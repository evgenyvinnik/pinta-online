/**
 * Recovery paths for a workspace that cannot be restored without crashing.
 *
 * Everything here deliberately avoids the editor, React, and the rendering code, because it
 * has to keep working when exactly those are the parts that failed. Layers are already stored
 * as PNG blobs, so a copy can be handed to the user without decoding a single pixel.
 */
import { loadWorkspace } from './workspacePersistence';

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
}

/**
 * Downloads every stored layer as a PNG, straight from IndexedDB. This is the last line of
 * defence: it runs when the editor that would normally export the work is the broken thing.
 */
export async function downloadWorkspaceCopy(): Promise<RecoveredCopy> {
  const workspace = await loadWorkspace();
  const documents = workspace?.documents ?? [];
  if (!documents.length) throw new Error('There is no saved work to recover.');

  let layers = 0;
  for (const document of documents) {
    const base = safeFileName(document.fileName).replace(/\.[^.]+$/, '');
    const multiple = document.layers.length > 1;
    for (const [index, layer] of document.layers.entries()) {
      if (!(layer.pixels instanceof Blob)) continue;
      const suffix = multiple ? `-${String(index + 1).padStart(2, '0')}-${safeFileName(layer.name)}` : '';
      downloadBlob(layer.pixels, `${base}${suffix}.png`);
      layers += 1;
    }
  }

  if (!layers) throw new Error('The saved work could not be read.');
  return { documents: documents.length, layers };
}
