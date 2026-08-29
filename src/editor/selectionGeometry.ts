import { context2d } from './canvasContext';
import { cloneCanvas, makeCanvas } from './canvasUtils';
import { applyTransform, isPureTranslation, normalizeSelectionBounds } from './geometry';
import { offsetMaskPixels } from './selectionMorphology';
import type { AffineTransform, Point, Selection, ToolId } from './types';

/** Selection combination modes, mirroring native Pinta's SelectionModeHandler. */
export type SelectionMode = 'replace' | 'union' | 'exclude' | 'xor' | 'intersect';

export type SelectionResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export function transformSelection(
  selection: Selection,
  transform: AffineTransform,
  width: number,
  height: number,
): Selection {
  if (isPureTranslation(transform)) {
    return {
      ...selection,
      start: applyTransform(selection.start, transform),
      end: applyTransform(selection.end, transform),
      points: selection.points?.map((point) => applyTransform(point, transform)),
    };
  }

  const bounds = normalizeSelection(selection, width, height);
  const sourceMask = createSelectionMask(bounds);
  const corners = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    { x: bounds.x, y: bounds.y + bounds.height },
  ].map((point) => applyTransform(point, transform));
  const originX = Math.floor(Math.min(...corners.map((point) => point.x))) - 1;
  const originY = Math.floor(Math.min(...corners.map((point) => point.y))) - 1;
  const right = Math.ceil(Math.max(...corners.map((point) => point.x))) + 1;
  const bottom = Math.ceil(Math.max(...corners.map((point) => point.y))) + 1;
  const transformedMask = makeCanvas(Math.max(1, right - originX), Math.max(1, bottom - originY));
  const context = context2d(transformedMask);
  context.setTransform(
    transform.a,
    transform.b,
    transform.c,
    transform.d,
    transform.e - originX,
    transform.f - originY,
  );
  context.translate(bounds.x, bounds.y);
  context.drawImage(sourceMask, 0, 0);
  const transformed = selectionFromMask(transformedMask, originX, originY);
  return transformed ? { ...transformed, tool: selection.tool } : {
    ...selection,
    start: applyTransform(selection.start, transform),
    end: applyTransform(selection.end, transform),
    points: selection.points?.map((point) => applyTransform(point, transform)),
  };
}

export function normalizeSelection(selection: Selection, _canvasWidth: number, _canvasHeight: number) {
  return { ...normalizeSelectionBounds(selection), selection };
}

export function selectionHandlePoints(bounds: ReturnType<typeof normalizeSelection>) {
  const left = bounds.x;
  const top = bounds.y;
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  const centerX = left + bounds.width / 2;
  const centerY = top + bounds.height / 2;
  return {
    nw: { x: left, y: top },
    n: { x: centerX, y: top },
    ne: { x: right, y: top },
    e: { x: right, y: centerY },
    se: { x: right, y: bottom },
    s: { x: centerX, y: bottom },
    sw: { x: left, y: bottom },
    w: { x: left, y: centerY },
  } satisfies Record<SelectionResizeHandle, Point>;
}

export function isResizableSelection(selection: Selection | null, tool: ToolId) {
  return selection !== null &&
    (tool === 'rectangle-select' || tool === 'ellipse-select');
}

export function selectionResizeHandleAtPoint(
  selection: Selection | null,
  tool: ToolId,
  point: Point,
  canvasWidth: number,
  canvasHeight: number,
  zoom: number,
): SelectionResizeHandle | null {
  if (!isResizableSelection(selection, tool) || !selection) return null;
  const bounds = normalizeSelection(selection, canvasWidth, canvasHeight);
  if (bounds.width < 1 || bounds.height < 1) return null;
  const hitRadius = 9.5 / zoom;
  let closest: { handle: SelectionResizeHandle; distance: number } | null = null;
  for (const [handle, handlePoint] of Object.entries(selectionHandlePoints(bounds)) as Array<[SelectionResizeHandle, Point]>) {
    const distance = Math.hypot(point.x - handlePoint.x, point.y - handlePoint.y);
    if (distance <= hitRadius && (!closest || distance < closest.distance)) closest = { handle, distance };
  }
  return closest?.handle ?? null;
}

export function constrainSelectionPoint(start: Point, point: Point, canvasWidth: number, canvasHeight: number) {
  const directionX = Math.sign(point.x - start.x) || 1;
  const directionY = Math.sign(point.y - start.y) || 1;
  const availableX = directionX > 0 ? canvasWidth - start.x : start.x;
  const availableY = directionY > 0 ? canvasHeight - start.y : start.y;
  const extent = Math.min(
    Math.max(Math.abs(point.x - start.x), Math.abs(point.y - start.y)),
    availableX,
    availableY,
  );
  return {
    x: start.x + directionX * extent,
    y: start.y + directionY * extent,
  };
}

export function resizeSelection(
  original: Selection,
  handle: SelectionResizeHandle,
  point: Point,
  canvasWidth: number,
  canvasHeight: number,
  constrain: boolean,
): Selection {
  const bounds = normalizeSelection(original, canvasWidth, canvasHeight);
  let left = bounds.x;
  let top = bounds.y;
  let right = bounds.x + bounds.width;
  let bottom = bounds.y + bounds.height;
  const movesLeft = handle.includes('w');
  const movesRight = handle.includes('e');
  const movesTop = handle.includes('n');
  const movesBottom = handle.includes('s');

  if (constrain && (movesLeft || movesRight) && (movesTop || movesBottom)) {
    const anchor = {
      x: movesLeft ? right : left,
      y: movesTop ? bottom : top,
    };
    const constrained = constrainSelectionPoint(anchor, point, canvasWidth, canvasHeight);
    if (movesLeft) left = constrained.x;
    if (movesRight) right = constrained.x;
    if (movesTop) top = constrained.y;
    if (movesBottom) bottom = constrained.y;
  } else {
    if (movesLeft) left = point.x;
    if (movesRight) right = point.x;
    if (movesTop) top = point.y;
    if (movesBottom) bottom = point.y;
    if (constrain && (movesLeft || movesRight)) {
      const centerY = (top + bottom) / 2;
      const halfHeight = Math.abs(right - left) / 2;
      top = centerY - halfHeight;
      bottom = centerY + halfHeight;
    } else if (constrain && (movesTop || movesBottom)) {
      const centerX = (left + right) / 2;
      const halfWidth = Math.abs(bottom - top) / 2;
      left = centerX - halfWidth;
      right = centerX + halfWidth;
    }
  }

  return {
    ...original,
    start: { x: Math.min(left, right), y: Math.min(top, bottom) },
    end: { x: Math.max(left, right), y: Math.max(top, bottom) },
  };
}

export const selectionBoundaryCache = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
let selectionMarchingPatternCanvas: HTMLCanvasElement | null = null;
let selectionOverlayScratchCanvas: HTMLCanvasElement | null = null;

export function selectionBoundaryOf(mask: HTMLCanvasElement) {
  const cached = selectionBoundaryCache.get(mask);
  if (cached) return cached;
  const maskPixels = context2d(mask).getImageData(0, 0, mask.width, mask.height).data;
  const boundary = makeCanvas(mask.width, mask.height);
  const context = context2d(boundary);
  const boundaryPixels = context.createImageData(mask.width, mask.height);
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      const pixel = y * mask.width + x;
      if (!maskPixels[pixel * 4 + 3]) continue;
      const edge = x === 0 || y === 0 || x === mask.width - 1 || y === mask.height - 1 ||
        !maskPixels[(pixel - 1) * 4 + 3] || !maskPixels[(pixel + 1) * 4 + 3] ||
        !maskPixels[(pixel - mask.width) * 4 + 3] || !maskPixels[(pixel + mask.width) * 4 + 3];
      if (!edge) continue;
      const index = pixel * 4;
      boundaryPixels.data[index] = 255;
      boundaryPixels.data[index + 1] = 255;
      boundaryPixels.data[index + 2] = 255;
      boundaryPixels.data[index + 3] = 255;
    }
  }
  context.putImageData(boundaryPixels, 0, 0);
  selectionBoundaryCache.set(mask, boundary);
  return boundary;
}

export function selectionMarchingPattern() {
  if (selectionMarchingPatternCanvas) return selectionMarchingPatternCanvas;
  const pattern = makeCanvas(6, 6);
  const context = context2d(pattern);
  const pixels = context.createImageData(6, 6);
  for (let y = 0; y < 6; y += 1) {
    for (let x = 0; x < 6; x += 1) {
      if ((x + y) % 6 >= 2) continue;
      const index = (y * 6 + x) * 4;
      pixels.data[index + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
  selectionMarchingPatternCanvas = pattern;
  return pattern;
}

export function selectionOverlayScratch(width: number, height: number) {
  if (!selectionOverlayScratchCanvas) selectionOverlayScratchCanvas = makeCanvas(width, height);
  if (selectionOverlayScratchCanvas.width !== width) selectionOverlayScratchCanvas.width = width;
  if (selectionOverlayScratchCanvas.height !== height) selectionOverlayScratchCanvas.height = height;
  const context = context2d(selectionOverlayScratchCanvas);
  context.clearRect(0, 0, width, height);
  return selectionOverlayScratchCanvas;
}

export function drawSelectionOverlay(
  target: HTMLCanvasElement,
  selection: Selection | null,
  tool: ToolId,
  zoom: number,
  phase = 0,
) {
  const context = context2d(target);
  context.clearRect(0, 0, target.width, target.height);
  if (!selection) return;

  context.save();
  const bounds = normalizeSelection(selection, target.width, target.height);
  const fillSelection = SELECTION_TOOLS.includes(tool);
  if (selection.mask) {
    const scratch = selectionOverlayScratch(selection.mask.width, selection.mask.height);
    const scratchContext = context2d(scratch);
    if (fillSelection) {
      scratchContext.drawImage(selection.mask, 0, 0);
      scratchContext.globalCompositeOperation = 'source-in';
      scratchContext.fillStyle = '#b3cce6';
      scratchContext.fillRect(0, 0, scratch.width, scratch.height);
      scratchContext.globalCompositeOperation = 'source-over';
      context.save();
      context.globalAlpha = 0.2;
      context.drawImage(scratch, bounds.x, bounds.y);
      context.restore();
      scratchContext.clearRect(0, 0, scratch.width, scratch.height);
    }
    scratchContext.drawImage(selectionBoundaryOf(selection.mask), 0, 0);
    scratchContext.save();
    scratchContext.globalCompositeOperation = 'source-atop';
    scratchContext.translate(phase % 6, 0);
    scratchContext.fillStyle = scratchContext.createPattern(selectionMarchingPattern(), 'repeat')!;
    scratchContext.fillRect(-6, 0, scratch.width + 12, scratch.height);
    scratchContext.restore();
    context.drawImage(scratch, bounds.x, bounds.y);
  } else {
    const outlineOffset = 0.5 / zoom;
    context.beginPath();
    if (selection.points?.length) {
      const [first, ...rest] = selection.points;
      context.moveTo(first.x + outlineOffset, first.y + outlineOffset);
      for (const point of rest) context.lineTo(point.x + outlineOffset, point.y + outlineOffset);
      context.closePath();
    } else if (selection.tool === 'ellipse-select') {
      context.ellipse(bounds.x + bounds.width / 2 + outlineOffset, bounds.y + bounds.height / 2 + outlineOffset, bounds.width / 2, bounds.height / 2, 0, 0, Math.PI * 2);
    } else {
      context.rect(bounds.x + outlineOffset, bounds.y + outlineOffset, bounds.width, bounds.height);
    }
    if (fillSelection) {
      context.fillStyle = 'rgba(179, 204, 230, 0.2)';
      context.fill();
    }
    // Match native Pinta: a white support outline with a short animated
    // black dash drawn over it remains visible on every canvas color.
    context.lineWidth = 2 / zoom;
    context.strokeStyle = '#ffffff';
    context.setLineDash([]);
    context.stroke();
    context.lineWidth = 1.5 / zoom;
    context.strokeStyle = '#000000';
    context.setLineDash([2 / zoom, 4 / zoom]);
    context.lineDashOffset = -(phase % 6) / zoom;
    context.stroke();
  }
  if (isResizableSelection(selection, tool) && bounds.width > 0 && bounds.height > 0) {
    const handleRadius = 4.5 / zoom;
    context.setLineDash([]);
    context.shadowBlur = 0;
    context.lineWidth = 1 / zoom;
    context.fillStyle = '#0000ff';
    context.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    for (const handlePoint of Object.values(selectionHandlePoints(bounds))) {
      const handleX = Math.max(handleRadius, Math.min(target.width - handleRadius, handlePoint.x));
      const handleY = Math.max(handleRadius, Math.min(target.height - handleRadius, handlePoint.y));
      context.beginPath();
      context.arc(handleX, handleY, handleRadius, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }
  }
  context.restore();
}

export function createSelectionMask(selection: ReturnType<typeof normalizeSelection>) {
  const mask = makeCanvas(selection.width, selection.height);
  const context = context2d(mask);
  context.fillStyle = '#ffffff';

  if (selection.selection.mask) {
    context.drawImage(selection.selection.mask, 0, 0, selection.width, selection.height);
    return mask;
  }

  context.beginPath();
  if (selection.selection.points?.length) {
    const [first, ...rest] = selection.selection.points;
    context.moveTo(first.x - selection.x, first.y - selection.y);
    for (const point of rest) context.lineTo(point.x - selection.x, point.y - selection.y);
    context.closePath();
  } else if (selection.ellipse) {
    context.ellipse(selection.width / 2, selection.height / 2, selection.width / 2, selection.height / 2, 0, 0, Math.PI * 2);
  } else {
    context.rect(0, 0, selection.width, selection.height);
  }
  context.fill();
  return mask;
}

export function copySelectionToCanvas(source: HTMLCanvasElement, selection: ReturnType<typeof normalizeSelection>) {
  const output = makeCanvas(selection.width, selection.height);
  const context = context2d(output);
  context.drawImage(source, -selection.x, -selection.y);
  context.globalCompositeOperation = 'destination-in';
  context.drawImage(createSelectionMask(selection), 0, 0);
  return output;
}

export function selectionMaskOnCanvas(selection: Selection, width: number, height: number) {
  const bounds = normalizeSelection(selection, width, height);
  const output = makeCanvas(width, height);
  if (bounds.width > 0 && bounds.height > 0) {
    context2d(output).drawImage(createSelectionMask(bounds), bounds.x, bounds.y);
  }
  return output;
}

/**
 * Keep a raster mutation inside the active selection by restoring the layer
 * outside its mask from the snapshot taken before the operation began.
 *
 * This intentionally works from the selection's alpha mask rather than a
 * rectangular clip: magic-wand and combined selections can be disconnected
 * or contain holes, and destructive compositing modes such as the eraser are
 * not representable by drawing the operation onto a transparent scratch
 * canvas first.
 */
export function constrainCanvasMutationToSelection(
  canvas: HTMLCanvasElement,
  before: HTMLCanvasElement | null,
  selection: Selection | null,
) {
  if (!before || !selection) return;
  const mask = selectionMaskOnCanvas(selection, canvas.width, canvas.height);
  const selectedResult = cloneCanvas(canvas);
  const selectedContext = context2d(selectedResult);
  selectedContext.globalCompositeOperation = 'destination-in';
  selectedContext.drawImage(mask, 0, 0);

  const merged = cloneCanvas(before);
  const mergedContext = context2d(merged);
  mergedContext.globalCompositeOperation = 'destination-out';
  mergedContext.drawImage(mask, 0, 0);
  mergedContext.globalCompositeOperation = 'source-over';
  mergedContext.drawImage(selectedResult, 0, 0);

  const context = context2d(canvas);
  context.save();
  context.globalCompositeOperation = 'copy';
  context.drawImage(merged, 0, 0);
  context.restore();
}

export function offsetSelectionMask(selection: Selection, width: number, height: number, offset: number) {
  if (Math.round(offset) === 0) return selection;
  const source = context2d(selectionMaskOnCanvas(selection, width, height)).getImageData(0, 0, width, height).data;
  const output = makeCanvas(width, height);
  const context = context2d(output);
  context.putImageData(new ImageData(offsetMaskPixels(source, width, height, offset), width, height), 0, 0);
  return selectionFromMask(output);
}

export function selectionFromMask(maskCanvas: HTMLCanvasElement, originX = 0, originY = 0): Selection | null {
  if (maskCanvas.width < 1 || maskCanvas.height < 1) return null;
  const context = context2d(maskCanvas);
  const pixels = context.getImageData(0, 0, maskCanvas.width, maskCanvas.height).data;
  let minX = maskCanvas.width;
  let minY = maskCanvas.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < maskCanvas.height; y += 1) {
    for (let x = 0; x < maskCanvas.width; x += 1) {
      if (pixels[(y * maskCanvas.width + x) * 4 + 3] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) return null;
  const mask = makeCanvas(maxX - minX + 1, maxY - minY + 1);
  context2d(mask).drawImage(maskCanvas, -minX, -minY);
  return {
    tool: 'magic-wand',
    start: { x: originX + minX, y: originY + minY },
    end: { x: originX + maxX + 1, y: originY + maxY + 1 },
    mask,
  };
}

export function combineSelectionMasks(
  previous: Selection | null,
  next: Selection,
  mode: SelectionMode,
  width: number,
  height: number,
) {
  if (mode === 'replace') return next;
  if (!previous) return mode === 'union' || mode === 'xor' ? next : null;
  const previousBounds = normalizeSelection(previous, width, height);
  const nextBounds = normalizeSelection(next, width, height);
  const left = mode === 'exclude'
    ? previousBounds.x
    : mode === 'intersect'
      ? Math.max(previousBounds.x, nextBounds.x)
      : Math.min(previousBounds.x, nextBounds.x);
  const top = mode === 'exclude'
    ? previousBounds.y
    : mode === 'intersect'
      ? Math.max(previousBounds.y, nextBounds.y)
      : Math.min(previousBounds.y, nextBounds.y);
  const right = mode === 'exclude'
    ? previousBounds.x + previousBounds.width
    : mode === 'intersect'
      ? Math.min(previousBounds.x + previousBounds.width, nextBounds.x + nextBounds.width)
      : Math.max(previousBounds.x + previousBounds.width, nextBounds.x + nextBounds.width);
  const bottom = mode === 'exclude'
    ? previousBounds.y + previousBounds.height
    : mode === 'intersect'
      ? Math.min(previousBounds.y + previousBounds.height, nextBounds.y + nextBounds.height)
      : Math.max(previousBounds.y + previousBounds.height, nextBounds.y + nextBounds.height);
  if (right <= left || bottom <= top) return null;
  const output = makeCanvas(right - left, bottom - top);
  const context = context2d(output);
  context.drawImage(createSelectionMask(previousBounds), previousBounds.x - left, previousBounds.y - top);
  context.globalCompositeOperation = mode === 'union'
    ? 'source-over'
    : mode === 'exclude'
      ? 'destination-out'
      : mode === 'xor'
        ? 'xor'
        : 'destination-in';
  if (nextBounds.width > 0 && nextBounds.height > 0) {
    context.drawImage(createSelectionMask(nextBounds), nextBounds.x - left, nextBounds.y - top);
  }
  context.globalCompositeOperation = 'source-over';
  return selectionFromMask(output, left, top);
}

export const SELECTION_TOOLS: ToolId[] = ['rectangle-select', 'ellipse-select', 'lasso-select', 'magic-wand'];
