import { imageDataCanvas, makeId } from './canvasUtils';
import { canvasFromPngBlob, canvasToPngBlob } from './workspacePersistence';
import { deduplicateHistoryPixels, snapshotOf } from './layerSnapshots';
import { resolvePixels, type PixelNode } from './historyPixels';
import type {
  DocumentSession, DocumentTab, FloatingPixelsState, GradientDraftState, HistorySnapshot,
  PaintLayer, ReeditableText, Selection,
} from './types';
import type {
  PersistedDocument, PersistedFloatingPixels, PersistedGradientDraft, PersistedHistorySnapshot,
  PersistedLayer, PersistedReeditableText, PersistedSelection,
} from './workspacePersistence';

/**
 * Turning the live editor state into what IndexedDB stores, and back.
 *
 * Layers and history snapshots become lossless PNG blobs, which is why this is the largest
 * thing the workspace writes and why section 5 of docs/final_polish.md wants history persisted
 * incrementally rather than rewritten whole on every save.
 */

export async function persistedSelectionOf(selection: Selection | null): Promise<PersistedSelection | null> {
  if (!selection) return null;
  return {
    tool: selection.tool,
    start: { ...selection.start },
    end: { ...selection.end },
    points: selection.points?.map((point) => ({ ...point })),
    mask: selection.mask ? await canvasToPngBlob(selection.mask) : undefined,
  };
}

export async function persistedFloatingPixelsOf(floating: FloatingPixelsState | null): Promise<PersistedFloatingPixels | null> {
  if (!floating) return null;
  return {
    layerId: floating.layerId,
    pixels: await canvasToPngBlob(floating.canvas),
    transform: { ...floating.transform },
  };
}

export async function floatingPixelsFromPersisted(floating: PersistedFloatingPixels | null | undefined): Promise<FloatingPixelsState | null> {
  if (!floating) return null;
  return {
    layerId: floating.layerId,
    canvas: await canvasFromPngBlob(floating.pixels),
    transform: { ...floating.transform },
  };
}

export async function selectionFromPersisted(selection: PersistedSelection | null) {
  if (!selection) return null;
  return {
    tool: selection.tool,
    start: { ...selection.start },
    end: { ...selection.end },
    points: selection.points?.map((point) => ({ ...point })),
    mask: selection.mask ? await canvasFromPngBlob(selection.mask) : undefined,
  } satisfies Selection;
}

export async function persistedLayerOf(layer: PaintLayer): Promise<PersistedLayer> {
  return {
    id: layer.id,
    name: layer.name,
    visible: layer.visible,
    opacity: layer.opacity,
    blendMode: layer.blendMode,
    pixels: await canvasToPngBlob(layer.canvas),
  };
}

/**
 * Encodes each distinct `PixelNode` once per save.
 *
 * History already shares nodes in memory: a step that leaves a layer untouched points both
 * entries at the same object. Writing without exploiting that re-encoded identical pixels once
 * per step per layer — a fifty-step history over four layers where only one is being painted
 * still wrote two hundred PNGs, of which a hundred and fifty were duplicates.
 *
 * Returning the *same* `Blob` instance for a repeated node also shrinks what is stored, because
 * structured clone records a second reference to an object it has already serialized rather than
 * copying it again. So an untouched layer costs one PNG in the database however long the history
 * grows.
 */
function pngBlobCache() {
  const encoded = new Map<PixelNode, Promise<Blob>>();
  return (node: PixelNode) => {
    const existing = encoded.get(node);
    if (existing) return existing;
    const blob = canvasToPngBlob(imageDataCanvas(resolvePixels(node)));
    encoded.set(node, blob);
    return blob;
  };
}

export async function persistedHistorySnapshotOf(
  snapshot: HistorySnapshot,
  pngFor: (node: PixelNode) => Promise<Blob> = pngBlobCache(),
): Promise<PersistedHistorySnapshot> {
  return {
    label: snapshot.label,
    layers: await Promise.all(snapshot.layers.map(async (layer) => ({
      id: layer.id,
      name: layer.name,
      visible: layer.visible,
      opacity: layer.opacity,
      blendMode: layer.blendMode,
      pixels: await pngFor(layer.pixels),
    }))),
    activeLayerId: snapshot.activeLayerId,
    width: snapshot.width,
    height: snapshot.height,
    selection: snapshot.selection ? {
      tool: snapshot.selection.tool,
      start: { ...snapshot.selection.start },
      end: { ...snapshot.selection.end },
      points: snapshot.selection.points?.map((point) => ({ ...point })),
      mask: snapshot.selection.mask ? await canvasToPngBlob(imageDataCanvas(snapshot.selection.mask)) : undefined,
    } : null,
    floatingPixels: snapshot.floatingPixels ? {
      layerId: snapshot.floatingPixels.layerId,
      pixels: await canvasToPngBlob(imageDataCanvas(snapshot.floatingPixels.pixels)),
      transform: { ...snapshot.floatingPixels.transform },
    } : null,
  };
}

export async function persistedReeditableTextOf(record: ReeditableText | null): Promise<PersistedReeditableText | null> {
  if (!record) return null;
  return {
    editor: { ...record.editor },
    options: { ...record.options },
    bounds: { ...record.bounds },
    layerId: record.layerId,
    historyIndex: record.historyIndex,
    basePixels: await canvasToPngBlob(record.baseCanvas),
    renderedPixels: await canvasToPngBlob(record.renderedCanvas),
  };
}

export async function reeditableTextFromPersisted(record: PersistedReeditableText | null | undefined, width: number, height: number): Promise<ReeditableText | null> {
  if (!record) return null;
  const [baseCanvas, renderedCanvas] = await Promise.all([
    canvasFromPngBlob(record.basePixels),
    canvasFromPngBlob(record.renderedPixels),
  ]);
  if (baseCanvas.width !== width || baseCanvas.height !== height || renderedCanvas.width !== width || renderedCanvas.height !== height) return null;
  return {
    editor: { ...record.editor },
    options: { ...record.options },
    bounds: { ...record.bounds },
    layerId: record.layerId,
    historyIndex: record.historyIndex,
    baseCanvas,
    renderedCanvas,
  };
}

export async function persistedGradientDraftOf(draft: GradientDraftState | null): Promise<PersistedGradientDraft | null> {
  if (!draft) return null;
  return {
    layerId: draft.layerId,
    start: { ...draft.start },
    end: { ...draft.end },
    reverseColors: draft.reverseColors,
    options: { ...draft.options },
    selection: await persistedSelectionOf(draft.selection),
    basePixels: await canvasToPngBlob(draft.baseCanvas),
  };
}

export async function gradientDraftFromPersisted(
  draft: PersistedGradientDraft | null | undefined,
  width: number,
  height: number,
  layers: PaintLayer[],
): Promise<GradientDraftState | null> {
  if (!draft || !layers.some((layer) => layer.id === draft.layerId)) return null;
  const [baseCanvas, selection] = await Promise.all([
    canvasFromPngBlob(draft.basePixels),
    selectionFromPersisted(draft.selection),
  ]);
  if (baseCanvas.width !== width || baseCanvas.height !== height) return null;
  return {
    layerId: draft.layerId,
    start: { ...draft.start },
    end: { ...draft.end },
    reverseColors: draft.reverseColors,
    options: { ...draft.options },
    selection,
    baseCanvas,
  };
}

export async function persistedDocumentOf(session: DocumentSession, withHistory: boolean): Promise<PersistedDocument> {
  const historyPng = pngBlobCache();
  return {
    id: session.id,
    fileName: session.fileName,
    dirty: session.dirty,
    width: session.width,
    height: session.height,
    layers: await Promise.all(session.layers.map(persistedLayerOf)),
    activeLayerId: session.activeLayerId,
    zoom: session.zoom,
    selection: await persistedSelectionOf(session.selection),
    floatingPixels: await persistedFloatingPixelsOf(session.floatingPixels),
    // Undo history is by far the largest thing stored, and the first thing to drop when the
    // origin is running out of room. One cache spans the whole document, so a layer that several
    // steps share is encoded and stored once rather than once per step.
    history: withHistory ? await Promise.all(session.history.map((entry) => persistedHistorySnapshotOf(entry, historyPng))) : [],
    historyIndex: withHistory ? session.historyIndex : 0,
    cleanHistoryIndex: withHistory ? session.cleanHistoryIndex : 0,
    textEditor: session.textEditor ? { ...session.textEditor } : null,
    reeditableTexts: await Promise.all(session.reeditableTexts.map(persistedReeditableTextOf)).then((records) => records.filter((record): record is PersistedReeditableText => record !== null)),
    reeditingText: await persistedReeditableTextOf(session.reeditingText),
    lineDraft: session.lineDraft,
    shapeDraft: session.shapeDraft,
    archivedShapeDrafts: session.archivedShapeDrafts,
    shapeDraftOrder: session.shapeDraftOrder,
    gradientDraft: await persistedGradientDraftOf(session.gradientDraft),
  };
}

export async function layerFromPersisted(storedLayer: PersistedLayer, width: number, height: number): Promise<PaintLayer> {
  const canvas = await canvasFromPngBlob(storedLayer.pixels);
  if (canvas.width !== width || canvas.height !== height) throw new Error('A stored layer has invalid dimensions.');
  return {
    id: storedLayer.id || makeId(),
    name: storedLayer.name || 'Layer',
    visible: storedLayer.visible,
    opacity: Math.max(0, Math.min(1, storedLayer.opacity)),
    blendMode: storedLayer.blendMode ?? 'normal',
    revision: 0,
    canvas,
  };
}

export async function historySnapshotFromPersisted(snapshot: PersistedHistorySnapshot): Promise<HistorySnapshot | null> {
  const width = Math.round(snapshot.width);
  const height = Math.round(snapshot.height);
  if (width < 1 || height < 1 || width > 16384 || height > 16384 || !snapshot.layers.length) return null;
  const layers = await Promise.all(snapshot.layers.map((layer) => layerFromPersisted(layer, width, height)));
  const activeLayerId = layers.some((layer) => layer.id === snapshot.activeLayerId)
    ? snapshot.activeLayerId
    : layers.at(-1)!.id;
  const selection = await selectionFromPersisted(snapshot.selection);
  const floatingPixels = await floatingPixelsFromPersisted(snapshot.floatingPixels);
  return snapshotOf(layers, activeLayerId, width, height, snapshot.label || 'Edit', selection, floatingPixels);
}

export async function documentFromPersisted(documentState: PersistedDocument): Promise<DocumentSession | null> {
  const width = Math.round(documentState.width);
  const height = Math.round(documentState.height);
  if (!documentState.id || !documentState.fileName || width < 1 || height < 1 || width > 16384 || height > 16384) return null;
  const layers = await Promise.all(documentState.layers.map((layer) => layerFromPersisted(layer, width, height)));
  if (!layers.length) return null;
  const activeLayerId = layers.some((layer) => layer.id === documentState.activeLayerId)
    ? documentState.activeLayerId
    : layers.at(-1)!.id;
  const selection = await selectionFromPersisted(documentState.selection);
  const floatingPixels = await floatingPixelsFromPersisted(documentState.floatingPixels);
  const storedTextRecords = documentState.reeditableTexts?.length
    ? documentState.reeditableTexts
    : documentState.reeditableText ? [documentState.reeditableText] : [];
  const [reeditableTexts, reeditingText, gradientDraft] = await Promise.all([
    Promise.all(storedTextRecords.map((record) => reeditableTextFromPersisted(record, width, height))).then((records) => records.filter((record): record is ReeditableText => record !== null)),
    reeditableTextFromPersisted(documentState.reeditingText, width, height),
    gradientDraftFromPersisted(documentState.gradientDraft, width, height, layers),
  ]);
  const restoredHistory = documentState.history?.length
    ? (await Promise.all(documentState.history.map(historySnapshotFromPersisted))).filter((entry): entry is HistorySnapshot => entry !== null)
    : [];
  const legacyLabel = documentState.fileName.startsWith('Unsaved Image') ? 'New Image' : 'Open Image';
  const history = restoredHistory.length
    ? deduplicateHistoryPixels(restoredHistory)
    : [snapshotOf(layers, activeLayerId, width, height, legacyLabel, selection)];
  const requestedHistoryIndex = Math.round(documentState.historyIndex ?? 0);
  const historyIndex = Math.max(0, Math.min(history.length - 1, requestedHistoryIndex));
  const requestedCleanHistoryIndex = Math.round(documentState.cleanHistoryIndex ?? (documentState.dirty ? -1 : historyIndex));
  const cleanHistoryIndex = requestedCleanHistoryIndex < 0
    ? -1
    : Math.max(0, Math.min(history.length - 1, requestedCleanHistoryIndex));
  return {
    id: documentState.id,
    fileName: documentState.fileName,
    dirty: documentState.dirty,
    width,
    height,
    layers,
    activeLayerId,
    history,
    historyIndex,
    cleanHistoryIndex,
    zoom: Math.max(0.1, Math.min(4, documentState.zoom || 0.8)),
    selection,
    floatingPixels,
    textEditor: documentState.textEditor ? { ...documentState.textEditor } : null,
    reeditableTexts,
    reeditingText,
    lineDraft: documentState.lineDraft ?? null,
    shapeDraft: documentState.shapeDraft ?? null,
    archivedShapeDrafts: documentState.archivedShapeDrafts ?? [],
    shapeDraftOrder: documentState.shapeDraftOrder ?? [],
    gradientDraft,
  };
}

export function documentTabOf(session: DocumentSession): DocumentTab {
  return {
    id: session.id,
    fileName: session.fileName,
    dirty: session.dirty,
    width: session.width,
    height: session.height,
  };
}
