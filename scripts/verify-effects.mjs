import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});

try {
  const { processEffect } = await server.ssrLoadModule('/src/effects/processor.ts');

  const identitySource = new Uint8ClampedArray([
    18, 127, 238, 191,
    0, 64, 128, 255,
    200, 150, 100, 180,
  ]);
  const curveIdentity = processEffect(identitySource, 3, 1, 'curves', {
    curveMode: 0,
    curve_luminosity_0: 0,
    curve_luminosity_255: 255,
  });
  assert.deepEqual([...curveIdentity], [...identitySource], 'identity luminosity curve must preserve every channel and alpha');

  const rgbCurve = processEffect(new Uint8ClampedArray([32, 96, 160, 255]), 1, 1, 'curves', {
    curveMode: 1,
    curve_red_0: 255,
    curve_red_255: 0,
    curve_green_0: 0,
    curve_green_255: 255,
    curve_blue_0: 0,
    curve_blue_255: 255,
  });
  assert.deepEqual([...rgbCurve], [223, 96, 160, 255], 'RGB curves must address channels independently');

  const splineCurve = processEffect(new Uint8ClampedArray([
    64, 64, 64, 255,
    192, 192, 192, 255,
  ]), 2, 1, 'curves', {
    curveMode: 0,
    curve_luminosity_0: 0,
    curve_luminosity_64: 40,
    curve_luminosity_192: 215,
    curve_luminosity_255: 255,
  });
  assert.ok(splineCurve[0] < 64 && splineCurve[4] > 192, 'an S-curve must deepen shadows and lift highlights');

  const levelDefaults = {};
  for (const channel of ['red', 'green', 'blue']) {
    levelDefaults[`levels_${channel}_inputLow`] = 0;
    levelDefaults[`levels_${channel}_inputHigh`] = 255;
    levelDefaults[`levels_${channel}_gamma`] = 1;
    levelDefaults[`levels_${channel}_outputLow`] = 0;
    levelDefaults[`levels_${channel}_outputHigh`] = 255;
  }
  const redOnlyLevels = processEffect(new Uint8ClampedArray([64, 64, 64, 255]), 1, 1, 'levels', {
    ...levelDefaults,
    levels_red_inputLow: 128,
  });
  assert.deepEqual([...redOnlyLevels], [0, 64, 64, 255], 'Levels must preserve independently configured channels');

  const gammaLevels = processEffect(new Uint8ClampedArray([128, 128, 128, 255]), 1, 1, 'levels', {
    ...levelDefaults,
    levels_red_gamma: 2,
    levels_green_gamma: 2,
    levels_blue_gamma: 2,
  });
  assert.ok(gammaLevels[0] >= 63 && gammaLevels[0] <= 65, 'Levels gamma must use Pinta-compatible exponent math');

  const blurIdentitySource = new Uint8ClampedArray([
    20, 40, 60, 255,
    80, 100, 120, 200,
    140, 160, 180, 128,
  ]);
  const fragmentIdentity = processEffect(blurIdentitySource, 3, 1, 'fragment', { fragments: 8, distance: 0, rotation: 73 });
  assert.deepEqual([...fragmentIdentity], [...blurIdentitySource], 'zero-distance Fragment must preserve pixels');
  const radialIdentity = processEffect(blurIdentitySource, 3, 1, 'radial-blur', { angle: 0, offsetX: 0, offsetY: 0, quality: 5 });
  assert.deepEqual([...radialIdentity], [...blurIdentitySource], 'zero-angle Radial Blur must preserve pixels');
  const zoomIdentity = processEffect(blurIdentitySource, 3, 1, 'zoom-blur', { amount: 0, offsetX: 0.5, offsetY: -0.5 });
  assert.deepEqual([...zoomIdentity], [...blurIdentitySource], 'zero-amount Zoom Blur must preserve pixels');

  const unfocused = processEffect(new Uint8ClampedArray([
    0, 0, 0, 255,
    255, 0, 0, 255,
    0, 0, 0, 255,
  ]), 3, 1, 'unfocus', { radius: 1 });
  assert.deepEqual(
    [...unfocused],
    [127, 0, 0, 255, 85, 0, 0, 255, 127, 0, 0, 255],
    'Unfocus must average the clipped circular neighborhood with native truncation',
  );

  // SharpenEffect is Lerp(src, localMedian, -0.5) over premultiplied values, with Amount
  // as the disc radius, not a convolution strength.
  const sharpened = processEffect(new Uint8ClampedArray([
    10, 20, 30, 255, 200, 210, 220, 255, 10, 20, 30, 255,
    40, 50, 60, 128, 250, 240, 230, 255, 40, 50, 60, 255,
    10, 20, 30, 255, 90, 80, 70, 200, 10, 20, 30, 255,
  ]), 3, 3, 'sharpen', { amount: 1 });
  assert.deepEqual(
    [...sharpened],
    [
      0, 4, 14, 255, 255, 255, 255, 255, 0, 4, 14, 255,
      35, 47, 55, 64, 255, 255, 255, 255, 39, 49, 59, 255,
      0, 10, 21, 255, 124, 99, 74, 172, 0, 4, 14, 255,
    ],
    'Sharpen must unsharp-mask against the local median over a disc of the given radius',
  );

  // GlowEffect adjusts brightness on the blurred buffer and only then screen-blends the
  // source, so the adjustment must not reach the finished composite.
  const glowSource = new Uint8ClampedArray(3 * 3 * 4);
  for (let index = 0; index < glowSource.length; index += 4) glowSource.set([60, 90, 120, 255], index);
  assert.deepEqual(
    [...processEffect(new Uint8ClampedArray(glowSource), 3, 3, 'glow', { radius: 2, brightness: 0, contrast: 0 })].slice(16, 20),
    [106, 148, 184, 255],
    'Glow must screen the source over the blurred layer',
  );
  assert.deepEqual(
    [...processEffect(new Uint8ClampedArray(glowSource), 3, 3, 'glow', { radius: 2, brightness: 40, contrast: 0 })].slice(16, 20),
    [136, 174, 205, 255],
    'Glow brightness must be applied to the blurred layer before the screen blend',
  );

  // BrightnessContrastPixelOp indexes its shift by the pixel's luminance: contrast 0
  // reduces to a plain brightness offset, and contrast 100 collapses to a threshold at
  // 128. A per-channel S-curve reproduces neither.
  const brightnessRamp = new Uint8ClampedArray([
    0, 0, 0, 255, 64, 64, 64, 255, 128, 128, 128, 255, 200, 200, 200, 255, 255, 255, 255, 255,
  ]);
  const adjust = (brightness, contrast) => [...processEffect(
    new Uint8ClampedArray(brightnessRamp), 5, 1, 'brightness-contrast', { brightness, contrast },
  )];
  assert.deepEqual(
    adjust(25, 0),
    [25, 25, 25, 255, 89, 89, 89, 255, 153, 153, 153, 255, 225, 225, 225, 255, 255, 255, 255, 255],
    'Brightness with no contrast must shift every channel by exactly that amount',
  );
  assert.deepEqual(
    adjust(0, 100),
    [0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255],
    'Full contrast must threshold at an intensity of 128',
  );
  assert.deepEqual(
    adjust(0, 50),
    [0, 0, 0, 255, 1, 1, 1, 255, 129, 129, 129, 255, 255, 255, 255, 255, 255, 255, 255, 255],
    'Partial contrast must follow the native multiply/divide table',
  );
  assert.deepEqual(
    adjust(-30, -40),
    [21, 21, 21, 255, 60, 60, 60, 255, 97, 97, 97, 255, 140, 140, 140, 255, 173, 173, 173, 255],
    'Negative brightness and contrast must follow the native table',
  );

  // PosterizePixel's running-counter buckets land on 0/85/170/255 for four levels.
  const posterizeRamp = new Uint8ClampedArray([
    0, 0, 0, 255, 64, 64, 64, 255, 128, 128, 128, 255, 200, 200, 200, 255, 255, 255, 255, 255,
  ]);
  assert.deepEqual(
    [...processEffect(posterizeRamp, 5, 1, 'posterize', { red: 4, green: 4, blue: 4 })],
    [0, 0, 0, 255, 85, 85, 85, 255, 170, 170, 170, 255, 255, 255, 255, 255, 255, 255, 255, 255],
    'Posterize must follow the native level table rather than a nearest-value quantiser',
  );

  const tintSource = new Uint8ClampedArray([200, 100, 50, 255, 20, 180, 90, 255]);
  // Sepia desaturates and then applies per-channel gamma [B 1.2, G 1.0, R 0.8].
  assert.deepEqual(
    [...processEffect(new Uint8ClampedArray(tintSource), 2, 1, 'sepia', { strength: 100 })],
    [143, 124, 107, 255, 140, 121, 104, 255],
    'Sepia must tone the desaturated pixel through the native gamma curves',
  );
  // HueSaturationLightness desaturates in intensity space and rotates hue in HSV.
  assert.deepEqual(
    [...processEffect(new Uint8ClampedArray(tintSource), 2, 1, 'hue-saturation', { hue: 40, saturation: 150, lightness: 0 })],
    [238, 238, 13, 255, 0, 205, 209, 255],
    'Hue / Saturation must rotate hue in HSV after an intensity-space saturation',
  );
  assert.deepEqual(
    [...processEffect(new Uint8ClampedArray(tintSource), 2, 1, 'hue-saturation', { hue: 0, saturation: 0, lightness: 0 })],
    [124, 123, 123, 255, 121, 120, 120, 255],
    'Zero saturation must collapse toward intensity through the native HSV round trip',
  );

  // Black and White is GetIntensityByte, which truncates its fixed-point luminance.
  assert.deepEqual(
    [...processEffect(new Uint8ClampedArray([200, 100, 50, 255]), 1, 1, 'black-white', {})],
    [124, 124, 124, 255],
    'Black and White must use the native fixed-point luminance',
  );

  const uniformMotionSource = new Uint8ClampedArray(5 * 3 * 4);
  for (let index = 0; index < uniformMotionSource.length; index += 4) {
    uniformMotionSource[index] = 31;
    uniformMotionSource[index + 1] = 63;
    uniformMotionSource[index + 2] = 95;
    uniformMotionSource[index + 3] = 255;
  }
  const uniformMotion = processEffect(uniformMotionSource, 5, 3, 'motion-blur', { angle: 25, distance: 3, centered: 1 });
  assert.deepEqual([...uniformMotion], [...uniformMotionSource], 'Motion Blur must preserve uniform opaque fields');

  const histogramSource = new Uint8ClampedArray([
    10, 20, 30, 255,
    100, 110, 120, 255,
    200, 210, 220, 255,
  ]);
  const localMinimum = processEffect(histogramSource, 3, 1, 'median', { radius: 1, percentile: 0 });
  assert.deepEqual([...localMinimum], [
    10, 20, 30, 255,
    10, 20, 30, 255,
    100, 110, 120, 255,
  ], 'Median must use the native circular, clipped neighborhood');
  const zeroStrengthNoiseReduction = processEffect(histogramSource, 3, 1, 'reduce-noise', { radius: 1, strength: 0 });
  assert.deepEqual([...zeroStrengthNoiseReduction], [...histogramSource], 'zero-strength Reduce Noise must preserve pixels');
  const reducedNoise = processEffect(histogramSource, 3, 1, 'reduce-noise', { radius: 1, strength: 0.4 });
  assert.equal(reducedNoise[4], 101, 'Reduce Noise must apply the native histogram-rank interpolation');

  const redEye = processEffect(new Uint8ClampedArray([
    240, 20, 10, 255,
    120, 110, 100, 200,
  ]), 2, 1, 'red-eye-removal', { tolerance: 70, saturation: 90 });
  assert.deepEqual([...redEye], [
    76, 20, 10, 255,
    120, 110, 100, 200,
  ], 'Red Eye Removal must replace only sufficiently saturated red pixels');

  const softenedPortrait = processEffect(new Uint8ClampedArray([80, 120, 160, 255]), 1, 1, 'soften-portrait', {
    softness: 0,
    lighting: 0,
    warmth: 0,
  });
  assert.deepEqual([...softenedPortrait], [70, 105, 141, 255], 'Soften Portrait must compose native desaturation and overlay blending');

  for (const [effect, parameters] of [
    ['bulge', { amount: 0 }],
    ['dents', { refraction: 0 }],
    ['polar-inversion', { amount: 0 }],
    ['tile-reflection', { intensity: 0 }],
    ['twist', { amount: 0 }],
  ]) {
    const identity = processEffect(blurIdentitySource, 3, 1, effect, parameters);
    assert.deepEqual([...identity], [...blurIdentitySource], `${effect} must preserve pixels at its identity setting`);
  }

  const pixelateSource = new Uint8ClampedArray(3 * 3 * 4);
  for (let index = 0; index < pixelateSource.length; index += 4) pixelateSource[index + 3] = 255;
  pixelateSource[(1 * 3 + 1) * 4] = 255;
  const pixelated = processEffect(pixelateSource, 3, 3, 'pixelate', { cellSize: 3 });
  assert.deepEqual([...pixelated], [...new Uint8ClampedArray([
    0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255,
    0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255,
    0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255,
  ])], 'Pixelate must use Pinta’s four-corner cell blend');

  const uniformDistortSource = new Uint8ClampedArray(3 * 3 * 4);
  for (let index = 0; index < uniformDistortSource.length; index += 4) {
    uniformDistortSource[index] = 22;
    uniformDistortSource[index + 1] = 44;
    uniformDistortSource[index + 2] = 66;
    uniformDistortSource[index + 3] = 255;
  }
  const frosted = processEffect(uniformDistortSource, 3, 3, 'frosted-glass', { amount: 2, seed: 17 });
  assert.deepEqual([...frosted], [...uniformDistortSource], 'Frosted Glass must preserve a uniform field');
  const primaryEdge = processEffect(uniformDistortSource, 3, 3, 'polar-inversion', {
    amount: -4,
    quality: 1,
    edgeBehavior: 3,
    __primaryR: 12,
    __primaryG: 34,
    __primaryB: 56,
  });
  assert.deepEqual([...primaryEdge.slice(0, 4)], [12, 34, 56, 255], 'warps must honor Pinta’s Primary edge behavior');

  const stylizeSource = new Uint8ClampedArray(3 * 3 * 4);
  for (let index = 0; index < stylizeSource.length; index += 4) {
    stylizeSource[index] = 80;
    stylizeSource[index + 1] = 120;
    stylizeSource[index + 2] = 160;
    stylizeSource[index + 3] = 255;
  }
  const centerIndex = (1 * 3 + 1) * 4;
  const detectedEdge = processEffect(stylizeSource, 3, 3, 'edge-detect', { angle: 45 });
  assert.deepEqual([...detectedEdge.slice(centerIndex, centerIndex + 4)], [0, 0, 0, 255], 'Edge Detect must use the native directional color kernel');
  const embossed = processEffect(stylizeSource, 3, 3, 'emboss', { angle: 0 });
  assert.deepEqual([...embossed.slice(centerIndex, centerIndex + 4)], [128, 128, 128, 255], 'Emboss must offset native intensity differences around middle gray');
  const outlined = processEffect(stylizeSource, 3, 3, 'outline-edge', { thickness: 1, intensity: 50 });
  assert.deepEqual([...outlined.slice(centerIndex, centerIndex + 4)], [255, 255, 255, 255], 'Outline Edge must preserve a uniform neighborhood as white');
  const relief = processEffect(stylizeSource, 3, 3, 'relief', { angle: 45 });
  assert.deepEqual([...relief.slice(centerIndex, centerIndex + 4)], [79, 120, 159, 255], 'Relief must retain the native floating-point kernel result on a uniform field');

  const inkSource = new Uint8ClampedArray(5 * 5 * 4);
  for (let index = 0; index < inkSource.length; index += 4) {
    inkSource[index] = 22;
    inkSource[index + 1] = 44;
    inkSource[index + 2] = 66;
    inkSource[index + 3] = 255;
  }
  const inkSketch = processEffect(inkSource, 5, 5, 'ink-sketch', { inkOutline: 50, coloring: 50 });
  const inkCenter = (2 * 5 + 2) * 4;
  assert.deepEqual([...inkSketch.slice(inkCenter, inkCenter + 4)], [0, 0, 0, 255], 'Ink Sketch must apply its native 5×5 outline kernel');
  const oilPainting = processEffect(uniformDistortSource, 3, 3, 'oil-painting', { brushSize: 2, coarseness: 50 });
  assert.deepEqual([...oilPainting], [...uniformDistortSource], 'Oil Painting must preserve a uniform intensity band');
  const pencilSketch = processEffect(uniformDistortSource, 3, 3, 'pencil-sketch', { pencilTipSize: 2, colorRange: 0 });
  assert.deepEqual([...pencilSketch.slice(centerIndex, centerIndex + 4)], [255, 255, 255, 255], 'Pencil Sketch must use inverted-blur color dodge');

  const dithered = processEffect(new Uint8ClampedArray([
    128, 128, 128, 255,
    128, 128, 128, 255,
  ]), 2, 1, 'dithering', { diffusionMethod: 7, paletteSource: 0, paletteChoice: 0 });
  assert.deepEqual([...dithered], [255, 255, 255, 255, 0, 0, 0, 255], 'Dithering must diffuse Floyd-Steinberg error through the chosen preset palette');
  const currentPaletteDither = processEffect(new Uint8ClampedArray([200, 100, 50, 180]), 1, 1, 'dithering', {
    paletteSource: 1,
    __paletteCount: 1,
    __palette0R: 10,
    __palette0G: 20,
    __palette0B: 30,
  });
  assert.deepEqual([...currentPaletteDither], [10, 20, 30, 255], 'Dithering must consume the editor’s current palette');

  const selectedColorGradient = {
    colorSchemeSource: 1,
    __primaryR: 12,
    __primaryG: 34,
    __primaryB: 56,
    __secondaryR: 12,
    __secondaryG: 34,
    __secondaryB: 56,
  };
  for (const [effect, parameters] of [
    ['clouds', { ...selectedColorGradient, scale: 50, power: 50, seed: 3 }],
    ['julia-fractal', { ...selectedColorGradient, factor: 1, quality: 1, zoom: 1 }],
    ['mandelbrot-fractal', { ...selectedColorGradient, factor: 10, quality: 1, zoom: 0 }],
    ['cells', { ...selectedColorGradient, numberOfCells: 1, quality: 1, cellRadius: 100, colorSchemeEdgeBehavior: 0 }],
  ]) {
    const rendered = processEffect(new Uint8ClampedArray(2 * 2 * 4), 2, 2, effect, parameters);
    assert.deepEqual([...rendered], [
      12, 34, 56, 255, 12, 34, 56, 255,
      12, 34, 56, 255, 12, 34, 56, 255,
    ], `${effect} must render through the selected-color gradient`);
  }
  const invertedMandelbrot = processEffect(new Uint8ClampedArray(4), 1, 1, 'mandelbrot-fractal', {
    ...selectedColorGradient,
    factor: 10,
    quality: 1,
    zoom: 0,
    invertColors: 1,
  });
  assert.deepEqual([...invertedMandelbrot], [243, 221, 199, 255], 'Mandelbrot must apply its native invert-colors option');
  const voronoiParameters = { numberOfCells: 3, quality: 1, pointSeed: 5, colorSeed: 7 };
  const voronoiFirst = processEffect(new Uint8ClampedArray(4 * 4 * 4), 4, 4, 'voronoi-diagram', voronoiParameters);
  const voronoiSecond = processEffect(new Uint8ClampedArray(4 * 4 * 4), 4, 4, 'voronoi-diagram', voronoiParameters);
  assert.deepEqual([...voronoiFirst], [...voronoiSecond], 'Voronoi generation must be deterministic for fixed seeds');
  assert.ok(new Set(Array.from({ length: 16 }, (_, index) => voronoiFirst.slice(index * 4, index * 4 + 3).join(','))).size > 1, 'Voronoi must assign distinct cell colors');

  const alignSource = new Uint8ClampedArray(3 * 3 * 4);
  const alignCenter = (1 * 3 + 1) * 4;
  alignSource.set([255, 0, 0, 255], alignCenter);
  const aligned = processEffect(alignSource, 3, 3, 'align-object', { position: 0 });
  assert.deepEqual([...aligned.slice(0, 4)], [255, 0, 0, 255], 'Align Object must move the detected object to the selected anchor');
  assert.deepEqual([...aligned.slice(alignCenter, alignCenter + 4)], [0, 0, 0, 0], 'Align Object must restore the selection background');

  const objectSource = new Uint8ClampedArray(5 * 5 * 4);
  for (let y = 1; y <= 3; y += 1) {
    for (let x = 1; x <= 3; x += 1) objectSource.set([80, 120, 160, 255], (y * 5 + x) * 4);
  }
  const featheredObject = processEffect(objectSource, 5, 5, 'feather-object', { radius: 2, tolerance: 20, featherCanvasEdge: 0 });
  assert.equal(featheredObject[(2 * 5 + 1) * 4 + 3], 127, 'Feather Object must fade alpha by distance from the transparent border');
  assert.equal(featheredObject[(2 * 5 + 2) * 4 + 3], 255, 'Feather Object must preserve pixels outside the feather radius');
  const outlinedObject = processEffect(objectSource, 5, 5, 'outline-object', {
    radius: 2,
    tolerance: 20,
    alphaGradient: 1,
    colorGradient: 1,
    __primaryR: 255,
    __primaryG: 0,
    __primaryB: 0,
    __secondaryR: 0,
    __secondaryG: 0,
    __secondaryB: 255,
  });
  assert.deepEqual([...outlinedObject.slice((2 * 5) * 4, (2 * 5) * 4 + 4)], [255, 0, 0, 255], 'Outline Object must paint direct border pixels with the primary color');

  const channelSource = new Uint8ClampedArray([
    10, 20, 30, 255,
    40, 50, 60, 255,
    70, 80, 90, 255,
  ]);
  const aberrated = processEffect(channelSource, 3, 1, 'chromatic-aberration', {
    redX: 1, redY: 0, greenX: 0, greenY: 0, blueX: -1, blueY: 0, tile: 1,
  });
  assert.deepEqual([...aberrated.slice(0, 4)], [70, 20, 60, 255], 'Chromatic Aberration must shift channels independently and wrap them');

  const scanlineSource = new Uint8ClampedArray(3 * 2 * 4).fill(255);
  const scanned = processEffect(scanlineSource, 3, 2, 'scanlines', { strength: 50, scanlines: 1, red: 0, green: 0, blue: 0 });
  assert.deepEqual([...scanned.slice(3 * 4, 3 * 4 + 4)], [128, 128, 128, 255], 'Scanlines must darken alternating rows while retaining alpha');

  const seededEffectSource = new Uint8ClampedArray(12 * 8 * 4).fill(127);
  for (let index = 3; index < seededEffectSource.length; index += 4) seededEffectSource[index] = 255;
  for (const [effect, parameters] of [
    ['colored-artifacts', { count: 12, minAlpha: 64, maxAlpha: 180, minWidth: 5, maxWidth: 25, minHeight: 5, maxHeight: 25, seed: 91 }],
    ['pixel-drag', { count: 24, direction: 0, minLength: 5, maxLength: 30, seed: 91 }],
    ['row-slice', { slices: 4, leftShift: 40, rightShift: 40, seed: 91 }],
    ['adjustment-noise', { intensity: 16, seed: 91 }],
  ]) {
    const first = processEffect(seededEffectSource, 12, 8, effect, parameters);
    const second = processEffect(seededEffectSource, 12, 8, effect, parameters);
    assert.deepEqual([...first], [...second], `${effect} must be deterministic for a fixed seed`);
    assert.ok(first.every((channel, index) => index % 4 !== 3 || channel === 255), `${effect} must retain opaque alpha`);
  }

  const coloredGray = processEffect(new Uint8ClampedArray([100, 150, 200, 190]), 1, 1, 'colored-grayscale', {
    __primaryR: 255, __primaryG: 128, __primaryB: 0,
  });
  assert.deepEqual([...coloredGray], [141, 71, 0, 190], 'Colored Grayscale must multiply luminance by the primary color and preserve alpha');

  const uniformHexSource = new Uint8ClampedArray(9 * 9 * 4);
  for (let index = 0; index < uniformHexSource.length; index += 4) uniformHexSource.set([12, 34, 56, 210], index);
  const hexagons = processEffect(uniformHexSource, 9, 9, 'hexagon-pixelate', {
    radius: 5, sampleMode: 0, offsetX: 0, offsetY: 0, borderWidth: 0, borderColor: 0,
  });
  assert.deepEqual([...hexagons], [...uniformHexSource], 'Hexagon Pixelate must preserve uniform fields and alpha with average sampling');

  const nightVision = processEffect(new Uint8ClampedArray([200, 100, 20, 170]), 1, 1, 'night-vision', { brightness: 0.6, noise: 0 });
  assert.deepEqual([...nightVision], [0, 102, 0, 170], 'Night Vision must reproduce the add-in green response and preserve alpha');

  // GaussianBlurEffect.cs uses Paint.NET's tent weight row with alpha-weighted sums and
  // excludes samples outside the surface, so edges and transparent pixels must not be
  // treated as clamped opaque neighbours. These bytes come from a literal transcription
  // of that Render loop and pin the kernel against drift.
  const blurSource = new Uint8ClampedArray([
    255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255,
    10, 20, 30, 0, 40, 50, 60, 128, 70, 80, 90, 255,
    200, 200, 200, 255, 5, 5, 5, 32, 250, 10, 10, 200,
  ]);
  assert.deepEqual(
    [...processEffect(new Uint8ClampedArray(blurSource), 3, 3, 'gaussian-blur', { radius: 1 })],
    [
      159, 82, 4, 177, 61, 114, 65, 201, 18, 81, 144, 233,
      155, 115, 75, 117, 85, 97, 75, 137, 71, 66, 97, 184,
      172, 173, 174, 121, 148, 90, 93, 101, 159, 36, 41, 134,
    ],
    'Gaussian Blur must match the native tent kernel with alpha weighting and excluded edges',
  );
  assert.deepEqual(
    [...processEffect(new Uint8ClampedArray(blurSource), 3, 3, 'gaussian-blur', { radius: 0 })],
    [...blurSource],
    'A zero Gaussian Blur radius must leave the surface untouched',
  );

  console.log('Effect verification passed: built-in catalogs plus all optional web add-in effects.');
} finally {
  await server.close();
}
