import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { paletteFileName, parsePalette, serializePalette, type PaletteFormat } from '../../src/editor/palette';

/**
 * Ported from the former `verify:palette` script so one runner covers it. The assertions are the
 * originals; only the grouping is new.
 */
describe('palette formats', () => {
  const colors = ['#ffffff', '#123456', '#00ff90'];
  const formats: PaletteFormat[] = ['paint-dot-net', 'gimp', 'paint-shop-pro'];

  it('round-trips every supported format through its own file name', () => {
    for (const format of formats) {
      const fileName = paletteFileName('round-trip', format);
      const encoded = serializePalette(colors, format, 'Round Trip');
      const decoded = parsePalette(encoded, fileName);
      assert.equal(decoded.format, format);
      assert.deepEqual(decoded.colors, colors);
    }
  });

  it('preserves Paint.NET alpha bytes in both directions', () => {
    assert.deepEqual(
      parsePalette('; Hexadecimal format: aarrggbb\n80112233\nFFABCDEF\n', 'colors.txt').colors,
      ['#11223380', '#abcdef'],
      'Paint.NET alpha bytes should be preserved by browser palettes',
    );
    assert.deepEqual(
      parsePalette(serializePalette(['#11223380'], 'paint-dot-net'), 'alpha.txt').colors,
      ['#11223380'],
      'Paint.NET palettes should round-trip transparent colors',
    );
  });

  it('reads a GIMP palette written by another application', () => {
    assert.deepEqual(
      parsePalette('GIMP Palette\nName: Sample\nColumns: 2\n# comment\n255 0 8 Red\n0 16 255 Blue\n', 'colors.gpl').colors,
      ['#ff0008', '#0010ff'],
    );
  });

  it('rejects a truncated PaintShop Pro palette rather than importing half of it', () => {
    assert.throws(() => parsePalette('JASC-PAL\n0100\n2\n1 2 3\n', 'broken.pal'), /truncated/i);
  });

  it('renames the file to match the chosen format', () => {
    assert.equal(paletteFileName('custom.gpl', 'paint-dot-net'), 'custom.txt');
  });
});
