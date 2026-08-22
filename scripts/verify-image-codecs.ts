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
assert.throws(() => decodePortablePixmap(new TextEncoder().encode('P6\n1 1\n255\n0 0 0')), /P3/);
assert.throws(() => decodeTarga(tga.slice(0, -2)), /truncated/i);

console.log('Image codec verification passed: P3 PPM scaling plus 32-bit uncompressed TGA order, alpha, and round trips.');
