import { describe, expect, it } from 'vitest';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_LEVELS,
  clampZoom,
  formatZoomPercent,
  parseZoomPercent,
  zoomInLevel,
  zoomOutLevel,
} from '../../src/editor/zoom';

describe('zoom collection', () => {
  it('matches the native levels, largest first', () => {
    expect(ZOOM_LEVELS[0]).toBe(3600);
    expect(ZOOM_LEVELS.at(-1)).toBe(5);
    expect([...ZOOM_LEVELS]).toEqual([...ZOOM_LEVELS].sort((a, b) => b - a));
  });

  it('steps through every level in order without skipping', () => {
    const ascending: number[] = [];
    let zoom = ZOOM_LEVELS.at(-1)! / 100;
    for (let step = 0; step < ZOOM_LEVELS.length * 2; step += 1) {
      ascending.push(Math.round(zoom * 100));
      const next = zoomInLevel(zoom);
      if (next === zoom) break;
      zoom = next;
    }
    expect(ascending).toEqual([...ZOOM_LEVELS].reverse());
  });

  it('is idempotent at both ends', () => {
    const top = MAX_ZOOM;
    const bottom = ZOOM_LEVELS.at(-1)! / 100;
    expect(zoomInLevel(top)).toBe(top);
    expect(zoomOutLevel(bottom)).toBe(bottom);
  });

  it('snaps a hand-typed value up to the next preset, matching native', () => {
    // 750% sits between 700 and 800; stepping in must land on 800, not 750 * factor.
    expect(zoomInLevel(7.5)).toBeCloseTo(8, 10);
    expect(zoomOutLevel(7.5)).toBeCloseTo(7, 10);
  });

  it('never returns a level outside the clamp', () => {
    for (const start of [0.001, 0.05, 1, 12, 36, 999]) {
      expect(zoomInLevel(start)).toBeLessThanOrEqual(MAX_ZOOM);
      expect(zoomOutLevel(start)).toBeGreaterThanOrEqual(MIN_ZOOM);
    }
  });
});

describe('clampZoom', () => {
  it('bounds to the native ceiling and the Best Fit floor', () => {
    expect(clampZoom(1000)).toBe(MAX_ZOOM);
    expect(clampZoom(-4)).toBe(MIN_ZOOM);
    expect(clampZoom(2.5)).toBe(2.5);
  });
});

describe('parseZoomPercent', () => {
  it('accepts the shapes a person actually types', () => {
    expect(parseZoomPercent('150')).toBeCloseTo(1.5, 10);
    expect(parseZoomPercent('150%')).toBeCloseTo(1.5, 10);
    expect(parseZoomPercent('  150 % ')).toBeCloseTo(1.5, 10);
    expect(parseZoomPercent('12.5')).toBeCloseTo(0.125, 10);
    expect(parseZoomPercent('12,5')).toBeCloseTo(0.125, 10);
  });

  it('rejects junk rather than guessing', () => {
    for (const input of ['', ' ', 'abc', '%', '-50', '1e3', 'NaN', '1 2', '50px']) {
      expect(parseZoomPercent(input)).toBeNull();
    }
  });

  it('clamps rather than returning an out-of-range scale', () => {
    expect(parseZoomPercent('99999')).toBe(MAX_ZOOM);
  });

  it('round-trips through the formatter for every preset', () => {
    for (const level of ZOOM_LEVELS) {
      const zoom = level / 100;
      expect(parseZoomPercent(formatZoomPercent(zoom))).toBeCloseTo(zoom, 10);
    }
  });
});
