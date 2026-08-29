import { describe, expect, it } from 'vitest';
import {
  constrainLinePoint,
  distanceToSegment,
  gradientAmount,
  isRenderableLineDraft,
  shapeDashPattern,
} from '../../src/editor/drawing';
import type { EditableLineState } from '../../src/editor/types';

// Everything that strokes onto a context stays with Playwright. These five decide *where* and
// *how far*, and each one changes what the user sees a tool do.

describe('distanceToSegment', () => {
  const start = { x: 0, y: 0 };
  const end = { x: 10, y: 0 };

  it('is zero on the segment and the perpendicular distance beside it', () => {
    expect(distanceToSegment({ x: 5, y: 0 }, start, end)).toBe(0);
    expect(distanceToSegment({ x: 5, y: 3 }, start, end)).toBe(3);
  });

  it('measures to the nearer endpoint past either end, not to the infinite line', () => {
    // The projection is clamped, so a point beyond the end is 5 away from the end itself.
    expect(distanceToSegment({ x: 15, y: 0 }, start, end)).toBe(5);
    expect(distanceToSegment({ x: -5, y: 0 }, start, end)).toBe(5);
  });

  it('handles a degenerate segment as a point', () => {
    expect(distanceToSegment({ x: 3, y: 4 }, start, start)).toBe(5);
  });
});

describe('constrainLinePoint', () => {
  const start = { x: 100, y: 100 };

  it('snaps to the nearest 45 degrees while keeping the drag length', () => {
    const snapped = constrainLinePoint(start, { x: 200, y: 110 });
    expect(snapped.y).toBeCloseTo(100, 6);
    expect(Math.hypot(snapped.x - 100, snapped.y - 100)).toBeCloseTo(Math.hypot(100, 10), 6);
  });

  it('snaps a near-diagonal drag onto the diagonal', () => {
    const snapped = constrainLinePoint(start, { x: 190, y: 210 });
    expect(snapped.x - 100).toBeCloseTo(snapped.y - 100, 6);
  });

  it('returns the point unchanged when it has not moved', () => {
    expect(constrainLinePoint(start, start)).toEqual(start);
  });
});

describe('isRenderableLineDraft', () => {
  const draft = (points: Array<{ x: number; y: number }>) =>
    ({ points, tensions: points.map(() => 0) }) as unknown as EditableLineState;

  it('needs two points that are meaningfully apart', () => {
    expect(
      isRenderableLineDraft(
        draft([
          { x: 0, y: 0 },
          { x: 40, y: 40 },
        ]),
      ),
    ).toBe(true);
  });

  it('rejects a draft too short to be a deliberate line', () => {
    // Below half a pixel this is a click, not a drag, and drawing it would leave a stray dot.
    expect(
      isRenderableLineDraft(
        draft([
          { x: 0, y: 0 },
          { x: 0.2, y: 0.2 },
        ]),
      ),
    ).toBe(false);
  });

  it('rejects a single point and null', () => {
    expect(isRenderableLineDraft(draft([{ x: 0, y: 0 }]))).toBe(false);
    expect(isRenderableLineDraft(null)).toBe(false);
  });
});

describe('gradientAmount', () => {
  const start = { x: 0, y: 0 };
  const end = { x: 100, y: 0 };

  it('runs from 0 at the start to 1 at the end of a linear gradient', () => {
    expect(gradientAmount('linear', start, end, 0, 0)).toBeCloseTo(0, 6);
    expect(gradientAmount('linear', start, end, 100, 0)).toBeCloseTo(1, 6);
    expect(gradientAmount('linear', start, end, 50, 0)).toBeCloseTo(0.5, 6);
  });

  it('measures radius rather than projection for a radial gradient', () => {
    expect(gradientAmount('radial', start, end, 0, 0)).toBeCloseTo(0, 6);
    expect(gradientAmount('radial', start, end, 0, 100)).toBeCloseTo(1, 6);
  });

  it('saturates at 1 rather than running past the end', () => {
    for (const type of ['linear', 'radial', 'reflected', 'diamond', 'conical'] as const) {
      expect(gradientAmount(type, start, end, 1000, 1000), type).toBeLessThanOrEqual(1);
    }
  });

  it('survives a zero-length drag rather than dividing by zero', () => {
    // The distance-based types have no scale to divide by and saturate; conical is angle-based,
    // so the angle from the centre is still well defined and it keeps returning a real value.
    for (const type of ['linear', 'radial', 'reflected', 'diamond'] as const) {
      expect(gradientAmount(type, start, start, 5, 5), type).toBe(1);
    }
    const conical = gradientAmount('conical', start, start, 5, 5);
    expect(Number.isFinite(conical)).toBe(true);
    expect(conical).toBeGreaterThanOrEqual(0);
    expect(conical).toBeLessThanOrEqual(1);
  });
});

describe('shapeDashPattern', () => {
  it('returns no dashes for a solid line', () => {
    expect(shapeDashPattern('-' as never, 4)).toEqual({ dashes: [], offset: 0 });
  });

  it('produces a dash array that scales with the stroke size', () => {
    const thin = shapeDashPattern('dash' as never, 1);
    const thick = shapeDashPattern('dash' as never, 8);
    expect(thin.dashes.length).toBeGreaterThan(0);
    expect(Math.max(...thick.dashes)).toBeGreaterThan(Math.max(...thin.dashes));
  });

  it('never emits a zero-length dash, which would draw nothing', () => {
    for (const style of ['dash', 'dot', 'dash-dot']) {
      const { dashes } = shapeDashPattern(style as never, 2);
      expect(
        dashes.every((dash) => dash > 0),
        style,
      ).toBe(true);
    }
  });
});
