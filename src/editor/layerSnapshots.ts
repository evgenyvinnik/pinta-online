import { context2d } from './canvasContext';
import { imageDataCanvas, imageDataEqual, makeCanvas, makeId } from './canvasUtils';
import { canvasCompositeOperation } from './geometry';
import { pixelNode, resolvePixels } from './historyPixels';
import type {
  FloatingPixelsSnapshot,
  FloatingPixelsState,
  HistorySnapshot,
  PaintLayer,
  Selection,
  SelectionSnapshot,
} from './types';

export function drawFloatingPixels(context: CanvasRenderingContext2D, floating: FloatingPixelsState) {
  context.save();
  context.setTransform(
    floating.transform.a,
    floating.transform.b,
    floating.transform.c,
    floating.transform.d,
    floating.transform.e,
    floating.transform.f,
  );
  context.drawImage(floating.canvas, 0, 0);
  context.restore();
}

export function floatingPixelsFromSnapshot(
  snapshot: FloatingPixelsSnapshot | null | undefined,
): FloatingPixelsState | null {
  if (!snapshot) return null;
  return {
    layerId: snapshot.layerId,
    canvas: imageDataCanvas(snapshot.pixels),
    transform: { ...snapshot.transform },
  };
}

export function snapshotFloatingPixels(floating: FloatingPixelsState | null): FloatingPixelsSnapshot | null {
  if (!floating) return null;
  return {
    layerId: floating.layerId,
    pixels: context2d(floating.canvas).getImageData(0, 0, floating.canvas.width, floating.canvas.height),
    transform: { ...floating.transform },
  };
}

export function makeLayer(width: number, height: number, name: string, white = false): PaintLayer {
  const canvas = makeCanvas(width, height);
  if (white) {
    const context = context2d(canvas);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
  }
  return {
    id: makeId(),
    name,
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    revision: 0,
    canvas,
  };
}

export function snapshotOf(
  layers: PaintLayer[],
  activeLayerId: string,
  width: number,
  height: number,
  label: string,
  selection: Selection | null = null,
  floatingPixels: FloatingPixelsState | null = null,
  previous?: HistorySnapshot,
): HistorySnapshot {
  const previousLayers = new Map(previous?.layers.map((layer) => [layer.id, layer]));
  return {
    label,
    activeLayerId,
    width,
    height,
    layers: layers.map((layer) => {
      const captured = context2d(layer.canvas).getImageData(0, 0, width, height);
      const prior = previousLayers.get(layer.id);
      // The previous entry is the newest one, which is always whole, so this costs no rebuild.
      const priorPixels = prior ? resolvePixels(prior.pixels) : null;
      return {
        id: layer.id,
        name: layer.name,
        visible: layer.visible,
        opacity: layer.opacity,
        blendMode: layer.blendMode,
        // An untouched layer shares the previous node rather than storing anything at all.
        pixels: prior && priorPixels && imageDataEqual(priorPixels, captured) ? prior.pixels : pixelNode(captured),
      };
    }),
    selection: snapshotSelection(selection),
    floatingPixels: snapshotFloatingPixels(floatingPixels),
  };
}

export function deduplicateHistoryPixels(history: HistorySnapshot[]) {
  for (let index = 1; index < history.length; index += 1) {
    const previousLayers = new Map(history[index - 1].layers.map((layer) => [layer.id, layer]));
    history[index] = {
      ...history[index],
      layers: history[index].layers.map((layer) => {
        const previous = previousLayers.get(layer.id);
        return previous && imageDataEqual(resolvePixels(previous.pixels), resolvePixels(layer.pixels))
          ? { ...layer, pixels: previous.pixels }
          : layer;
      }),
    };
  }
  return history;
}

export function snapshotSelection(selection: Selection | null): SelectionSnapshot | null {
  if (!selection) return null;
  return {
    tool: selection.tool,
    start: { ...selection.start },
    end: { ...selection.end },
    points: selection.points?.map((point) => ({ ...point })),
    mask: selection.mask
      ? context2d(selection.mask).getImageData(0, 0, selection.mask.width, selection.mask.height)
      : undefined,
  };
}

export function selectionFromSnapshot(selection: SelectionSnapshot | null | undefined): Selection | null {
  if (!selection) return null;
  let mask: HTMLCanvasElement | undefined;
  if (selection.mask) {
    mask = makeCanvas(selection.mask.width, selection.mask.height);
    context2d(mask).putImageData(selection.mask, 0, 0);
  }
  return {
    tool: selection.tool,
    start: { ...selection.start },
    end: { ...selection.end },
    points: selection.points?.map((point) => ({ ...point })),
    mask,
  };
}

export function layerFromSnapshot(layer: HistorySnapshot['layers'][number]) {
  const pixels = resolvePixels(layer.pixels);
  const canvas = makeCanvas(pixels.width, pixels.height);
  context2d(canvas).putImageData(pixels, 0, 0);
  return {
    id: layer.id,
    name: layer.name,
    visible: layer.visible,
    opacity: layer.opacity,
    blendMode: layer.blendMode ?? 'normal',
    revision: 0,
    canvas,
  } satisfies PaintLayer;
}

export function paintLayer(context: CanvasRenderingContext2D, layer: PaintLayer) {
  if (!layer.visible) return;
  context.save();
  context.globalAlpha = layer.opacity;
  context.globalCompositeOperation = canvasCompositeOperation(layer.blendMode);
  context.drawImage(layer.canvas, 0, 0);
  context.restore();
}
