import assert from 'node:assert/strict';
import { strFromU8, unzipSync } from 'fflate';
import { decodeOpenRasterArchive, encodeOpenRasterArchive } from '../src/editor/openRaster.ts';

const backgroundPng = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);
const overlayPng = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 2]);
const mergedPng = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 3]);
const thumbnailPng = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 4]);

const encoded = encodeOpenRasterArchive({
  width: 640,
  height: 360,
  layers: [
    { name: 'Background', visible: true, opacity: 1, blendMode: 'normal', png: backgroundPng },
    { name: 'Ink & <Glow>', visible: false, opacity: 0.625, blendMode: 'overlay', png: overlayPng },
  ],
  mergedPng,
  thumbnailPng,
});

const files = unzipSync(encoded);
assert.equal(strFromU8(files.mimetype), 'image/openraster');
assert.ok(files['stack.xml']);
assert.ok(files['data/layer0.png']);
assert.ok(files['data/layer1.png']);
assert.ok(files['mergedimage.png']);
assert.ok(files['Thumbnails/thumbnail.png']);

const stackXml = strFromU8(files['stack.xml']);
assert.match(stackXml, /name="Ink &amp; &lt;Glow&gt;"/);
assert.ok(stackXml.indexOf('Ink &amp; &lt;Glow&gt;') < stackXml.indexOf('Background'), 'Top layer must be serialized first.');

const decoded = decodeOpenRasterArchive(encoded);
assert.equal(decoded.width, 640);
assert.equal(decoded.height, 360);
assert.equal(decoded.layers.length, 2);
assert.deepEqual(decoded.layers.map((layer) => layer.name), ['Background', 'Ink & <Glow>']);
assert.deepEqual(decoded.layers.map((layer) => layer.visible), [true, false]);
assert.deepEqual(decoded.layers.map((layer) => layer.opacity), [1, 0.625]);
assert.deepEqual(decoded.layers.map((layer) => layer.blendMode), ['normal', 'overlay']);
assert.deepEqual(decoded.layers[0].png, backgroundPng);
assert.deepEqual(decoded.layers[1].png, overlayPng);
assert.deepEqual(decoded.mergedPng, mergedPng);
assert.deepEqual(decoded.thumbnailPng, thumbnailPng);

assert.throws(() => decodeOpenRasterArchive(new Uint8Array()), /invalid zip data|stack\.xml/i);

console.log('OpenRaster verification passed: archive structure, layer order, metadata, escaping, and payload round-trip.');
