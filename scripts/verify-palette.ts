import assert from 'node:assert/strict';
import { paletteFileName, parsePalette, serializePalette, type PaletteFormat } from '../src/editor/palette.ts';

const colors = ['#ffffff', '#123456', '#00ff90'];
const formats: PaletteFormat[] = ['paint-dot-net', 'gimp', 'paint-shop-pro'];

for (const format of formats) {
  const fileName = paletteFileName('round-trip', format);
  const encoded = serializePalette(colors, format, 'Round Trip');
  const decoded = parsePalette(encoded, fileName);
  assert.equal(decoded.format, format);
  assert.deepEqual(decoded.colors, colors);
}

assert.deepEqual(
  parsePalette('; Hexadecimal format: aarrggbb\n80112233\nFFABCDEF\n', 'colors.txt').colors,
  ['#112233', '#abcdef'],
  'Paint.NET alpha bytes should be accepted while browser palette colors remain RGB',
);
assert.deepEqual(
  parsePalette('GIMP Palette\nName: Sample\nColumns: 2\n# comment\n255 0 8 Red\n0 16 255 Blue\n', 'colors.gpl').colors,
  ['#ff0008', '#0010ff'],
);
assert.throws(() => parsePalette('JASC-PAL\n0100\n2\n1 2 3\n', 'broken.pal'), /truncated/i);
assert.equal(paletteFileName('custom.gpl', 'paint-dot-net'), 'custom.txt');

console.log('Palette verification passed: Paint.NET, GIMP, and PaintShop Pro parsing, export, sniffing, and round-trip behavior.');
