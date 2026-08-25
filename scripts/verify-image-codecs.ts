import assert from 'node:assert/strict';
import { decodePortablePixmap, decodeTarga, encodePortablePixmap, encodeTarga } from '../src/editor/imageCodecs.ts';

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

console.log('Image codec verification passed: P3/P6 PPM plus raw, RLE, true-color, and grayscale TGA variants.');
