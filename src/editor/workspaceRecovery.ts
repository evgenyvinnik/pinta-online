/**
 * Recovery paths for a workspace that cannot be restored without crashing.
 *
 * Everything here deliberately avoids the editor, React, and the rendering code, because it
 * has to keep working when exactly those are the parts that failed. Layers are already stored
 * as PNG blobs, so a copy can be handed to the user without decoding a single pixel.
 *
 * That constraint is also what makes an OpenRaster download possible here:
 * `encodeOpenRasterArchive` is a pure function from PNG bytes to a zip, so the recovered file
 * keeps layer names, visibility, opacity and blend modes instead of flattening the work into a
 * pile of loose images. If anything about that fails the loose PNGs are still written, because
 * a worse copy beats no copy when this code path is running at all.
 */
import { encodeOpenRasterArchive, type OpenRasterLayerData } from './openRaster';
import { loadWorkspace, type PersistedDocument } from './workspacePersistence';

const SKIP_RESTORE_KEY = 'pinta-online-skip-restore';

/**
 * Asks the next boot to start empty instead of replaying the stored workspace. Session storage
 * is deliberate: the escape lasts for this tab until it is used, and never becomes a setting a
 * user has to find and undo.
 */
export function requestRestoreSkip() {
  try {
    sessionStorage.setItem(SKIP_RESTORE_KEY, '1');
  } catch {
    // A browser refusing session storage still gets a plain reload, which is the common fix.
  }
}

/** Reads the flag and clears it, so skipping restore never becomes sticky. */
export function consumeRestoreSkip() {
  try {
    const requested = sessionStorage.getItem(SKIP_RESTORE_KEY) === '1';
    if (requested) sessionStorage.removeItem(SKIP_RESTORE_KEY);
    return requested;
  } catch {
    return false;
  }
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoking immediately can cancel the download in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function safeFileName(name: string) {
  return (name || 'image').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'image';
}

export interface RecoveredCopy {
  documents: number;
  layers: number;
  /** How many documents were written as `.ora` rather than loose PNGs. */
  archives: number;
}

/**
 * `mergedimage.png` is required by the OpenRaster spec, and native Pinta writes one. Producing
 * it means compositing, which is the kind of work this module exists to avoid depending on, so
 * a single-layer document reuses its only layer and anything else goes without. Pinta's own
 * reader only requires `stack.xml`, and the layers are all present either way.
 */
function mergedImageFor(layers: OpenRasterLayerData[]) {
  return layers.length === 1 ? layers[0].png : undefined;
}

async function openRasterBytesFor(document: PersistedDocument) {
  const layers: OpenRasterLayerData[] = [];
  for (const layer of document.layers) {
    if (!(layer.pixels instanceof Blob)) continue;
    layers.push({
      name: layer.name,
      visible: layer.visible,
      opacity: layer.opacity,
      blendMode: layer.blendMode,
      x: 0,
      y: 0,
      png: new Uint8Array(await layer.pixels.arrayBuffer()),
    });
  }
  if (!layers.length) return null;
  const bytes = encodeOpenRasterArchive({
    width: document.width,
    height: document.height,
    layers,
    mergedPng: mergedImageFor(layers),
  });
  return { bytes, layers: layers.length };
}

function downloadLooseLayers(document: PersistedDocument, base: string) {
  let written = 0;
  const multiple = document.layers.length > 1;
  for (const [index, layer] of document.layers.entries()) {
    if (!(layer.pixels instanceof Blob)) continue;
    const suffix = multiple ? `-${String(index + 1).padStart(2, '0')}-${safeFileName(layer.name)}` : '';
    downloadBlob(layer.pixels, `${base}${suffix}.png`);
    written += 1;
  }
  return written;
}

/**
 * Downloads the stored work straight from IndexedDB, as one `.ora` per image where that can be
 * built and loose layer PNGs where it cannot. This is the last line of defence: it runs when the
 * editor that would normally export the work is the broken thing.
 */
export async function downloadWorkspaceCopy(): Promise<RecoveredCopy> {
  const workspace = await loadWorkspace();
  const documents = workspace?.documents ?? [];
  if (!documents.length) throw new Error('There is no saved work to recover.');

  let layers = 0;
  let archives = 0;
  for (const document of documents) {
    const base = safeFileName(document.fileName).replace(/\.[^.]+$/, '');
    let archived = null;
    try {
      archived = await openRasterBytesFor(document);
    } catch {
      // Zipping can fail on a document large enough to exhaust memory, which is one of the
      // reasons the workspace may have been unrecoverable in the first place. Fall through.
    }
    if (archived) {
      downloadBlob(new Blob([archived.bytes as BlobPart], { type: 'image/openraster' }), `${base}.ora`);
      layers += archived.layers;
      archives += 1;
    } else {
      layers += downloadLooseLayers(document, base);
    }
  }

  if (!layers) throw new Error('The saved work could not be read.');
  return { documents: documents.length, layers, archives };
}
