import { useCallback, useEffect, useRef, useState } from 'react';
import { isEditableTarget } from '../editor/shortcuts';
import type { usePaintEditor } from '../editor/usePaintEditor';

export type PasteTarget = 'current' | 'new-layer' | 'new-image';

interface ClipboardBridgeOptions {
  editor: ReturnType<typeof usePaintEditor>;
  notify: (message: string) => void;
  /** Pasting from a menu dismisses it before any dialog opens. */
  closeMenus: () => void;
}

/**
 * The bridge between the OS clipboard and the editor's own.
 *
 * The window `paste` listener is here rather than in App because it is the fallback path: a
 * browser that refuses `navigator.clipboard.read` still delivers a paste event, and
 * `fallbackPasteTargetRef` carries the target the user actually chose from the menu into that
 * event, which arrives with no argument of its own.
 */
export function useClipboardBridge({ editor, notify, closeMenus }: ClipboardBridgeOptions) {
  const [pendingPaste, setPendingPaste] = useState<'current' | 'new-layer' | null>(null);
  const [clipboardInformation, setClipboardInformation] = useState<{ title: string; message: string } | null>(null);
  const fallbackPasteTargetRef = useRef<PasteTarget>('current');

  const performPaste = useCallback((target: PasteTarget, expandCanvas = false) => {
    const effectiveTarget = editor.documents.length ? target : 'new-image';
    const pasted = effectiveTarget === 'current'
      ? editor.paste(expandCanvas)
      : effectiveTarget === 'new-layer'
        ? editor.pasteIntoNewLayer(expandCanvas)
        : editor.pasteIntoNewImage();
    if (pasted) notify(effectiveTarget === 'current' ? 'Pasted into the current layer' : effectiveTarget === 'new-layer' ? 'Pasted into a new layer' : 'Pasted into a new image');
    return pasted;
  }, [editor, notify]);

  const pasteImportedImage = useCallback(async (blob: Blob, target: PasteTarget) => {
    const size = await editor.importClipboardImage(blob);
    const effectiveTarget = editor.documents.length ? target : 'new-image';
    if (effectiveTarget !== 'new-image' && (size.width > editor.width || size.height > editor.height)) {
      closeMenus();
      setPendingPaste(effectiveTarget);
      return true;
    }
    return performPaste(effectiveTarget);
  }, [editor, performPaste]);

  const showEmptyClipboard = useCallback(() => {
    setClipboardInformation({ title: 'Image cannot be pasted', message: 'The clipboard does not contain an image.' });
  }, []);

  const requestPaste = useCallback(async (target: PasteTarget = 'current') => {
    closeMenus();
    if (navigator.clipboard?.read) {
      try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const imageType = item.types.find((type) => type.startsWith('image/'));
          if (imageType) return pasteImportedImage(await item.getType(imageType), target);
        }
      } catch {
        // Permission-restricted browsers can still use Pinta's in-app clipboard.
      }
    }
    // Browsers that refuse the image write, or an operating-system clipboard holding
    // unrelated content, must still paste whatever Pinta itself copied.
    if (!editor.hasClipboard) {
      showEmptyClipboard();
      return false;
    }
    if (editor.documents.length && target !== 'new-image' && (editor.clipboardSize.width > editor.width || editor.clipboardSize.height > editor.height)) {
      setPendingPaste(target);
      return true;
    }
    return performPaste(target);
  }, [editor.clipboardSize.height, editor.clipboardSize.width, editor.documents.length, editor.hasClipboard, editor.height, editor.width, pasteImportedImage, performPaste, showEmptyClipboard]);

  const publishClipboardImage = useCallback(async () => {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return false;
    const pending = editor.clipboardPngBlob().then((blob) => {
      if (!blob) throw new Error('Pinta has no image to publish');
      return blob;
    });
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pending })]);
      return true;
    } catch {
      return false;
    }
  }, [editor]);

  const copyImage = useCallback((kind: 'copy' | 'copy-merged' | 'cut') => {
    const copied = kind === 'copy' ? editor.copySelection() : kind === 'copy-merged' ? editor.copyMerged() : editor.cutSelection();
    if (!copied) return false;
    void publishClipboardImage();
    notify(kind === 'cut' ? 'Cut selection' : kind === 'copy-merged' ? 'Copied merged image' : 'Copied selection');
    return true;
  }, [editor, notify, publishClipboardImage]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const image = [...(event.clipboardData?.files ?? [])].find((file) => file.type.startsWith('image/'));
      event.preventDefault();
      const target = fallbackPasteTargetRef.current;
      fallbackPasteTargetRef.current = 'current';
      if (image) {
        void pasteImportedImage(image, target).catch(showEmptyClipboard);
      } else if (editor.hasClipboard) {
        if (editor.documents.length && target !== 'new-image' && (editor.clipboardSize.width > editor.width || editor.clipboardSize.height > editor.height)) setPendingPaste(target);
        else performPaste(target);
      } else {
        showEmptyClipboard();
      }
    };
    window.addEventListener('paste', onPaste, { capture: true });
    return () => window.removeEventListener('paste', onPaste, { capture: true });
  }, [editor.clipboardSize.height, editor.clipboardSize.width, editor.documents.length, editor.hasClipboard, editor.height, editor.width, pasteImportedImage, performPaste, showEmptyClipboard]);

  return {
    pendingPaste,
    setPendingPaste,
    clipboardInformation,
    setClipboardInformation,
    fallbackPasteTargetRef,
    performPaste,
    pasteImportedImage,
    showEmptyClipboard,
    requestPaste,
    publishClipboardImage,
    copyImage,
  };
}
