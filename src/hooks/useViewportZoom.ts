import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { usePaintEditor } from '../editor/usePaintEditor';
import { clampZoom, zoomInLevel, zoomOutLevel } from '../editor/zoom';
import { usePreferences } from '../state/preferences';

interface ViewportZoomOptions {
  editor: ReturnType<typeof usePaintEditor>;
  /**
   * `editor.setZoom` under its own name. Zooming here has to update `zoomRef` and the anchor
   * before the state write, so it deliberately bypasses `setFixedZoom`.
   */
  setEditorZoom: (zoom: number) => void;
}

export interface ViewportMetrics {
  width: number;
  height: number;
  scrollLeft: number;
  scrollTop: number;
}

export interface ZoomMarquee {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The canvas viewport: what it is scrolled to, how far it is zoomed, and how pointers move it.
 *
 * Zooming to a point is the reason this is a hook and not a handful of callbacks. Changing the
 * zoom re-lays-out the canvas, so keeping the pixel under the cursor still requires knowing where
 * that pixel was *before* React re-rendered. `zoomAnchorRef` carries the pre-render position
 * across to a `useLayoutEffect` that corrects the scroll offset in the same frame, which is why
 * `zoomRef` and `renderedZoomRef` are separate: one is the zoom being applied, the other the zoom
 * currently on screen. Nine refs coordinate that dance and none of them mean anything to the rest
 * of the app, so they stay private here.
 *
 * Pinta's own model is preserved on top: "Window" stays selected until an explicit zoom replaces
 * it (`ZoomToWindowActivated`), and a window fit shows an image that already fits at 100% rather
 * than magnifying it.
 */
export function useViewportZoom({ editor, setEditorZoom }: ViewportZoomOptions) {
  const showSidebar = usePreferences((state) => state.showSidebar);
  const showToolbox = usePreferences((state) => state.showToolbox);
  const showDocumentTabs = usePreferences((state) => state.showDocumentTabs);
  const showRulers = usePreferences((state) => state.showRulers);

  // Pinta's zoom combo keeps "Window" selected until an explicit zoom replaces it.
  const [zoomMode, setZoomMode] = useState<'fixed' | 'fit' | 'window'>('fixed');
  const [zoomMarquee, setZoomMarquee] = useState<ZoomMarquee | null>(null);
  const [viewportMetrics, setViewportMetrics] = useState<ViewportMetrics>({
    width: 0,
    height: 0,
    scrollLeft: 0,
    scrollTop: 0,
  });

  const viewportRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const zoomDragRef = useRef<{ clientX: number; clientY: number; imageX: number; imageY: number; button: number } | null>(null);
  const zoomRef = useRef(editor.zoom);
  const renderedZoomRef = useRef(editor.zoom);
  const zoomAnchorRef = useRef<{ imageX: number; imageY: number; clientX: number; clientY: number } | null>(null);
  const gestureStartZoomRef = useRef<number | null>(null);
  const fittedViewportSizeRef = useRef<string | null>(null);
  const autoFittedDocumentsRef = useRef<Set<string> | null>(null);

  const fitZoomToWindow = useCallback(() => {
    const viewport = viewportRef.current;
    const frame = viewport?.querySelector<HTMLElement>('.canvas-centering-frame');
    if (!viewport || !frame || !editor.width || !editor.height) return;
    // MainWindow.ZoomToWindow_Activated keeps a 20px margin around the fitted image; the
    // web frame's own padding already supplies one, so the larger of the two is used.
    const frameStyle = getComputedStyle(frame);
    const marginX = Math.max(20, parseFloat(frameStyle.paddingLeft) + parseFloat(frameStyle.paddingRight));
    const marginY = Math.max(20, parseFloat(frameStyle.paddingTop) + parseFloat(frameStyle.paddingBottom));
    const windowWidth = Math.max(1, viewport.clientWidth - marginX);
    const windowHeight = Math.max(1, viewport.clientHeight - marginY);
    // An image that already fits is shown at 100% rather than magnified.
    if (editor.width <= windowWidth && editor.height <= windowHeight) {
      editor.setZoom(1);
      return;
    }
    editor.setZoom(Math.min(windowWidth / editor.width, windowHeight / editor.height));
  }, [editor]);

  const zoomToWindow = useCallback((mode: 'fit' | 'window' = 'window') => {
    setZoomMode(mode);
    fitZoomToWindow();
  }, [fitZoomToWindow]);

  /** Any explicit zoom leaves Window mode, matching ZoomToWindowActivated = false. */
  const setFixedZoom = useCallback((zoom: number) => {
    setZoomMode('fixed');
    editor.setZoom(zoom);
  }, [editor]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || zoomMode === 'fixed') {
      fittedViewportSizeRef.current = null;
      return;
    }
    const observer = new ResizeObserver(() => {
      const size = `${viewport.clientWidth}x${viewport.clientHeight}`;
      if (fittedViewportSizeRef.current === size) return;
      fittedViewportSizeRef.current = size;
      fitZoomToWindow();
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [fitZoomToWindow, zoomMode]);

  useEffect(() => {
    if (!editor.workspaceReady) return;
    if (autoFittedDocumentsRef.current === null) {
      autoFittedDocumentsRef.current = new Set(editor.restoredDocumentIds);
    }
    const id = editor.activeDocumentId;
    if (!id || autoFittedDocumentsRef.current.has(id)) return;
    autoFittedDocumentsRef.current.add(id);
    zoomToWindow('fit');
  }, [editor.activeDocumentId, editor.restoredDocumentIds, editor.workspaceReady, zoomToWindow]);

  const zoomToSelection = useCallback(() => {
    const viewport = viewportRef.current;
    const bounds = editor.selectionBounds;
    if (!viewport || !bounds) return;
    const availableWidth = Math.max(1, viewport.clientWidth - 52);
    const availableHeight = Math.max(1, viewport.clientHeight - 52);
    const nextZoom = Math.min(availableWidth / bounds.width, availableHeight / bounds.height);
    setZoomMode('fixed');
    editor.setZoom(nextZoom);
    requestAnimationFrame(() => {
      const canvas = viewport.querySelector<HTMLElement>('.canvas-stack');
      if (!canvas) return;
      const viewportRect = viewport.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      const centerX = canvasRect.left + (bounds.x + bounds.width / 2) * clampZoom(nextZoom);
      const centerY = canvasRect.top + (bounds.y + bounds.height / 2) * clampZoom(nextZoom);
      viewport.scrollLeft += centerX - viewportRect.left - viewport.clientWidth / 2;
      viewport.scrollTop += centerY - viewportRect.top - viewport.clientHeight / 2;
    });
  }, [editor]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const update = () => setViewportMetrics({
      width: viewport.clientWidth,
      height: viewport.clientHeight,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [showDocumentTabs, showRulers, showSidebar, showToolbox]);

  const onViewportScroll = useCallback((scrollLeft: number, scrollTop: number) => {
    setViewportMetrics((current) => ({ ...current, scrollLeft, scrollTop }));
  }, []);

  const zoomAtPoint = useCallback((requestedZoom: number, clientX: number, clientY: number) => {
    const viewport = viewportRef.current;
    const canvas = viewport?.querySelector<HTMLElement>('.canvas-stack');
    if (!viewport || !canvas) return;
    const nextZoom = clampZoom(requestedZoom);
    if (Math.abs(nextZoom - zoomRef.current) < 0.0001) return;
    const canvasBounds = canvas.getBoundingClientRect();
    const renderedZoom = renderedZoomRef.current;
    zoomAnchorRef.current = {
      imageX: (clientX - canvasBounds.left) / renderedZoom,
      imageY: (clientY - canvasBounds.top) / renderedZoom,
      clientX,
      clientY,
    };
    zoomRef.current = nextZoom;
    setZoomMode('fixed');
    setEditorZoom(nextZoom);
  }, [setEditorZoom]);

  const zoomImagePointToClient = useCallback((requestedZoom: number, imageX: number, imageY: number, clientX: number, clientY: number) => {
    const nextZoom = clampZoom(requestedZoom);
    if (Math.abs(nextZoom - zoomRef.current) < 0.0001) return;
    zoomAnchorRef.current = { imageX, imageY, clientX, clientY };
    zoomRef.current = nextZoom;
    setZoomMode('fixed');
    setEditorZoom(nextZoom);
  }, [setEditorZoom]);

  useLayoutEffect(() => {
    renderedZoomRef.current = editor.zoom;
    zoomRef.current = editor.zoom;
    const anchor = zoomAnchorRef.current;
    const viewport = viewportRef.current;
    const canvas = viewport?.querySelector<HTMLElement>('.canvas-stack');
    if (!anchor || !viewport || !canvas) return;
    const canvasBounds = canvas.getBoundingClientRect();
    viewport.scrollLeft += canvasBounds.left + anchor.imageX * editor.zoom - anchor.clientX;
    viewport.scrollTop += canvasBounds.top + anchor.imageY * editor.zoom - anchor.clientY;
    zoomAnchorRef.current = null;
  }, [editor.zoom]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? viewport.clientHeight
          : 1);
      zoomAtPoint(zoomRef.current * Math.exp(-delta * 0.0025), event.clientX, event.clientY);
    };
    const gesturePoint = (event: Event) => {
      const gesture = event as Event & { clientX?: number; clientY?: number };
      const bounds = viewport.getBoundingClientRect();
      return {
        x: gesture.clientX ?? bounds.left + bounds.width / 2,
        y: gesture.clientY ?? bounds.top + bounds.height / 2,
      };
    };
    const gestureStart = (event: Event) => {
      event.preventDefault();
      gestureStartZoomRef.current = zoomRef.current;
    };
    const gestureChange = (event: Event) => {
      event.preventDefault();
      const gesture = event as Event & { scale?: number };
      const point = gesturePoint(event);
      zoomAtPoint((gestureStartZoomRef.current ?? zoomRef.current) * Math.max(0.01, gesture.scale ?? 1), point.x, point.y);
    };
    const gestureEnd = (event: Event) => {
      event.preventDefault();
      gestureStartZoomRef.current = null;
    };

    viewport.addEventListener('wheel', wheel, { passive: false });
    viewport.addEventListener('gesturestart', gestureStart, { passive: false });
    viewport.addEventListener('gesturechange', gestureChange, { passive: false });
    viewport.addEventListener('gestureend', gestureEnd, { passive: false });
    return () => {
      viewport.removeEventListener('wheel', wheel);
      viewport.removeEventListener('gesturestart', gestureStart);
      viewport.removeEventListener('gesturechange', gestureChange);
      viewport.removeEventListener('gestureend', gestureEnd);
    };
  }, [zoomAtPoint]);

  const handleCanvasPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.button === 1 || editor.tool === 'pan') && viewportRef.current) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      panRef.current = {
        x: event.clientX,
        y: event.clientY,
        left: viewportRef.current.scrollLeft,
        top: viewportRef.current.scrollTop,
      };
      return;
    }
    if (editor.tool === 'zoom') {
      event.preventDefault();
      const bounds = event.currentTarget.getBoundingClientRect();
      zoomDragRef.current = {
        clientX: event.clientX,
        clientY: event.clientY,
        imageX: (event.clientX - bounds.left) / editor.zoom,
        imageY: (event.clientY - bounds.top) / editor.zoom,
        button: event.button,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    editor.onPointerDown(event);
  };

  const handleCanvasPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (panRef.current && viewportRef.current) {
      viewportRef.current.scrollLeft = panRef.current.left - (event.clientX - panRef.current.x);
      viewportRef.current.scrollTop = panRef.current.top - (event.clientY - panRef.current.y);
      return;
    }
    if (zoomDragRef.current) {
      const drag = zoomDragRef.current;
      if (drag.button === 0 && Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) >= 3) {
        const bounds = event.currentTarget.getBoundingClientRect();
        const imageX = (event.clientX - bounds.left) / editor.zoom;
        const imageY = (event.clientY - bounds.top) / editor.zoom;
        setZoomMarquee({
          x: Math.min(drag.imageX, imageX),
          y: Math.min(drag.imageY, imageY),
          width: Math.abs(imageX - drag.imageX),
          height: Math.abs(imageY - drag.imageY),
        });
      }
      return;
    }
    if (
      viewportRef.current &&
      editor.selectionAutoScroll &&
      ['rectangle-select', 'ellipse-select', 'lasso-select'].includes(editor.tool) &&
      event.buttons !== 0
    ) {
      const viewport = viewportRef.current;
      const bounds = viewport.getBoundingClientRect();
      const edge = 18;
      const scrollX = event.clientX < bounds.left + edge ? -12 : event.clientX > bounds.right - edge ? 12 : 0;
      const scrollY = event.clientY < bounds.top + edge ? -12 : event.clientY > bounds.bottom - edge ? 12 : 0;
      if (scrollX || scrollY) viewport.scrollBy(scrollX, scrollY);
    }
    editor.onPointerMove(event);
  };

  const handleCanvasPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (panRef.current) {
      panRef.current = null;
      return;
    }
    if (zoomDragRef.current) {
      const drag = zoomDragRef.current;
      const marquee = zoomMarquee;
      zoomDragRef.current = null;
      setZoomMarquee(null);
      if (drag.button === 2) {
        zoomAtPoint(zoomOutLevel(zoomRef.current), event.clientX, event.clientY);
      } else if (marquee && marquee.width >= 2 && marquee.height >= 2 && viewportRef.current) {
        const viewportBounds = viewportRef.current.getBoundingClientRect();
        const requested = Math.min(
          Math.max(1, viewportRef.current.clientWidth - 52) / marquee.width,
          Math.max(1, viewportRef.current.clientHeight - 52) / marquee.height,
        );
        zoomImagePointToClient(
          requested,
          marquee.x + marquee.width / 2,
          marquee.y + marquee.height / 2,
          viewportBounds.left + viewportBounds.width / 2,
          viewportBounds.top + viewportBounds.height / 2,
        );
      } else {
        zoomAtPoint(zoomInLevel(zoomRef.current), event.clientX, event.clientY);
      }
      return;
    }
    editor.onPointerUp(event);
  };

  return {
    viewportRef,
    viewportMetrics,
    zoomMode,
    zoomMarquee,
    zoomToWindow,
    setFixedZoom,
    zoomToSelection,
    onViewportScroll,
    handleCanvasPointerDown,
    handleCanvasPointerMove,
    handleCanvasPointerUp,
  };
}
