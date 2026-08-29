import { useCallback, type MutableRefObject } from 'react';
import { context2d } from './canvasContext';
import { makeCanvas } from './canvasUtils';
import { getAnchorOffset } from './colorMatching';
import { copySelectionToCanvas, normalizeSelection } from './selectionGeometry';
import { paintLayer } from './layerSnapshots';
import type { CanvasAnchor, PaintLayer, Selection } from './types';

interface ImageCommandDeps {
  layersRef: MutableRefObject<PaintLayer[]>;
  dimensionsRef: MutableRefObject<{ width: number; height: number }>;
  commitPendingEditsRef: MutableRefObject<() => boolean>;
  /** The live selection, read by Crop to Selection. */
  selection: Selection | null;
  /** Clear Selection is Delete's behaviour, which the erase command already implements. */
  eraseCurrentSelection: (historyLabel: string) => boolean;
  pushHistory: (label: string, layers?: PaintLayer[]) => void;
  setDimensions: (width: number, height: number) => void;
  setLayerList: (layers: PaintLayer[]) => void;
  updateSelection: (selection: Selection | null) => void;
}

/** Commands that change the canvas itself rather than one layer's pixels. */

export function useImageCommands({
  layersRef, dimensionsRef, commitPendingEditsRef, selection, eraseCurrentSelection,
  pushHistory, setDimensions, setLayerList, updateSelection,
}: ImageCommandDeps) {
  const cropToSelection = useCallback(() => {
    commitPendingEditsRef.current();
    if (!selection) return false;
    const bounds = normalizeSelection(selection, dimensionsRef.current.width, dimensionsRef.current.height);
    if (bounds.width < 1 || bounds.height < 1) return false;
    const next = layersRef.current.map((layer) => {
      const canvas = copySelectionToCanvas(layer.canvas, bounds);
      return { ...layer, canvas };
    });
    setDimensions(bounds.width, bounds.height);
    setLayerList(next);
    updateSelection(null);
    pushHistory('Crop to Selection', next);
    return true;
  }, [commitPendingEditsRef, dimensionsRef, layersRef, pushHistory, selection, setDimensions, setLayerList, updateSelection]);

  const autoCropImage = useCallback(() => {
    commitPendingEditsRef.current();
    const currentWidth = dimensionsRef.current.width;
    const currentHeight = dimensionsRef.current.height;
    const composite = makeCanvas(currentWidth, currentHeight);
    const context = context2d(composite);
    for (const layer of layersRef.current) paintLayer(context, layer);
    const pixels = context.getImageData(0, 0, currentWidth, currentHeight).data;
    let left = currentWidth;
    let top = currentHeight;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < currentHeight; y += 1) {
      for (let x = 0; x < currentWidth; x += 1) {
        if (pixels[(y * currentWidth + x) * 4 + 3] === 0) continue;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
    if (right < left || bottom < top) return false;
    const nextWidth = right - left + 1;
    const nextHeight = bottom - top + 1;
    if (left === 0 && top === 0 && nextWidth === currentWidth && nextHeight === currentHeight) return false;
    const next = layersRef.current.map((layer) => {
      const canvas = makeCanvas(nextWidth, nextHeight);
      context2d(canvas).drawImage(layer.canvas, -left, -top);
      return { ...layer, canvas };
    });
    setDimensions(nextWidth, nextHeight);
    setLayerList(next);
    updateSelection(null);
    pushHistory('Auto Crop', next);
    return true;
  }, [commitPendingEditsRef, dimensionsRef, layersRef, pushHistory, setDimensions, setLayerList, updateSelection]);

  const resizeImage = useCallback((newWidth: number, newHeight: number, resampling = 'bilinear') => {
    commitPendingEditsRef.current();
    const safeWidth = Math.max(1, Math.min(16384, Math.round(newWidth)));
    const safeHeight = Math.max(1, Math.min(16384, Math.round(newHeight)));
    if (safeWidth === dimensionsRef.current.width && safeHeight === dimensionsRef.current.height) return;
    const next = layersRef.current.map((layer) => {
      const canvas = makeCanvas(safeWidth, safeHeight);
      const context = context2d(canvas);
      context.imageSmoothingEnabled = resampling !== 'nearest';
      context.imageSmoothingQuality = resampling === 'bicubic' ? 'high' : 'medium';
      context.drawImage(layer.canvas, 0, 0, safeWidth, safeHeight);
      return { ...layer, canvas };
    });
    setDimensions(safeWidth, safeHeight);
    setLayerList(next);
    updateSelection(null);
    pushHistory('Resize Image', next);
  }, [commitPendingEditsRef, dimensionsRef, layersRef, pushHistory, setDimensions, setLayerList, updateSelection]);

  const resizeCanvas = useCallback((newWidth: number, newHeight: number, anchor: CanvasAnchor = 'center') => {
    commitPendingEditsRef.current();
    const safeWidth = Math.max(1, Math.min(16384, Math.round(newWidth)));
    const safeHeight = Math.max(1, Math.min(16384, Math.round(newHeight)));
    if (safeWidth === dimensionsRef.current.width && safeHeight === dimensionsRef.current.height) return;
    const horizontal = anchor.endsWith('west') ? 'start' : anchor.endsWith('east') ? 'end' : 'center';
    const vertical = anchor.startsWith('north') ? 'start' : anchor.startsWith('south') ? 'end' : 'center';
    const offsetX = getAnchorOffset(dimensionsRef.current.width, safeWidth, horizontal);
    const offsetY = getAnchorOffset(dimensionsRef.current.height, safeHeight, vertical);
    const next = layersRef.current.map((layer) => {
      const canvas = makeCanvas(safeWidth, safeHeight);
      context2d(canvas).drawImage(layer.canvas, offsetX, offsetY);
      return { ...layer, canvas };
    });
    setDimensions(safeWidth, safeHeight);
    setLayerList(next);
    updateSelection(null);
    pushHistory('Resize Canvas', next);
  }, [commitPendingEditsRef, dimensionsRef, layersRef, pushHistory, setDimensions, setLayerList, updateSelection]);

  const flipImage = useCallback((direction: 'horizontal' | 'vertical') => {
    commitPendingEditsRef.current();
    const currentWidth = dimensionsRef.current.width;
    const currentHeight = dimensionsRef.current.height;
    const next = layersRef.current.map((layer) => {
      const canvas = makeCanvas(currentWidth, currentHeight);
      const context = context2d(canvas);
      context.translate(direction === 'horizontal' ? currentWidth : 0, direction === 'vertical' ? currentHeight : 0);
      context.scale(direction === 'horizontal' ? -1 : 1, direction === 'vertical' ? -1 : 1);
      context.drawImage(layer.canvas, 0, 0);
      return { ...layer, canvas };
    });
    setLayerList(next);
    updateSelection(null);
    pushHistory(direction === 'horizontal' ? 'Flip Horizontal' : 'Flip Vertical', next);
  }, [commitPendingEditsRef, dimensionsRef, layersRef, pushHistory, setLayerList, updateSelection]);

  const rotateImage = useCallback((rotation: 'clockwise' | 'counter-clockwise' | '180') => {
    commitPendingEditsRef.current();
    const oldWidth = dimensionsRef.current.width;
    const oldHeight = dimensionsRef.current.height;
    const quarterTurn = rotation !== '180';
    const nextWidth = quarterTurn ? oldHeight : oldWidth;
    const nextHeight = quarterTurn ? oldWidth : oldHeight;
    const next = layersRef.current.map((layer) => {
      const canvas = makeCanvas(nextWidth, nextHeight);
      const context = context2d(canvas);
      if (rotation === 'clockwise') {
        context.translate(nextWidth, 0);
        context.rotate(Math.PI / 2);
      } else if (rotation === 'counter-clockwise') {
        context.translate(0, nextHeight);
        context.rotate(-Math.PI / 2);
      } else {
        context.translate(nextWidth, nextHeight);
        context.rotate(Math.PI);
      }
      context.drawImage(layer.canvas, 0, 0);
      return { ...layer, canvas };
    });
    setDimensions(nextWidth, nextHeight);
    setLayerList(next);
    updateSelection(null);
    pushHistory(rotation === 'clockwise' ? 'Rotate 90° Clockwise' : rotation === 'counter-clockwise' ? 'Rotate 90° Counter-Clockwise' : 'Rotate 180°', next);
  }, [commitPendingEditsRef, dimensionsRef, layersRef, pushHistory, setDimensions, setLayerList, updateSelection]);

  const clearActiveLayer = useCallback(() => {
    commitPendingEditsRef.current();
    eraseCurrentSelection('Erase Selection');
  }, [commitPendingEditsRef, eraseCurrentSelection]);

  return {
    cropToSelection,
    autoCropImage,
    resizeImage,
    resizeCanvas,
    flipImage,
    rotateImage,
    clearActiveLayer,
  };
}
