import { describe, expect, it } from 'vitest';
import { offsetMaskPixels } from '../../src/editor/selectionMorphology';

/** Builds mask bytes from an ASCII picture, where `#` is selected. */
function mask(rows: string[]) {
  const width = rows[0].length;
  const pixels = new Uint8ClampedArray(width * rows.length * 4);
  rows.forEach((row, y) => {
    [...row].forEach((cell, x) => {
      if (cell !== '#') return;
      const index = (y * width + x) * 4;
      pixels[index] = 255;
      pixels[index + 1] = 255;
      pixels[index + 2] = 255;
      pixels[index + 3] = 255;
    });
  });
  return { pixels, width, height: rows.length };
}

/** Renders the result back to ASCII so a failure shows the shape, not a byte offset. */
function render(pixels: Uint8ClampedArray, width: number, height: number) {
  const rows: string[] = [];
  for (let y = 0; y < height; y += 1) {
    let row = '';
    for (let x = 0; x < width; x += 1) row += pixels[(y * width + x) * 4 + 3] > 0 ? '#' : '.';
    rows.push(row);
  }
  return rows;
}

function offset(rows: string[], by: number) {
  const { pixels, width, height } = mask(rows);
  return render(offsetMaskPixels(pixels, width, height, by), width, height);
}

describe('offsetMaskPixels', () => {
  it('returns the mask untouched for a zero offset', () => {
    const rows = ['.....', '.###.', '.###.', '.....'];
    expect(offset(rows, 0)).toEqual(rows);
    // A fractional offset rounds to zero rather than doing something arbitrary.
    expect(offset(rows, 0.4)).toEqual(rows);
  });

  it('grows a single pixel into the square its radius covers', () => {
    expect(offset(['.....', '.....', '..#..', '.....', '.....'], 1)).toEqual([
      '.....',
      '.###.',
      '.###.',
      '.###.',
      '.....',
    ]);
  });

  it('grows by a square window, not a disc', () => {
    // The corners fill in too — this is a box dilation, and the diagonal reach proves it.
    expect(offset(['.....', '.....', '..#..', '.....', '.....'], 2)[0]).toBe('#####');
  });

  it('shrinks a block from every side', () => {
    expect(offset(['......', '.####.', '.####.', '.####.', '.####.', '......'], -1)).toEqual([
      '......',
      '......',
      '..##..',
      '..##..',
      '......',
      '......',
    ]);
  });

  it('erases a selection thinner than twice the shrink radius', () => {
    expect(offset(['....', '.##.', '.##.', '....'], -2).join('')).not.toContain('#');
  });

  it('pulls a selection away from a canvas edge it touches when shrinking', () => {
    // Near a border the sampling window is clipped, so it can never be fully covered. A
    // Select All then shrink therefore eats the border — which is what shrinking should do.
    expect(offset(['#####', '#####', '#####', '#####', '#####'], -1)).toEqual([
      '.....',
      '.###.',
      '.###.',
      '.###.',
      '.....',
    ]);
  });

  it('clamps a grow at the canvas edge instead of reading out of bounds', () => {
    expect(offset(['#..', '...', '...'], 1)).toEqual(['##.', '##.', '...']);
  });

  it('treats a huge radius as select-all when growing and select-none when shrinking', () => {
    const rows = ['....', '..#.', '....', '....'];
    expect(offset(rows, 50).join('')).not.toContain('.');
    expect(offset(['####', '####', '####', '####'], -50).join('')).not.toContain('#');
  });

  it('reads the alpha channel, so a mask drawn in any colour still counts', () => {
    const width = 3;
    const pixels = new Uint8ClampedArray(width * 3 * 4);
    // A fully transparent but bright-white pixel must not count as selected.
    pixels.set([255, 255, 255, 0], 0);
    // A black but opaque pixel must.
    pixels.set([0, 0, 0, 255], (1 * width + 1) * 4);

    expect(render(offsetMaskPixels(pixels, width, 3, 0), width, 3)).toEqual(['...', '.#.', '...']);
  });

  it('joins two nearby regions when grown enough to touch', () => {
    expect(offset(['.......', '.#...#.', '.......'], 1)).toEqual(['###.###', '###.###', '###.###']);
  });

  it('is symmetric: growing then shrinking by the same radius restores a large block', () => {
    const rows = ['........', '..####..', '..####..', '..####..', '..####..', '........'];
    const grown = offset(rows, 1);
    const { pixels, width, height } = mask(grown);
    expect(render(offsetMaskPixels(pixels, width, height, -1), width, height)).toEqual(rows);
  });

  it('handles a non-square canvas without transposing it', () => {
    expect(offset(['........', '...#....'], 1)).toEqual(['..###...', '..###...']);
  });
});
