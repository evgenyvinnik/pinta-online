import { useCallback, type MutableRefObject } from 'react';
import { context2d } from './canvasContext';
import { makeCanvas, makeId } from './canvasUtils';
import {
  createDocumentExportBlob,
  decodeImageFile,
  exportExtension,
  exportFormatFromFileName,
  writeExportBlob,
} from './exportFormats';
import { makeLayer, paintLayer, snapshotOf } from './layerSnapshots';
import { DEFAULT_HEIGHT, DEFAULT_WIDTH } from './types';
import type { DocumentSession, ExportOptions, PaintLayer, Selection } from './types';

interface FileCommandDeps {
  layersRef: MutableRefObject<PaintLayer[]>;
  dimensionsRef: MutableRefObject<{ width: number; height: number }>;
  documentsRef: MutableRefObject<DocumentSession[]>;
  activeDocumentIdRef: MutableRefObject<string>;
  historyIndexRef: MutableRefObject<number>;
  cleanHistoryIndexRef: MutableRefObject<number>;
  untitledCounterRef: MutableRefObject<number>;
  currentDocumentViewRef: MutableRefObject<{
    fileName: string;
    dirty: boolean;
    zoom: number;
    selection: Selection | null;
    floatingPixels: unknown;
  }>;
  effectBusyRef: MutableRefObject<boolean>;
  commitPendingEditsRef: MutableRefObject<(label?: string) => boolean>;
  captureActiveDocument: () => void;
  loadDocument: (session: DocumentSession) => void;
  clearActiveDocument: () => void;
  publishDocumentTabs: () => void;
  setFileName: (name: string) => void;
  setDirty: (dirty: boolean) => void;
  /** New Image fills a transparent-or-secondary background with this. */
  secondary: string;
}

/** Creating, opening, saving and closing documents. */

export function useFileCommands({
  layersRef,
  dimensionsRef,
  documentsRef,
  activeDocumentIdRef,
  historyIndexRef,
  cleanHistoryIndexRef,
  untitledCounterRef,
  currentDocumentViewRef,
  effectBusyRef,
  commitPendingEditsRef,
  captureActiveDocument,
  loadDocument,
  clearActiveDocument,
  publishDocumentTabs,
  setFileName,
  setDirty,
  secondary,
}: FileCommandDeps) {
  const newDocument = useCallback(
    (
      newWidth = DEFAULT_WIDTH,
      newHeight = DEFAULT_HEIGHT,
      background: 'white' | 'secondary' | 'transparent' = 'white',
    ) => {
      const safeWidth = Math.max(1, Math.min(16384, Math.round(newWidth)));
      const safeHeight = Math.max(1, Math.min(16384, Math.round(newHeight)));
      const layer = makeLayer(safeWidth, safeHeight, 'Background', background === 'white');
      if (background === 'secondary') {
        const context = context2d(layer.canvas);
        context.fillStyle = secondary;
        context.fillRect(0, 0, safeWidth, safeHeight);
      }
      const entry = snapshotOf([layer], layer.id, safeWidth, safeHeight, 'New Image');
      const session: DocumentSession = {
        id: makeId(),
        fileName: `Unsaved Image ${untitledCounterRef.current++}`,
        dirty: false,
        width: safeWidth,
        height: safeHeight,
        layers: [layer],
        activeLayerId: layer.id,
        history: [entry],
        historyIndex: 0,
        cleanHistoryIndex: 0,
        zoom: 1,
        selection: null,
        floatingPixels: null,
        textEditor: null,
        reeditableTexts: [],
        reeditingText: null,
        lineDraft: null,
        shapeDraft: null,
        archivedShapeDrafts: [],
        shapeDraftOrder: [],
        gradientDraft: null,
      };
      commitPendingEditsRef.current();
      captureActiveDocument();
      const activeIndex = documentsRef.current.findIndex((candidate) => candidate.id === activeDocumentIdRef.current);
      const next = [...documentsRef.current];
      next.splice(activeIndex + 1, 0, session);
      documentsRef.current = next;
      loadDocument(session);
      publishDocumentTabs();
    },
    [
      activeDocumentIdRef,
      captureActiveDocument,
      commitPendingEditsRef,
      documentsRef,
      loadDocument,
      publishDocumentTabs,
      secondary,
      untitledCounterRef,
    ],
  );

  const newDocumentFromCanvas = useCallback(
    (source: HTMLCanvasElement, historyLabel = 'New Screenshot') => {
      const safeWidth = Math.max(1, Math.min(16384, source.width));
      const safeHeight = Math.max(1, Math.min(16384, source.height));
      const layer = makeLayer(safeWidth, safeHeight, 'Background');
      context2d(layer.canvas).drawImage(source, 0, 0, safeWidth, safeHeight);
      const entry = snapshotOf([layer], layer.id, safeWidth, safeHeight, historyLabel);
      const session: DocumentSession = {
        id: makeId(),
        fileName: `Unsaved Image ${untitledCounterRef.current++}`,
        dirty: false,
        width: safeWidth,
        height: safeHeight,
        layers: [layer],
        activeLayerId: layer.id,
        history: [entry],
        historyIndex: 0,
        cleanHistoryIndex: 0,
        zoom: 1,
        selection: null,
        floatingPixels: null,
        textEditor: null,
        reeditableTexts: [],
        reeditingText: null,
        lineDraft: null,
        shapeDraft: null,
        archivedShapeDrafts: [],
        shapeDraftOrder: [],
        gradientDraft: null,
      };
      commitPendingEditsRef.current();
      captureActiveDocument();
      const activeIndex = documentsRef.current.findIndex((candidate) => candidate.id === activeDocumentIdRef.current);
      const next = [...documentsRef.current];
      next.splice(activeIndex + 1, 0, session);
      documentsRef.current = next;
      loadDocument(session);
      publishDocumentTabs();
      return true;
    },
    [
      activeDocumentIdRef,
      captureActiveDocument,
      commitPendingEditsRef,
      documentsRef,
      loadDocument,
      publishDocumentTabs,
      untitledCounterRef,
    ],
  );

  const openFile = useCallback(
    async (file: File, fileHandle?: FileSystemFileHandle) => {
      const opened = await decodeImageFile(file);
      const activeLayer = opened.layers.at(-1)!;
      const entry = snapshotOf(opened.layers, activeLayer.id, opened.width, opened.height, 'Open Image');
      const session: DocumentSession = {
        id: makeId(),
        fileName: file.name,
        dirty: false,
        width: opened.width,
        height: opened.height,
        layers: opened.layers,
        activeLayerId: activeLayer.id,
        history: [entry],
        historyIndex: 0,
        cleanHistoryIndex: 0,
        zoom: 1,
        selection: null,
        floatingPixels: null,
        textEditor: null,
        reeditableTexts: [],
        reeditingText: null,
        lineDraft: null,
        shapeDraft: null,
        archivedShapeDrafts: [],
        shapeDraftOrder: [],
        gradientDraft: null,
        fileHandle,
      };
      commitPendingEditsRef.current();
      captureActiveDocument();
      const activeIndex = documentsRef.current.findIndex((candidate) => candidate.id === activeDocumentIdRef.current);
      const next = [...documentsRef.current];
      next.splice(activeIndex + 1, 0, session);
      documentsRef.current = next;
      loadDocument(session);
      publishDocumentTabs();
    },
    [
      activeDocumentIdRef,
      captureActiveDocument,
      commitPendingEditsRef,
      documentsRef,
      loadDocument,
      publishDocumentTabs,
    ],
  );

  const saveImage = useCallback(
    async (options: ExportOptions = {}) => {
      commitPendingEditsRef.current();
      const currentName = currentDocumentViewRef.current.fileName;
      const format = options.format ?? exportFormatFromFileName(currentName) ?? 'png';
      const requestedName = options.fileName?.trim() || currentName;
      const baseName = requestedName.replace(/\.[^.]+$/, '') || 'pinta-image';
      const fallbackName = `${baseName}.${exportExtension(format)}`;
      const blob = await createDocumentExportBlob(
        layersRef.current,
        dimensionsRef.current.width,
        dimensionsRef.current.height,
        format,
        options.quality ?? 0.92,
      );
      if (!blob) return false;
      const session = documentsRef.current.find((candidate) => candidate.id === activeDocumentIdRef.current);
      const fileHandle = options.fileHandle ?? (options.fileName === undefined ? session?.fileHandle : undefined);
      const savedName = await writeExportBlob(blob, fallbackName, fileHandle);
      cleanHistoryIndexRef.current = historyIndexRef.current;
      if (session) {
        session.fileName = savedName;
        session.dirty = false;
        session.cleanHistoryIndex = historyIndexRef.current;
        if (fileHandle) session.fileHandle = fileHandle;
      }
      currentDocumentViewRef.current.fileName = savedName;
      currentDocumentViewRef.current.dirty = false;
      setFileName(savedName);
      setDirty(false);
      publishDocumentTabs();
      return true;
    },
    [
      activeDocumentIdRef,
      cleanHistoryIndexRef,
      commitPendingEditsRef,
      currentDocumentViewRef,
      dimensionsRef,
      documentsRef,
      historyIndexRef,
      layersRef,
      publishDocumentTabs,
      setDirty,
      setFileName,
    ],
  );

  const saveAllImages = useCallback(async () => {
    commitPendingEditsRef.current();
    captureActiveDocument();
    const dirtyDocuments = documentsRef.current.filter((session) => session.dirty);
    let saved = 0;
    for (const session of dirtyDocuments) {
      try {
        const format = exportFormatFromFileName(session.fileName) ?? 'png';
        const baseName = session.fileName.replace(/\.[^.]+$/, '') || 'pinta-image';
        const fallbackName = `${baseName}.${exportExtension(format)}`;
        const blob = await createDocumentExportBlob(session.layers, session.width, session.height, format);
        if (!blob) continue;
        session.fileName = await writeExportBlob(blob, fallbackName, session.fileHandle);
        session.dirty = false;
        session.cleanHistoryIndex = session.historyIndex;
        saved += 1;
      } catch {
        // Keep failed documents dirty so a later Save or Save As can retry them.
      }
    }
    const active = documentsRef.current.find((session) => session.id === activeDocumentIdRef.current);
    if (active) {
      cleanHistoryIndexRef.current = active.cleanHistoryIndex;
      currentDocumentViewRef.current.fileName = active.fileName;
      currentDocumentViewRef.current.dirty = active.dirty;
      setFileName(active.fileName);
      setDirty(active.dirty);
    }
    publishDocumentTabs();
    return saved;
  }, [
    activeDocumentIdRef,
    captureActiveDocument,
    cleanHistoryIndexRef,
    commitPendingEditsRef,
    currentDocumentViewRef,
    documentsRef,
    publishDocumentTabs,
    setDirty,
    setFileName,
  ]);

  const createCompositeDataUrl = useCallback(() => {
    commitPendingEditsRef.current();
    const output = makeCanvas(dimensionsRef.current.width, dimensionsRef.current.height);
    const context = context2d(output);
    for (const layer of layersRef.current) paintLayer(context, layer);
    return output.toDataURL('image/png');
  }, [commitPendingEditsRef, dimensionsRef, layersRef]);

  const closeDocument = useCallback(
    (id: string) => {
      if (effectBusyRef.current) return false;
      commitPendingEditsRef.current();
      captureActiveDocument();
      const closingIndex = documentsRef.current.findIndex((candidate) => candidate.id === id);
      if (closingIndex < 0) return false;
      const closingActiveDocument = id === activeDocumentIdRef.current;
      const remaining = documentsRef.current.filter((candidate) => candidate.id !== id);

      documentsRef.current = remaining;
      if (closingActiveDocument) {
        const nextActive = remaining[Math.min(closingIndex, remaining.length - 1)];
        if (nextActive) loadDocument(nextActive);
        else clearActiveDocument();
      }
      publishDocumentTabs();
      return true;
    },
    [
      activeDocumentIdRef,
      captureActiveDocument,
      clearActiveDocument,
      commitPendingEditsRef,
      documentsRef,
      effectBusyRef,
      loadDocument,
      publishDocumentTabs,
    ],
  );

  const closeAllDocuments = useCallback(() => {
    if (effectBusyRef.current) return false;
    commitPendingEditsRef.current();
    documentsRef.current = [];
    clearActiveDocument();
    publishDocumentTabs();
    return true;
  }, [clearActiveDocument, commitPendingEditsRef, documentsRef, effectBusyRef, publishDocumentTabs]);

  return {
    newDocument,
    newDocumentFromCanvas,
    openFile,
    saveImage,
    saveAllImages,
    createCompositeDataUrl,
    closeDocument,
    closeAllDocuments,
  };
}
