import { describe, expect, it } from 'vitest';
import {
  IDENTITY_TRANSFORM,
  applyTransform,
  canvasCompositeOperation,
  isPureTranslation,
  multiplyTransforms,
  normalizeSelectionBounds,
  transformAround,
  transformDelta,
  translationTransform,
} from '../../src/editor/geometry';
import { BLEND_MODES } from '../../src/editor/types';
import type { AffineTransform, Point } from '../../src/editor/types';

const ROTATE_90: AffineTransform = { a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 };
const SCALE_2X: AffineTransform = { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 };

function expectPoint(actual: Point, expected: Point) {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
}

describe('multiplyTransforms', () => {
  it('leaves a transform unchanged when composed with the identity', () => {
    expect(multiplyTransforms(SCALE_2X, IDENTITY_TRANSFORM)).toEqual(SCALE_2X);
    expect(multiplyTransforms(IDENTITY_TRANSFORM, SCALE_2X)).toEqual(SCALE_2X);
  });

  it('applies the right operand first, matching the Canvas convention', () => {
    // Scale then translate moves by the untouched offset; translate then scale doubles it.
    const scaleThenTranslate = multiplyTransforms(translationTransform(10, 0), SCALE_2X);
    const translateThenScale = multiplyTransforms(SCALE_2X, translationTransform(10, 0));

    expectPoint(applyTransform({ x: 1, y: 0 }, scaleThenTranslate), { x: 12, y: 0 });
    expectPoint(applyTransform({ x: 1, y: 0 }, translateThenScale), { x: 22, y: 0 });
  });

  it('composes rotations additively', () => {
    const halfTurn = multiplyTransforms(ROTATE_90, ROTATE_90);
    expectPoint(applyTransform({ x: 1, y: 0 }, halfTurn), { x: -1, y: 0 });
  });
});

describe('transformAround', () => {
  it('leaves the centre point exactly where it was', () => {
    const center = { x: 40, y: 25 };
    for (const transform of [ROTATE_90, SCALE_2X]) {
      expectPoint(applyTransform(center, transformAround(center, transform)), center);
    }
  });

  it('rotates the surrounding points about that centre', () => {
    const around = transformAround({ x: 10, y: 10 }, ROTATE_90);
    expectPoint(applyTransform({ x: 20, y: 10 }, around), { x: 10, y: 20 });
  });

  it('is the plain transform when the centre is the origin', () => {
    const around = transformAround({ x: 0, y: 0 }, SCALE_2X);
    for (const key of Object.keys(SCALE_2X) as (keyof AffineTransform)[]) {
      expect(around[key]).toBeCloseTo(SCALE_2X[key], 9);
    }
  });
});

describe('isPureTranslation', () => {
  it('separates the cheap move path from transforms needing a re-raster', () => {
    expect(isPureTranslation(translationTransform(5, -3))).toBe(true);
    expect(isPureTranslation(IDENTITY_TRANSFORM)).toBe(true);
    expect(isPureTranslation(SCALE_2X)).toBe(false);
    expect(isPureTranslation(ROTATE_90)).toBe(false);
    // A flip keeps |a| = |d| = 1 but is not a translation.
    expect(isPureTranslation({ a: 1, b: 0, c: 0, d: -1, e: 0, f: 0 })).toBe(false);
  });
});

describe('normalizeSelectionBounds', () => {
  const select = (start: Point, end: Point, tool = 'rectangle-select' as const) => ({ tool, start, end });

  it('orders the corners however the drag was made', () => {
    const forward = normalizeSelectionBounds(select({ x: 10, y: 20 }, { x: 40, y: 60 }));
    const backward = normalizeSelectionBounds(select({ x: 40, y: 60 }, { x: 10, y: 20 }));

    expect(forward).toEqual(backward);
    expect(forward).toMatchObject({ x: 10, y: 20, width: 30, height: 40 });
  });

  it('never reports a negative size, whatever the input', () => {
    const corners: Point[] = [{ x: 0, y: 0 }, { x: -50, y: 900 }, { x: 12.5, y: -7.25 }, { x: 3, y: 3 }];
    for (const start of corners) {
      for (const end of corners) {
        const bounds = normalizeSelectionBounds(select(start, end));
        expect(bounds.width).toBeGreaterThanOrEqual(0);
        expect(bounds.height).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('grows to whole pixels rather than truncating a fractional drag away', () => {
    // A drag from 10.4 to 10.6 crosses a pixel boundary, so it selects that pixel.
    const bounds = normalizeSelectionBounds(select({ x: 10.4, y: 5.2 }, { x: 10.6, y: 5.8 }));
    expect(bounds).toMatchObject({ x: 10, y: 5, width: 1, height: 1 });
  });

  it('measures the same drag identically whichever way the pointer coordinates arrive', () => {
    // Firefox reports integer pointer coordinates where Chromium reports halves, so over a canvas
    // whose origin sits at x=239.5 the same gesture arrives as 40 -> 140 in one browser and
    // 39.5 -> 139.5 in the other. Native rounds both corners (SelectTool.cs:88,
    // RectangleHandle.cs:123), which is what makes these agree; flooring the near edge and
    // ceiling the far one reported 100 and 101.
    const chromium = normalizeSelectionBounds(select({ x: 40, y: 30 }, { x: 140, y: 90 }));
    const firefox = normalizeSelectionBounds(select({ x: 39.5, y: 29.5 }, { x: 139.5, y: 89.5 }));

    expect(chromium).toMatchObject({ width: 100, height: 60 });
    expect(firefox).toMatchObject({ width: 100, height: 60 });
  });

  it('treats a drag that never leaves one pixel as no selection, as native does', () => {
    // Rounding both corners means a sub-pixel twitch collapses to zero, which is how native
    // turns a click into a deselect rather than a one-pixel selection.
    expect(normalizeSelectionBounds(select({ x: 10.1, y: 5.1 }, { x: 10.4, y: 5.4 })))
      .toMatchObject({ width: 0, height: 0 });
  });

  it('reports a zero-size selection for a click without a drag', () => {
    expect(normalizeSelectionBounds(select({ x: 7, y: 7 }, { x: 7, y: 7 }))).toMatchObject({ width: 0, height: 0 });
  });

  it('keeps geometry outside the canvas so a transform can bring it back', () => {
    const bounds = normalizeSelectionBounds(select({ x: -30, y: -20 }, { x: 10, y: 10 }));
    expect(bounds).toMatchObject({ x: -30, y: -20, width: 40, height: 30 });
  });

  it('flags the ellipse tool so the mask is drawn as an ellipse', () => {
    expect(normalizeSelectionBounds(select({ x: 0, y: 0 }, { x: 4, y: 4 }, 'ellipse-select')).ellipse).toBe(true);
    expect(normalizeSelectionBounds(select({ x: 0, y: 0 }, { x: 4, y: 4 })).ellipse).toBe(false);
  });
});

describe('transformDelta', () => {
  const center = { x: 100, y: 100 };

  it('moves by whole pixels so a drag cannot blur the pixels it carries', () => {
    const move = transformDelta({ mode: 'translate', start: { x: 10, y: 10 }, center }, { x: 25.7, y: 4.2 }, false);
    expect(move).toEqual(translationTransform(15, -6));
  });

  it('rotates by the angle swept around the centre', () => {
    const rotate = transformDelta({ mode: 'rotate', start: { x: 200, y: 100 }, center }, { x: 100, y: 200 }, false);
    // A quarter turn takes the point to the right of centre to the point below it.
    expectPoint(applyTransform({ x: 200, y: 100 }, rotate), { x: 100, y: 200 });
  });

  it('snaps rotation to 32 steps when constrained', () => {
    const step = Math.PI * 2 / 32;
    const rotate = transformDelta({ mode: 'rotate', start: { x: 200, y: 100 }, center }, { x: 190, y: 130 }, true);
    const angle = Math.atan2(rotate.b, rotate.a);
    expect(Math.abs(angle / step - Math.round(angle / step))).toBeLessThan(1e-9);
  });

  it('scales each axis by the ratio the handle was dragged', () => {
    const scale = transformDelta({ mode: 'scale', start: { x: 200, y: 200 }, center }, { x: 300, y: 150 }, false);
    expect(scale.a).toBeCloseTo(2, 9);
    expect(scale.d).toBeCloseTo(0.5, 9);
    expectPoint(applyTransform(center, scale), center);
  });

  it('locks the aspect ratio to the larger axis when constrained', () => {
    const scale = transformDelta({ mode: 'scale', start: { x: 200, y: 200 }, center }, { x: 300, y: 150 }, true);
    expect(Math.abs(scale.a)).toBeCloseTo(Math.abs(scale.d), 9);
    expect(Math.abs(scale.a)).toBeCloseTo(2, 9);
  });

  it('keeps the sign of each axis when constraining, so a flip stays flipped', () => {
    const scale = transformDelta({ mode: 'scale', start: { x: 200, y: 200 }, center }, { x: 0, y: 150 }, true);
    expect(Math.sign(scale.a)).toBe(-1);
    expect(Math.sign(scale.d)).toBe(1);
  });

  it('does not collapse the shape when the handle starts on the centre axis', () => {
    // startVector.x is zero here; dividing by it would produce Infinity and erase the pixels.
    const scale = transformDelta({ mode: 'scale', start: { x: 100, y: 200 }, center }, { x: 150, y: 300 }, false);
    expect(Number.isFinite(scale.a)).toBe(true);
    expect(scale.a).toBe(1);
    expect(scale.d).toBeCloseTo(2, 9);
  });
});

describe('canvasCompositeOperation', () => {
  it('maps Normal to source-over and passes every other mode through', () => {
    expect(canvasCompositeOperation('normal')).toBe('source-over');
    for (const mode of BLEND_MODES) {
      const composite = canvasCompositeOperation(mode);
      expect(composite).toBe(mode === 'normal' ? 'source-over' : mode);
    }
  });
});
