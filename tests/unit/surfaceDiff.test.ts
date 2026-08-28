import { describe, expect, it } from 'vitest';
import {
  applyAndSwapSurfaceDiff,
  applySurfaceDiff,
  createSurfaceDiff,
  surfaceDiffByteSize,
} from '../../src/editor/surfaceDiff';

function surface(width: number, height: number, fill: [number, number, number, number] = [0, 0, 0, 0]) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < pixels.length; index += 4) pixels.set(fill, index);
  return new ImageData(pixels, width, height);
}

/** Fills a rectangle the way the native tests use a Cairo context to. */
function fillRect(image: ImageData, x: number, y: number, width: number, height: number, color: [number, number, number, number]) {
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      image.data.set(color, (row * image.width + column) * 4);
    }
  }
  return image;
}

function clone(image: ImageData) {
  return new ImageData(new Uint8ClampedArray(image.data), image.width, image.height);
}

const BLUE: [number, number, number, number] = [0, 0, 255, 255];

describe('createSurfaceDiff', () => {
  it('returns null for identical surfaces', () => {
    // Ported from Returning_Null_If_Same_Surfaces.
    const image = fillRect(surface(8, 8), 2, 2, 3, 3, BLUE);
    expect(createSurfaceDiff(image, clone(image))).toBeNull();
  });

  it('returns a diff for surfaces that differ', () => {
    // Ported from Returning_Value_If_Different_Surfaces.
    const before = surface(8, 8);
    const after = fillRect(clone(before), 1, 1, 2, 2, BLUE);
    expect(createSurfaceDiff(before, after)).not.toBeNull();
  });

  it('declines when the change covers too much to be worth storing', () => {
    // Ported from Returning_Null_If_Savings_Too_Small: a 16x15 fill in a 16x16 surface changes
    // 240 of 256 pixels, so savings are ~6.3% — under the 10% floor.
    const before = surface(16, 16);
    const after = fillRect(clone(before), 0, 0, 16, 15, BLUE);
    expect(createSurfaceDiff(before, after, false)).toBeNull();
  });

  it('accepts a change small enough to be worth storing', () => {
    // Ported from Returning_Non_Null_If_Savings_Big_Enough: 4 of 256 pixels, ~98.4% saved.
    const before = surface(16, 16);
    const after = fillRect(clone(before), 0, 0, 2, 2, BLUE);
    expect(createSurfaceDiff(before, after, false)).not.toBeNull();
  });

  it('honours force past the savings floor', () => {
    const before = surface(16, 16);
    const after = fillRect(clone(before), 0, 0, 16, 15, BLUE);
    expect(createSurfaceDiff(before, after, true)).not.toBeNull();
  });

  it('measures savings against the whole surface, not the bounding box', () => {
    // Every pixel inside the box changed, so a box-relative measure would report no saving at
    // all. Against the surface it saves 99%, which is the number that matters.
    const before = surface(100, 100);
    const after = fillRect(clone(before), 10, 10, 10, 10, BLUE);
    expect(createSurfaceDiff(before, after, false)).not.toBeNull();
  });

  it('bounds the change tightly, with inclusive edges', () => {
    const before = surface(10, 10);
    const after = fillRect(clone(before), 3, 4, 2, 3, BLUE);
    const diff = createSurfaceDiff(before, after)!;

    expect(diff.bounds).toEqual({ x: 3, y: 4, right: 4, bottom: 6 });
  });

  it('spans scattered changes with one box', () => {
    const before = surface(10, 10);
    const after = clone(before);
    after.data.set(BLUE, (1 * 10 + 8) * 4);
    after.data.set(BLUE, (7 * 10 + 2) * 4);
    const diff = createSurfaceDiff(before, after)!;

    expect(diff.bounds).toEqual({ x: 2, y: 1, right: 8, bottom: 7 });
    // Only the two pixels are stored, even though the box is 7x7.
    expect(diff.pixels).toHaveLength(2 * 4);
  });

  it('notices a change in alpha alone', () => {
    const before = surface(4, 4, [10, 20, 30, 255]);
    const after = clone(before);
    after.data[(2 * 4 + 1) * 4 + 3] = 128;

    expect(createSurfaceDiff(before, after)).not.toBeNull();
  });

  it('returns null for mismatched sizes, and throws when forced', () => {
    const small = surface(4, 4);
    const large = surface(5, 4);
    expect(createSurfaceDiff(small, large)).toBeNull();
    expect(() => createSurfaceDiff(small, large, true)).toThrow(/same size/i);
  });
});

describe('applyAndSwapSurfaceDiff', () => {
  it('swaps a surface back and forth between both states', () => {
    // Ported from Changes_Swapped_Back_And_Forth, the property the whole design rests on.
    const a = fillRect(surface(16, 16, [255, 255, 255, 255]), 2, 2, 5, 5, BLUE);
    const b = fillRect(clone(a), 4, 4, 6, 6, [255, 0, 0, 255]);
    const working = clone(b);
    const diff = createSurfaceDiff(a, b, true)!;

    applyAndSwapSurfaceDiff(diff, working);
    expect([...working.data]).toEqual([...a.data]);

    applyAndSwapSurfaceDiff(diff, working);
    expect([...working.data]).toEqual([...b.data]);
  });

  it('survives many round trips without drifting', () => {
    const before = fillRect(surface(12, 12, [9, 9, 9, 255]), 1, 1, 3, 3, BLUE);
    const after = fillRect(clone(before), 5, 5, 4, 4, [1, 2, 3, 4]);
    const working = clone(after);
    const diff = createSurfaceDiff(before, after, true)!;

    for (let pass = 0; pass < 10; pass += 1) applyAndSwapSurfaceDiff(diff, working);
    expect([...working.data]).toEqual([...after.data]);
  });
});

describe('applySurfaceDiff', () => {
  it('restores the original without consuming the diff', () => {
    const before = surface(8, 8, [255, 255, 255, 255]);
    const after = fillRect(clone(before), 2, 2, 2, 2, BLUE);
    const diff = createSurfaceDiff(before, after)!;
    const stored = new Uint8ClampedArray(diff.pixels);

    const first = clone(after);
    applySurfaceDiff(diff, first);
    expect([...first.data]).toEqual([...before.data]);
    // Unlike the swapping form, this one must stay reusable.
    expect([...diff.pixels]).toEqual([...stored]);

    const second = clone(after);
    applySurfaceDiff(diff, second);
    expect([...second.data]).toEqual([...before.data]);
  });

  it('leaves pixels outside the changed region alone', () => {
    const before = surface(8, 8, [255, 255, 255, 255]);
    const after = fillRect(clone(before), 2, 2, 2, 2, BLUE);
    const diff = createSurfaceDiff(before, after)!;

    // A surface whose untouched area differs from either state must keep that area.
    const target = fillRect(clone(after), 6, 6, 2, 2, [7, 7, 7, 255]);
    applySurfaceDiff(diff, target);
    expect([...target.data.slice((6 * 8 + 6) * 4, (6 * 8 + 6) * 4 + 4)]).toEqual([7, 7, 7, 255]);
  });

  it('refuses a surface of the wrong size rather than corrupting it', () => {
    const before = surface(8, 8);
    const after = fillRect(clone(before), 1, 1, 2, 2, BLUE);
    const diff = createSurfaceDiff(before, after)!;

    expect(() => applySurfaceDiff(diff, surface(9, 8))).toThrow(/size/i);
  });
});

describe('surfaceDiffByteSize', () => {
  it('is a small fraction of the surface it describes', () => {
    const before = surface(400, 400);
    const after = fillRect(clone(before), 100, 100, 20, 20, BLUE);
    const diff = createSurfaceDiff(before, after)!;

    // The point of the exercise: a small stroke must not cost a full copy.
    expect(surfaceDiffByteSize(diff)).toBeLessThan(before.data.byteLength / 100);
  });

  it('counts the mask and the stored pixels', () => {
    const before = surface(16, 16);
    const after = fillRect(clone(before), 0, 0, 2, 2, BLUE);
    const diff = createSurfaceDiff(before, after)!;

    expect(surfaceDiffByteSize(diff)).toBe(diff.bitmask.byteLength + diff.pixels.byteLength);
    expect(diff.pixels.byteLength).toBe(4 * 4);
  });
});
