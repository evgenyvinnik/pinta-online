import { describe, expect, it } from 'vitest';
import { clampByte, colorToRgba, imageDataEqual, makeId, rgbaToHex } from '../../src/editor/canvasUtils';

// The canvas-backed helpers (makeCanvas, cloneCanvas, canvasesHaveSamePixels, imageDataCanvas)
// need a real rasteriser and stay covered by Playwright. Everything below is pure.

function image(width: number, height: number, fill = 0) {
  return new ImageData(new Uint8ClampedArray(width * height * 4).fill(fill), width, height);
}

describe('imageDataEqual', () => {
  it('accepts identical buffers and rejects a single changed byte', () => {
    const first = image(4, 4, 7);
    expect(imageDataEqual(first, image(4, 4, 7))).toBe(true);

    const changed = image(4, 4, 7);
    changed.data[37] = 8;
    expect(imageDataEqual(first, changed)).toBe(false);
  });

  it('rejects differing sizes rather than comparing what it can', () => {
    // Same byte count, different shape: 2x8 and 4x4 both hold 128 bytes.
    expect(imageDataEqual(image(2, 8), image(4, 4))).toBe(false);
    expect(imageDataEqual(image(4, 4), image(4, 5))).toBe(false);
  });

  it('compares the alpha channel, not only colour', () => {
    const opaque = image(2, 2, 255);
    const transparent = image(2, 2, 255);
    transparent.data[3] = 0;
    expect(imageDataEqual(opaque, transparent)).toBe(false);
  });
});

describe('colorToRgba', () => {
  it('reads six-digit hex as fully opaque', () => {
    expect(colorToRgba('#3584e4')).toEqual({ r: 0x35, g: 0x84, b: 0xe4, a: 255 });
  });

  it('reads the alpha byte of eight-digit hex', () => {
    expect(colorToRgba('#3584e480')).toEqual({ r: 0x35, g: 0x84, b: 0xe4, a: 0x80 });
  });

  it('accepts a value with no leading hash', () => {
    expect(colorToRgba('ffffff')).toEqual({ r: 255, g: 255, b: 255, a: 255 });
  });
});

describe('rgbaToHex', () => {
  it('omits the alpha byte when fully opaque', () => {
    expect(rgbaToHex(53, 132, 228)).toBe('#3584e4');
    expect(rgbaToHex(53, 132, 228, 255)).toBe('#3584e4');
  });

  it('writes the alpha byte when it is not', () => {
    expect(rgbaToHex(53, 132, 228, 128)).toBe('#3584e480');
  });

  it('pads single-digit channels, so the string is always the same length', () => {
    expect(rgbaToHex(0, 1, 15)).toBe('#00010f');
  });

  it('clamps and rounds rather than emitting an invalid colour', () => {
    expect(rgbaToHex(-20, 300, 127.6)).toBe('#00ff80');
    expect(rgbaToHex(0, 0, 0, -5)).toBe('#00000000');
  });

  it('round-trips through colorToRgba for both lengths', () => {
    for (const color of ['#000000', '#ffffff', '#3584e4', '#11223380', '#abcdef']) {
      const { r, g, b, a } = colorToRgba(color);
      expect(rgbaToHex(r, g, b, a)).toBe(color);
    }
  });
});

describe('clampByte', () => {
  it('holds values inside the byte range at the boundaries', () => {
    expect(clampByte(-1)).toBe(0);
    expect(clampByte(0)).toBe(0);
    expect(clampByte(255)).toBe(255);
    expect(clampByte(256)).toBe(255);
    expect(clampByte(128)).toBe(128);
  });
});

describe('makeId', () => {
  it('never repeats across a realistic number of layers', () => {
    const ids = new Set(Array.from({ length: 500 }, () => makeId()));
    expect(ids.size).toBe(500);
  });

  it('still produces an id where crypto.randomUUID is unavailable', () => {
    const original = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
    try {
      expect(makeId()).toMatch(/^layer-\d+-[a-z0-9]+$/);
    } finally {
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: original });
    }
  });
});
