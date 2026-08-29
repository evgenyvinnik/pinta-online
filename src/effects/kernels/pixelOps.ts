import type { EffectParameters } from '../types';
import { buildCurveLookup, curvePointsFromParameters } from '../curves';
import {
  clampByte, clampTruncatedByte, createSeededRandom, dotNetRandom, fastMultiplyByte,
  histogramPercentile, histogramRange, histogramRank, histogramWeightedSum, intensityByte,
  nativeBilinearSample, nativeBilinearSampleWrapped, nativeReflectedCoordinate, nativeWarpSample,
  PERLIN_PERMUTATION, perlinGradient, perlinNoise, perlinPermutation, premultiplyChannel,
  premultiplySurface, processLocalHistogram, processWarp, reportLoop, reportPixels, reportProgress,
  straightFromPremultiplied, value, warpBounds, withProgressRange, writeNativePremultipliedBlend,
} from './shared';
import { gaussianBlur } from './blur';

/**
 * BrightnessContrastPixelOp builds a transfer table indexed by the pixel's luminance, so
 * the shift applied to every channel depends on how bright the pixel already is, and a
 * contrast of 100 collapses to a hard threshold. A per-channel S-curve is a different
 * adjustment entirely.
 */
export function applyBrightnessContrast(data: Uint8ClampedArray, brightnessValue: number, contrastValue: number) {
  const brightness = Math.round(brightnessValue);
  const contrast = Math.round(contrastValue);
  const multiply = contrast < 0 ? contrast + 100 : contrast > 0 ? 100 : 1;
  const divide = contrast < 0 ? 100 : contrast > 0 ? 100 - contrast : 1;

  if (divide === 0) {
    for (let index = 0; index < data.length; index += 4) {
      const level = intensityByte(data[index], data[index + 1], data[index + 2]) + brightness < 128 ? 0 : 255;
      data[index] = level;
      data[index + 1] = level;
      data[index + 2] = level;
      reportPixels(index, data.length);
    }
    return;
  }

  const shifts = new Int32Array(256);
  for (let intensity = 0; intensity < 256; intensity += 1) {
    shifts[intensity] = divide === 100
      ? Math.trunc((intensity - 127) * multiply / divide) + 127 - intensity + brightness
      : Math.trunc((intensity - 127 + brightness) * multiply / divide) + 127 - intensity;
  }

  for (let index = 0; index < data.length; index += 4) {
    const shift = shifts[intensityByte(data[index], data[index + 1], data[index + 2])];
    data[index] = clampTruncatedByte(data[index] + shift);
    data[index + 1] = clampTruncatedByte(data[index + 1] + shift);
    data[index + 2] = clampTruncatedByte(data[index + 2] + shift);
    reportPixels(index, data.length);
  }
}

/**
 * UnaryPixelOps.PosterizePixel.CalcLevels: buckets advance on a running counter rather
 * than by nearest-value rounding, which puts the boundaries in different places than a
 * textbook quantiser.
 */
export function posterizeLevels(levelCountValue: number) {
  const levelCount = Math.max(2, Math.min(64, Math.round(levelCountValue)));
  const steps = new Uint8Array(levelCount);
  for (let step = 1; step < levelCount; step += 1) steps[step] = Math.trunc(255 * step / (levelCount - 1));

  const levels = new Uint8Array(256);
  let step = 0;
  let counter = 0;
  for (let input = 0; input < 256; input += 1) {
    levels[input] = steps[Math.min(step, levelCount - 1)];
    counter += levelCount;
    if (counter > 255) {
      counter -= 255;
      step += 1;
    }
  }
  return levels;
}

/** UnaryPixelOps.Level restricted to the full 0-255 input and output range. */
export function levelChannel(input: number, gamma: number) {
  if (input <= 0) return 0;
  if (input >= 255) return 255;
  return clampTruncatedByte(255 * (input / 255) ** gamma);
}

export function rgbToHsv(red: number, green: number, blue: number) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta !== 0) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }
  if (hue < 0) hue += 360;
  return [hue, max === 0 ? 0 : delta / max, max] as const;
}

/**
 * CairoExtensions.FromHsv, including its deliberate nudge of a zero saturation or value
 * to 0.0001 so a grey pixel still travels the sector path, and the truncating byte cast
 * in ToColorBgra.
 */
export function hsvToRgb(hue: number, saturationValue: number, brightnessValue: number) {
  const h = hue % 360;
  const saturation = saturationValue === 0 ? 0.0001 : saturationValue;
  const brightness = brightnessValue === 0 ? 0.0001 : brightnessValue;

  const sectorPosition = h / 60;
  const sector = Math.floor(sectorPosition);
  const fraction = sectorPosition - sector;
  const p = brightness * (1 - saturation);
  const q = brightness * (1 - saturation * fraction);
  const t = brightness * (1 - saturation * (1 - fraction));

  const [red, green, blue] = sector === 0 ? [brightness, t, p]
    : sector === 1 ? [q, brightness, p]
      : sector === 2 ? [p, brightness, t]
        : sector === 3 ? [p, q, brightness]
          : sector === 4 ? [t, p, brightness]
            : [brightness, p, q];
  return [
    clampTruncatedByte(red * 255),
    clampTruncatedByte(green * 255),
    clampTruncatedByte(blue * 255),
  ] as const;
}

/** UnaryPixelOps.BlendConstant, including its divide-by-256 integer blend. */
export function blendConstant(channel: number, blendChannel: number, blendAlpha: number) {
  return Math.trunc((channel * (255 - blendAlpha) + blendChannel * blendAlpha) / 256);
}

export function processHueSaturation(data: Uint8ClampedArray, parameters: EffectParameters) {
  // UnaryPixelOps.HueSaturationLightness works on three different models: saturation
  // pushes channels away from the pixel's intensity, hue rotates in HSV with the hue
  // truncated to whole degrees, and lightness blends toward white or black. An HSL
  // round trip reproduces none of them.
  const hueDelta = Math.round(value(parameters, 'hue', 0));
  const saturationFactor = Math.trunc(Math.round(value(parameters, 'saturation', 100)) * 1024 / 100);
  const lightness = Math.round(value(parameters, 'lightness', 0));
  const blendChannel = lightness > 0 ? 255 : 0;
  const blendAlpha = Math.trunc(Math.abs(lightness) * 255 / 100);

  for (let index = 0; index < data.length; index += 4) {
    const intensity = intensityByte(data[index], data[index + 1], data[index + 2]);
    const saturated = [0, 1, 2].map((channel) => (
      Math.max(0, Math.min(255, (intensity * 1024 + (data[index + channel] - intensity) * saturationFactor) >> 10))
    ));

    const [hue, saturation, brightness] = rgbToHsv(saturated[0], saturated[1], saturated[2]);
    let shiftedHue = Math.trunc(hue) + hueDelta;
    while (shiftedHue < 0) shiftedHue += 360;
    while (shiftedHue > 360) shiftedHue -= 360;
    let [red, green, blue] = hsvToRgb(shiftedHue, saturation, brightness);

    if (lightness !== 0) {
      red = blendConstant(red, blendChannel, blendAlpha);
      green = blendConstant(green, blendChannel, blendAlpha);
      blue = blendConstant(blue, blendChannel, blendAlpha);
    }

    data[index] = red;
    data[index + 1] = green;
    data[index + 2] = blue;
    reportPixels(index, data.length);
  }
}

export function processAutoLevel(data: Uint8ClampedArray) {
  const histograms = Array.from({ length: 3 }, () => Array<number>(256).fill(0));
  const totals = [0, 0, 0];
  for (let index = 0; index < data.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const color = data[index + channel];
      histograms[channel][color] += 1;
      totals[channel] += color;
    }
    reportPixels(index, data.length, 0, 0.5);
  }
  const pixelCount = data.length / 4;
  const controls = histograms.map((histogram, channel) => {
    const percentile = (fraction: number) => {
      let cumulative = 0;
      for (let value = 0; value < 256; value += 1) {
        cumulative += histogram[value];
        if (cumulative > pixelCount * fraction) return value;
      }
      return 0;
    };
    const low = percentile(0.005);
    const high = percentile(0.995);
    const mean = pixelCount ? totals[channel] / pixelCount : 0;
    const ratio = (mean - low) / Math.max(1, high - low);
    const gamma = low < mean && mean < high
      ? Math.max(0.1, Math.min(10, Math.log(0.5) / Math.log(ratio)))
      : 1;
    return { low, high, gamma, valid: high > low };
  });
  for (let index = 0; index < data.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const { low, high, gamma, valid } = controls[channel];
      if (!valid) continue;
      const input = data[index + channel];
      if (input <= low) data[index + channel] = 0;
      else if (input >= high) data[index + channel] = 255;
      else data[index + channel] = clampTruncatedByte(((input - low) / (high - low)) ** gamma * 255);
    }
    reportPixels(index, data.length, 0.5, 1);
  }
}

export function processLevels(data: Uint8ClampedArray, parameters: EffectParameters) {
  const channelNames = ['red', 'green', 'blue'];
  const controls = channelNames.map((channel) => {
    const prefix = `levels_${channel}_`;
    const inputLow = Math.max(0, Math.min(254, value(parameters, `${prefix}inputLow`, value(parameters, 'inputLow', 0))));
    const inputHigh = Math.max(inputLow + 1, Math.min(255, value(parameters, `${prefix}inputHigh`, value(parameters, 'inputHigh', 255))));
    const outputLow = Math.max(0, Math.min(254, value(parameters, `${prefix}outputLow`, value(parameters, 'outputLow', 0))));
    const outputHigh = Math.max(outputLow + 1, Math.min(255, value(parameters, `${prefix}outputHigh`, value(parameters, 'outputHigh', 255))));
    const gamma = Math.max(0.1, Math.min(10, value(parameters, `${prefix}gamma`, value(parameters, 'gamma', 1))));
    return { inputLow, inputHigh, outputLow, outputHigh, gamma };
  });
  for (let index = 0; index < data.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const { inputLow, inputHigh, outputLow, outputHigh, gamma } = controls[channel];
      const input = data[index + channel];
      if (input <= inputLow) data[index + channel] = outputLow;
      else if (input >= inputHigh) data[index + channel] = outputHigh;
      else data[index + channel] = clampTruncatedByte(
        outputLow + (outputHigh - outputLow) * ((input - inputLow) / (inputHigh - inputLow)) ** gamma,
      );
    }
    reportPixels(index, data.length);
  }
}

export function processCurves(data: Uint8ClampedArray, parameters: EffectParameters) {
  if (value(parameters, 'curveMode', 0) === 0) {
    const lookup = buildCurveLookup(curvePointsFromParameters(parameters, 'luminosity'));
    for (let index = 0; index < data.length; index += 4) {
      const luminosity = intensityByte(data[index], data[index + 1], data[index + 2]);
      const difference = lookup[luminosity] - luminosity;
      data[index] = clampByte(data[index] + difference);
      data[index + 1] = clampByte(data[index + 1] + difference);
      data[index + 2] = clampByte(data[index + 2] + difference);
      reportPixels(index, data.length);
    }
    return;
  }
  const red = buildCurveLookup(curvePointsFromParameters(parameters, 'red'));
  const green = buildCurveLookup(curvePointsFromParameters(parameters, 'green'));
  const blue = buildCurveLookup(curvePointsFromParameters(parameters, 'blue'));
  for (let index = 0; index < data.length; index += 4) {
    data[index] = red[data[index]];
    data[index + 1] = green[data[index + 1]];
    data[index + 2] = blue[data[index + 2]];
    reportPixels(index, data.length);
  }
}

export function processGlow(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
  // GlowEffect.Render blurs, adjusts brightness/contrast on the *blurred* buffer, and
  // only then screen-blends the original over it. Adjusting the finished composite
  // instead brightens the whole image rather than just the glow.
  const output = withProgressRange(0, 0.7, () => gaussianBlur(source, width, height, value(parameters, 'radius', 6)));
  withProgressRange(0.7, 0.8, () => applyBrightnessContrast(output, value(parameters, 'brightness', 10), value(parameters, 'contrast', 10)));
  for (let index = 0; index < output.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      output[index + channel] = clampByte(255 - ((255 - source[index + channel]) * (255 - output[index + channel])) / 255);
    }
    output[index + 3] = source[index + 3];
    reportPixels(index, output.length, 0.8, 1);
  }
  return output;
}

export const OLD_MS_PAINT_PALETTE = [
  [0, 0, 0],
  [128, 0, 0], [0, 128, 0], [128, 128, 0], [0, 0, 128], [128, 0, 128], [0, 128, 128], [128, 128, 128],
  [255, 0, 0], [0, 255, 0], [255, 255, 0], [0, 0, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255],
  [128, 64, 0], [0, 64, 64], [128, 128, 64], [255, 128, 64], [255, 0, 128], [0, 64, 128],
  [0, 255, 128], [255, 255, 128], [192, 192, 192], [128, 0, 255], [0, 128, 255],
  [128, 128, 255], [128, 255, 255],
];

export const WINDOWS_16_PALETTE = [
  [0, 0, 0], [128, 0, 0], [0, 128, 0], [128, 128, 0],
  [0, 0, 128], [128, 0, 128], [0, 64, 128], [192, 192, 192],
  [128, 128, 128], [255, 0, 0], [0, 255, 0], [255, 255, 0],
  [0, 0, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255],
];

export const DIFFUSION_MATRICES = [
  { weights: [[0, 0, 0, 5, 3], [2, 4, 5, 4, 2], [0, 2, 3, 2, 0]], left: 2 },
  { weights: [[0, 0, 0, 4, 3], [1, 2, 3, 2, 1]], left: 2 },
  { weights: [[0, 0, 2], [1, 1, 0]], left: 1 },
  { weights: [[0, 0, 0, 8, 4], [2, 4, 8, 4, 2]], left: 2 },
  { weights: [[0, 0, 1, 1], [1, 1, 1, 0], [0, 1, 0, 0]], left: 1, factor: 1 / 8 },
  { weights: [[0, 0, 0, 8, 4], [2, 4, 8, 4, 2], [1, 2, 4, 2, 1]], left: 2 },
  { weights: [[0, 0, 0, 7, 5], [3, 5, 7, 5, 3], [1, 3, 5, 3, 1]], left: 2 },
  { weights: [[0, 0, 7], [3, 5, 1]], left: 1 },
  { weights: [[0, 3], [3, 2]], left: 0 },
];

export function currentDitherPalette(parameters: EffectParameters) {
  const count = Math.max(0, Math.round(value(parameters, '__paletteCount', 0)));
  const palette: number[][] = [];
  for (let index = 0; index < count; index += 1) {
    palette.push([
      value(parameters, `__palette${index}R`, 0),
      value(parameters, `__palette${index}G`, 0),
      value(parameters, `__palette${index}B`, 0),
    ]);
  }
  return palette.length ? palette : WINDOWS_16_PALETTE;
}

export function recentDitherPalette(parameters: EffectParameters) {
  const count = Math.max(0, Math.round(value(parameters, '__recentPaletteCount', 0)));
  const palette: number[][] = [];
  for (let index = 0; index < count; index += 1) {
    palette.push([
      value(parameters, `__recentPalette${index}R`, 0),
      value(parameters, `__recentPalette${index}G`, 0),
      value(parameters, `__recentPalette${index}B`, 0),
    ]);
  }
  return palette.length ? palette : currentDitherPalette(parameters);
}

export function presetDitherPalette(choice: number) {
  if (choice === 0) return [[0, 0, 0], [255, 255, 255]];
  if (choice === 1) return OLD_MS_PAINT_PALETTE;
  if (choice === 3) return [
    ...WINDOWS_16_PALETTE,
    [255, 251, 240], [192, 220, 192], [166, 202, 240], [160, 160, 164],
  ];
  return WINDOWS_16_PALETTE;
}

export function nearestDitherColor(red: number, green: number, blue: number, paletteChoice: number, palette: number[][]) {
  const cubeFactor = paletteChoice === 4 ? 255 : paletteChoice === 5 ? 51 : paletteChoice === 6 ? 85 : paletteChoice === 7 ? 17 : 0;
  if (cubeFactor) {
    return [
      Math.max(0, Math.min(255, Math.round(red / cubeFactor) * cubeFactor)),
      Math.max(0, Math.min(255, Math.round(green / cubeFactor) * cubeFactor)),
      Math.max(0, Math.min(255, Math.round(blue / cubeFactor) * cubeFactor)),
    ];
  }
  let closest = palette[0];
  let minimumDistance = Number.POSITIVE_INFINITY;
  for (const color of palette) {
    const redDifference = red - color[0];
    const greenDifference = green - color[1];
    const blueDifference = blue - color[2];
    const distance = redDifference * redDifference + greenDifference * greenDifference + blueDifference * blueDifference;
    if (distance >= minimumDistance) continue;
    minimumDistance = distance;
    closest = color;
  }
  return closest;
}

export function processDithering(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
  const output = new Uint8ClampedArray(source);
  const bounds = warpBounds(parameters, width, height);
  const left = Math.max(0, Math.floor(bounds.x));
  const top = Math.max(0, Math.floor(bounds.y));
  const right = Math.min(width, Math.ceil(bounds.x + bounds.width));
  const bottom = Math.min(height, Math.ceil(bounds.y + bounds.height));
  const method = Math.max(0, Math.min(8, Math.round(value(parameters, 'diffusionMethod', 7))));
  const matrix = DIFFUSION_MATRICES[method];
  const weightTotal = matrix.weights.flat().reduce((total, weight) => total + weight, 0);
  const factor = matrix.factor ?? 1 / weightTotal;
  const paletteSource = Math.max(0, Math.min(2, Math.round(value(parameters, 'paletteSource', 0))));
  const paletteChoice = Math.max(0, Math.min(7, Math.round(value(parameters, 'paletteChoice', 2))));
  const palette = paletteSource === 0
    ? presetDitherPalette(paletteChoice)
    : paletteSource === 1 ? currentDitherPalette(parameters) : recentDitherPalette(parameters);
  const effectiveChoice = paletteSource === 0 ? paletteChoice : -1;
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const index = (y * width + x) * 4;
      const red = output[index];
      const green = output[index + 1];
      const blue = output[index + 2];
      const closest = nearestDitherColor(red, green, blue, effectiveChoice, palette);
      output[index] = closest[0];
      output[index + 1] = closest[1];
      output[index + 2] = closest[2];
      output[index + 3] = 255;
      const errorRed = red - closest[0];
      const errorGreen = green - closest[1];
      const errorBlue = blue - closest[2];
      for (let matrixY = 0; matrixY < matrix.weights.length; matrixY += 1) {
        for (let matrixX = 0; matrixX < matrix.weights[matrixY].length; matrixX += 1) {
          const weight = matrix.weights[matrixY][matrixX];
          if (weight <= 0) continue;
          const targetX = x + matrixX - matrix.left;
          const targetY = y + matrixY;
          if (targetX < left || targetX >= right || targetY < top || targetY >= bottom) continue;
          const target = (targetY * width + targetX) * 4;
          output[target] = Math.max(0, Math.min(255, output[target] + Math.trunc(weight * factor * errorRed)));
          output[target + 1] = Math.max(0, Math.min(255, output[target + 1] + Math.trunc(weight * factor * errorGreen)));
          output[target + 2] = Math.max(0, Math.min(255, output[target + 2] + Math.trunc(weight * factor * errorBlue)));
          output[target + 3] = 255;
        }
      }
    }
    reportLoop(y - top + 1, bottom - top);
  }
  return output;
}

export function processRedEyeRemoval(data: Uint8ClampedArray, parameters: EffectParameters) {
  const tolerance = Math.max(0, Math.min(100, value(parameters, 'tolerance', 70)));
  const replacementSaturation = Math.max(0, Math.min(100, value(parameters, 'saturation', 90))) / 100;
  for (let index = 0; index < data.length; index += 4) {
    reportPixels(index, data.length);
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const maximum = Math.max(red, green, blue);
    const minimum = Math.min(red, green, blue);
    const saturation = maximum === 0 || maximum === minimum ? 0 : (maximum - minimum) / maximum * 255;
    if (red - Math.max(green, blue) <= tolerance || saturation <= 100) continue;
    const intensity = red * 0.299 + green * 0.587 + blue * 0.114;
    data[index] = Math.floor(intensity * replacementSaturation);
  }
}

export function overlayChannel(foreground: number, background: number) {
  return foreground < 128
    ? fastMultiplyByte(2 * foreground, background)
    : 255 - fastMultiplyByte(2 * (255 - foreground), 255 - background);
}

export function processSoftenPortrait(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
  const softness = Math.max(0, Math.min(10, Math.round(value(parameters, 'softness', 5))));
  const lighting = Math.max(-20, Math.min(20, value(parameters, 'lighting', 0)));
  const warmth = Math.max(0, Math.min(20, value(parameters, 'warmth', 10))) / 100;
  const softened = softness === 0
    ? new Uint8ClampedArray(source)
    : withProgressRange(0, 0.7, () => gaussianBlur(source, width, height, softness * 3));
  withProgressRange(softness === 0 ? 0 : 0.7, 0.8, () => applyBrightnessContrast(softened, lighting, -lighting / 2));
  for (let index = 0; index < softened.length; index += 4) {
    const gray = (19595 * source[index] + 38470 * source[index + 1] + 7471 * source[index + 2]) >> 16;
    const effectiveRed = Math.min(255, Math.floor(gray * (1 + warmth)));
    const effectiveBlue = Math.max(0, Math.floor(gray * (1 - warmth)));
    softened[index] = overlayChannel(effectiveRed, softened[index]);
    softened[index + 1] = overlayChannel(gray, softened[index + 1]);
    softened[index + 2] = overlayChannel(effectiveBlue, softened[index + 2]);
    softened[index + 3] = Math.min(255, fastMultiplyByte(source[index + 3], 255 - softened[index + 3]) + softened[index + 3]);
    reportPixels(index, softened.length, 0.8, 1);
  }
  return softened;
}

export function processVignette(data: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
  const strength = value(parameters, 'strength', 1);
  const radiusPercentage = value(parameters, 'radiusPercentage', 50);
  const centerX = (width - 1) / 2 + value(parameters, 'offsetX', 0) * width / 2;
  const centerY = (height - 1) / 2 + value(parameters, 'offsetY', 0) * height / 2;
  const radius = Math.max(width, height) * 0.5 * radiusPercentage / 100;
  const radiusFactor = Math.PI / Math.max(1e-9, 8 * radius * radius);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const distance = ((x - centerX) ** 2 + (y - centerY) ** 2) * radiusFactor;
      const cosine = Math.cos(distance);
      const multiplier = cosine <= 0 || distance > Math.PI
        ? 1 - strength
        : 1 - strength + strength * cosine ** 4;
      const index = (y * width + x) * 4;
      data[index] = clampByte(data[index] * multiplier);
      data[index + 1] = clampByte(data[index + 1] * multiplier);
      data[index + 2] = clampByte(data[index + 2] * multiplier);
    }
    reportLoop(y + 1, height);
  }
}

export function directionalWeights(angleValue: number, centerWeight: number) {
  const angle = angleValue * Math.PI / 180;
  const delta = Math.PI / 4;
  return [
    Math.cos(angle + delta), Math.cos(angle + 2 * delta), Math.cos(angle + 3 * delta),
    Math.cos(angle), centerWeight, Math.cos(angle + 4 * delta),
    Math.cos(angle - delta), Math.cos(angle - 2 * delta), Math.cos(angle - 3 * delta),
  ];
}

export function processDirectionalDifference(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  angleValue: number,
  centerWeight: number,
  monochrome: boolean,
) {
  const weights = directionalWeights(angleValue, centerWeight);
  const output = new Uint8ClampedArray(source.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const destination = (y * width + x) * 4;
      if (monochrome) {
        let total = 0;
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          const sampleY = y + offsetY;
          if (sampleY < 0 || sampleY >= height) continue;
          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            const sampleX = x + offsetX;
            if (sampleX < 0 || sampleX >= width) continue;
            const sample = (sampleY * width + sampleX) * 4;
            const intensity = (19595 * source[sample] + 38470 * source[sample + 1] + 7471 * source[sample + 2]) >> 16;
            total += weights[(offsetY + 1) * 3 + offsetX + 1] * intensity;
          }
        }
        const shade = Math.max(0, Math.min(255, Math.trunc(total) + 128));
        output[destination] = shade;
        output[destination + 1] = shade;
        output[destination + 2] = shade;
      } else {
        for (let channel = 0; channel < 3; channel += 1) {
          let total = 0;
          for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
            const sampleY = y + offsetY;
            if (sampleY < 0 || sampleY >= height) continue;
            for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
              const sampleX = x + offsetX;
              if (sampleX < 0 || sampleX >= width) continue;
              const sample = (sampleY * width + sampleX) * 4;
              total += weights[(offsetY + 1) * 3 + offsetX + 1] * source[sample + channel];
            }
          }
          output[destination + channel] = Math.max(0, Math.min(255, Math.trunc(total)));
        }
      }
      output[destination + 3] = 255;
    }
    reportLoop(y + 1, height);
  }
  return output;
}

export function processChromaticAberration(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
  const output = new Uint8ClampedArray(source.length);
  const wrap = value(parameters, 'tile', 0) !== 0;
  const shifts = [
    [Math.round(value(parameters, 'redX', 0)), Math.round(value(parameters, 'redY', 0))],
    [Math.round(value(parameters, 'greenX', 0)), Math.round(value(parameters, 'greenY', 0))],
    [Math.round(value(parameters, 'blueX', 0)), Math.round(value(parameters, 'blueY', 0))],
  ];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const destination = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        let sampleX = x - shifts[channel][0];
        let sampleY = y - shifts[channel][1];
        if (wrap) {
          sampleX = ((sampleX % width) + width) % width;
          sampleY = ((sampleY % height) + height) % height;
        } else {
          sampleX = Math.max(0, Math.min(width - 1, sampleX));
          sampleY = Math.max(0, Math.min(height - 1, sampleY));
        }
        output[destination + channel] = source[(sampleY * width + sampleX) * 4 + channel];
      }
      output[destination + 3] = source[destination + 3];
    }
    reportLoop(y + 1, height);
  }
  return output;
}

export function processColoredGrayscale(data: Uint8ClampedArray, parameters: EffectParameters) {
  const tint = [value(parameters, '__primaryR', 0), value(parameters, '__primaryG', 0), value(parameters, '__primaryB', 0)];
  for (let index = 0; index < data.length; index += 4) {
    const gray = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
    for (let channel = 0; channel < 3; channel += 1) data[index + channel] = clampByte(gray * tint[channel] / 255);
    reportPixels(index, data.length);
  }
}

export function processNightVision(data: Uint8ClampedArray, parameters: EffectParameters) {
  const brightness = Math.max(0, Math.min(1, value(parameters, 'brightness', 0.6)));
  const addNoise = value(parameters, 'noise', 0) !== 0;
  const noiseIntensity = Math.max(1, Math.min(64, value(parameters, 'noiseIntensity', 20)));
  const random = createSeededRandom(value(parameters, 'seed', 1984));
  for (let index = 0; index < data.length; index += 4) {
    const noise = addNoise ? (random() * 2 - 1) * noiseIntensity : 0;
    const green = data[index + 2] * 0.1 + data[index + 1] * brightness + data[index] * 0.2 + noise;
    data[index] = 0;
    data[index + 1] = clampByte(green);
    data[index + 2] = 0;
    reportPixels(index, data.length);
  }
}
