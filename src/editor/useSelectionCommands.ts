import { useCallback, type MutableRefObject } from 'react';
import { context2d } from './canvasContext';
import { cloneCanvas, makeCanvas } from './canvasUtils';
import { drawFloatingPixels, makeLayer, paintLayer } from './layerSnapshots';
import { canvasBlob, decodeImageFile } from './exportFormats';
import { translationTransform } from './geometry';
import {
  combineSelectionMasks, constrainCanvasMutationToSelection, copySelectionToCanvas,
  createSelectionMask, normalizeSelection, offsetSelectionMask, selectionFromMask,
  selectionMaskOnCanvas,
} from './selectionGeometry';
import type { FloatingPixelsState, PaintLayer, Selection, ToolId } from './types';

interface SelectionCommandDeps {
  layersRef: MutableRefObject<PaintLayer[]>;
  activeLayerIdRef: MutableRefObject<string>;
  dimensionsRef: MutableRefObject<{ width: number; height: number }>;
  selectionRef: MutableRefObject<Selection | null>;
  floatingPixelsRef: MutableRefObject<FloatingPixelsState | null>;
  clipboardRef: MutableRefObject<HTMLCanvasElement | null>;
  /** The live selection as rendered state; the ref carries the same value for handlers. */
  selection: Selection | null;
  activeLayer: () => PaintLayer | undefined;
  /** Fill Selection paints with the primary colour. */
  primary: string;
  /** Paste Into New Image hands the pasted pixels to a fresh document. */
  newDocumentFromCanvas: (canvas: HTMLCanvasElement, name: string) => void;
  commitPendingEditsRef: MutableRefObject<(label?: string) => boolean>;
  pushHistoryRef: MutableRefObject<(label: string) => void>;
  pushHistory: (label: string, layers?: PaintLayer[]) => void;
  setLayerList: (layers: PaintLayer[]) => void;
  setActiveLayerId: (id: string) => void;
  setDimensions: (width: number, height: number) => void;
  setHasClipboard: (has: boolean) => void;
  setClipboardSize: (size: { width: number; height: number }) => void;
  setTool: (tool: ToolId) => void;
  updateSelection: (selection: Selection | null) => void;
  updateFloatingPixels: (floating: FloatingPixelsState | null) => void;
}

/** Selecting, copying, cutting and pasting. */

export function useSelectionCommands({
  layersRef, activeLayerIdRef, dimensionsRef, selectionRef, floatingPixelsRef, clipboardRef, selection,
  activeLayer, primary, newDocumentFromCanvas,
  commitPendingEditsRef, pushHistoryRef, pushHistory, setLayerList, setActiveLayerId,
  setDimensions, setHasClipboard, setClipboardSize, setTool, updateSelection, updateFloatingPixels,
}: SelectionCommandDeps) {
  const selectAll = useCallback(() => {
    commitPendingEditsRef.current();
    updateSelection({
      tool: 'rectangle-select',
      start: { x: 0, y: 0 },
      end: { x: dimensionsRef.current.width, y: dimensionsRef.current.height },
    });
    pushHistoryRef.current('Select All');
  }, []);

  const deselect = useCallback(() => {
    commitPendingEditsRef.current();
    if (!selectionRef.current) return;
    updateSelection(null);
    pushHistoryRef.current('Deselect');
  }, []);

  const copySelection = useCallback(() => {
    const layer = activeLayer();
    if (!layer) return false;
    const source = cloneCanvas(layer.canvas);
    const floating = floatingPixelsRef.current;
    if (floating?.layerId === layer.id) drawFloatingPixels(context2d(source), floating);
    const target = selection ?? {
      tool: 'rectangle-select' as const,
      start: { x: 0, y: 0 },
      end: { x: dimensionsRef.current.width, y: dimensionsRef.current.height },
    };
    const bounds = normalizeSelection(target, dimensionsRef.current.width, dimensionsRef.current.height);
    if (bounds.width < 1 || bounds.height < 1) return false;
    clipboardRef.current = copySelectionToCanvas(source, bounds);
    setClipboardSize({ width: bounds.width, height: bounds.height });
    setHasClipboard(true);
    return true;
  }, [activeLayer, selection]);

  const copyMerged = useCallback(() => {
    commitPendingEditsRef.current();
    const composite = makeCanvas(dimensionsRef.current.width, dimensionsRef.current.height);
    const context = context2d(composite);
    for (const layer of layersRef.current) paintLayer(context, layer);
    const target = selection ?? {
      tool: 'rectangle-select' as const,
      start: { x: 0, y: 0 },
      end: { x: dimensionsRef.current.width, y: dimensionsRef.current.height },
    };
    const bounds = normalizeSelection(target, dimensionsRef.current.width, dimensionsRef.current.height);
    if (bounds.width < 1 || bounds.height < 1) return false;
    clipboardRef.current = copySelectionToCanvas(composite, bounds);
    setClipboardSize({ width: bounds.width, height: bounds.height });
    setHasClipboard(true);
    return true;
  }, [selection]);

  const clipboardPngBlob = useCallback(async () => {
    const clipboard = clipboardRef.current;
    return clipboard ? canvasBlob(clipboard, 'image/png') : null;
  }, []);

  const importClipboardImage = useCallback(async (blob: Blob) => {
    const name = blob instanceof File && blob.name ? blob.name : 'Clipboard Image.png';
    const file = blob instanceof File ? blob : new File([blob], name, { type: blob.type || 'image/png' });
    const opened = await decodeImageFile(file);
    const canvas = makeCanvas(opened.width, opened.height);
    const context = context2d(canvas);
    for (const layer of opened.layers) paintLayer(context, layer);
    clipboardRef.current = canvas;
    setClipboardSize({ width: canvas.width, height: canvas.height });
    setHasClipboard(true);
    return { width: canvas.width, height: canvas.height };
  }, []);

  const eraseCurrentSelection = useCallback((historyLabel: string) => {
    const layer = activeLayer();
    if (!layer) return false;
    const context = context2d(layer.canvas);
    context.save();
    context.globalCompositeOperation = 'destination-out';
    if (selection) {
      const bounds = normalizeSelection(selection, dimensionsRef.current.width, dimensionsRef.current.height);
      context.drawImage(createSelectionMask(bounds), bounds.x, bounds.y);
    } else {
      context.fillRect(0, 0, layer.canvas.width, layer.canvas.height);
    }
    context.restore();
    pushHistory(historyLabel);
    return true;
  }, [activeLayer, pushHistory, selection]);

  const cutSelection = useCallback(() => {
    commitPendingEditsRef.current();
    if (!copySelection()) return false;
    return eraseCurrentSelection('Cut');
  }, [copySelection, eraseCurrentSelection]);

  const paste = useCallback((expandCanvas = false) => {
    commitPendingEditsRef.current();
    const clipboard = clipboardRef.current;
    let layer = activeLayer();
    if (!clipboard || !layer) return false;
    if (expandCanvas && (clipboard.width > dimensionsRef.current.width || clipboard.height > dimensionsRef.current.height)) {
      const oldWidth = dimensionsRef.current.width;
      const oldHeight = dimensionsRef.current.height;
      const nextWidth = Math.max(dimensionsRef.current.width, clipboard.width);
      const nextHeight = Math.max(dimensionsRef.current.height, clipboard.height);
      const offsetX = Math.round((nextWidth - oldWidth) / 2);
      const offsetY = Math.round((nextHeight - oldHeight) / 2);
      const next = layersRef.current.map((candidate) => {
        const canvas = makeCanvas(nextWidth, nextHeight);
        context2d(canvas).drawImage(candidate.canvas, offsetX, offsetY);
        return { ...candidate, canvas };
      });
      setDimensions(nextWidth, nextHeight);
      setLayerList(next);
      layer = next.find((candidate) => candidate.id === layer!.id)!;
    }
    const bounds = selection ? normalizeSelection(selection, dimensionsRef.current.width, dimensionsRef.current.height) : null;
    const x = bounds?.x ?? Math.round((dimensionsRef.current.width - clipboard.width) / 2);
    const y = bounds?.y ?? Math.round((dimensionsRef.current.height - clipboard.height) / 2);
    setTool('move-pixels');
    updateSelection({
      tool: 'rectangle-select',
      start: { x, y },
      end: { x: x + clipboard.width, y: y + clipboard.height },
    });
    updateFloatingPixels({
      layerId: layer.id,
      canvas: cloneCanvas(clipboard),
      transform: translationTransform(x, y),
    });
    pushHistory('Paste');
    return true;
  }, [activeLayer, pushHistory, selection, setDimensions, setLayerList, setTool, updateFloatingPixels, updateSelection]);

  const pasteIntoNewLayer = useCallback((expandCanvas = false) => {
    commitPendingEditsRef.current();
    const clipboard = clipboardRef.current;
    if (!clipboard) return false;
    setTool('move-pixels');
    const oldWidth = dimensionsRef.current.width;
    const oldHeight = dimensionsRef.current.height;
    const nextWidth = expandCanvas ? Math.max(dimensionsRef.current.width, clipboard.width) : dimensionsRef.current.width;
    const nextHeight = expandCanvas ? Math.max(dimensionsRef.current.height, clipboard.height) : dimensionsRef.current.height;
    const layer = makeLayer(nextWidth, nextHeight, 'Pasted Layer');
    const bounds = selection ? normalizeSelection(selection, dimensionsRef.current.width, dimensionsRef.current.height) : null;
    const x = bounds?.x ?? Math.round((nextWidth - clipboard.width) / 2);
    const y = bounds?.y ?? Math.round((nextHeight - clipboard.height) / 2);
    const activeIndex = layersRef.current.findIndex((candidate) => candidate.id === activeLayerIdRef.current);
    const next = expandCanvas && (nextWidth !== dimensionsRef.current.width || nextHeight !== dimensionsRef.current.height)
      ? layersRef.current.map((candidate) => {
        const canvas = makeCanvas(nextWidth, nextHeight);
        context2d(canvas).drawImage(candidate.canvas, Math.round((nextWidth - oldWidth) / 2), Math.round((nextHeight - oldHeight) / 2));
        return { ...candidate, canvas };
      })
      : [...layersRef.current];
    next.splice(Math.max(0, activeIndex + 1), 0, layer);
    if (expandCanvas) setDimensions(nextWidth, nextHeight);
    setLayerList(next);
    setActiveLayerId(layer.id);
    activeLayerIdRef.current = layer.id;
    updateSelection({
      tool: 'rectangle-select',
      start: { x, y },
      end: { x: x + clipboard.width, y: y + clipboard.height },
    });
    updateFloatingPixels({
      layerId: layer.id,
      canvas: cloneCanvas(clipboard),
      transform: translationTransform(x, y),
    });
    pushHistory('Paste Into New Layer', next);
    return true;
  }, [pushHistory, selection, setActiveLayerId, setDimensions, setLayerList, setTool, updateFloatingPixels, updateSelection]);

  const pasteIntoNewImage = useCallback(() => {
    const clipboard = clipboardRef.current;
    if (!clipboard) return false;
    return newDocumentFromCanvas(clipboard, 'Pasted Image');
  }, [newDocumentFromCanvas]);

  const fillSelection = useCallback(() => {
    commitPendingEditsRef.current();
    const layer = activeLayer();
    if (!layer || !selection) return false;
    const bounds = normalizeSelection(selection, dimensionsRef.current.width, dimensionsRef.current.height);
    if (bounds.width < 1 || bounds.height < 1) return false;
    const fill = makeCanvas(bounds.width, bounds.height);
    const fillContext = context2d(fill);
    fillContext.fillStyle = primary;
    fillContext.fillRect(0, 0, fill.width, fill.height);
    fillContext.globalCompositeOperation = 'destination-in';
    fillContext.drawImage(createSelectionMask(bounds), 0, 0);
    context2d(layer.canvas).drawImage(fill, bounds.x, bounds.y);
    pushHistory('Fill Selection');
    return true;
  }, [activeLayer, primary, pushHistory, selection]);

  const invertSelection = useCallback(() => {
    commitPendingEditsRef.current();
    if (!selection) return false;
    const width = dimensionsRef.current.width;
    const height = dimensionsRef.current.height;
    const inverted = makeCanvas(width, height);
    const context = context2d(inverted);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.globalCompositeOperation = 'destination-out';
    context.drawImage(selectionMaskOnCanvas(selection, width, height), 0, 0);
    updateSelection(selectionFromMask(inverted));
    pushHistory('Invert Selection');
    return true;
  }, [pushHistory, selection]);

  const offsetSelection = useCallback((offset: number) => {
    commitPendingEditsRef.current();
    if (!selection) return false;
    const safeOffset = Math.max(-100, Math.min(100, Math.round(offset)));
    if (safeOffset === 0) return false;
    updateSelection(offsetSelectionMask(selection, dimensionsRef.current.width, dimensionsRef.current.height, safeOffset));
    pushHistory('Offset Selection');
    return true;
  }, [pushHistory, selection]);

  return {
    selectAll,
    deselect,
    copySelection,
    copyMerged,
    clipboardPngBlob,
    importClipboardImage,
    eraseCurrentSelection,
    cutSelection,
    paste,
    pasteIntoNewLayer,
    pasteIntoNewImage,
    fillSelection,
    invertSelection,
    offsetSelection,
  };
}
