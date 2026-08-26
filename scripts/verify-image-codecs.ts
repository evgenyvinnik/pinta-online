import assert from 'node:assert/strict';
import { decodeBitmap, decodePortablePixmap, decodeTarga, decodeTiff, encodeBitmap, encodePortablePixmap, encodeTarga, encodeTiff } from '../src/editor/imageCodecs.ts';

const image = {
  width: 2,
  height: 2,
  data: new Uint8ClampedArray([
    255, 0, 0, 255, 0, 255, 0, 128,
    0, 0, 255, 64, 12, 34, 56, 0,
  ]),
};

const tga = encodeTarga(image);
assert.equal(tga[2], 2, 'TGA should use uncompressed true-color image type');
assert.equal(tga[16], 32, 'TGA should preserve alpha with 32-bit pixels');
assert.deepEqual(decodeTarga(tga), image, 'TGA should round-trip pixel order and alpha');

const bitmap = encodeBitmap(image);
assert.equal(String.fromCharCode(bitmap[0], bitmap[1]), 'BM');
assert.equal(new DataView(bitmap.buffer).getUint32(30, true), 3, 'BMP should use explicit RGBA bitfields');
assert.deepEqual(decodeBitmap(bitmap), image, 'V4 BMP should round-trip pixel order and alpha');

const tiff = encodeTiff(image);
assert.ok(
  String.fromCharCode(...tiff.subarray(0, 4)) === 'MM\0*' || String.fromCharCode(...tiff.subarray(0, 4)) === 'II*\0',
  'TIFF should write a standard byte-order and magic header',
);
assert.deepEqual(decodeTiff(tiff), image, 'TIFF should round-trip pixel order and alpha');

const topDown24 = new Uint8Array(54 + 8);
const topDownView = new DataView(topDown24.buffer);
topDown24.set([0x42, 0x4d]);
topDownView.setUint32(2, topDown24.length, true);
topDownView.setUint32(10, 54, true);
topDownView.setUint32(14, 40, true);
topDownView.setInt32(18, 2, true);
topDownView.setInt32(22, -1, true);
topDownView.setUint16(26, 1, true);
topDownView.setUint16(28, 24, true);
topDownView.setUint32(34, 8, true);
topDown24.set([30, 20, 10, 60, 50, 40, 0, 0], 54);
assert.deepEqual([...decodeBitmap(topDown24).data], [10, 20, 30, 255, 40, 50, 60, 255], 'BMP should honor top-down rows and row padding');

const paletteBmp = new Uint8Array(62 + 4);
const paletteView = new DataView(paletteBmp.buffer);
paletteBmp.set([0x42, 0x4d]);
paletteView.setUint32(2, paletteBmp.length, true);
paletteView.setUint32(10, 62, true);
paletteView.setUint32(14, 40, true);
paletteView.setInt32(18, 2, true);
paletteView.setInt32(22, 1, true);
paletteView.setUint16(26, 1, true);
paletteView.setUint16(28, 1, true);
paletteView.setUint32(34, 4, true);
paletteView.setUint32(46, 2, true);
paletteBmp.set([0, 0, 255, 0, 0, 255, 0, 0], 54);
paletteBmp.set([0b0100_0000, 0, 0, 0], 62);
assert.deepEqual([...decodeBitmap(paletteBmp).data], [255, 0, 0, 255, 0, 255, 0, 255], 'BMP should decode packed palette indices');

const ppm = encodePortablePixmap(image);
const decodedPpm = decodePortablePixmap(ppm);
assert.equal(decodedPpm.width, image.width);
assert.equal(decodedPpm.height, image.height);
assert.deepEqual(
  [...decodedPpm.data],
  [...image.data].map((value, index) => index % 4 === 3 ? 255 : value),
  'PPM should round-trip RGB and normalize alpha to opaque',
);

const scaled = decodePortablePixmap(new TextEncoder().encode('P3\n# scaling and comments\n1 1\n15\n15 8 0\n'));
assert.deepEqual([...scaled.data], [255, 136, 0, 255]);

const p6 = decodePortablePixmap(new Uint8Array([
  ...new TextEncoder().encode('P6\n# binary RGB\n2 1\n255\n'),
  255, 0, 32, 4, 128, 250,
]));
assert.deepEqual([...p6.data], [255, 0, 32, 255, 4, 128, 250, 255], 'P6 should decode binary 8-bit RGB samples');

const p6HighDepth = decodePortablePixmap(new Uint8Array([
  ...new TextEncoder().encode('P6\n1 1\n1023\n'),
  0x03, 0xff, 0x02, 0x00, 0x00, 0x00,
]));
assert.deepEqual([...p6HighDepth.data], [255, 128, 0, 255], 'P6 should scale big-endian 16-bit RGB samples');

const rleTga = new Uint8Array([
  0, 0, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 1, 0, 24, 0x20,
  0x81, 0, 0, 255,
  0x00, 255, 0, 0,
]);
assert.deepEqual(
  [...decodeTarga(rleTga).data],
  [255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255],
  'TGA should decode mixed RLE and raw true-color packets',
);

const grayscaleTga = new Uint8Array([
  0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 1, 0, 16, 0x28,
  32, 64, 220, 180,
]);
assert.deepEqual(
  [...decodeTarga(grayscaleTga).data],
  [32, 32, 32, 64, 220, 220, 220, 180],
  'TGA should decode grayscale plus alpha samples',
);

const paletteTga = new Uint8Array([
  0, 1, 1, 0, 0, 2, 0, 24, 0, 0, 0, 0, 2, 0, 1, 0, 8, 0x20,
  0, 0, 255, 0, 255, 0,
  1, 0,
]);
assert.deepEqual(
  [...decodeTarga(paletteTga).data],
  [0, 255, 0, 255, 255, 0, 0, 255],
  'TGA should resolve palette indices using the declared color-map depth',
);

assert.throws(() => decodeTarga(tga.slice(0, -2)), /truncated/i);
assert.throws(() => decodePortablePixmap(new Uint8Array([...new TextEncoder().encode('P6\n1 1\n255\n'), 1, 2])), /truncated/i);
assert.throws(() => decodeBitmap(bitmap.slice(0, -2)), /truncated/i);
assert.throws(() => decodeTiff(new Uint8Array([0x49, 0x49, 0, 0])), /header/i);

console.log('Image codec verification passed: P3/P6 PPM, TIFF RGBA, BMP palette/24/32-bit variants, plus raw, RLE, true-color, and grayscale TGA variants.');
