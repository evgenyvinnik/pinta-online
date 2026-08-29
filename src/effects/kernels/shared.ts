/**
 * State and primitives shared by every effect kernel.
 *
 * The progress reporter is module-level mutable state, which is why it lives here rather than
 * being threaded through every kernel: ES modules are single instances, so each kernel module
 * importing `reportLoop` reports into the same range the dispatcher set up with
 * `withProgressRange`. Splitting the kernels into separate files does not change that.
 */
import type { EffectParameters } from '../types';

export const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
export const clampTruncatedByte = (value: number) => Math.max(0, Math.min(255, Math.trunc(value)));
export const value = (parameters: EffectParameters, key: string, fallback: number) => parameters[key] ?? fallback;

export type EffectProgressReporter = (progress: number) => void;

let activeProgressReporter: EffectProgressReporter | undefined;
let progressRangeStart = 0;
let progressRangeEnd = 1;
let lastReportedProgress = -1;

export function reportProgress(progress: number, force = false) {
  if (!activeProgressReporter) return;
  const normalized = Math.max(0, Math.min(1, progress));
  const absolute = progressRangeStart + (progressRangeEnd - progressRangeStart) * normalized;
  if (!force && absolute < 1 && absolute - lastReportedProgress < 0.01) return;
  if (absolute < lastReportedProgress) return;
  lastReportedProgress = absolute;
  activeProgressReporter(absolute);
}

export function reportLoop(completed: number, total: number, start = 0, end = 1) {
  reportProgress(start + (end - start) * completed / Math.max(1, total));
}

export function reportPixels(index: number, byteLength: number, start = 0, end = 1) {
  const pixel = index / 4 + 1;
  const pixels = Math.max(1, byteLength / 4);
  const interval = Math.max(1, Math.floor(pixels / 100));
  if (pixel === pixels || pixel % interval === 0) reportLoop(pixel, pixels, start, end);
}

export function withProgressRange<T>(start: number, end: number, operation: () => T): T {
  const previousStart = progressRangeStart;
  const previousEnd = progressRangeEnd;
  const span = previousEnd - previousStart;
  progressRangeStart = previousStart + span * start;
  progressRangeEnd = previousStart + span * end;
  try {
    return operation();
  } finally {
    progressRangeStart = previousStart;
    progressRangeEnd = previousEnd;
  }
}

/**
 * Installs the reporter for one run and resets the range. An imported binding cannot be assigned
 * to from another module, so the dispatcher goes through this rather than writing the variable.
 */
export function setProgressReporter(reporter: EffectProgressReporter | undefined) {
  activeProgressReporter = reporter;
  progressRangeStart = 0;
  progressRangeEnd = 1;
  lastReportedProgress = -1;
}

/* ------------------------------------------------------------------------------------------
 * Sampling and histogram primitives.
 *
 * These cross category boundaries: processLocalHistogram backs Median, Reduce Noise, Unfocus and
 * Outline Object; nativeWarpSample and processWarp back most of the distortions. Section 9.1 of
 * docs/refactoring.md says to take them out before the categories for exactly that reason.
 * ---------------------------------------------------------------------------------------- */

export function writeNativePremultipliedBlend(output: Uint8ClampedArray, index: number, totals: number[], count: number) {
  if (count === 0) {
    output.fill(0, index, index + 4);
    return;
  }
  const alpha = clampTruncatedByte(totals[3] / count);
  output[index] = straightFromPremultiplied(clampTruncatedByte(totals[0] / count), alpha);
  output[index + 1] = straightFromPremultiplied(clampTruncatedByte(totals[1] / count), alpha);
  output[index + 2] = straightFromPremultiplied(clampTruncatedByte(totals[2] / count), alpha);
  output[index + 3] = alpha;
}

/** CairoExtensions.GetBilinearSample over the premultiplied Cairo surface. */
export function nativeBilinearSample(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  sample: number[],
) {
  const u = Math.fround(x);
  const v = Math.fround(y);
  if (!Number.isFinite(u) || !Number.isFinite(v) || u < 0 || v < 0 || u >= width || v >= height) return false;

  const left = Math.floor(u);
  const top = Math.floor(v);
  const xFraction = Math.trunc(Math.fround(256 * Math.fround(u - left)));
  const yFraction = Math.trunc(Math.fround(256 * Math.fround(v - top)));
  const xInverse = 256 - xFraction;
  const yInverse = 256 - yFraction;
  const weights = [
    xInverse * yInverse,
    xFraction * yInverse,
    xInverse * yFraction,
    xFraction * yFraction,
  ];
  const right = left === width - 1 ? left : left + 1;
  const bottom = top === height - 1 ? top : top + 1;
  const indices = [
    (top * width + left) * 4,
    (top * width + right) * 4,
    (bottom * width + left) * 4,
    (bottom * width + right) * 4,
  ];
  sample.fill(0);
  for (let corner = 0; corner < 4; corner += 1) {
    const sourceIndex = indices[corner];
    const alpha = source[sourceIndex + 3];
    sample[0] += premultiplyChannel(source[sourceIndex], alpha) * weights[corner];
    sample[1] += premultiplyChannel(source[sourceIndex + 1], alpha) * weights[corner];
    sample[2] += premultiplyChannel(source[sourceIndex + 2], alpha) * weights[corner];
    sample[3] += alpha * weights[corner];
  }
  for (let channel = 0; channel < 4; channel += 1) sample[channel] = Math.floor((sample[channel] + 32768) / 65536);
  return true;
}

export function nativeBilinearSampleWrapped(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  sample: number[],
) {
  const u = Math.fround(x);
  const v = Math.fround(y);
  if (!Number.isFinite(u) || !Number.isFinite(v)) return false;

  const floorX = Math.floor(u);
  const floorY = Math.floor(v);
  const xFraction = Math.trunc(Math.fround(256 * Math.fround(u - floorX)));
  const yFraction = Math.trunc(Math.fround(256 * Math.fround(v - floorY)));
  const wrappedX = floorX < 0 ? width - 1 + ((floorX + 1) % width)
    : floorX > width - 1 ? floorX % width : floorX;
  const wrappedY = floorY < 0 ? height - 1 + ((floorY + 1) % height)
    : floorY > height - 1 ? floorY % height : floorY;
  const right = wrappedX === width - 1 ? 0 : wrappedX + 1;
  const bottom = wrappedY === height - 1 ? 0 : wrappedY + 1;
  const weights = [
    (256 - xFraction) * (256 - yFraction),
    xFraction * (256 - yFraction),
    (256 - xFraction) * yFraction,
    xFraction * yFraction,
  ];
  const indices = [
    (wrappedY * width + wrappedX) * 4,
    (wrappedY * width + right) * 4,
    (bottom * width + wrappedX) * 4,
    (bottom * width + right) * 4,
  ];
  sample.fill(0);
  for (let corner = 0; corner < 4; corner += 1) {
    const sourceIndex = indices[corner];
    const alpha = source[sourceIndex + 3];
    sample[0] += premultiplyChannel(source[sourceIndex], alpha) * weights[corner];
    sample[1] += premultiplyChannel(source[sourceIndex + 1], alpha) * weights[corner];
    sample[2] += premultiplyChannel(source[sourceIndex + 2], alpha) * weights[corner];
    sample[3] += alpha * weights[corner];
  }
  for (let channel = 0; channel < 4; channel += 1) sample[channel] = Math.floor((sample[channel] + 32768) / 65536);
  return true;
}

export function nativeReflectedCoordinate(coordinate: number, size: number) {
  let reflected = Math.fround(coordinate);
  let shouldReflect = false;
  while (reflected < 0) {
    reflected = Math.fround(reflected + size);
    shouldReflect = !shouldReflect;
  }
  while (reflected > size) {
    reflected = Math.fround(reflected - size);
    shouldReflect = !shouldReflect;
  }
  return shouldReflect ? Math.fround(size - reflected) : reflected;
}

export function nativeWarpSample(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  edgeBehavior: number,
  originalIndex: number,
  parameters: EffectParameters,
  sample: number[],
) {
  const u = Math.fround(x);
  const v = Math.fround(y);
  if (u >= 0 && u <= width - 1 && v >= 0 && v <= height - 1) {
    nativeBilinearSample(source, width, height, u, v, sample);
    return;
  }

  if (edgeBehavior === 0) {
    nativeBilinearSample(
      source,
      width,
      height,
      Math.max(0, Math.min(width - 1, u)),
      Math.max(0, Math.min(height - 1, v)),
      sample,
    );
    return;
  }
  if (edgeBehavior === 1) {
    nativeBilinearSampleWrapped(source, width, height, u, v, sample);
    return;
  }
  if (edgeBehavior === 2) {
    nativeBilinearSample(
      source,
      width,
      height,
      nativeReflectedCoordinate(u, width),
      nativeReflectedCoordinate(v, height),
      sample,
    );
    return;
  }

  sample.fill(0);
  if (edgeBehavior === 3 || edgeBehavior === 4) {
    const prefix = edgeBehavior === 3 ? '__primary' : '__secondary';
    sample[0] = value(parameters, `${prefix}R`, edgeBehavior === 3 ? 0 : 255);
    sample[1] = value(parameters, `${prefix}G`, edgeBehavior === 3 ? 0 : 255);
    sample[2] = value(parameters, `${prefix}B`, edgeBehavior === 3 ? 0 : 255);
    sample[3] = 255;
  } else if (edgeBehavior === 6) {
    const alpha = source[originalIndex + 3];
    sample[0] = premultiplyChannel(source[originalIndex], alpha);
    sample[1] = premultiplyChannel(source[originalIndex + 1], alpha);
    sample[2] = premultiplyChannel(source[originalIndex + 2], alpha);
    sample[3] = alpha;
  }
}

export function warpBounds(parameters: EffectParameters, width: number, height: number) {
  return {
    x: value(parameters, '__selectionX', 0),
    y: value(parameters, '__selectionY', 0),
    width: value(parameters, '__selectionWidth', width),
    height: value(parameters, '__selectionHeight', height),
  };
}

export function processWarp(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  parameters: EffectParameters,
  qualityValue: number,
  transform: (x: number, y: number, radius: number, output: { x: number; y: number }) => void,
) {
  const bounds = warpBounds(parameters, width, height);
  const centerX = bounds.x + bounds.width * (1 + value(parameters, 'offsetX', 0)) / 2;
  const centerY = bounds.y + bounds.height * (1 + value(parameters, 'offsetY', 0)) / 2;
  const radius = Math.min(bounds.width, bounds.height) / 2;
  const quality = Math.max(1, Math.min(5, Math.round(qualityValue)));
  const edgeBehavior = Math.round(value(parameters, 'edgeBehavior', 0));
  const sampleCount = quality * quality;
  const offsets = sampleCount === 1 ? [{ x: 0, y: 0 }] : Array.from({ length: sampleCount }, (_, index) => {
    const offsetY = (index + 1) / (sampleCount + 1);
    const baseX = offsetY * quality;
    return { x: baseX - Math.trunc(baseX) - 0.5, y: offsetY - 0.5 };
  });
  const output = new Uint8ClampedArray(source.length);
  const transformed = { x: 0, y: 0 };
  const sample = [0, 0, 0, 0];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const totals = [0, 0, 0, 0];
      const originalIndex = (y * width + x) * 4;
      for (const offset of offsets) {
        transform(x - centerX + offset.x, y - centerY - offset.y, radius, transformed);
        nativeWarpSample(
          source,
          width,
          height,
          transformed.x + centerX,
          transformed.y + centerY,
          edgeBehavior,
          originalIndex,
          parameters,
          sample,
        );
        for (let channel = 0; channel < 4; channel += 1) totals[channel] += sample[channel];
      }
      writeNativePremultipliedBlend(output, originalIndex, totals, sampleCount);
    }
    reportLoop(y + 1, height);
  }
  return output;
}

/** ColorBgra.ToPremultipliedAlpha: integer truncation, not rounding. */
export function premultiplyChannel(channel: number, alpha: number) {
  return Math.trunc(channel * alpha / 255);
}

/** ColorBgra.ToStraightAlpha, which yields zero for a fully transparent pixel. */
export function straightFromPremultiplied(channel: number, alpha: number) {
  return alpha > 0 ? clampTruncatedByte(Math.trunc(channel * 255 / alpha)) : 0;
}

export function premultiplySurface(surface: Uint8ClampedArray) {
  const result = new Uint8ClampedArray(surface.length);
  for (let index = 0; index < surface.length; index += 4) {
    const alpha = surface[index + 3];
    result[index] = premultiplyChannel(surface[index], alpha);
    result[index + 1] = premultiplyChannel(surface[index + 1], alpha);
    result[index + 2] = premultiplyChannel(surface[index + 2], alpha);
    result[index + 3] = alpha;
  }
  return result;
}

/** The weighted accumulation ApplyWithAlpha performs over each histogram. */
export function histogramWeightedSum(histogram: Uint32Array) {
  let total = 0;
  for (let bin = 1; bin < 256; bin += 1) total += bin * histogram[bin];
  return total;
}

export function histogramPercentile(histogram: Uint32Array, minimumCount: number) {
  let channel = 0;
  let count = 0;
  while (channel < 255 && histogram[channel] === 0) channel += 1;
  while (channel < 255 && count < minimumCount) {
    count += histogram[channel];
    channel += 1;
  }
  return channel;
}

export function histogramRank(histogram: Uint32Array, channel: number, area: number) {
  let count = 0;
  for (let index = 0; index < channel; index += 1) count += histogram[index];
  return Math.floor(count * 255 / area);
}

export function histogramRange(histogram: Uint32Array, minimumCount: number, maximumCount: number) {
  let count = 0;
  let low = 0;
  while (low < 255 && histogram[low] === 0) low += 1;
  while (low < 255 && count < minimumCount) {
    count += histogram[low];
    low += 1;
  }
  let high = low;
  while (high < 255 && count < maximumCount) {
    count += histogram[high];
    high += 1;
  }
  return { low, high };
}

export function processLocalHistogram(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  parameters: EffectParameters,
  mode: 'median' | 'reduce-noise' | 'outline-edge' | 'unfocus' | 'sharpen',
) {
  const radiusKey = mode === 'outline-edge' ? 'thickness' : mode === 'sharpen' ? 'amount' : 'radius';
  const radiusFallback = mode === 'median' ? 10 : mode === 'reduce-noise' ? 6 : mode === 'unfocus' ? 4 : mode === 'sharpen' ? 2 : 3;
  const radius = Math.max(1, Math.min(200, Math.round(value(parameters, radiusKey, radiusFallback))));
  const percentile = Math.max(0, Math.min(100, Math.round(value(parameters, 'percentile', 50))));
  const strength = Math.max(0, Math.min(1, value(parameters, 'strength', 0.4)));
  const outlineIntensity = Math.max(0, Math.min(100, value(parameters, 'intensity', 50)));
  const cutoff = Math.floor(((radius * 2 + 1) ** 2 + 2) / 4);
  const halfWidths = new Int16Array(radius + 1);
  for (let offset = 0; offset <= radius; offset += 1) {
    halfWidths[offset] = Math.floor(Math.sqrt(Math.max(0, cutoff - offset * offset)));
  }

  const redHistogram = new Uint32Array(256);
  const greenHistogram = new Uint32Array(256);
  const blueHistogram = new Uint32Array(256);
  const alphaHistogram = new Uint32Array(256);
  const output = new Uint8ClampedArray(source.length);

  // LocalHistogram.RenderRectWithAlpha, used only by Unfocus, indexes the histograms by
  // the premultiplied channel value and weights each bin by that pixel's alpha. Every
  // other caller counts straight-alpha values once each.
  const weighted = mode === 'unfocus';
  const premultiplied = weighted ? premultiplySurface(source) : source;
  let alphaSum = 0;

  const addPixel = (index: number) => {
    const weight = weighted ? source[index + 3] : 1;
    redHistogram[premultiplied[index]] += weight;
    greenHistogram[premultiplied[index + 1]] += weight;
    blueHistogram[premultiplied[index + 2]] += weight;
    alphaHistogram[source[index + 3]] += weight;
    alphaSum += weight;
  };
  const removePixel = (index: number) => {
    const weight = weighted ? source[index + 3] : 1;
    redHistogram[premultiplied[index]] -= weight;
    greenHistogram[premultiplied[index + 1]] -= weight;
    blueHistogram[premultiplied[index + 2]] -= weight;
    alphaHistogram[source[index + 3]] -= weight;
    alphaSum -= weight;
  };

  for (let y = 0; y < height; y += 1) {
    redHistogram.fill(0);
    greenHistogram.fill(0);
    blueHistogram.fill(0);
    alphaHistogram.fill(0);
    alphaSum = 0;
    const top = Math.max(0, y - radius);
    const bottom = Math.min(height - 1, y + radius);
    let area = 0;
    for (let sampleY = top; sampleY <= bottom; sampleY += 1) {
      const halfWidth = halfWidths[Math.abs(sampleY - y)];
      const right = Math.min(width - 1, halfWidth);
      for (let sampleX = 0; sampleX <= right; sampleX += 1) {
        addPixel((sampleY * width + sampleX) * 4);
        area += 1;
      }
    }

    for (let x = 0; x < width; x += 1) {
      const destination = (y * width + x) * 4;
      if (mode === 'median') {
        const minimumCount = Math.floor(area * percentile / 100);
        output[destination] = histogramPercentile(redHistogram, minimumCount);
        output[destination + 1] = histogramPercentile(greenHistogram, minimumCount);
        output[destination + 2] = histogramPercentile(blueHistogram, minimumCount);
        output[destination + 3] = histogramPercentile(alphaHistogram, minimumCount);
      } else if (mode === 'reduce-noise') {
        const red = source[destination];
        const green = source[destination + 1];
        const blue = source[destination + 2];
        const normalizedRed = histogramRank(redHistogram, red, area);
        const normalizedGreen = histogramRank(greenHistogram, green, area);
        const normalizedBlue = histogramRank(blueHistogram, blue, area);
        const intensity = (red * 0.299 + green * 0.587 + blue * 0.114) / 255;
        const amount = -0.2 * strength * (1 - 0.75 * intensity);
        output[destination] = clampByte(red + (normalizedRed - red) * amount);
        output[destination + 1] = clampByte(green + (normalizedGreen - green) * amount);
        output[destination + 2] = clampByte(blue + (normalizedBlue - blue) * amount);
        output[destination + 3] = source[destination + 3];
      } else if (mode === 'unfocus') {
        // UnfocusEffect.ApplyWithAlpha: a premultiplied mean over the disc, converted
        // back to the straight alpha the canvas buffer stores.
        const divisor = area * 255;
        const alpha = area === 0 ? 0 : Math.trunc(alphaSum / area);
        if (divisor === 0 || alpha === 0) {
          output[destination] = 0;
          output[destination + 1] = 0;
          output[destination + 2] = 0;
          output[destination + 3] = 0;
        } else {
          output[destination] = straightFromPremultiplied(clampTruncatedByte(Math.trunc(histogramWeightedSum(redHistogram) / divisor)), alpha);
          output[destination + 1] = straightFromPremultiplied(clampTruncatedByte(Math.trunc(histogramWeightedSum(greenHistogram) / divisor)), alpha);
          output[destination + 2] = straightFromPremultiplied(clampTruncatedByte(Math.trunc(histogramWeightedSum(blueHistogram) / divisor)), alpha);
          output[destination + 3] = alpha;
        }
      } else if (mode === 'sharpen') {
        // SharpenEffect: Lerp(src, localMedian, -0.5) over premultiplied values.
        const minimumCount = Math.floor(area * 50 / 100);
        const medianAlpha = histogramPercentile(alphaHistogram, minimumCount);
        const sourceAlpha = source[destination + 3];
        const sharpen = (histogram: Uint32Array, channel: number) => {
          const median = premultiplyChannel(histogramPercentile(histogram, minimumCount), medianAlpha);
          const start = premultiplyChannel(source[destination + channel], sourceAlpha);
          return clampTruncatedByte(start - 0.5 * (median - start));
        };
        const red = sharpen(redHistogram, 0);
        const green = sharpen(greenHistogram, 1);
        const blue = sharpen(blueHistogram, 2);
        const alpha = clampTruncatedByte(sourceAlpha - 0.5 * (medianAlpha - sourceAlpha));
        output[destination] = straightFromPremultiplied(red, alpha);
        output[destination + 1] = straightFromPremultiplied(green, alpha);
        output[destination + 2] = straightFromPremultiplied(blue, alpha);
        output[destination + 3] = alpha;
      } else {
        const minimumCount = Math.floor(area * (100 - outlineIntensity) / 200);
        const maximumCount = Math.floor(area * (100 + outlineIntensity) / 200);
        const redRange = histogramRange(redHistogram, minimumCount, maximumCount);
        const greenRange = histogramRange(greenHistogram, minimumCount, maximumCount);
        const blueRange = histogramRange(blueHistogram, minimumCount, maximumCount);
        const alphaRange = histogramRange(alphaHistogram, minimumCount, maximumCount);
        output[destination] = 255 - (redRange.high - redRange.low);
        output[destination + 1] = 255 - (greenRange.high - greenRange.low);
        output[destination + 2] = 255 - (blueRange.high - blueRange.low);
        output[destination + 3] = alphaRange.high;
      }

      if (x === width - 1) continue;
      for (let sampleY = top; sampleY <= bottom; sampleY += 1) {
        const halfWidth = halfWidths[Math.abs(sampleY - y)];
        const removing = x - halfWidth;
        const adding = x + halfWidth + 1;
        if (removing >= 0) {
          removePixel((sampleY * width + removing) * 4);
          area -= 1;
        }
        if (adding < width) {
          addPixel((sampleY * width + adding) * 4);
          area += 1;
        }
      }
    }
    reportLoop(y + 1, height);
  }
  return output;
}

/* ------------------------------------------------------------------------------------------
 * Noise and colour primitives used by more than one kernel group. The Perlin tables and the
 * .NET-compatible seeded random are here because Clouds, Cells, Voronoi and Frosted Glass all
 * need identical sequences to stay byte-compatible with native.
 * ---------------------------------------------------------------------------------------- */

export const PERLIN_PERMUTATION = new Uint8Array([
  151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,8,99,37,240,21,10,23,190,6,148,
  247,120,234,75,0,26,197,62,94,252,219,203,117,35,11,32,57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,
  74,165,71,134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,133,230,220,105,92,41,55,46,245,40,244,102,143,54,
  65,25,63,161,1,216,80,73,209,76,132,187,208,89,18,169,200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,
  52,217,226,250,124,123,5,202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,182,189,28,42,223,183,170,213,
  119,248,152,2,44,154,163,70,221,153,101,155,167,43,172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,
  218,246,97,228,251,34,242,193,238,210,144,12,191,179,162,241,81,51,145,235,249,14,239,107,49,192,214,31,181,199,106,157,
  184,84,204,176,115,121,50,45,127,4,150,254,138,236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180,
]);

export function perlinPermutation(index: number) {
  return PERLIN_PERMUTATION[index & 255];
}

export function perlinGradient(hash: number, x: number, y: number) {
  const direction = hash & 15;
  const first = direction < 8 ? x : y;
  const second = direction < 4 ? y : direction === 12 || direction === 14 ? x : 0;
  return (direction & 1 ? -first : first) + (direction & 2 ? -second : second);
}

export function perlinNoise(x: number, y: number, seed: number) {
  const floorX = Math.floor(x);
  const floorY = Math.floor(y);
  const gridX = floorX & 255;
  const gridY = floorY & 255;
  const offsetX = x - floorX;
  const offsetY = y - floorY;
  const fadeX = offsetX ** 3 * (offsetX * (offsetX * 6 - 15) + 10);
  const fadeY = offsetY ** 3 * (offsetY * (offsetY * 6 - 15) + 10);
  const a = perlinPermutation(gridX + seed) + gridY;
  const b = perlinPermutation(gridX + 1 + seed) + gridY;
  const top = perlinGradient(perlinPermutation(a), offsetX, offsetY)
    + (perlinGradient(perlinPermutation(b), offsetX - 1, offsetY) - perlinGradient(perlinPermutation(a), offsetX, offsetY)) * fadeX;
  const bottom = perlinGradient(perlinPermutation(a + 1), offsetX, offsetY - 1)
    + (perlinGradient(perlinPermutation(b + 1), offsetX - 1, offsetY - 1) - perlinGradient(perlinPermutation(a + 1), offsetX, offsetY - 1)) * fadeX;
  return top + (bottom - top) * fadeY;
}

export function dotNetRandom(seedValue: number) {
  const maximum = 0x7fffffff;
  const seed = Math.round(seedValue) | 0;
  const subtraction = seed === -0x80000000 ? maximum : Math.abs(seed);
  const seeds = new Int32Array(56);
  let current = 161803398 - subtraction;
  if (current < 0) current += maximum;
  seeds[55] = current;
  let next = 1;
  for (let index = 1; index < 55; index += 1) {
    const slot = (21 * index) % 55;
    seeds[slot] = next;
    next = current - next;
    if (next < 0) next += maximum;
    current = seeds[slot];
  }
  for (let pass = 1; pass < 5; pass += 1) {
    for (let index = 1; index < 56; index += 1) {
      seeds[index] -= seeds[1 + (index + 30) % 55];
      if (seeds[index] < 0) seeds[index] += maximum;
    }
  }
  let inext = 0;
  let inextp = 21;
  const internalSample = () => {
    inext += 1;
    if (inext >= 56) inext = 1;
    inextp += 1;
    if (inextp >= 56) inextp = 1;
    let result = seeds[inext] - seeds[inextp];
    if (result === maximum) result -= 1;
    if (result < 0) result += maximum;
    seeds[inext] = result;
    return result;
  };
  return {
    nextDouble: () => internalSample() / maximum,
    nextInt: (minimum: number, upperExclusive: number) => minimum
      + Math.floor(internalSample() / maximum * (upperExclusive - minimum)),
    nextBytes: (count: number) => Array.from({ length: count }, () => internalSample() % 256),
  };
}

/** ColorBgra.GetIntensityByte: Paint.NET's fixed-point luminance, truncated. */
export function intensityByte(red: number, green: number, blue: number) {
  return (19595 * red + 38470 * green + 7471 * blue) >> 16;
}

export function fastMultiplyByte(first: number, second: number) {
  const product = first * second + 0x80;
  return ((product >> 8) + product) >> 8;
}

export function createSeededRandom(seedValue: number) {
  let state = Math.max(1, Math.trunc(seedValue)) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function addPremultipliedPixel(source: Uint8ClampedArray, index: number, totals: number[]) {
  const alpha = source[index + 3];
  totals[0] += premultiplyChannel(source[index], alpha);
  totals[1] += premultiplyChannel(source[index + 1], alpha);
  totals[2] += premultiplyChannel(source[index + 2], alpha);
  totals[3] += alpha;
}

/** RGBA as a tuple, used by every routine that builds colours numerically. */
export type RenderColor = [number, number, number, number];
