import { useCallback, useEffect, useState, useRef } from 'react';
import type { usePaintEditor } from '../editor/usePaintEditor';
import { exportFormatFromFileName } from '../editor/exportFormats';

interface BulkDocumentOptions {
  editor: ReturnType<typeof usePaintEditor>;
  notify: (message: string) => void;
  showError: (title: string, message: string, error: unknown) => void;
  pendingFlattenAction: FlattenAction | null;
  setPendingFlattenAction: (action: FlattenAction | null) => void;
  setPendingSaveAction: (action: SaveAction | null) => void;
  setShowSaveAs: (show: boolean) => void;
  isSaveAsOpen: () => boolean;
  closeMenus: () => void;
}

/**
 * Close All and Save All, both of which walk the open documents one at a time.
 *
 * They are driven by a queue plus an effect rather than a loop because each step can open a
 * dialog — Save As, or the flatten confirmation — and has to wait for the user before the next
 * document is switched to. `saveAllWriteRef` guards against the effect re-entering while a write
 * is still in flight, which a state flag could not do because it has to be read synchronously.
 */
export type SaveAction = { kind: 'close' | 'close-all' | 'save-all'; documentId: string };
export type FlattenAction = { kind: 'save' | 'close' | 'close-all' | 'save-all'; documentId: string };

export function useBulkDocumentActions({
  editor,
  notify,
  showError,
  pendingFlattenAction,
  setPendingFlattenAction,
  setPendingSaveAction,
  setShowSaveAs,
  isSaveAsOpen,
  closeMenus,
}: BulkDocumentOptions) {
  const [closingDocumentId, setClosingDocumentId] = useState<string | null>(null);
  const [showCloseAllConfirm, setShowCloseAllConfirm] = useState(false);
  const [closeAllQueue, setCloseAllQueue] = useState<string[]>([]);
  const [saveAllQueue, setSaveAllQueueState] = useState<string[]>([]);
  const [saveAllCount, setSaveAllCount] = useState(0);
  const saveAllQueueRef = useRef<string[]>([]);
  const saveAllCountRef = useRef(0);
  const saveAllWriteRef = useRef(false);
  const editorRef = useRef(editor);
  editorRef.current = editor;

  const setSaveAllQueue = useCallback((value: string[] | ((current: string[]) => string[])) => {
    const next = typeof value === 'function' ? value(saveAllQueueRef.current) : value;
    saveAllQueueRef.current = next;
    setSaveAllQueueState(next);
  }, []);

  const requestCloseAll = useCallback(() => {
    closeMenus();
    const currentEditor = editorRef.current;
    const dirtyDocuments = currentEditor.documents.filter((document) =>
      document.id === currentEditor.activeDocumentId ? currentEditor.dirty : document.dirty,
    );
    if (!dirtyDocuments.length) {
      currentEditor.closeAllDocuments();
      return;
    }
    const queue = dirtyDocuments.map((document) => document.id);
    currentEditor.switchDocument(queue[0]);
    setCloseAllQueue(queue);
    setShowCloseAllConfirm(true);
  }, [closeMenus]);

  const completeCloseAllStep = useCallback(
    (completedId: string) => {
      const remaining = closeAllQueue.filter((id) => id !== completedId);
      if (!remaining.length) {
        editorRef.current.closeAllDocuments();
        setCloseAllQueue([]);
        setShowCloseAllConfirm(false);
        return;
      }
      editorRef.current.closeDocument(completedId);
      editorRef.current.switchDocument(remaining[0]);
      setCloseAllQueue(remaining);
      setShowCloseAllConfirm(true);
    },
    [closeAllQueue],
  );

  const completeSaveAllStep = useCallback(
    (completedId: string, saved: boolean) => {
      const remaining = saveAllQueueRef.current.filter((id) => id !== completedId);
      const completedCount = saveAllCountRef.current + (saved ? 1 : 0);
      saveAllCountRef.current = completedCount;
      setSaveAllCount(completedCount);
      setSaveAllQueue(remaining);
      if (!remaining.length) {
        notify(
          completedCount
            ? `Saved ${completedCount} ${completedCount === 1 ? 'image' : 'images'}`
            : 'All images are already saved',
        );
        return;
      }
      editorRef.current.switchDocument(remaining[0]);
    },
    [notify, setSaveAllQueue],
  );

  const requestSaveAll = useCallback(() => {
    closeMenus();
    const currentEditor = editorRef.current;
    const queue = currentEditor.documents
      .filter((document) => (document.id === currentEditor.activeDocumentId ? currentEditor.dirty : document.dirty))
      .map((document) => document.id);
    if (!queue.length) {
      notify('All images are already saved');
      return;
    }
    saveAllCountRef.current = 0;
    setSaveAllCount(0);
    setSaveAllQueue(queue);
    currentEditor.switchDocument(queue[0]);
  }, [closeMenus, notify, setSaveAllQueue]);

  const writeSaveAllDocument = useCallback(
    async (documentId: string) => {
      if (saveAllWriteRef.current) return false;
      saveAllWriteRef.current = true;
      try {
        const saved = await editorRef.current.saveImage();
        if (saved) completeSaveAllStep(documentId, true);
        else setSaveAllQueue([]);
        return saved;
      } catch (error) {
        setSaveAllQueue([]);
        showError(
          'Failed to save image',
          error instanceof Error ? error.message : 'The image could not be saved.',
          error,
        );
        return false;
      } finally {
        saveAllWriteRef.current = false;
      }
    },
    [completeSaveAllStep, setSaveAllQueue, showError],
  );

  useEffect(() => {
    const documentId = saveAllQueue[0];
    if (!documentId || saveAllWriteRef.current || isSaveAsOpen() || pendingFlattenAction) return;
    if (editor.activeDocumentId !== documentId) {
      editor.switchDocument(documentId);
      return;
    }
    const storedDocument = editor.documents.find((document) => document.id === documentId);
    const documentState =
      storedDocument && documentId === editor.activeDocumentId
        ? { ...storedDocument, dirty: editor.dirty, fileName: editor.fileName }
        : storedDocument;
    if (!documentState?.dirty) {
      completeSaveAllStep(documentId, false);
      return;
    }
    if (/^Unsaved Image(?:\s+\d+)?$/i.test(documentState.fileName)) {
      setPendingSaveAction({ kind: 'save-all', documentId });
      setShowSaveAs(true);
      return;
    }
    if (editor.layers.length > 1 && (exportFormatFromFileName(documentState.fileName) ?? 'png') !== 'ora') {
      setPendingFlattenAction({ kind: 'save-all', documentId });
      return;
    }
    void writeSaveAllDocument(documentId);
  }, [
    completeSaveAllStep,
    editor,
    pendingFlattenAction,
    saveAllQueue,
    setShowSaveAs,
    isSaveAsOpen,
    setPendingSaveAction,
    setPendingFlattenAction,
    writeSaveAllDocument,
  ]);

  return {
    closingDocumentId,
    setClosingDocumentId,
    showCloseAllConfirm,
    setShowCloseAllConfirm,
    closeAllQueue,
    setCloseAllQueue,
    saveAllQueue,
    setSaveAllQueue,
    saveAllCount,
    requestCloseAll,
    completeCloseAllStep,
    completeSaveAllStep,
    requestSaveAll,
    writeSaveAllDocument,
  };
}
