import { useCallback, type MutableRefObject } from 'react';
import { context2d } from './canvasContext';
import { makeCanvas } from './canvasUtils';
import { decodeImageFile } from './exportFormats';
import { makeLayer, paintLayer } from './layerSnapshots';
import { canvasCompositeOperation } from './geometry';
import type { BlendMode, PaintLayer } from './types';

interface LayerCommandDeps {
  layersRef: MutableRefObject<PaintLayer[]>;
  activeLayerIdRef: MutableRefObject<string>;
  dimensionsRef: MutableRefObject<{ width: number; height: number }>;
  previewCanvasRef: MutableRefObject<HTMLCanvasElement | null>;
  commitPendingEditsRef: MutableRefObject<(label?: string) => boolean>;
  pushHistory: (label: string, layers?: PaintLayer[]) => void;
  setLayerList: (layers: PaintLayer[]) => void;
  setActiveLayerId: (id: string) => void;
  /** Current document size, as rendered state rather than the ref. */
  width: number;
  height: number;
}

/** Adding, removing, reordering and transforming layers. */

export function useLayerCommands({
  layersRef, activeLayerIdRef, dimensionsRef, previewCanvasRef, commitPendingEditsRef,
  pushHistory, setLayerList, setActiveLayerId, width, height,
}: LayerCommandDeps) {
  const activeLayer = useCallback(() => layersRef.current.find((layer) => layer.id === activeLayerIdRef.current), [activeLayerIdRef, layersRef]);

  const addLayer = useCallback(() => {
    commitPendingEditsRef.current();
    const layer = makeLayer(dimensionsRef.current.width, dimensionsRef.current.height, `Layer ${layersRef.current.length + 1}`);
    const activeIndex = layersRef.current.findIndex((candidate) => candidate.id === activeLayerIdRef.current);
    const next = [...layersRef.current];
    next.splice(activeIndex + 1, 0, layer);
    setLayerList(next);
    setActiveLayerId(layer.id);
    activeLayerIdRef.current = layer.id;
    pushHistory('Add New Layer', next);
  }, [activeLayerIdRef, commitPendingEditsRef, dimensionsRef, layersRef, pushHistory, setActiveLayerId, setLayerList]);

  const importLayerFromFile = useCallback(async (file: File) => {
    commitPendingEditsRef.current();
    const opened = await decodeImageFile(file);
    const imported = makeLayer(dimensionsRef.current.width, dimensionsRef.current.height, file.name);
    const source = makeCanvas(opened.width, opened.height);
    const sourceContext = context2d(source);
    for (const layer of opened.layers) paintLayer(sourceContext, layer);
    context2d(imported.canvas).drawImage(source, 0, 0);
    const activeIndex = layersRef.current.findIndex((candidate) => candidate.id === activeLayerIdRef.current);
    const next = [...layersRef.current];
    next.splice(activeIndex + 1, 0, imported);
    setLayerList(next);
    setActiveLayerId(imported.id);
    activeLayerIdRef.current = imported.id;
    pushHistory('Import From File', next);
    return true;
  }, [activeLayerIdRef, commitPendingEditsRef, dimensionsRef, layersRef, pushHistory, setActiveLayerId, setLayerList]);

  const duplicateLayer = useCallback(() => {
    commitPendingEditsRef.current();
    const source = activeLayer();
    if (!source) return;
    const copy = makeLayer(source.canvas.width, source.canvas.height, `${source.name} copy`);
    copy.visible = source.visible;
    copy.opacity = source.opacity;
    copy.blendMode = source.blendMode;
    context2d(copy.canvas).drawImage(source.canvas, 0, 0);
    const index = layersRef.current.indexOf(source);
    const next = [...layersRef.current];
    next.splice(index + 1, 0, copy);
    setLayerList(next);
    setActiveLayerId(copy.id);
    activeLayerIdRef.current = copy.id;
    pushHistory('Duplicate Layer', next);
  }, [activeLayer, activeLayerIdRef, commitPendingEditsRef, layersRef, pushHistory, setActiveLayerId, setLayerList]);

  const deleteLayer = useCallback(() => {
    commitPendingEditsRef.current();
    if (layersRef.current.length === 1) return;
    const index = layersRef.current.findIndex((layer) => layer.id === activeLayerIdRef.current);
    const next = layersRef.current.filter((layer) => layer.id !== activeLayerIdRef.current);
    const nextActive = next[Math.max(0, index - 1)] ?? next[0];
    setLayerList(next);
    setActiveLayerId(nextActive.id);
    activeLayerIdRef.current = nextActive.id;
    pushHistory('Delete Layer', next);
  }, [activeLayerIdRef, commitPendingEditsRef, layersRef, pushHistory, setActiveLayerId, setLayerList]);

  const mergeLayerDown = useCallback(() => {
    commitPendingEditsRef.current();
    const index = layersRef.current.findIndex((layer) => layer.id === activeLayerIdRef.current);
    if (index <= 0) return;
    const top = layersRef.current[index];
    const bottom = layersRef.current[index - 1];
    const merged = makeLayer(width, height, bottom.name);
    const context = context2d(merged.canvas);
    paintLayer(context, bottom);
    paintLayer(context, top);
    const next = [...layersRef.current];
    next.splice(index - 1, 2, merged);
    setLayerList(next);
    setActiveLayerId(merged.id);
    activeLayerIdRef.current = merged.id;
    pushHistory('Merge Layer Down', next);
  }, [activeLayerIdRef, commitPendingEditsRef, height, layersRef, pushHistory, setActiveLayerId, setLayerList, width]);

  const moveLayer = useCallback((direction: -1 | 1) => {
    commitPendingEditsRef.current();
    const index = layersRef.current.findIndex((layer) => layer.id === activeLayerIdRef.current);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= layersRef.current.length) return;
    const next = [...layersRef.current];
    [next[index], next[target]] = [next[target], next[index]];
    setLayerList(next);
    pushHistory(direction > 0 ? 'Move Layer Up' : 'Move Layer Down', next);
  }, [activeLayerIdRef, commitPendingEditsRef, layersRef, pushHistory, setLayerList]);

  const flipLayer = useCallback((direction: 'horizontal' | 'vertical') => {
    commitPendingEditsRef.current();
    const layer = layersRef.current.find((candidate) => candidate.id === activeLayerIdRef.current);
    if (!layer) return false;
    const canvas = makeCanvas(layer.canvas.width, layer.canvas.height);
    const context = context2d(canvas);
    context.translate(direction === 'horizontal' ? canvas.width : 0, direction === 'vertical' ? canvas.height : 0);
    context.scale(direction === 'horizontal' ? -1 : 1, direction === 'vertical' ? -1 : 1);
    context.drawImage(layer.canvas, 0, 0);
    const next = layersRef.current.map((candidate) => candidate.id === layer.id ? { ...candidate, canvas } : candidate);
    setLayerList(next);
    pushHistory(direction === 'horizontal' ? 'Flip Layer Horizontal' : 'Flip Layer Vertical', next);
    return true;
  }, [activeLayerIdRef, commitPendingEditsRef, layersRef, pushHistory, setLayerList]);

  const clearLayerTransformPreview = useCallback(() => {
    const preview = previewCanvasRef.current;
    if (preview) context2d(preview).clearRect(0, 0, preview.width, preview.height);
  }, [previewCanvasRef]);

  const previewLayerProperties = useCallback((layerId: string, properties: { visible: boolean; opacity: number; blendMode: BlendMode }) => {
    const preview = previewCanvasRef.current;
    if (!preview || !layersRef.current.some((candidate) => candidate.id === layerId)) return false;
    const width = dimensionsRef.current.width;
    const height = dimensionsRef.current.height;
    if (preview.width !== width) preview.width = width;
    if (preview.height !== height) preview.height = height;
    const context = context2d(preview);
    context.clearRect(0, 0, width, height);
    for (const candidate of layersRef.current) {
      paintLayer(context, candidate.id === layerId ? {
        ...candidate,
        visible: properties.visible,
        opacity: Math.max(0, Math.min(1, properties.opacity)),
        blendMode: properties.blendMode,
      } : candidate);
    }
    return true;
  }, [dimensionsRef, layersRef, previewCanvasRef]);

  const previewRotateZoomLayer = useCallback((layerId: string, angle: number, panHorizontal: number, panVertical: number, zoomAmount: number) => {
    const preview = previewCanvasRef.current;
    const layer = layersRef.current.find((candidate) => candidate.id === layerId);
    if (!preview || !layer) return false;
    const width = dimensionsRef.current.width;
    const height = dimensionsRef.current.height;
    if (preview.width !== width) preview.width = width;
    if (preview.height !== height) preview.height = height;
    const context = context2d(preview);
    context.clearRect(0, 0, width, height);
    const safeAngle = Math.max(-360, Math.min(360, angle));
    const safePanHorizontal = Math.max(-1, Math.min(1, panHorizontal));
    const safePanVertical = Math.max(-1, Math.min(1, panVertical));
    const safeZoom = Math.max(0, Math.min(16, zoomAmount));
    const centerX = width / 2;
    const centerY = height / 2;
    for (const candidate of layersRef.current) {
      if (candidate.id !== layerId) {
        paintLayer(context, candidate);
        continue;
      }
      if (!candidate.visible) continue;
      context.save();
      context.globalAlpha = candidate.opacity;
      context.globalCompositeOperation = canvasCompositeOperation(candidate.blendMode);
      context.translate((1 + safePanHorizontal) * centerX, (1 + safePanVertical) * centerY);
      context.rotate(-safeAngle * Math.PI / 180);
      context.scale(safeZoom, safeZoom);
      context.translate(-centerX, -centerY);
      context.drawImage(candidate.canvas, 0, 0);
      context.restore();
    }
    return true;
  }, [dimensionsRef, layersRef, previewCanvasRef]);

  const rotateZoomLayer = useCallback((angle: number, panHorizontal: number, panVertical: number, zoomAmount: number) => {
    clearLayerTransformPreview();
    commitPendingEditsRef.current();
    const layer = layersRef.current.find((candidate) => candidate.id === activeLayerIdRef.current);
    if (!layer) return false;
    const safeAngle = Math.max(-360, Math.min(360, angle));
    const safePanHorizontal = Math.max(-1, Math.min(1, panHorizontal));
    const safePanVertical = Math.max(-1, Math.min(1, panVertical));
    const safeZoom = Math.max(0, Math.min(16, zoomAmount));
    if (safeAngle === 0 && safePanHorizontal === 0 && safePanVertical === 0 && safeZoom === 1) return false;
    const canvas = makeCanvas(layer.canvas.width, layer.canvas.height);
    const context = context2d(canvas);
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    context.translate((1 + safePanHorizontal) * centerX, (1 + safePanVertical) * centerY);
    context.rotate(-safeAngle * Math.PI / 180);
    context.scale(safeZoom, safeZoom);
    context.translate(-centerX, -centerY);
    context.drawImage(layer.canvas, 0, 0);
    const next = layersRef.current.map((candidate) => candidate.id === layer.id ? { ...candidate, canvas } : candidate);
    setLayerList(next);
    pushHistory('Rotate / Zoom Layer', next);
    return true;
  }, [activeLayerIdRef, clearLayerTransformPreview, commitPendingEditsRef, layersRef, pushHistory, setLayerList]);

  const flattenImage = useCallback(() => {
    commitPendingEditsRef.current();
    if (layersRef.current.length < 2) return false;
    const flattened = makeLayer(dimensionsRef.current.width, dimensionsRef.current.height, layersRef.current[0].name);
    const context = context2d(flattened.canvas);
    for (const layer of layersRef.current) paintLayer(context, layer);
    const next = [flattened];
    setLayerList(next);
    setActiveLayerId(flattened.id);
    activeLayerIdRef.current = flattened.id;
    pushHistory('Flatten', next);
    return true;
  }, [activeLayerIdRef, commitPendingEditsRef, dimensionsRef, layersRef, pushHistory, setActiveLayerId, setLayerList]);

  const toggleLayer = useCallback((id: string) => {
    commitPendingEditsRef.current();
    const next = layersRef.current.map((layer) => layer.id === id ? { ...layer, visible: !layer.visible } : layer);
    setLayerList(next);
    pushHistory('Layer Visibility', next);
  }, [commitPendingEditsRef, layersRef, pushHistory, setLayerList]);

  const renameLayer = useCallback((id: string, name: string) => {
    commitPendingEditsRef.current();
    const trimmed = name.trim();
    if (!trimmed) return;
    const next = layersRef.current.map((layer) => layer.id === id ? { ...layer, name: trimmed } : layer);
    setLayerList(next);
    pushHistory('Layer Properties', next);
  }, [commitPendingEditsRef, layersRef, pushHistory, setLayerList]);

  const updateLayerProperties = useCallback((id: string, properties: { name: string; visible: boolean; opacity: number; blendMode: BlendMode }) => {
    commitPendingEditsRef.current();
    const trimmed = properties.name.trim();
    if (!trimmed) return false;
    const layer = layersRef.current.find((candidate) => candidate.id === id);
    if (!layer) return false;
    const opacity = Math.max(0, Math.min(1, properties.opacity));
    if (layer.name === trimmed && layer.visible === properties.visible && layer.opacity === opacity && layer.blendMode === properties.blendMode) return false;
    const next = layersRef.current.map((candidate) => candidate.id === id ? {
      ...candidate,
      name: trimmed,
      visible: properties.visible,
      opacity,
      blendMode: properties.blendMode,
    } : candidate);
    setLayerList(next);
    pushHistory('Layer Properties', next);
    return true;
  }, [commitPendingEditsRef, layersRef, pushHistory, setLayerList]);

  return {
    activeLayer,
    addLayer,
    importLayerFromFile,
    duplicateLayer,
    deleteLayer,
    mergeLayerDown,
    moveLayer,
    flipLayer,
    clearLayerTransformPreview,
    previewLayerProperties,
    previewRotateZoomLayer,
    rotateZoomLayer,
    flattenImage,
    toggleLayer,
    renameLayer,
    updateLayerProperties,
  };
}
