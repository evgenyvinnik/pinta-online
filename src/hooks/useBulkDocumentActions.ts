import { useCallback, useEffect, useState, useRef } from 'react';
import type { usePaintEditor } from '../editor/usePaintEditor';
import { initialExportFormat } from '../components/dialogs/documentDialogs';

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
  editor, notify, showError, pendingFlattenAction, setPendingFlattenAction, setPendingSaveAction,
  setShowSaveAs, isSaveAsOpen, closeMenus,
}: BulkDocumentOptions) {
  const [closingDocumentId, setClosingDocumentId] = useState<string | null>(null);
  const [showCloseAllConfirm, setShowCloseAllConfirm] = useState(false);
  const [closeAllQueue, setCloseAllQueue] = useState<string[]>([]);
  const [saveAllQueue, setSaveAllQueue] = useState<string[]>([]);
  const [saveAllCount, setSaveAllCount] = useState(0);
  const saveAllWriteRef = useRef(false);

  const requestCloseAll = useCallback(() => {
    closeMenus();
    const dirtyDocuments = editor.documents.filter((document) => document.dirty);
    if (!dirtyDocuments.length) {
      editor.closeAllDocuments();
      return;
    }
    const queue = dirtyDocuments.map((document) => document.id);
    editor.switchDocument(queue[0]);
    setCloseAllQueue(queue);
    setShowCloseAllConfirm(true);
  }, [editor]);

  const completeCloseAllStep = useCallback((completedId: string) => {
    const remaining = closeAllQueue.filter((id) => id !== completedId);
    if (!remaining.length) {
      editor.closeAllDocuments();
      setCloseAllQueue([]);
      setShowCloseAllConfirm(false);
      return;
    }
    editor.closeDocument(completedId);
    editor.switchDocument(remaining[0]);
    setCloseAllQueue(remaining);
    setShowCloseAllConfirm(true);
  }, [closeAllQueue, editor]);

  const completeSaveAllStep = useCallback((completedId: string, saved: boolean) => {
    const remaining = saveAllQueue.filter((id) => id !== completedId);
    const completedCount = saveAllCount + (saved ? 1 : 0);
    setSaveAllCount(completedCount);
    setSaveAllQueue(remaining);
    if (!remaining.length) {
      notify(completedCount
        ? `Saved ${completedCount} ${completedCount === 1 ? 'image' : 'images'}`
        : 'All images are already saved');
      return;
    }
    editor.switchDocument(remaining[0]);
  }, [editor, notify, saveAllCount, saveAllQueue]);

  const requestSaveAll = useCallback(() => {
    closeMenus();
    const queue = editor.documents.filter((document) => document.dirty).map((document) => document.id);
    if (!queue.length) {
      notify('All images are already saved');
      return;
    }
    setSaveAllCount(0);
    setSaveAllQueue(queue);
    editor.switchDocument(queue[0]);
  }, [editor, notify]);

  useEffect(() => {
    const documentId = saveAllQueue[0];
    if (!documentId || saveAllWriteRef.current || isSaveAsOpen() || pendingFlattenAction) return;
    if (editor.activeDocumentId !== documentId) {
      editor.switchDocument(documentId);
      return;
    }
    const documentState = editor.documents.find((document) => document.id === documentId);
    if (!documentState?.dirty) {
      completeSaveAllStep(documentId, false);
      return;
    }
    if (/^Unsaved Image(?:\s+\d+)?$/i.test(documentState.fileName)) {
      setPendingSaveAction({ kind: 'save-all', documentId });
      setShowSaveAs(true);
      return;
    }
    if (editor.layers.length > 1 && initialExportFormat(documentState.fileName) !== 'ora') {
      setPendingFlattenAction({ kind: 'save-all', documentId });
      return;
    }
    saveAllWriteRef.current = true;
    void editor.saveImage().then((saved) => {
      saveAllWriteRef.current = false;
      if (saved) completeSaveAllStep(documentId, true);
      else setSaveAllQueue([]);
    }).catch((error) => {
      saveAllWriteRef.current = false;
      setSaveAllQueue([]);
      showError('Failed to save image', error instanceof Error ? error.message : 'The image could not be saved.', error);
    });
  }, [completeSaveAllStep, editor, pendingFlattenAction, saveAllQueue, showError, setShowSaveAs]);

  return {
    closingDocumentId, setClosingDocumentId,
    showCloseAllConfirm, setShowCloseAllConfirm,
    closeAllQueue, setCloseAllQueue,
    saveAllQueue, setSaveAllQueue, saveAllCount,
    requestCloseAll, completeCloseAllStep, completeSaveAllStep, requestSaveAll,
  };
}
