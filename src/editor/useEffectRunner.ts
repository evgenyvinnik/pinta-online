import { useCallback, type MutableRefObject } from 'react';
import { runImageEffect } from '../effects/client';
import { EFFECT_BY_ID, type EffectId, type EffectParameters } from '../effects/types';
import { context2d } from './canvasContext';
import { colorToRgba, makeCanvas } from './canvasUtils';
import { normalizeSelection, selectionMaskOnCanvas } from './selectionGeometry';
import { paintLayer } from './layerSnapshots';
import type { PaintLayer, RgbHistogram, Selection } from './types';

interface EffectRunnerDeps {
  layersRef: MutableRefObject<PaintLayer[]>;
  activeLayerIdRef: MutableRefObject<string>;
  selectionRef: MutableRefObject<Selection | null>;
  historyIndexRef: MutableRefObject<number>;
  previewCanvasRef: MutableRefObject<HTMLCanvasElement | null>;
  commitPendingEditsRef: MutableRefObject<(label?: string) => boolean>;
  effectBusyRef: MutableRefObject<boolean>;
  effectPreviewTokenRef: MutableRefObject<number>;
  effectRequestAbortRef: MutableRefObject<AbortController | null>;
  /** The layer an effect is applied to; read fresh on every call. */
  activeLayer: () => PaintLayer | undefined;
  /** Dithering and the gradient renders read the live colours. */
  palette: string[];
  primary: string;
  secondary: string;
  recentColors: readonly string[];
  pushHistory: (label: string, layers?: PaintLayer[]) => void;
  setEffectBusy: (busy: boolean) => void;
  setEffectProgress: (progress: number) => void;
}

/**
 * Running an adjustment or effect, and previewing one while its dialog is open.
 *
 * Cancellation terminates the worker rather than setting a flag, because the processors run
 * synchronously inside it; the token and abort refs are what let a superseded preview be
 * discarded when its result finally arrives.
 */

export function useEffectRunner({
  layersRef,
  activeLayerIdRef,
  selectionRef,
  historyIndexRef,
  previewCanvasRef,
  commitPendingEditsRef,
  effectBusyRef,
  effectPreviewTokenRef,
  effectRequestAbortRef,
  activeLayer,
  palette,
  primary,
  secondary,
  recentColors,
  pushHistory,
  setEffectBusy,
  setEffectProgress,
}: EffectRunnerDeps) {
  const effectParametersFor = useCallback(
    (parameters: EffectParameters, activeSelection: Selection | null, sourceWidth: number, sourceHeight: number) => {
      const primaryRgba = colorToRgba(primary);
      const secondaryRgba = colorToRgba(secondary);
      const enriched: EffectParameters = {
        ...parameters,
        __primaryR: primaryRgba.r,
        __primaryG: primaryRgba.g,
        __primaryB: primaryRgba.b,
        __secondaryR: secondaryRgba.r,
        __secondaryG: secondaryRgba.g,
        __secondaryB: secondaryRgba.b,
        __paletteCount: palette.length,
        __recentPaletteCount: Math.min(10, recentColors.length),
      };
      palette.forEach((color, index) => {
        const rgba = colorToRgba(color);
        enriched[`__palette${index}R`] = rgba.r;
        enriched[`__palette${index}G`] = rgba.g;
        enriched[`__palette${index}B`] = rgba.b;
      });
      recentColors.slice(0, 10).forEach((color, index) => {
        const rgba = colorToRgba(color);
        enriched[`__recentPalette${index}R`] = rgba.r;
        enriched[`__recentPalette${index}G`] = rgba.g;
        enriched[`__recentPalette${index}B`] = rgba.b;
      });
      if (activeSelection) {
        const effectBounds = normalizeSelection(activeSelection, sourceWidth, sourceHeight);
        enriched.__selectionX = effectBounds.x;
        enriched.__selectionY = effectBounds.y;
        enriched.__selectionWidth = effectBounds.width;
        enriched.__selectionHeight = effectBounds.height;
      }
      return enriched;
    },
    [palette, primary, recentColors, secondary],
  );

  const clearEffectPreview = useCallback(() => {
    effectPreviewTokenRef.current += 1;
    effectRequestAbortRef.current?.abort();
    effectRequestAbortRef.current = null;
    const preview = previewCanvasRef.current;
    if (preview) context2d(preview).clearRect(0, 0, preview.width, preview.height);
  }, [effectPreviewTokenRef, effectRequestAbortRef, previewCanvasRef]);

  const getActiveHistogram = useCallback((): RgbHistogram => {
    const histogram: RgbHistogram = {
      red: Array<number>(256).fill(0),
      green: Array<number>(256).fill(0),
      blue: Array<number>(256).fill(0),
    };
    const layer = activeLayer();
    if (!layer) return histogram;

    const activeSelection = selectionRef.current;
    const bounds = activeSelection
      ? normalizeSelection(activeSelection, layer.canvas.width, layer.canvas.height)
      : { x: 0, y: 0, width: layer.canvas.width, height: layer.canvas.height };
    const left = Math.max(0, bounds.x);
    const top = Math.max(0, bounds.y);
    const right = Math.min(layer.canvas.width, bounds.x + bounds.width);
    const bottom = Math.min(layer.canvas.height, bounds.y + bounds.height);
    if (right <= left || bottom <= top) return histogram;

    // Native Pinta builds the Levels histogram from the selection's bounding
    // rectangle on the current user layer (rather than from the composited
    // image or only from selected mask pixels).
    const pixels = context2d(layer.canvas).getImageData(left, top, right - left, bottom - top).data;
    for (let index = 0; index < pixels.length; index += 4) {
      histogram.red[pixels[index]] += 1;
      histogram.green[pixels[index + 1]] += 1;
      histogram.blue[pixels[index + 2]] += 1;
    }
    return histogram;
  }, [activeLayer, selectionRef]);

  const previewEffect = useCallback(
    async (effect: EffectId, parameters: EffectParameters = {}) => {
      const token = ++effectPreviewTokenRef.current;
      effectRequestAbortRef.current?.abort();
      const abortController = new AbortController();
      effectRequestAbortRef.current = abortController;
      commitPendingEditsRef.current();
      const layer = activeLayer();
      const preview = previewCanvasRef.current;
      if (!layer || !preview) return false;
      const sourceWidth = layer.canvas.width;
      const sourceHeight = layer.canvas.height;
      const source = context2d(layer.canvas).getImageData(0, 0, sourceWidth, sourceHeight);
      const activeSelection = selectionRef.current;
      let processed: ImageData;
      try {
        processed = await runImageEffect(
          source,
          effect,
          effectParametersFor(parameters, activeSelection, sourceWidth, sourceHeight),
          abortController.signal,
        );
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return false;
        throw error;
      } finally {
        if (effectRequestAbortRef.current === abortController) effectRequestAbortRef.current = null;
      }
      if (token !== effectPreviewTokenRef.current || activeLayerIdRef.current !== layer.id) return false;

      const processedCanvas = makeCanvas(sourceWidth, sourceHeight);
      context2d(processedCanvas).putImageData(processed, 0, 0);
      const previewLayerCanvas = makeCanvas(sourceWidth, sourceHeight);
      const previewLayerContext = context2d(previewLayerCanvas);
      previewLayerContext.drawImage(layer.canvas, 0, 0);
      if (activeSelection) {
        const fullMask = selectionMaskOnCanvas(activeSelection, sourceWidth, sourceHeight);
        previewLayerContext.save();
        previewLayerContext.globalCompositeOperation = 'destination-out';
        previewLayerContext.drawImage(fullMask, 0, 0);
        previewLayerContext.restore();
        context2d(processedCanvas).globalCompositeOperation = 'destination-in';
        context2d(processedCanvas).drawImage(fullMask, 0, 0);
      } else {
        previewLayerContext.clearRect(0, 0, sourceWidth, sourceHeight);
      }
      previewLayerContext.drawImage(processedCanvas, 0, 0);

      if (preview.width !== sourceWidth) preview.width = sourceWidth;
      if (preview.height !== sourceHeight) preview.height = sourceHeight;
      const previewContext = context2d(preview);
      previewContext.clearRect(0, 0, sourceWidth, sourceHeight);
      for (const candidate of layersRef.current) {
        paintLayer(
          previewContext,
          candidate.id === layer.id ? { ...candidate, canvas: previewLayerCanvas } : candidate,
        );
      }
      return true;
    },
    [
      activeLayer,
      activeLayerIdRef,
      commitPendingEditsRef,
      effectParametersFor,
      effectPreviewTokenRef,
      effectRequestAbortRef,
      layersRef,
      previewCanvasRef,
      selectionRef,
    ],
  );

  const applyEffect = useCallback(
    async (effect: EffectId, parameters: EffectParameters = {}) => {
      if (effectBusyRef.current) return false;
      clearEffectPreview();
      commitPendingEditsRef.current();
      const layer = activeLayer();
      if (!layer) return false;
      const context = context2d(layer.canvas);
      const sourceWidth = layer.canvas.width;
      const sourceHeight = layer.canvas.height;
      const sourceHistoryIndex = historyIndexRef.current;
      const source = context.getImageData(0, 0, sourceWidth, sourceHeight);
      const activeSelection = selectionRef.current;
      const effectParameters = effectParametersFor(parameters, activeSelection, sourceWidth, sourceHeight);
      const abortController = new AbortController();
      effectRequestAbortRef.current = abortController;
      effectBusyRef.current = true;
      setEffectBusy(true);
      setEffectProgress(0);
      try {
        const processed = await runImageEffect(
          source,
          effect,
          effectParameters,
          abortController.signal,
          setEffectProgress,
        );
        const currentLayer = layersRef.current.find((candidate) => candidate.id === layer.id);
        const documentUnchanged =
          currentLayer === layer &&
          historyIndexRef.current === sourceHistoryIndex &&
          layer.canvas.width === sourceWidth &&
          layer.canvas.height === sourceHeight;
        if (!documentUnchanged) return false;

        if (activeSelection) {
          const processedCanvas = makeCanvas(sourceWidth, sourceHeight);
          const processedContext = context2d(processedCanvas);
          processedContext.putImageData(processed, 0, 0);
          const fullMask = selectionMaskOnCanvas(activeSelection, sourceWidth, sourceHeight);
          processedContext.globalCompositeOperation = 'destination-in';
          processedContext.drawImage(fullMask, 0, 0);
          processedContext.globalCompositeOperation = 'source-over';
          context.save();
          context.globalCompositeOperation = 'destination-out';
          context.drawImage(fullMask, 0, 0);
          context.restore();
          context.drawImage(processedCanvas, 0, 0);
        } else {
          context.putImageData(processed, 0, 0);
        }
        pushHistory(EFFECT_BY_ID[effect].name);
        return true;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return false;
        throw error;
      } finally {
        if (effectRequestAbortRef.current === abortController) effectRequestAbortRef.current = null;
        effectBusyRef.current = false;
        setEffectBusy(false);
        setEffectProgress(0);
      }
    },
    [
      activeLayer,
      clearEffectPreview,
      commitPendingEditsRef,
      effectBusyRef,
      effectParametersFor,
      effectRequestAbortRef,
      historyIndexRef,
      layersRef,
      pushHistory,
      selectionRef,
      setEffectBusy,
      setEffectProgress,
    ],
  );

  const cancelEffect = useCallback(() => {
    effectPreviewTokenRef.current += 1;
    effectRequestAbortRef.current?.abort();
    effectRequestAbortRef.current = null;
    const preview = previewCanvasRef.current;
    if (preview) context2d(preview).clearRect(0, 0, preview.width, preview.height);
  }, [effectPreviewTokenRef, effectRequestAbortRef, previewCanvasRef]);

  return {
    effectParametersFor,
    clearEffectPreview,
    getActiveHistogram,
    previewEffect,
    applyEffect,
    cancelEffect,
  };
}
