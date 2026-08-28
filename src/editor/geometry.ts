import type { AffineTransform, Point, ToolId } from './types';

/**
 * The pure geometry the editor runs on: affine composition and selection bounds. None of it
 * touches a canvas, which is what lets it be tested without a rasteriser — the parts that do
 * draw stay in `usePaintEditor`.
 */
export interface SelectionGeometry {
  tool: ToolId;
  start: Point;
  end: Point;
  points?: Point[];
}

export interface TransformGestureGeometry {
  mode: 'translate' | 'scale' | 'rotate';
  start: Point;
  center: Point;
}

export const IDENTITY_TRANSFORM: AffineTransform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function translationTransform(x: number, y: number): AffineTransform {
  return { a: 1, b: 0, c: 0, d: 1, e: x, f: y };
}

export function multiplyTransforms(left: AffineTransform, right: AffineTransform): AffineTransform {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

/** Applies a transform about an arbitrary point rather than the canvas origin. */
export function transformAround(center: Point, transform: AffineTransform): AffineTransform {
  return multiplyTransforms(
    translationTransform(center.x, center.y),
    multiplyTransforms(transform, translationTransform(-center.x, -center.y)),
  );
}

export function applyTransform(point: Point, transform: AffineTransform): Point {
  return {
    x: transform.a * point.x + transform.c * point.y + transform.e,
    y: transform.b * point.x + transform.d * point.y + transform.f,
  };
}

export function isPureTranslation(transform: AffineTransform) {
  return transform.a === 1 && transform.b === 0 && transform.c === 0 && transform.d === 1;
}

export function normalizeSelectionBounds(selection: SelectionGeometry) {
  // Native transform tools retain geometry outside the canvas so it can be moved back later.
  // Drawing the mask onto a document-sized target performs the required clipping without
  // destroying the off-canvas bounds, so nothing is clamped here.
  const left = Math.min(selection.start.x, selection.end.x);
  const top = Math.min(selection.start.y, selection.end.y);
  const right = Math.max(selection.start.x, selection.end.x);
  const bottom = Math.max(selection.start.y, selection.end.y);
  return {
    x: Math.floor(left),
    y: Math.floor(top),
    width: Math.max(0, Math.ceil(right) - Math.floor(left)),
    height: Math.max(0, Math.ceil(bottom) - Math.floor(top)),
    ellipse: selection.tool === 'ellipse-select',
  };
}

export function transformDelta(
  gesture: TransformGestureGeometry,
  point: Point,
  constrain: boolean,
): AffineTransform {
  if (gesture.mode === 'translate') {
    return translationTransform(
      Math.floor(point.x - gesture.start.x),
      Math.floor(point.y - gesture.start.y),
    );
  }

  const startVector = { x: gesture.start.x - gesture.center.x, y: gesture.start.y - gesture.center.y };
  const currentVector = { x: point.x - gesture.center.x, y: point.y - gesture.center.y };

  if (gesture.mode === 'rotate') {
    let angle = Math.atan2(currentVector.y, currentVector.x) - Math.atan2(startVector.y, startVector.x);
    if (constrain) {
      const step = Math.PI * 2 / 32;
      angle = Math.round(angle / step) * step;
    }
    return transformAround(gesture.center, {
      a: Math.cos(angle),
      b: Math.sin(angle),
      c: -Math.sin(angle),
      d: Math.cos(angle),
      e: 0,
      f: 0,
    });
  }

  // A handle dragged through the centre would otherwise divide by ~0 and collapse the shape.
  let scaleX = Math.abs(startVector.x) < 0.001 ? 1 : currentVector.x / startVector.x;
  let scaleY = Math.abs(startVector.y) < 0.001 ? 1 : currentVector.y / startVector.y;
  if (constrain) {
    const maximum = Math.max(Math.abs(scaleX), Math.abs(scaleY));
    scaleX = maximum * (Math.sign(scaleX) || 1);
    scaleY = maximum * (Math.sign(scaleY) || 1);
  }
  return transformAround(gesture.center, { a: scaleX, b: 0, c: 0, d: scaleY, e: 0, f: 0 });
}

export function canvasCompositeOperation(blendMode: string): GlobalCompositeOperation {
  // Every Pinta blend mode but Normal already carries its Canvas name; Normal is source-over.
  return (blendMode === 'normal' ? 'source-over' : blendMode) as GlobalCompositeOperation;
}
