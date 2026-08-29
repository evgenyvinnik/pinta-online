import { describe, expect, it } from 'vitest';
import { colorDifferenceWithinTolerance, floodTolerance, getAnchorOffset, recolorColorTolerance } from '../../src/editor/colorMatching';

// floodFill, magicWandSelection and sampleCanvasColor read pixels off a canvas and stay with
// Playwright. The tolerance arithmetic and the anchor grid are pure, and both are places where
// an off-by-one changes what the user's tool actually selects.

describe('colorDifferenceWithinTolerance', () => {
  const black = [0, 0, 0, 255] as const;

  it('matches a colour against itself at zero tolerance', () => {
    expect(colorDifferenceWithinTolerance(0, 0, 0, 255, black, 0)).toBe(true);
  });

  it('rejects any difference at zero tolerance', () => {
    expect(colorDifferenceWithinTolerance(1, 0, 0, 255, black, 0)).toBe(false);
  });

  it('widens as tolerance rises', () => {
    const grey = 40;
    expect(colorDifferenceWithinTolerance(grey, grey, grey, 255, black, 10)).toBe(false);
    expect(colorDifferenceWithinTolerance(grey, grey, grey, 255, black, 100)).toBe(true);
  });

  it('counts the alpha channel, so a transparent pixel is not the same as an opaque one', () => {
    expect(colorDifferenceWithinTolerance(0, 0, 0, 0, black, 0)).toBe(false);
  });

  it('is symmetric in the direction of the difference', () => {
    const target = [128, 128, 128, 255] as const;
    expect(colorDifferenceWithinTolerance(120, 128, 128, 255, target, 10))
      .toBe(colorDifferenceWithinTolerance(136, 128, 128, 255, target, 10));
  });
});

describe('floodTolerance and recolorColorTolerance', () => {
  it('map the 0-100 slider onto a usable range, rising with the setting', () => {
    for (const scale of [floodTolerance, recolorColorTolerance]) {
      const values = [0, 25, 50, 75, 100].map(scale);
      expect(values.every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
      // Monotonic: raising the slider must never select less.
      for (let index = 1; index < values.length; index += 1) {
        expect(values[index]).toBeGreaterThanOrEqual(values[index - 1]);
      }
    }
  });
});

describe('getAnchorOffset', () => {
  // Per axis, not a 2D anchor: the caller applies it once for x and once for y.
  it('keeps the start edge when anchored there', () => {
    expect(getAnchorOffset(100, 300, 'start')).toBe(0);
    expect(getAnchorOffset(300, 100, 'start')).toBe(0);
  });

  it('keeps the end edge when anchored there, going negative as the canvas shrinks', () => {
    expect(getAnchorOffset(100, 300, 'end')).toBe(200);
    expect(getAnchorOffset(300, 100, 'end')).toBe(-200);
  });

  it('splits the difference when centred', () => {
    expect(getAnchorOffset(100, 300, 'center')).toBe(100);
    expect(getAnchorOffset(300, 100, 'center')).toBe(-100);
  });

  it('rounds a half-pixel centre rather than leaving a fractional offset', () => {
    // 101 into 200 leaves 99 to split; a fractional offset would blur the copied pixels.
    expect(Number.isInteger(getAnchorOffset(101, 200, 'center'))).toBe(true);
    expect(getAnchorOffset(101, 200, 'center')).toBe(50);
  });

  it('is zero for every position when the size does not change', () => {
    for (const position of ['start', 'center', 'end'] as const) {
      expect(getAnchorOffset(200, 200, position), position).toBe(0);
    }
  });
});
