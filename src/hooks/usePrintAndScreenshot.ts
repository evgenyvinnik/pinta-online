import { useCallback, useEffect, useState } from 'react';
import { context2d } from '../editor/canvasContext';
import type { usePaintEditor } from '../editor/usePaintEditor';
import type { PrintPreview } from '../components/dialogs/systemDialogs';

interface PrintAndScreenshotOptions {
  editor: ReturnType<typeof usePaintEditor>;
  notify: (message: string) => void;
  showError: (title: string, message: string, error: unknown) => void;
  /** Opening the print preview dismisses whatever menu launched it. */
  closeMenus: () => void;
}

/**
 * Printing and screen capture. Both open a dialog, both are one-shot browser handshakes, and
 * neither has anything to do with the rest of the editor's state — which is why they can own
 * their own without threading anything back up.
 */
export function usePrintAndScreenshot({ editor, notify, showError, closeMenus }: PrintAndScreenshotOptions) {
  const [printPreview, setPrintPreview] = useState<PrintPreview | null>(null);
  const [showScreenshot, setShowScreenshot] = useState(false);
  const [screenshotBusy, setScreenshotBusy] = useState(false);
  const [screenshotError, setScreenshotError] = useState('');

  const openPrintDialog = useCallback(() => {
    closeMenus();
    setPrintPreview({
      dataUrl: editor.createCompositeDataUrl(),
      fileName: editor.fileName,
      width: editor.width,
      height: editor.height,
      settings: {
        orientation: editor.width > editor.height ? 'landscape' : 'portrait',
        scaleMode: 'fit',
        scale: 100,
        margin: 12,
        center: true,
      },
    });
  }, [closeMenus, editor]);

  useEffect(() => {
    if (!printPreview) return;
    const closeAfterPrint = () => setPrintPreview(null);
    window.addEventListener('afterprint', closeAfterPrint, { once: true });
    return () => window.removeEventListener('afterprint', closeAfterPrint);
  }, [printPreview]);

  const captureScreenshot = useCallback(
    async (delay: number) => {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        setShowScreenshot(false);
        showError(
          'Failed to capture screenshot',
          'Screen capture is not supported by this browser.',
          'navigator.mediaDevices.getDisplayMedia is unavailable.',
        );
        return;
      }
      setScreenshotBusy(true);
      setScreenshotError('');
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.srcObject = stream;
        await new Promise<void>((resolve, reject) => {
          video.onloadedmetadata = () => resolve();
          video.onerror = () => reject(new Error('The selected screen could not be read.'));
        });
        await video.play();
        if (delay > 0) await new Promise((resolve) => window.setTimeout(resolve, delay * 1000));
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        if (!video.videoWidth || !video.videoHeight) throw new Error('The selected screen did not provide an image.');
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context2d(canvas).drawImage(video, 0, 0);
        editor.newDocumentFromCanvas(canvas, 'New Screenshot');
        setShowScreenshot(false);
        notify(`Captured ${canvas.width} × ${canvas.height} screenshot`);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'NotAllowedError') {
          setScreenshotError('Screen capture was canceled or not allowed.');
        } else {
          setShowScreenshot(false);
          showError(
            'Failed to capture screenshot',
            error instanceof Error ? error.message : 'The screenshot could not be captured.',
            error,
          );
        }
      } finally {
        for (const track of stream?.getTracks() ?? []) track.stop();
        setScreenshotBusy(false);
      }
    },
    [editor, notify, showError],
  );

  return {
    printPreview,
    setPrintPreview,
    openPrintDialog,
    showScreenshot,
    setShowScreenshot,
    screenshotBusy,
    screenshotError,
    setScreenshotError,
    captureScreenshot,
  };
}
