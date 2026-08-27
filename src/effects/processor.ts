import type { EffectId, EffectParameters } from './types';
import { buildCurveLookup, curvePointsFromParameters } from './curves';

const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
const clampTruncatedByte = (value: number) => Math.max(0, Math.min(255, Math.trunc(value)));
const value = (parameters: EffectParameters, key: string, fallback: number) => parameters[key] ?? fallback;

type EffectProgressReporter = (progress: number) => void;

let activeProgressReporter: EffectProgressReporter | undefined;
let progressRangeStart = 0;
let progressRangeEnd = 1;
let lastReportedProgress = -1;

function reportProgress(progress: number, force = false) {
  if (!activeProgressReporter) return;
  const normalized = Math.max(0, Math.min(1, progress));
  const absolute = progressRangeStart + (progressRangeEnd - progressRangeStart) * normalized;
  if (!force && absolute < 1 && absolute - lastReportedProgress < 0.01) return;
  if (absolute < lastReportedProgress) return;
  lastReportedProgress = absolute;
  activeProgressReporter(absolute);
}

function reportLoop(completed: number, total: number, start = 0, end = 1) {
  reportProgress(start + (end - start) * completed / Math.max(1, total));
}

function reportPixels(index: number, byteLength: number, start = 0, end = 1) {
  const pixel = index / 4 + 1;
  const pixels = Math.max(1, byteLength / 4);
  const interval = Math.max(1, Math.floor(pixels / 100));
  if (pixel === pixels || pixel % interval === 0) reportLoop(pixel, pixels, start, end);
}

function withProgressRange<T>(start: number, end: number, operation: () => T): T {
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
 * Pinta's Gaussian blur is the Paint.NET port in
 * `original/Pinta.Effects/Effects/GaussianBlurEffect.cs`: a tent weight row rather than a
 * true Gaussian, alpha-weighted accumulation, and samples outside the surface excluded
 * from the weight sum instead of clamped to the edge. Canvas pixel buffers are already
 * straight-alpha, so the native premultiply round trip has no counterpart here.
 */
function createGaussianBlurRow(amount: number) {
  const size = 1 + amount * 2;
  const weights = new Int32Array(size);
  for (let i = 0; i <= amount; i += 1) {
    weights[i] = 16 * (i + 1);
    weights[size - i - 1] = weights[i];
  }
  return weights;
}

function gaussianBlur(source: Uint8ClampedArray, width: number, height: number, radiusValue: number) {
  const radius = Math.max(0, Math.round(radiusValue));
  if (radius === 0) return new Uint8ClampedArray(source);

  const weights = createGaussianBlurRow(radius);
  const length = weights.length;
  const output = new Uint8ClampedArray(source.length);

  // One accumulator per column of the sliding window, kept in a ring buffer so advancing
  // x costs a single new column instead of shifting six arrays.
  const waSums = new Float64Array(length);
  const wcSums = new Float64Array(length);
  const aSums = new Float64Array(length);
  const bSums = new Float64Array(length);
  const gSums = new Float64Array(length);
  const rSums = new Float64Array(length);

  const accumulateColumn = (slot: number, sourceX: number, y: number) => {
    waSums[slot] = 0;
    wcSums[slot] = 0;
    aSums[slot] = 0;
    bSums[slot] = 0;
    gSums[slot] = 0;
    rSums[slot] = 0;
    if (sourceX < 0 || sourceX >= width) return;
    for (let wy = 0; wy < length; wy += 1) {
      const sourceY = y + wy - radius;
      if (sourceY < 0 || sourceY >= height) continue;
      const index = (sourceY * width + sourceX) * 4;
      const alpha = source[index + 3];
      let weighted = weights[wy];
      waSums[slot] += weighted;
      weighted *= alpha + (alpha >> 7);
      wcSums[slot] += weighted;
      weighted = Math.floor(weighted / 256);
      if (alpha > 0) {
        aSums[slot] += weighted * alpha;
        rSums[slot] += weighted * source[index];
        gSums[slot] += weighted * source[index + 1];
        bSums[slot] += weighted * source[index + 2];
      }
    }
  };

  for (let y = 0; y < height; y += 1) {
    for (let wx = 0; wx < length; wx += 1) accumulateColumn(wx, wx - radius, y);

    for (let x = 0; x < width; x += 1) {
      // The ring buffer's oldest slot holds the column that just left the window.
      const base = x % length;
      let waSum = 0;
      let wcSum = 0;
      let aSum = 0;
      let bSum = 0;
      let gSum = 0;
      let rSum = 0;
      for (let wx = 0; wx < length; wx += 1) {
        const slot = (base + wx) % length;
        const weight = weights[wx];
        waSum += weight * waSums[slot];
        wcSum += weight * wcSums[slot];
        aSum += weight * aSums[slot];
        bSum += weight * bSums[slot];
        gSum += weight * gSums[slot];
        rSum += weight * rSums[slot];
      }

      wcSum = Math.floor(wcSum / 256);
      const destination = (y * width + x) * 4;
      if (waSum === 0 || wcSum === 0) {
        output[destination] = 0;
        output[destination + 1] = 0;
        output[destination + 2] = 0;
        output[destination + 3] = 0;
      } else {
        output[destination] = clampTruncatedByte(rSum / wcSum);
        output[destination + 1] = clampTruncatedByte(gSum / wcSum);
        output[destination + 2] = clampTruncatedByte(bSum / wcSum);
        output[destination + 3] = clampTruncatedByte(aSum / waSum);
      }

      if (x + 1 < width) accumulateColumn(base, x + 1 + length - 1 - radius, y);
    }
    reportLoop(y + 1, height);
  }

  return output;
}

function addBilinearSample(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  totals: number[],
) {
  if (x < 0 || y < 0 || x > width - 1 || y > height - 1) return false;
  const left = Math.floor(x);
  const top = Math.floor(y);
  const right = Math.min(width - 1, left + 1);
  const bottom = Math.min(height - 1, top + 1);
  const horizontal = x - left;
  const vertical = y - top;
  const topLeft = (top * width + left) * 4;
  const topRight = (top * width + right) * 4;
  const bottomLeft = (bottom * width + left) * 4;
  const bottomRight = (bottom * width + right) * 4;
  const topLeftWeight = (1 - horizontal) * (1 - vertical);
  const topRightWeight = horizontal * (1 - vertical);
  const bottomLeftWeight = (1 - horizontal) * vertical;
  const bottomRightWeight = horizontal * vertical;
  for (let channel = 0; channel < 4; channel += 1) {
    totals[channel] += source[topLeft + channel] * topLeftWeight
      + source[topRight + channel] * topRightWeight
      + source[bottomLeft + channel] * bottomLeftWeight
      + source[bottomRight + channel] * bottomRightWeight;
  }
  return true;
}

function processFragment(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
  const fragments = Math.max(2, Math.min(50, Math.round(value(parameters, 'fragments', 4))));
  const distance = Math.max(0, Math.min(100, value(parameters, 'distance', 8)));
  const rotation = value(parameters, 'rotation', 0) * Math.PI / 180 - Math.PI / 2;
  const offsets = Array.from({ length: fragments }, (_, index) => {
    const angle = rotation + Math.PI * 2 * index / fragments;
    return { x: Math.round(-Math.sin(angle) * distance), y: Math.round(-Math.cos(angle) * distance) };
  });
  const output = new Uint8ClampedArray(source.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const totals = [0, 0, 0, 0];
      let count = 0;
      for (const offset of offsets) {
        const sampleX = x - offset.x;
        const sampleY = y - offset.y;
        if (sampleX < 0 || sampleY < 0 || sampleX >= width || sampleY >= height) continue;
        const sample = (sampleY * width + sampleX) * 4;
        for (let channel = 0; channel < 4; channel += 1) totals[channel] += source[sample + channel];
        count += 1;
      }
      const destination = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) output[destination + channel] = count ? clampByte(totals[channel] / count) : 0;
    }
    reportLoop(y + 1, height);
  }
  return output;
}

function processMotionBlur(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
  const angle = (value(parameters, 'angle', 25) + 180) * Math.PI / 180;
  const distance = Math.max(1, Math.min(200, value(parameters, 'distance', 10)));
  const centered = value(parameters, 'centered', 1) !== 0;
  const vectorX = distance * Math.cos(angle);
  const vectorY = -distance * Math.sin(angle);
  const startX = centered ? -vectorX / 2 : 0;
  const startY = centered ? -vectorY / 2 : 0;
  const endX = centered ? vectorX / 2 : vectorX;
  const endY = centered ? vectorY / 2 : vectorY;
  // An odd sample count guarantees that every trail contains the source pixel.
  const sampleCount = Math.min(127, Math.max(3, Math.round((1 + distance) * 1.5) | 1));
  const output = new Uint8ClampedArray(source.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const totals = [0, 0, 0, 0];
      let count = 0;
      for (let sample = 0; sample < sampleCount; sample += 1) {
        const amount = sample / (sampleCount - 1);
        if (addBilinearSample(source, width, height, x + startX + (endX - startX) * amount, y + startY + (endY - startY) * amount, totals)) count += 1;
      }
      const destination = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) output[destination + channel] = count ? clampByte(totals[channel] / count) : 0;
    }
    reportLoop(y + 1, height);
  }
  return output;
}

function processRadialBlur(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
  const angle = value(parameters, 'angle', 2) * Math.PI / 180;
  if (Math.abs(angle) < 1e-6) return new Uint8ClampedArray(source);
  const quality = Math.max(1, Math.min(5, Math.round(value(parameters, 'quality', 2))));
  const centerX = width / 2 * (1 + value(parameters, 'offsetX', 0));
  const centerY = height / 2 * (1 + value(parameters, 'offsetY', 0));
  const sampleCount = quality * quality * (4 + quality) + 1;
  const output = new Uint8ClampedArray(source.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const relativeX = x - centerX;
      const relativeY = y - centerY;
      const totals = [0, 0, 0, 0];
      let count = 0;
      for (let sample = 0; sample < sampleCount; sample += 1) {
        const theta = -angle / 2 + angle * sample / (sampleCount - 1);
        const cosine = Math.cos(theta);
        const sine = Math.sin(theta);
        const sampleX = Math.round(centerX + relativeX * cosine - relativeY * sine);
        const sampleY = Math.round(centerY + relativeX * sine + relativeY * cosine);
        if (sampleX < 0 || sampleY < 0 || sampleX >= width || sampleY >= height) continue;
        const sourceIndex = (sampleY * width + sampleX) * 4;
        for (let channel = 0; channel < 4; channel += 1) totals[channel] += source[sourceIndex + channel];
        count += 1;
      }
      const destination = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) output[destination + channel] = count ? clampByte(totals[channel] / count) : 0;
    }
    reportLoop(y + 1, height);
  }
  return output;
}

function boxBlur(source: Uint8ClampedArray, width: number, height: number, radiusValue: number) {
  const radius = Math.max(1, Math.min(200, Math.round(radiusValue)));
  const horizontal = new Float64Array(source.length);
  const output = new Uint8ClampedArray(source.length);
  for (let y = 0; y < height; y += 1) {
    const totals = [0, 0, 0, 0];
    for (let sampleX = 0; sampleX <= Math.min(width - 1, radius); sampleX += 1) {
      const index = (y * width + sampleX) * 4;
      for (let channel = 0; channel < 4; channel += 1) totals[channel] += source[index + channel];
    }
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width - 1, x + radius);
      const destination = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) horizontal[destination + channel] = totals[channel] / (right - left + 1);
      const removing = x - radius;
      const adding = x + radius + 1;
      if (removing >= 0) {
        const index = (y * width + removing) * 4;
        for (let channel = 0; channel < 4; channel += 1) totals[channel] -= source[index + channel];
      }
      if (adding < width) {
        const index = (y * width + adding) * 4;
        for (let channel = 0; channel < 4; channel += 1) totals[channel] += source[index + channel];
      }
    }
    reportLoop(y + 1, height, 0, 0.5);
  }
  for (let x = 0; x < width; x += 1) {
    const totals = [0, 0, 0, 0];
    for (let sampleY = 0; sampleY <= Math.min(height - 1, radius); sampleY += 1) {
      const index = (sampleY * width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) totals[channel] += horizontal[index + channel];
    }
    for (let y = 0; y < height; y += 1) {
      const top = Math.max(0, y - radius);
      const bottom = Math.min(height - 1, y + radius);
      const destination = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) output[destination + channel] = clampByte(totals[channel] / (bottom - top + 1));
      const removing = y - radius;
      const adding = y + radius + 1;
      if (removing >= 0) {
        const index = (removing * width + x) * 4;
        for (let channel = 0; channel < 4; channel += 1) totals[channel] -= horizontal[index + channel];
      }
      if (adding < height) {
        const index = (adding * width + x) * 4;
        for (let channel = 0; channel < 4; channel += 1) totals[channel] += horizontal[index + channel];
      }
    }
    reportLoop(x + 1, width, 0.5, 1);
  }
  return output;
}

function processZoomBlur(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
  const amount = Math.max(0, Math.min(100, value(parameters, 'amount', 10))) / 100;
  if (!amount) return new Uint8ClampedArray(source);
  const centerX = width / 2 * (1 + value(parameters, 'offsetX', 0));
  const centerY = height / 2 * (1 + value(parameters, 'offsetY', 0));
  const output = new Uint8ClampedArray(source.length);
  const sampleCount = 65;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const totals = [0, 0, 0, 0];
      let count = 0;
      for (let sample = 0; sample < sampleCount; sample += 1) {
        const scale = 1 - amount * sample / (sampleCount - 1);
        const sampleX = centerX + (x - centerX) * scale;
        const sampleY = centerY + (y - centerY) * scale;
        if (addBilinearSample(source, width, height, sampleX, sampleY, totals)) count += 1;
      }
      const destination = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) output[destination + channel] = count ? clampByte(totals[channel] / count) : 0;
    }
    reportLoop(y + 1, height);
  }
  return output;
}

function wrapCoordinate(coordinate: number, size: number) {
  if (size <= 1) return 0;
  return ((coordinate % size) + size) % size;
}

function reflectCoordinate(coordinate: number, size: number) {
  if (size <= 1) return 0;
  const maximum = size - 1;
  const period = maximum * 2;
  const reflected = ((coordinate % period) + period) % period;
  return reflected > maximum ? period - reflected : reflected;
}

function addWarpSample(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  totals: number[],
  edgeBehavior: number,
  originalIndex: number,
  parameters: EffectParameters,
) {
  if (addBilinearSample(source, width, height, x, y, totals)) return;
  if (edgeBehavior === 5) return;
  if (edgeBehavior === 6) {
    for (let channel = 0; channel < 4; channel += 1) totals[channel] += source[originalIndex + channel];
    return;
  }
  if (edgeBehavior === 3 || edgeBehavior === 4) {
    const prefix = edgeBehavior === 3 ? '__primary' : '__secondary';
    totals[0] += value(parameters, `${prefix}R`, edgeBehavior === 3 ? 0 : 255);
    totals[1] += value(parameters, `${prefix}G`, edgeBehavior === 3 ? 0 : 255);
    totals[2] += value(parameters, `${prefix}B`, edgeBehavior === 3 ? 0 : 255);
    totals[3] += 255;
    return;
  }
  const sampleX = edgeBehavior === 1 ? wrapCoordinate(x, width)
    : edgeBehavior === 2 ? reflectCoordinate(x, width)
      : Math.max(0, Math.min(width - 1, x));
  const sampleY = edgeBehavior === 1 ? wrapCoordinate(y, height)
    : edgeBehavior === 2 ? reflectCoordinate(y, height)
      : Math.max(0, Math.min(height - 1, y));
  addBilinearSample(source, width, height, sampleX, sampleY, totals);
}

function warpBounds(parameters: EffectParameters, width: number, height: number) {
  return {
    x: value(parameters, '__selectionX', 0),
    y: value(parameters, '__selectionY', 0),
    width: value(parameters, '__selectionWidth', width),
    height: value(parameters, '__selectionHeight', height),
  };
}

function processWarp(
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
  const output = new Uint8ClampedArray(source.length);
  const transformed = { x: 0, y: 0 };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const totals = [0, 0, 0, 0];
      const originalIndex = (y * width + x) * 4;
      for (let sampleY = 0; sampleY < quality; sampleY += 1) {
        for (let sampleX = 0; sampleX < quality; sampleX += 1) {
          const offsetX = quality === 1 ? 0 : (sampleX + 0.5) / quality - 0.5;
          const offsetY = quality === 1 ? 0 : (sampleY + 0.5) / quality - 0.5;
          transform(x - centerX + offsetX, y - centerY + offsetY, radius, transformed);
          addWarpSample(source, width, height, transformed.x + centerX, transformed.y + centerY, totals, edgeBehavior, originalIndex, parameters);
        }
      }
      const count = quality * quality;
      for (let channel = 0; channel < 4; channel += 1) output[originalIndex + channel] = clampByte(totals[channel] / count);
    }
    reportLoop(y + 1, height);
  }
  return output;
}

function processBulge(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
  const amount = Math.max(-200, Math.min(100, value(parameters, 'amount', 45))) / 100;
  if (amount === 0) return new Uint8ClampedArray(source);
  const halfWidth = width / 2 * (1 + value(parameters, 'offsetX', 0));
  const halfHeight = height / 2 * (1 + value(parameters, 'offsetY', 0));
  const maximumRadius = Math.min(width / 2, height / 2) * value(parameters, 'radiusPercentage', 100) / 100;
  const output = new Uint8ClampedArray(source.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const destination = (y * width + x) * 4;
      const relativeX = x - halfWidth;
      const relativeY = y - halfHeight;
      const radialScale = 1 - Math.hypot(relativeX, relativeY) / maximumRadius;
      if (radialScale <= 0) {
        for (let channel = 0; channel < 4; channel += 1) output[destination + channel] = source[destination + channel];
        continue;
      }
      const scale = 1 - amount * radialScale * radialScale;
      const totals = [0, 0, 0, 0];
      addBilinearSample(
        source,
        width,
        height,
        Math.max(0, Math.min(width - 1, relativeX * scale + halfWidth)),
        Math.max(0, Math.min(height - 1, relativeY * scale + halfHeight)),
        totals,
      );
      for (let channel = 0; channel < 4; channel += 1) output[destination + channel] = clampByte(totals[channel]);
    }
    reportLoop(y + 1, height);
  }
  return output;
}

const PERLIN_PERMUTATION = new Uint8Array([
  151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,8,99,37,240,21,10,23,190,6,148,
  247,120,234,75,0,26,197,62,94,252,219,203,117,35,11,32,57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,
  74,165,71,134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,133,230,220,105,92,41,55,46,245,40,244,102,143,54,
  65,25,63,161,1,216,80,73,209,76,132,187,208,89,18,169,200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,
  52,217,226,250,124,123,5,202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,182,189,28,42,223,183,170,213,
  119,248,152,2,44,154,163,70,221,153,101,155,167,43,172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,
  218,246,97,228,251,34,242,193,238,210,144,12,191,179,162,241,81,51,145,235,249,14,239,107,49,192,214,31,181,199,106,157,
  184,84,204,176,115,121,50,45,127,4,150,254,138,236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180,
]);
const PERLIN_ROTATION = 137.2 * Math.PI / 180;
const PERLIN_ROTATION_COSINE = Math.cos(PERLIN_ROTATION);
const PERLIN_ROTATION_SINE = Math.sin(PERLIN_ROTATION);

function perlinPermutation(index: number) {
  return PERLIN_PERMUTATION[index & 255];
}

function perlinGradient(hash: number, x: number, y: number) {
  const direction = hash & 15;
  const first = direction < 8 ? x : y;
  const second = direction < 4 ? y : direction === 12 || direction === 14 ? x : 0;
  return (direction & 1 ? -first : first) + (direction & 2 ? -second : second);
}

function perlinNoise(x: number, y: number, seed: number) {
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

function fractalPerlin(x: number, y: number, detail: number, roughness: number, seed: number) {
  let total = 0;
  let frequency = 1;
  let amplitude = 1;
  let partial = detail;
  for (let octave = 0; octave < Math.ceil(detail); octave += 1) {
    const rotatedX = x * PERLIN_ROTATION_COSINE - y * PERLIN_ROTATION_SINE;
    const rotatedY = x * PERLIN_ROTATION_SINE + y * PERLIN_ROTATION_COSINE;
    total += amplitude * perlinNoise(rotatedX * frequency, rotatedY * frequency, seed) * Math.min(1, partial);
    amplitude *= roughness;
    if (amplitude < 0.001) break;
    frequency *= 2;
    partial -= 1;
    x = rotatedX + 499;
    y = rotatedY + 506;
  }
  return total;
}

type RenderColor = [number, number, number, number];
type GradientStop = { offset: number; color: RenderColor };

function seededRandom(seedValue: number) {
  let seed = Math.round(seedValue) | 0;
  return () => {
    seed = seed + 0x6d2b79f5 | 0;
    let number = Math.imul(seed ^ seed >>> 15, 1 | seed);
    number = number + Math.imul(number ^ number >>> 7, 61 | number) ^ number;
    return ((number ^ number >>> 14) >>> 0) / 4294967296;
  };
}

function renderColorFromNumber(valueToConvert: number): RenderColor {
  const packed = Math.max(0, Math.min(0xffffff, Math.round(valueToConvert)));
  return [(packed >> 16) & 255, (packed >> 8) & 255, packed & 255, 255];
}

function presetGradient(choice: number): GradientStop[] {
  const transparent: RenderColor = [0, 0, 0, 0];
  const white: RenderColor = [255, 255, 255, 255];
  const black: RenderColor = [0, 0, 0, 255];
  if (choice === 0) return [{ offset: 0, color: [0, 146, 70, 255] }, { offset: 0.25, color: white }, { offset: 1, color: [206, 43, 55, 255] }];
  if (choice === 1) return [{ offset: 0, color: white }, { offset: 1, color: black }];
  if (choice === 2) return [{ offset: 0, color: transparent }, { offset: 0.25, color: black }, { offset: 0.5, color: [255, 0, 0, 255] }, { offset: 0.75, color: [255, 255, 0, 255] }, { offset: 1, color: white }];
  if (choice === 3) return [{ offset: 0, color: transparent }, { offset: 0.25, color: [135, 206, 235, 255] }, { offset: 0.75, color: [255, 182, 193, 255] }, { offset: 1, color: [255, 255, 240, 255] }];
  if (choice === 4) return [{ offset: 0, color: white }, { offset: 0.25, color: [255, 105, 180, 255] }, { offset: 0.5, color: [219, 112, 219, 255] }, { offset: 0.75, color: [173, 216, 230, 255] }, { offset: 1, color: [214, 235, 242, 255] }];
  if (choice === 5) return [{ offset: 0, color: transparent }, { offset: 0.25, color: black }, { offset: 0.5, color: [0, 0, 255, 255] }, { offset: 0.75, color: [0, 255, 255, 255] }, { offset: 1, color: white }];
  if (choice === 6) return [{ offset: 0, color: transparent }, { offset: 0.25, color: [0, 128, 0, 255] }, { offset: 0.5, color: [0, 255, 0, 255] }, { offset: 0.75, color: [255, 255, 0, 255] }, { offset: 1, color: white }];
  if (choice === 7) return [{ offset: 0, color: [70, 12, 26, 255] }, { offset: 0.2, color: [213, 101, 103, 255] }, { offset: 0.4, color: [200, 219, 25, 255] }, { offset: 0.6, color: [59, 52, 124, 255] }, { offset: 0.8, color: [0, 133, 248, 255] }, { offset: 1, color: [228, 117, 93, 255] }];
  return [{ offset: 0, color: [128, 128, 0, 255] }, { offset: 0.25, color: [255, 255, 0, 255] }, { offset: 1, color: [253, 245, 196, 255] }];
}

function effectGradient(parameters: EffectParameters, defaultChoice: number) {
  const source = Math.round(value(parameters, 'colorSchemeSource', 0));
  let stops: GradientStop[];
  if (source === 1) {
    stops = [
      { offset: 0, color: [value(parameters, '__primaryR', 0), value(parameters, '__primaryG', 0), value(parameters, '__primaryB', 0), 255] },
      { offset: 1, color: [value(parameters, '__secondaryR', 255), value(parameters, '__secondaryG', 255), value(parameters, '__secondaryB', 255), 255] },
    ];
  } else if (source === 2) {
    const random = seededRandom(value(parameters, 'colorSchemeSeed', 0));
    const startColor: RenderColor = [Math.floor(random() * 256), Math.floor(random() * 256), Math.floor(random() * 256), 255];
    const endColor: RenderColor = [Math.floor(random() * 256), Math.floor(random() * 256), Math.floor(random() * 256), 255];
    const stopCount = Math.floor(random() * 5);
    stops = [{ offset: 0, color: startColor }];
    for (let index = 0; index < stopCount; index += 1) {
      stops.push({
        offset: (index + 1) / (stopCount + 1),
        color: [Math.floor(random() * 256), Math.floor(random() * 256), Math.floor(random() * 256), 255],
      });
    }
    stops.push({ offset: 1, color: endColor });
  } else {
    stops = presetGradient(Math.round(value(parameters, 'colorScheme', defaultChoice)));
  }
  return value(parameters, 'reverseColorScheme', 0) === 0
    ? stops
    : stops.map((stop) => ({ offset: 1 - stop.offset, color: stop.color })).reverse();
}

function gradientColor(stops: GradientStop[], amountValue: number): RenderColor {
  const amount = Math.max(0, Math.min(1, amountValue));
  let rightIndex = stops.findIndex((stop) => stop.offset >= amount);
  if (rightIndex <= 0) return [...stops[Math.max(0, rightIndex)].color] as RenderColor;
  if (rightIndex < 0) rightIndex = stops.length - 1;
  const left = stops[rightIndex - 1];
  const right = stops[rightIndex];
  const span = right.offset - left.offset;
  const progress = span <= 0 ? 0 : (amount - left.offset) / span;
  return left.color.map((channel, index) => clampByte(channel + (right.color[index] - channel) * progress)) as RenderColor;
}

function processClouds(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
  const scale = Math.max(2, Math.min(1000, Math.round(value(parameters, 'scale', 250))));
  const power = Math.max(0, Math.min(100, value(parameters, 'power', 50))) / 100;
  const seed = Math.round(value(parameters, 'seed', 0)) & 255;
  const gradient = effectGradient(parameters, 0);
  const bounds = warpBounds(parameters, width, height);
  const output = new Uint8ClampedArray(source.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = 2 * (x - bounds.x) - bounds.width;
      const dy = 2 * (y - bounds.y) - bounds.height;
      let noiseValue = 0;
      let multiplier = 1;
      let divisor = scale;
      for (let octave = 0; octave < 12 && multiplier > 0.03 && divisor > 0; octave += 1) {
        const positionX = 65536 + dx / divisor;
        const positionY = 65536 + dy / divisor;
        noiseValue += perlinNoise(positionX, positionY, seed ^ octave) * multiplier;
        divisor = Math.floor(divisor / 2);
        multiplier *= power;
      }
      const color = gradientColor(gradient, (noiseValue + 1) / 2);
      const destination = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) output[destination + channel] = color[channel];
    }
    reportLoop(y + 1, height);
  }
  return output;
}

function juliaValue(realValue: number, imaginaryValue: number) {
  let real = realValue;
  let imaginary = imaginaryValue;
  let iterations = 0;
  let magnitudeSquared = real * real + imaginary * imaginary;
  while (iterations < 256 && magnitudeSquared < 10000) {
    const previousReal = real;
    real = real * real - imaginary * imaginary + 0.3125;
    imaginary = 2 * previousReal * imaginary + 0.03;
    iterations += 1;
    magnitudeSquared = real * real + imaginary * imaginary;
  }
  return iterations - (2 - 2 * Math.log(10000) / Math.log(Math.max(1.000001, magnitudeSquared)));
}

function mandelbrotValue(realValue: number, imaginaryValue: number, factor: number) {
  let real = 0;
  let imaginary = 0;
  let iterations = 0;
  let magnitudeSquared = 0;
  while (iterations * factor < 1024 && magnitudeSquared < 100000) {
    const previousReal = real;
    real = real * real - imaginary * imaginary + realValue;
    imaginary = 2 * previousReal * imaginary + imaginaryValue;
    iterations += 1;
    magnitudeSquared = real * real + imaginary * imaginary;
  }
  return iterations - Math.log(Math.max(1.000001, magnitudeSquared)) / Math.log(100000);
}

function processFractal(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters, kind: 'julia' | 'mandelbrot') {
  const factor = Math.max(1, Math.min(10, Math.round(value(parameters, 'factor', kind === 'julia' ? 4 : 1))));
  const quality = Math.max(1, Math.min(5, Math.round(value(parameters, 'quality', 2))));
  const count = quality * quality + 1;
  const zoomValue = value(parameters, 'zoom', kind === 'julia' ? 1 : 10);
  const inverseZoom = kind === 'julia' ? 1 / Math.max(0.5, zoomValue) : 1 / (1 + 20 * Math.max(0, zoomValue));
  const angle = value(parameters, 'angle', 0) * Math.PI / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const gradient = effectGradient(parameters, kind === 'julia' ? 2 : 5);
  const output = new Uint8ClampedArray(source.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const totals = [0, 0, 0, 0];
      const baseX = 2 * x - width;
      const baseY = 2 * y - height;
      for (let sample = 0; sample < count; sample += 1) {
        const relativeX = (baseX + sample / count) / height;
        const relativeY = (baseY + ((sample / quality) % 1)) / height;
        const rotatedX = relativeX * cosine - relativeY * sine;
        const rotatedY = relativeX * sine + relativeY * cosine;
        let gradientPosition: number;
        if (kind === 'julia') {
          const aspect = height / width;
          const real = (rotatedX - rotatedY * aspect) * inverseZoom;
          const imaginary = (rotatedY + rotatedX * aspect) * inverseZoom;
          gradientPosition = Math.max(0, Math.min(1023, factor * juliaValue(real, imaginary))) / 1023;
        } else {
          const result = mandelbrotValue(rotatedX * inverseZoom - 0.7, rotatedY * inverseZoom - 0.29, factor);
          gradientPosition = Math.max(0, Math.min(1023, 64 + factor * result)) / 1023;
        }
        const color = gradientColor(gradient, gradientPosition);
        for (let channel = 0; channel < 4; channel += 1) totals[channel] += color[channel];
      }
      const destination = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        let channelValue = clampByte(totals[channel] / count);
        if (kind === 'mandelbrot' && value(parameters, 'invertColors', 0) !== 0 && channel < 3) channelValue = 255 - channelValue;
        output[destination + channel] = channelValue;
      }
    }
    reportLoop(y + 1, height);
  }
  return output;
}

type ControlPoint = { x: number; y: number; color?: RenderColor };

function createControlPoints(width: number, height: number, parameters: EffectParameters) {
  const bounds = warpBounds(parameters, width, height);
  const count = Math.max(1, Math.min(1024, Math.round(value(parameters, 'numberOfCells', 100)), Math.floor(bounds.width * bounds.height)));
  const arrangement = Math.round(value(parameters, 'pointArrangement', 0));
  const points: ControlPoint[] = [];
  if (arrangement === 1) {
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    const radius = Math.min(bounds.width, bounds.height) / 2;
    for (let index = 0; index < count; index += 1) {
      const angle = Math.PI * 2 * index / count;
      points.push({ x: centerX + radius * Math.cos(angle), y: centerY + radius * Math.sin(angle) });
    }
  } else if (arrangement === 2) {
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    const maximumRadius = Math.min(bounds.width, bounds.height) / 2;
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    for (let index = 0; index < count; index += 1) {
      const radius = Math.sqrt(index / count) * maximumRadius;
      points.push({ x: centerX + radius * Math.cos(index * goldenAngle), y: centerY + radius * Math.sin(index * goldenAngle) });
    }
  } else {
    const random = seededRandom(value(parameters, 'pointSeed', 0));
    const used = new Set<number>();
    while (points.length < count) {
      const x = Math.floor(bounds.x + random() * bounds.width);
      const y = Math.floor(bounds.y + random() * bounds.height);
      const key = y * width + x;
      if (used.has(key)) continue;
      used.add(key);
      points.push({ x: x + 0.5, y: y + 0.5 });
    }
  }
  return points;
}

function relativeDistance(x: number, y: number, point: ControlPoint, metric: number) {
  const dx = Math.abs(x - point.x);
  const dy = Math.abs(y - point.y);
  return metric === 1 ? dx + dy : metric === 2 ? Math.max(dx, dy) : dx * dx + dy * dy;
}

function actualDistance(relative: number, metric: number) {
  return metric === 0 ? Math.sqrt(relative) : relative;
}

function renderPointColor(parameters: EffectParameters) {
  return renderColorFromNumber(value(parameters, 'pointColor', 0));
}

function processCells(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
  const points = createControlPoints(width, height, parameters);
  const metric = Math.round(value(parameters, 'distanceMetric', 0));
  const quality = Math.max(1, Math.min(4, Math.round(value(parameters, 'quality', 3))));
  const cellRadius = Math.max(4, Math.min(100, value(parameters, 'cellRadius', 32)));
  const gradient = effectGradient(parameters, 1);
  const edgeBehavior = Math.round(value(parameters, 'colorSchemeEdgeBehavior', 0));
  const showPoints = value(parameters, 'showPoints', 0) !== 0;
  const pointRadius = value(parameters, 'pointSize', 4) / 2;
  const pointColor = renderPointColor(parameters);
  const output = new Uint8ClampedArray(source.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const totals = [0, 0, 0, 0];
      const destination = (y * width + x) * 4;
      for (let sampleY = 0; sampleY < quality; sampleY += 1) {
        for (let sampleX = 0; sampleX < quality; sampleX += 1) {
          const locationX = x + (sampleX + 0.5) / quality;
          const locationY = y + (sampleY + 0.5) / quality;
          let shortest = Number.POSITIVE_INFINITY;
          for (const point of points) shortest = Math.min(shortest, relativeDistance(locationX, locationY, point, metric));
          const distance = actualDistance(shortest, metric);
          let color: RenderColor;
          if (showPoints && distance <= pointRadius) color = pointColor;
          else if (distance <= cellRadius) color = gradientColor(gradient, distance / cellRadius);
          else if (edgeBehavior === 1) color = gradientColor(gradient, wrapCoordinate(distance, cellRadius) / cellRadius);
          else if (edgeBehavior === 2) color = gradientColor(gradient, reflectCoordinate(distance, cellRadius + 1) / cellRadius);
          else if (edgeBehavior === 3) color = [value(parameters, '__primaryR', 0), value(parameters, '__primaryG', 0), value(parameters, '__primaryB', 0), 255];
          else if (edgeBehavior === 4) color = [value(parameters, '__secondaryR', 255), value(parameters, '__secondaryG', 255), value(parameters, '__secondaryB', 255), 255];
          else if (edgeBehavior === 5) color = [0, 0, 0, 0];
          else if (edgeBehavior === 6) color = [source[destination], source[destination + 1], source[destination + 2], source[destination + 3]];
          else color = gradientColor(gradient, 1);
          for (let channel = 0; channel < 4; channel += 1) totals[channel] += color[channel];
        }
      }
      for (let channel = 0; channel < 4; channel += 1) output[destination + channel] = clampByte(totals[channel] / (quality * quality));
    }
    reportLoop(y + 1, height);
  }
  return output;
}

function processVoronoi(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
  let points = createControlPoints(width, height, parameters);
  const sorting = Math.round(value(parameters, 'colorSorting', 0));
  if (sorting >= 1 && sorting <= 3) points = [...points].sort((first, second) => first.x - second.x || first.y - second.y);
  else if (sorting >= 4) points = [...points].sort((first, second) => first.y - second.y || first.x - second.x);
  const random = seededRandom(value(parameters, 'colorSeed', 0));
  let colors: RenderColor[] = points.map(() => [Math.floor(random() * 256), Math.floor(random() * 256), Math.floor(random() * 256), 255]);
  const sortChannel: 0 | 1 | 2 | null = sorting === 1 || sorting === 4 ? 2 : sorting === 2 || sorting === 5 ? 1 : sorting === 3 || sorting === 6 ? 0 : null;
  if (sortChannel !== null) colors = [...colors].sort((first, second) => first[sortChannel] - second[sortChannel]);
  if (value(parameters, 'reverseColorSorting', 0) !== 0) colors.reverse();
  points.forEach((point, index) => { point.color = colors[index]; });
  const metric = Math.round(value(parameters, 'distanceMetric', 0));
  const quality = Math.max(1, Math.min(4, Math.round(value(parameters, 'quality', 3))));
  const showPoints = value(parameters, 'showPoints', 0) !== 0;
  const basePointRadius = value(parameters, 'pointSize', 4) / 2;
  const pointThreshold = metric === 0 ? basePointRadius * basePointRadius : basePointRadius;
  const pointColor = renderPointColor(parameters);
  const output = new Uint8ClampedArray(source.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const totals = [0, 0, 0, 0];
      const destination = (y * width + x) * 4;
      for (let sampleY = 0; sampleY < quality; sampleY += 1) {
        for (let sampleX = 0; sampleX < quality; sampleX += 1) {
          const locationX = x + (sampleX + 0.5) / quality;
          const locationY = y + (sampleY + 0.5) / quality;
          let closest = points[0];
          let shortest = Number.POSITIVE_INFINITY;
          for (const point of points) {
            const distance = relativeDistance(locationX, locationY, point, metric);
            if (distance > shortest) continue;
            shortest = distance;
            closest = point;
          }
          const color = showPoints && shortest <= pointThreshold ? pointColor : closest.color!;
          for (let channel = 0; channel < 4; channel += 1) totals[channel] += color[channel];
        }
      }
      for (let channel = 0; channel < 4; channel += 1) output[destination + channel] = clampByte(totals[channel] / (quality * quality));
    }
    reportLoop(y + 1, height);
  }
  return output;
}

function processDents(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
  const refraction = Math.max(0, Math.min(200, value(parameters, 'refraction', 50)));
  if (refraction === 0) return new Uint8ClampedArray(source);
  const bounds = warpBounds(parameters, width, height);
  const radius = Math.max(0.5, Math.min(bounds.width, bounds.height) / 2);
  const scale = Math.max(1, Math.min(200, value(parameters, 'scale', 25)));
  const scaleR = 400 / radius / scale;
  const roughnessValue = Math.max(0, Math.min(100, value(parameters, 'roughness', 10)));
  const detail = 1 + roughnessValue / 10;
  const maximumDetail = Math.floor(Math.log(scaleR) / Math.log(0.5));
  const effectiveDetail = detail > maximumDetail && maximumDetail >= 1 ? maximumDetail : detail;
  const normalizedRoughness = roughnessValue / 100;
  const refractionScale = refraction / 100 / scaleR;
  const theta = Math.PI * 2 * value(parameters, 'turbulence', 10) / 10;
  const seed = Math.max(0, Math.min(255, Math.round(value(parameters, 'seed', 0))));
  return processWarp(source, width, height, parameters, value(parameters, 'quality', 2), (x, y, _radius, output) => {
    const noise = fractalPerlin(x * scaleR, y * scaleR, effectiveDetail, normalizedRoughness, seed);
    output.x = x + refractionScale * Math.sin(-theta * noise);
    output.y = y + refractionScale * Math.cos(theta * noise);
  });
}

function processFrostedGlass(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
  const amount = Math.max(1, Math.min(10, Math.round(value(parameters, 'amount', 1))));
  let seed = Math.round(value(parameters, 'seed', 0)) | 0;
  const random = () => {
    seed = seed + 0x6d2b79f5 | 0;
    let number = Math.imul(seed ^ seed >>> 15, 1 | seed);
    number = number + Math.imul(number ^ number >>> 7, 61 | number) ^ number;
    return ((number ^ number >>> 14) >>> 0) / 4294967296;
  };
  const output = new Uint8ClampedArray(source.length);
  for (let y = 0; y < height; y += 1) {
    const top = Math.max(0, y - amount);
    const bottom = Math.min(height - 1, y + amount);
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - amount);
      const right = Math.min(width - 1, x + amount);
      const neighborhoodWidth = right - left + 1;
      const choice = Math.floor(random() * neighborhoodWidth * (bottom - top + 1));
      const chosenX = left + choice % neighborhoodWidth;
      const chosenY = top + Math.floor(choice / neighborhoodWidth);
      const chosenIndex = (chosenY * width + chosenX) * 4;
      const chosenIntensity = (19595 * source[chosenIndex] + 38470 * source[chosenIndex + 1] + 7471 * source[chosenIndex + 2]) >> 16;
      const totals = [0, 0, 0, 0];
      let count = 0;
      for (let sampleY = top; sampleY <= bottom; sampleY += 1) {
        for (let sampleX = left; sampleX <= right; sampleX += 1) {
          const sample = (sampleY * width + sampleX) * 4;
          const intensity = (19595 * source[sample] + 38470 * source[sample + 1] + 7471 * source[sample + 2]) >> 16;
          if (intensity !== chosenIntensity) continue;
          for (let channel = 0; channel < 4; channel += 1) totals[channel] += source[sample + channel];
          count += 1;
        }
      }
      const destination = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) output[destination + channel] = Math.floor(totals[channel] / count);
    }
    reportLoop(y + 1, height);
  }
  return output;
}

function processPolarInversion(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
  const amount = Math.max(-4, Math.min(4, value(parameters, 'amount', 0)));
  if (amount === 0) return new Uint8ClampedArray(source);
  return processWarp(source, width, height, parameters, value(parameters, 'quality', 2), (x, y, radius, output) => {
    const magnitudeSquared = x * x + y * y;
    if (magnitudeSquared < 1e-9) {
      output.x = x;
      output.y = y;
      return;
    }
    const scale = 1 + (radius * radius / magnitudeSquared - 1) * amount;
    output.x = x * scale;
    output.y = y * scale;
  });
}

function processTileReflection(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
  const intensityValue = Math.max(-20, Math.min(20, value(parameters, 'intensity', 8)));
  if (intensityValue === 0) return new Uint8ClampedArray(source);
  const theta = value(parameters, 'rotation', 30) * Math.PI / 180;
  const sine = Math.sin(-theta);
  const cosine = Math.cos(-theta);
  const tileScale = Math.PI / Math.max(2, value(parameters, 'tileSize', 40));
  const intensity = intensityValue * intensityValue / 10 * Math.sign(intensityValue);
  const curved = Math.round(value(parameters, 'tileType', 0)) === 1;
  const edgeBehavior = Math.round(value(parameters, 'edgeBehavior', 1));
  const centerX = width / 2;
  const centerY = height / 2;
  const quality = 4;
  const output = new Uint8ClampedArray(source.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const totals = [0, 0, 0, 0];
      const destination = (y * width + x) * 4;
      for (let sampleY = 0; sampleY < quality; sampleY += 1) {
        for (let sampleX = 0; sampleX < quality; sampleX += 1) {
          const initialX = x - centerX + (sampleX + 0.5) / quality - 0.5;
          const initialY = y - centerY + (sampleY + 0.5) / quality - 0.5;
          const rotatedX = cosine * initialX + sine * initialY;
          const rotatedY = -sine * initialX + cosine * initialY;
          const waveX = curved ? Math.sin(rotatedX * tileScale) : Math.tan(rotatedX * tileScale);
          const waveY = curved ? Math.sin(rotatedY * tileScale) : Math.tan(rotatedY * tileScale);
          const transformedX = rotatedX + intensity * waveX;
          const transformedY = rotatedY + intensity * waveY;
          addWarpSample(
            source,
            width,
            height,
            centerX + cosine * transformedX - sine * transformedY,
            centerY + sine * transformedX + cosine * transformedY,
            totals,
            edgeBehavior,
            destination,
            parameters,
          );
        }
      }
      for (let channel = 0; channel < 4; channel += 1) output[destination + channel] = clampByte(totals[channel] / (quality * quality));
    }
    reportLoop(y + 1, height);
  }
  return output;
}

function processTwist(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
  const amount = Math.max(-100, Math.min(100, value(parameters, 'amount', 30)));
  const radiusPercentage = Math.max(0, Math.min(100, value(parameters, 'radiusPercentage', 100)));
  if (amount === 0 || radiusPercentage === 0) return new Uint8ClampedArray(source);
  const preliminaryTwist = -amount;
  const twist = preliminaryTwist * preliminaryTwist * Math.sign(preliminaryTwist) / 100;
  return processWarp(source, width, height, parameters, Math.max(1, value(parameters, 'antialias', 2)), (x, y, radiusBasis, output) => {
    const maximumRadius = radiusBasis * radiusPercentage / 100;
    const radialDistance = Math.hypot(x, y);
    if (radialDistance > maximumRadius || radialDistance === 0) {
      output.x = x;
      output.y = y;
      return;
    }
    const radialFactor = 1 - radialDistance / maximumRadius;
    const localTwist = radialFactor ** 3 * twist;
    const cosine = Math.cos(localTwist);
    const sine = Math.sin(localTwist);
    output.x = x * cosine - y * sine;
    output.y = x * sine + y * cosine;
  });
}

function convolve(source: Uint8ClampedArray, width: number, height: number, kernel: number[], divisor = 1, bias = 0) {
  const output = new Uint8ClampedArray(source.length);
  const size = Math.sqrt(kernel.length);
  const radius = Math.floor(size / 2);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const destination = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        let total = 0;
        for (let kernelY = 0; kernelY < size; kernelY += 1) {
          for (let kernelX = 0; kernelX < size; kernelX += 1) {
            const sampleX = Math.max(0, Math.min(width - 1, x + kernelX - radius));
            const sampleY = Math.max(0, Math.min(height - 1, y + kernelY - radius));
            total += source[(sampleY * width + sampleX) * 4 + channel] * kernel[kernelY * size + kernelX];
          }
        }
        output[destination + channel] = clampByte(total / divisor + bias);
      }
      output[destination + 3] = source[destination + 3];
    }
  }
  return output;
}

function applyBrightnessContrast(data: Uint8ClampedArray, brightness: number, contrast: number) {
  const addition = brightness * 2.55;
  const scaledContrast = Math.max(-254, Math.min(254, contrast * 2.54));
  const factor = (259 * (scaledContrast + 255)) / (255 * (259 - scaledContrast));
  for (let index = 0; index < data.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      data[index + channel] = clampByte(factor * (data[index + channel] - 128) + 128 + addition);
    }
    reportPixels(index, data.length);
  }
}

function rgbToHsl(red: number, green: number, blue: number) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness] as const;
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue = max === r ? (g - b) / delta + (g < b ? 6 : 0) : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  hue /= 6;
  return [hue, saturation, lightness] as const;
}

function hueToRgb(p: number, q: number, hueValue: number) {
  let hue = hueValue;
  if (hue < 0) hue += 1;
  if (hue > 1) hue -= 1;
  if (hue < 1 / 6) return p + (q - p) * 6 * hue;
  if (hue < 1 / 2) return q;
  if (hue < 2 / 3) return p + (q - p) * (2 / 3 - hue) * 6;
  return p;
}

function hslToRgb(hue: number, saturation: number, lightness: number) {
  if (saturation === 0) {
    const gray = clampByte(lightness * 255);
    return [gray, gray, gray] as const;
  }
  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  return [
    clampByte(hueToRgb(p, q, hue + 1 / 3) * 255),
    clampByte(hueToRgb(p, q, hue) * 255),
    clampByte(hueToRgb(p, q, hue - 1 / 3) * 255),
  ] as const;
}

function processHueSaturation(data: Uint8ClampedArray, parameters: EffectParameters) {
  const hueShift = value(parameters, 'hue', 0) / 360;
  const saturationScale = value(parameters, 'saturation', 100) / 100;
  const lightnessShift = value(parameters, 'lightness', 0) / 100;
  for (let index = 0; index < data.length; index += 4) {
    const [hue, saturation, lightness] = rgbToHsl(data[index], data[index + 1], data[index + 2]);
    const shiftedHue = (hue + hueShift + 1) % 1;
    const shiftedSaturation = Math.max(0, Math.min(1, saturation * saturationScale));
    const shiftedLightness = Math.max(0, Math.min(1, lightness + lightnessShift));
    const [red, green, blue] = hslToRgb(shiftedHue, shiftedSaturation, shiftedLightness);
    data[index] = red;
    data[index + 1] = green;
    data[index + 2] = blue;
    reportPixels(index, data.length);
  }
}

function processAutoLevel(data: Uint8ClampedArray) {
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

function processLevels(data: Uint8ClampedArray, parameters: EffectParameters) {
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

function processCurves(data: Uint8ClampedArray, parameters: EffectParameters) {
  if (value(parameters, 'curveMode', 0) === 0) {
    const lookup = buildCurveLookup(curvePointsFromParameters(parameters, 'luminosity'));
    for (let index = 0; index < data.length; index += 4) {
      const luminosity = clampByte(data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114);
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

function processPixelate(source: Uint8ClampedArray, width: number, height: number, cellSizeValue: number) {
  const output = new Uint8ClampedArray(source);
  const cellSize = Math.max(1, Math.round(cellSizeValue));
  for (let top = 0; top < height; top += cellSize) {
    for (let left = 0; left < width; left += cellSize) {
      const totals = [0, 0, 0, 0];
      const bottom = Math.min(height, top + cellSize);
      const right = Math.min(width, left + cellSize);
      const cornerIndices = [
        (top * width + left) * 4,
        (top * width + right - 1) * 4,
        ((bottom - 1) * width + left) * 4,
        ((bottom - 1) * width + right - 1) * 4,
      ];
      for (const corner of cornerIndices) {
        for (let channel = 0; channel < 4; channel += 1) totals[channel] += source[corner + channel];
      }
      for (let y = top; y < bottom; y += 1) {
        for (let x = left; x < right; x += 1) {
          const index = (y * width + x) * 4;
          for (let channel = 0; channel < 4; channel += 1) output[index + channel] = clampByte(totals[channel] / 4);
        }
      }
    }
    reportLoop(Math.min(height, top + cellSize), height);
  }
  return output;
}

function histogramPercentile(histogram: Uint32Array, minimumCount: number) {
  let channel = 0;
  let count = 0;
  while (channel < 255 && histogram[channel] === 0) channel += 1;
  while (channel < 255 && count < minimumCount) {
    count += histogram[channel];
    channel += 1;
  }
  return channel;
}

function histogramRank(histogram: Uint32Array, channel: number, area: number) {
  let count = 0;
  for (let index = 0; index < channel; index += 1) count += histogram[index];
  return Math.floor(count * 255 / area);
}

function histogramRange(histogram: Uint32Array, minimumCount: number, maximumCount: number) {
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

function processLocalHistogram(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  parameters: EffectParameters,
  mode: 'median' | 'reduce-noise' | 'outline-edge',
) {
  const radiusKey = mode === 'outline-edge' ? 'thickness' : 'radius';
  const radiusFallback = mode === 'median' ? 10 : mode === 'reduce-noise' ? 6 : 3;
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

  const addPixel = (index: number) => {
    redHistogram[source[index]] += 1;
    greenHistogram[source[index + 1]] += 1;
    blueHistogram[source[index + 2]] += 1;
    alphaHistogram[source[index + 3]] += 1;
  };
  const removePixel = (index: number) => {
    redHistogram[source[index]] -= 1;
    greenHistogram[source[index + 1]] -= 1;
    blueHistogram[source[index + 2]] -= 1;
    alphaHistogram[source[index + 3]] -= 1;
  };

  for (let y = 0; y < height; y += 1) {
    redHistogram.fill(0);
    greenHistogram.fill(0);
    blueHistogram.fill(0);
    alphaHistogram.fill(0);
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

function processNoise(data: Uint8ClampedArray, parameters: EffectParameters) {
  const intensity = value(parameters, 'intensity', 64) * 1.275;
  const saturation = value(parameters, 'colorSaturation', 100) / 100;
  const coverage = value(parameters, 'coverage', 100) / 100;
  let seed = Math.round(value(parameters, 'seed', 0)) ^ 0x6d2b79f5;
  const random = () => {
    seed |= 0;
    seed = seed + 0x6d2b79f5 | 0;
    let number = Math.imul(seed ^ seed >>> 15, 1 | seed);
    number = number + Math.imul(number ^ number >>> 7, 61 | number) ^ number;
    return ((number ^ number >>> 14) >>> 0) / 4294967296;
  };
  for (let index = 0; index < data.length; index += 4) {
    reportPixels(index, data.length);
    if (random() > coverage) continue;
    const common = (random() * 2 - 1) * intensity;
    for (let channel = 0; channel < 3; channel += 1) {
      const colored = (random() * 2 - 1) * intensity;
      data[index + channel] = clampByte(data[index + channel] + common * (1 - saturation) + colored * saturation);
    }
  }
}

function processGlow(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
  const output = new Uint8ClampedArray(source.length);
  const blurred = withProgressRange(0, 0.65, () => gaussianBlur(source, width, height, value(parameters, 'radius', 6)));
  for (let index = 0; index < output.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      output[index + channel] = clampByte(255 - ((255 - source[index + channel]) * (255 - blurred[index + channel])) / 255);
    }
    output[index + 3] = source[index + 3];
    reportPixels(index, output.length, 0.65, 0.9);
  }
  withProgressRange(0.9, 1, () => applyBrightnessContrast(output, value(parameters, 'brightness', 10), value(parameters, 'contrast', 10)));
  return output;
}

function processInkSketch(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
  const coloringAdjustment = -(value(parameters, 'coloring', 50) - 50) * 2;
  const output = withProgressRange(0, 0.55, () => processGlow(source, width, height, {
    radius: 6,
    brightness: coloringAdjustment,
    contrast: coloringAdjustment,
  }));
  const threshold = value(parameters, 'inkOutline', 50) * 255 / 100;
  const weights = [
    -1, -1, -1, -1, -1,
    -1, -1, -1, -1, -1,
    -1, -1, 30, -1, -1,
    -1, -1, -1, -1, -1,
    -1, -1, -5, -1, -1,
  ];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const totals = [0, 0, 0, 0];
      for (let offsetY = -2; offsetY <= 2; offsetY += 1) {
        const sampleY = y + offsetY;
        if (sampleY < 0 || sampleY >= height) continue;
        for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
          const sampleX = x + offsetX;
          if (sampleX < 0 || sampleX >= width) continue;
          const sample = (sampleY * width + sampleX) * 4;
          const weight = weights[(offsetY + 2) * 5 + offsetX + 2];
          for (let channel = 0; channel < 4; channel += 1) totals[channel] += source[sample + channel] * weight;
        }
      }
      const red = Math.max(0, Math.min(255, totals[0]));
      const green = Math.max(0, Math.min(255, totals[1]));
      const blue = Math.max(0, Math.min(255, totals[2]));
      const gray = (19595 * red + 38470 * green + 7471 * blue) >> 16;
      const ink = gray > threshold ? 255 : 0;
      const destination = (y * width + x) * 4;
      output[destination] = Math.min(output[destination], ink);
      output[destination + 1] = Math.min(output[destination + 1], ink);
      output[destination + 2] = Math.min(output[destination + 2], ink);
    }
    reportLoop(y + 1, height, 0.55, 1);
  }
  return output;
}

function processOilPainting(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
  const brushSize = Math.max(1, Math.min(8, Math.round(value(parameters, 'brushSize', 3))));
  const coarseness = Math.max(3, Math.min(255, Math.round(value(parameters, 'coarseness', 50))));
  const counts = new Uint32Array(coarseness + 1);
  const redTotals = new Uint32Array(coarseness + 1);
  const greenTotals = new Uint32Array(coarseness + 1);
  const blueTotals = new Uint32Array(coarseness + 1);
  const alphaTotals = new Uint32Array(coarseness + 1);
  const output = new Uint8ClampedArray(source.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      counts.fill(0);
      redTotals.fill(0);
      greenTotals.fill(0);
      blueTotals.fill(0);
      alphaTotals.fill(0);
      const top = Math.max(0, y - brushSize);
      const bottom = Math.min(height - 1, y + brushSize);
      const left = Math.max(0, x - brushSize);
      const right = Math.min(width - 1, x + brushSize);
      for (let sampleY = top; sampleY <= bottom; sampleY += 1) {
        for (let sampleX = left; sampleX <= right; sampleX += 1) {
          const sample = (sampleY * width + sampleX) * 4;
          const intensityByte = (19595 * source[sample] + 38470 * source[sample + 1] + 7471 * source[sample + 2]) >> 16;
          const intensity = fastMultiplyByte(intensityByte, coarseness);
          counts[intensity] += 1;
          redTotals[intensity] += source[sample];
          greenTotals[intensity] += source[sample + 1];
          blueTotals[intensity] += source[sample + 2];
          alphaTotals[intensity] += source[sample + 3];
        }
      }
      let chosenIntensity = 0;
      let maximumCount = 0;
      for (let intensity = 0; intensity <= coarseness; intensity += 1) {
        if (counts[intensity] <= maximumCount) continue;
        chosenIntensity = intensity;
        maximumCount = counts[intensity];
      }
      const destination = (y * width + x) * 4;
      output[destination] = Math.floor(redTotals[chosenIntensity] / maximumCount);
      output[destination + 1] = Math.floor(greenTotals[chosenIntensity] / maximumCount);
      output[destination + 2] = Math.floor(blueTotals[chosenIntensity] / maximumCount);
      output[destination + 3] = Math.floor(alphaTotals[chosenIntensity] / maximumCount);
    }
    reportLoop(y + 1, height);
  }
  return output;
}

function processPencilSketch(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
  const adjusted = new Uint8ClampedArray(source);
  const colorRange = Math.max(-20, Math.min(20, value(parameters, 'colorRange', 0)));
  withProgressRange(0, 0.1, () => applyBrightnessContrast(adjusted, -colorRange, -colorRange));
  const blurred = withProgressRange(0.1, 0.8, () => gaussianBlur(adjusted, width, height, value(parameters, 'pencilTipSize', 2)));
  const output = new Uint8ClampedArray(source.length);
  for (let index = 0; index < source.length; index += 4) {
    const sourceGray = (19595 * source[index] + 38470 * source[index + 1] + 7471 * source[index + 2]) >> 16;
    const blurredGray = (19595 * blurred[index] + 38470 * blurred[index + 1] + 7471 * blurred[index + 2]) >> 16;
    const inverted = 255 - blurredGray;
    const dodge = inverted === 255 ? 255 : Math.min(255, Math.floor(sourceGray * 255 / (255 - inverted)));
    output[index] = dodge;
    output[index + 1] = dodge;
    output[index + 2] = dodge;
    output[index + 3] = source[index + 3];
    reportPixels(index, source.length, 0.8, 1);
  }
  return output;
}

const WINDOWS_16_PALETTE = [
  [0, 0, 0], [128, 0, 0], [0, 128, 0], [128, 128, 0],
  [0, 0, 128], [128, 0, 128], [0, 128, 128], [192, 192, 192],
  [128, 128, 128], [255, 0, 0], [0, 255, 0], [255, 255, 0],
  [0, 0, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255],
];

const DIFFUSION_MATRICES = [
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

function currentDitherPalette(parameters: EffectParameters) {
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

function presetDitherPalette(choice: number, parameters: EffectParameters) {
  if (choice === 0) return [[0, 0, 0], [255, 255, 255]];
  if (choice === 1) return currentDitherPalette(parameters);
  if (choice === 3) return [
    ...WINDOWS_16_PALETTE,
    [255, 251, 240], [192, 220, 192], [166, 202, 240], [160, 160, 164],
  ];
  return WINDOWS_16_PALETTE;
}

function nearestDitherColor(red: number, green: number, blue: number, paletteChoice: number, palette: number[][]) {
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

function processDithering(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
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
  const palette = paletteSource === 0 ? presetDitherPalette(paletteChoice, parameters) : currentDitherPalette(parameters);
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

function processAlignObject(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
  const bounds = warpBounds(parameters, width, height);
  const left = Math.max(0, Math.floor(bounds.x));
  const top = Math.max(0, Math.floor(bounds.y));
  const right = Math.min(width, Math.ceil(bounds.x + bounds.width));
  const bottom = Math.min(height, Math.ceil(bounds.y + bounds.height));
  const backgroundIndex = (top * width + left) * 4;
  const background = [source[backgroundIndex], source[backgroundIndex + 1], source[backgroundIndex + 2], source[backgroundIndex + 3]];
  let objectLeft = right;
  let objectTop = bottom;
  let objectRight = left - 1;
  let objectBottom = top - 1;
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const index = (y * width + x) * 4;
      if (source[index] === background[0] && source[index + 1] === background[1] && source[index + 2] === background[2] && source[index + 3] === background[3]) continue;
      objectLeft = Math.min(objectLeft, x);
      objectTop = Math.min(objectTop, y);
      objectRight = Math.max(objectRight, x);
      objectBottom = Math.max(objectBottom, y);
    }
    reportLoop(y - top + 1, bottom - top, 0, 0.3);
  }
  const output = new Uint8ClampedArray(source);
  if (objectRight < objectLeft || objectBottom < objectTop) return output;
  const objectWidth = objectRight - objectLeft + 1;
  const objectHeight = objectBottom - objectTop + 1;
  const position = Math.max(0, Math.min(8, Math.round(value(parameters, 'position', 4))));
  const column = position % 3;
  const row = Math.floor(position / 3);
  const targetX = column === 0 ? left : column === 1 ? left + Math.floor((right - left - objectWidth) / 2) : right - objectWidth;
  const targetY = row === 0 ? top : row === 1 ? top + Math.floor((bottom - top - objectHeight) / 2) : bottom - objectHeight;
  const objectPixels = new Uint8ClampedArray(objectWidth * objectHeight * 4);
  for (let y = 0; y < objectHeight; y += 1) {
    const start = ((objectTop + y) * width + objectLeft) * 4;
    objectPixels.set(source.subarray(start, start + objectWidth * 4), y * objectWidth * 4);
    reportLoop(y + 1, objectHeight, 0.3, 0.45);
  }
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const destination = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) output[destination + channel] = background[channel];
    }
    reportLoop(y - top + 1, bottom - top, 0.45, 0.75);
  }
  for (let y = 0; y < objectHeight; y += 1) {
    const destination = ((targetY + y) * width + targetX) * 4;
    output.set(objectPixels.subarray(y * objectWidth * 4, (y + 1) * objectWidth * 4), destination);
    reportLoop(y + 1, objectHeight, 0.75, 1);
  }
  return output;
}

function collectObjectBorders(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  parameters: EffectParameters,
  tolerance: number,
  includeCanvasEdge: boolean,
  includeDiagonals: boolean,
) {
  const bounds = warpBounds(parameters, width, height);
  const left = Math.max(0, Math.floor(bounds.x));
  const top = Math.max(0, Math.floor(bounds.y));
  const right = Math.min(width, Math.ceil(bounds.x + bounds.width));
  const bottom = Math.min(height, Math.ceil(bounds.y + bounds.height));
  const rows = Array.from({ length: height }, () => [] as number[]);
  const offsets = includeDiagonals
    ? [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]
    : [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      if (includeCanvasEdge && (x === 0 || x === width - 1 || y === 0 || y === height - 1)) {
        rows[y].push(x);
        continue;
      }
      const index = (y * width + x) * 4;
      if (source[index + 3] > tolerance) continue;
      for (const [offsetX, offsetY] of offsets) {
        const neighborX = x + offsetX;
        const neighborY = y + offsetY;
        if (neighborX < 0 || neighborX >= width || neighborY < 0 || neighborY >= height) continue;
        if (source[(neighborY * width + neighborX) * 4 + 3] <= tolerance) continue;
        rows[y].push(x);
        break;
      }
    }
    reportLoop(y - top + 1, bottom - top);
  }
  return { rows, left, top, right, bottom };
}

function nearestObjectBorder(x: number, y: number, borderRows: number[][], radius: number) {
  let shortest = Number.POSITIVE_INFINITY;
  const top = Math.max(0, Math.floor(y - radius + 1));
  const bottom = Math.min(borderRows.length - 1, Math.ceil(y + radius - 1));
  for (let borderY = top; borderY <= bottom; borderY += 1) {
    const dy = borderY - y;
    for (const borderX of borderRows[borderY]) {
      const dx = borderX - x;
      if (Math.abs(dx) >= radius) continue;
      const distance = Math.hypot(dx, dy);
      if (distance <= radius && distance < shortest) shortest = distance;
    }
  }
  return shortest;
}

function processFeatherObject(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
  const radius = Math.max(1, Math.min(100, Math.round(value(parameters, 'radius', 6))));
  const tolerance = Math.max(0, Math.min(255, Math.round(value(parameters, 'tolerance', 20))));
  const borders = withProgressRange(0, 0.35, () => collectObjectBorders(source, width, height, parameters, tolerance, value(parameters, 'featherCanvasEdge', 0) !== 0, false));
  const output = new Uint8ClampedArray(source);
  for (let y = borders.top; y < borders.bottom; y += 1) {
    for (let x = borders.left; x < borders.right; x += 1) {
      const index = (y * width + x) * 4;
      if (source[index + 3] === 0) continue;
      const distance = nearestObjectBorder(x, y, borders.rows, radius);
      if (!Number.isFinite(distance)) continue;
      output[index + 3] = Math.min(source[index + 3], Math.floor(source[index + 3] * distance / radius));
    }
    reportLoop(y - borders.top + 1, borders.bottom - borders.top, 0.35, 1);
  }
  return output;
}

function normalBlendPixel(output: Uint8ClampedArray, index: number, color: RenderColor) {
  const topAlpha = color[3] / 255;
  if (topAlpha <= 0) return;
  const bottomAlpha = output[index + 3] / 255;
  const finalAlpha = topAlpha + bottomAlpha * (1 - topAlpha);
  for (let channel = 0; channel < 3; channel += 1) {
    output[index + channel] = finalAlpha === 0 ? 0 : clampByte((color[channel] * topAlpha + output[index + channel] * bottomAlpha * (1 - topAlpha)) / finalAlpha);
  }
  output[index + 3] = clampByte(finalAlpha * 255);
}

function processOutlineObject(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
  const radiusValue = Math.max(0, Math.min(100, Math.round(value(parameters, 'radius', 6))));
  const radius = Math.max(1, radiusValue);
  const tolerance = Math.max(0, Math.min(255, Math.round(value(parameters, 'tolerance', 20))));
  const borders = withProgressRange(0, 0.35, () => collectObjectBorders(source, width, height, parameters, tolerance, value(parameters, 'outlineBorder', 0) !== 0, radiusValue === 1));
  const output = new Uint8ClampedArray(source);
  const primary: RenderColor = [value(parameters, '__primaryR', 0), value(parameters, '__primaryG', 0), value(parameters, '__primaryB', 0), 255];
  const secondary: RenderColor = [value(parameters, '__secondaryR', 255), value(parameters, '__secondaryG', 255), value(parameters, '__secondaryB', 255), 255];
  for (let y = borders.top; y < borders.bottom; y += 1) {
    for (let x = borders.left; x < borders.right; x += 1) {
      const index = (y * width + x) * 4;
      if (source[index + 3] === 255) continue;
      let outlineAlpha = value(parameters, 'fillObjectBackground', 1) !== 0 && source[index + 3] >= tolerance ? 255 : 0;
      const distance = nearestObjectBorder(x, y, borders.rows, radius);
      if (Number.isFinite(distance)) outlineAlpha = Math.max(outlineAlpha, distance === 0 ? 255 : Math.floor(255 * (1 - distance / radius)));
      if (value(parameters, 'alphaGradient', 1) === 0 && outlineAlpha !== 0) outlineAlpha = 255;
      if (outlineAlpha === 0) continue;
      const progress = value(parameters, 'colorGradient', 1) !== 0 ? outlineAlpha / 255 : 1;
      const color: RenderColor = [
        clampByte(secondary[0] + (primary[0] - secondary[0]) * progress),
        clampByte(secondary[1] + (primary[1] - secondary[1]) * progress),
        clampByte(secondary[2] + (primary[2] - secondary[2]) * progress),
        outlineAlpha,
      ];
      normalBlendPixel(output, index, color);
    }
    reportLoop(y - borders.top + 1, borders.bottom - borders.top, 0.35, 1);
  }
  return output;
}

function processRedEyeRemoval(data: Uint8ClampedArray, parameters: EffectParameters) {
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

function fastMultiplyByte(first: number, second: number) {
  const product = first * second + 0x80;
  return ((product >> 8) + product) >> 8;
}

function overlayChannel(foreground: number, background: number) {
  return foreground < 128
    ? fastMultiplyByte(2 * foreground, background)
    : 255 - fastMultiplyByte(2 * (255 - foreground), 255 - background);
}

function processSoftenPortrait(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
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

function processVignette(data: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
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

function directionalWeights(angleValue: number, centerWeight: number) {
  const angle = angleValue * Math.PI / 180;
  const delta = Math.PI / 4;
  return [
    Math.cos(angle + delta), Math.cos(angle + 2 * delta), Math.cos(angle + 3 * delta),
    Math.cos(angle), centerWeight, Math.cos(angle + 4 * delta),
    Math.cos(angle - delta), Math.cos(angle - 2 * delta), Math.cos(angle - 3 * delta),
  ];
}

function processDirectionalDifference(
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

function createSeededRandom(seedValue: number) {
  let state = Math.max(1, Math.trunc(seedValue)) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function processChromaticAberration(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
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

function processScanlines(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
  const output = new Uint8ClampedArray(source);
  const strength = Math.max(0, Math.min(1, value(parameters, 'strength', 38) / 100));
  const scanlines = value(parameters, 'scanlines', 1) !== 0;
  const phosphors = [value(parameters, 'red', 1), value(parameters, 'green', 1), value(parameters, 'blue', 1)];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const lineFactor = scanlines && y % 2 === 1 ? 1 - strength : 1;
      for (let channel = 0; channel < 3; channel += 1) {
        const phosphorFactor = phosphors[channel] && x % 3 !== channel ? 1 - strength * 0.38 : 1;
        output[index + channel] = clampByte(source[index + channel] * lineFactor * phosphorFactor);
      }
    }
    reportLoop(y + 1, height);
  }
  return output;
}

function processColoredArtifacts(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
  const output = new Uint8ClampedArray(source);
  const random = createSeededRandom(value(parameters, 'seed', 0));
  const count = Math.max(1, Math.min(2048, Math.round(value(parameters, 'count', 128))));
  const firstAlpha = Math.max(0, Math.min(255, value(parameters, 'minAlpha', 64)));
  const secondAlpha = Math.max(0, Math.min(255, value(parameters, 'maxAlpha', 255)));
  const minAlpha = Math.min(firstAlpha, secondAlpha) / 255;
  const maxAlpha = Math.max(firstAlpha, secondAlpha) / 255;
  const firstWidth = Math.max(0, Math.min(1, value(parameters, 'minWidth', 0.2)));
  const secondWidth = Math.max(0, Math.min(1, value(parameters, 'maxWidth', 0.5)));
  const minWidth = Math.min(firstWidth, secondWidth);
  const maxWidth = Math.max(firstWidth, secondWidth);
  const firstHeight = Math.max(0, Math.min(1, value(parameters, 'minHeight', 0.2)));
  const secondHeight = Math.max(0, Math.min(1, value(parameters, 'maxHeight', 0.5)));
  const minHeight = Math.min(firstHeight, secondHeight);
  const maxHeight = Math.max(firstHeight, secondHeight);
  for (let artifact = 0; artifact < count; artifact += 1) {
    const artifactWidth = Math.max(1, Math.round(width * (minWidth + random() * (maxWidth - minWidth))));
    const artifactHeight = Math.max(1, Math.round(height * (minHeight + random() * (maxHeight - minHeight))));
    const startX = Math.floor(random() * width);
    const startY = Math.floor(random() * height);
    const color = [Math.floor(random() * 256), Math.floor(random() * 256), Math.floor(random() * 256)];
    const alpha = minAlpha + random() * (maxAlpha - minAlpha);
    for (let y = startY; y < Math.min(height, startY + artifactHeight); y += 1) {
      for (let x = startX; x < Math.min(width, startX + artifactWidth); x += 1) {
        const index = (y * width + x) * 4;
        for (let channel = 0; channel < 3; channel += 1) output[index + channel] = clampByte(output[index + channel] * (1 - alpha) + color[channel] * alpha);
      }
    }
    reportLoop(artifact + 1, count);
  }
  return output;
}

function processPixelDrag(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
  const output = new Uint8ClampedArray(source);
  const random = createSeededRandom(value(parameters, 'seed', 0));
  const count = Math.max(0, Math.min(4096, Math.round(value(parameters, 'count', 512))));
  const vertical = value(parameters, 'direction', 0) === 1;
  const extent = vertical ? height : width;
  const minLength = Math.max(0, extent * Math.min(value(parameters, 'minLength', 0.01), value(parameters, 'maxLength', 0.01)));
  const maxLength = Math.max(minLength, extent * Math.max(value(parameters, 'minLength', 0.01), value(parameters, 'maxLength', 0.01)));
  for (let drag = 0; drag < count; drag += 1) {
    const startX = Math.floor(random() * width);
    const startY = Math.floor(random() * height);
    const length = Math.max(1, Math.round(minLength + random() * (maxLength - minLength)));
    const sample = (startY * width + startX) * 4;
    for (let offset = 0; offset < length; offset += 1) {
      const x = vertical ? startX : (startX + offset) % width;
      const y = vertical ? ((startY - offset) % height + height) % height : startY;
      const destination = (y * width + x) * 4;
      output.set(source.subarray(sample, sample + 4), destination);
    }
    reportLoop(drag + 1, count);
  }
  return output;
}

function processRowSlice(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
  const output = new Uint8ClampedArray(source.length);
  const random = createSeededRandom(value(parameters, 'seed', 0));
  const slices = Math.max(1, Math.min(128, Math.round(value(parameters, 'slices', 32))));
  const sliceHeight = height / slices;
  const left = width * Math.max(0, value(parameters, 'leftShift', 0.5)) / 2;
  const right = width * Math.max(0, value(parameters, 'rightShift', 0.5)) / 2;
  const shifts = Array.from({ length: slices }, () => Math.round(-left + random() * (left + right)));
  for (let y = 0; y < height; y += 1) {
    const shift = shifts[Math.min(slices - 1, Math.floor(y / sliceHeight))];
    for (let x = 0; x < width; x += 1) {
      const sampleX = ((x - shift) % width + width) % width;
      const destination = (y * width + x) * 4;
      const sample = (y * width + sampleX) * 4;
      output.set(source.subarray(sample, sample + 4), destination);
    }
    reportLoop(y + 1, height);
  }
  return output;
}

function processAdjustmentNoise(data: Uint8ClampedArray, parameters: EffectParameters) {
  const random = createSeededRandom(value(parameters, 'seed', 0));
  const intensity = Math.max(1, Math.min(64, value(parameters, 'intensity', 16)));
  for (let index = 0; index < data.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) data[index + channel] = clampByte(data[index + channel] + (random() * 2 - 1) * intensity);
    reportPixels(index, data.length);
  }
}

function processColoredGrayscale(data: Uint8ClampedArray, parameters: EffectParameters) {
  const tint = [value(parameters, '__primaryR', 0), value(parameters, '__primaryG', 0), value(parameters, '__primaryB', 0)];
  for (let index = 0; index < data.length; index += 4) {
    const gray = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
    for (let channel = 0; channel < 3; channel += 1) data[index + channel] = clampByte(gray * tint[channel] / 255);
    reportPixels(index, data.length);
  }
}

interface HexCell {
  key: string;
  centerX: number;
  centerY: number;
  distanceSquared: number;
  nextDistanceSquared: number;
  neighborDistance: number;
}

function nearestHexCell(x: number, y: number, radius: number, offsetX: number, offsetY: number): HexCell {
  const spacingX = Math.sqrt(3) * radius;
  const spacingY = 1.5 * radius;
  const rowGuess = Math.round((y - offsetY) / spacingY);
  let nearest: HexCell | null = null;
  let nextDistanceSquared = Number.POSITIVE_INFINITY;
  for (let row = rowGuess - 2; row <= rowGuess + 2; row += 1) {
    const rowOffset = Math.abs(row % 2) === 1 ? spacingX / 2 : 0;
    const columnGuess = Math.round((x - offsetX - rowOffset) / spacingX);
    for (let column = columnGuess - 2; column <= columnGuess + 2; column += 1) {
      const centerX = offsetX + rowOffset + column * spacingX;
      const centerY = offsetY + row * spacingY;
      const distanceSquared = (x - centerX) ** 2 + (y - centerY) ** 2;
      if (!nearest || distanceSquared < nearest.distanceSquared) {
        if (nearest) nextDistanceSquared = nearest.distanceSquared;
        nearest = { key: `${row}:${column}`, centerX, centerY, distanceSquared, nextDistanceSquared: 0, neighborDistance: 0 };
      } else if (distanceSquared < nextDistanceSquared) nextDistanceSquared = distanceSquared;
    }
  }
  const result = nearest!;
  result.nextDistanceSquared = nextDistanceSquared;
  result.neighborDistance = Math.sqrt(3) * radius;
  return result;
}

function processHexagonPixelate(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
  const radius = Math.max(5, Math.min(200, value(parameters, 'radius', 20)));
  const offsetX = value(parameters, 'offsetX', 0) * width / 2;
  const offsetY = value(parameters, 'offsetY', 0) * height / 2;
  const sampleCenter = value(parameters, 'sampleMode', 0) === 1;
  const borderWidth = Math.max(0, Math.min(50, value(parameters, 'borderWidth', 0)));
  const borderColor = Math.max(0, Math.min(0xffffff, Math.round(value(parameters, 'borderColor', 0))));
  const border = [(borderColor >> 16) & 255, (borderColor >> 8) & 255, borderColor & 255, 255];
  const assignments = new Array<HexCell>(width * height);
  const totals = new Map<string, number[]>();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cell = nearestHexCell(x, y, radius, offsetX, offsetY);
      assignments[y * width + x] = cell;
      if (sampleCenter) continue;
      const pixel = (y * width + x) * 4;
      const total = totals.get(cell.key) ?? [0, 0, 0, 0, 0];
      for (let channel = 0; channel < 4; channel += 1) total[channel] += source[pixel + channel];
      total[4] += 1;
      totals.set(cell.key, total);
    }
    reportLoop(y + 1, height, 0, 0.5);
  }
  const output = new Uint8ClampedArray(source.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cell = assignments[y * width + x];
      const destination = (y * width + x) * 4;
      const boundaryDistance = (cell.nextDistanceSquared - cell.distanceSquared) / (2 * cell.neighborDistance);
      if (borderWidth > 0 && boundaryDistance <= borderWidth) {
        output.set(border, destination);
      } else if (sampleCenter) {
        const centerX = Math.max(0, Math.min(width - 1, Math.round(cell.centerX)));
        const centerY = Math.max(0, Math.min(height - 1, Math.round(cell.centerY)));
        const sample = (centerY * width + centerX) * 4;
        output.set(source.subarray(sample, sample + 4), destination);
      } else {
        const total = totals.get(cell.key)!;
        for (let channel = 0; channel < 4; channel += 1) output[destination + channel] = clampByte(total[channel] / total[4]);
      }
    }
    reportLoop(y + 1, height, 0.5, 1);
  }
  return output;
}

function processNightVision(data: Uint8ClampedArray, parameters: EffectParameters) {
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

export function processEffect(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  effect: EffectId,
  parameters: EffectParameters,
  onProgress?: EffectProgressReporter,
) {
  activeProgressReporter = onProgress;
  progressRangeStart = 0;
  progressRangeEnd = 1;
  lastReportedProgress = -1;
  reportProgress(0, true);
  try {
  const output = new Uint8ClampedArray(source);
  if (effect === 'auto-level') {
    processAutoLevel(output);
  } else if (effect === 'black-white') {
    for (let index = 0; index < output.length; index += 4) {
      const gray = clampByte(output[index] * 0.299 + output[index + 1] * 0.587 + output[index + 2] * 0.114);
      output[index] = gray;
      output[index + 1] = gray;
      output[index + 2] = gray;
      reportPixels(index, output.length);
    }
  } else if (effect === 'brightness-contrast') {
    applyBrightnessContrast(output, value(parameters, 'brightness', 0), value(parameters, 'contrast', 0));
  } else if (effect === 'curves') {
    processCurves(output, parameters);
  } else if (effect === 'hue-saturation') {
    processHueSaturation(output, parameters);
  } else if (effect === 'invert') {
    for (let index = 0; index < output.length; index += 4) {
      output[index] = 255 - output[index];
      output[index + 1] = 255 - output[index + 1];
      output[index + 2] = 255 - output[index + 2];
      reportPixels(index, output.length);
    }
  } else if (effect === 'levels') {
    processLevels(output, parameters);
  } else if (effect === 'posterize') {
    const levels = [value(parameters, 'red', 16), value(parameters, 'green', 16), value(parameters, 'blue', 16)];
    for (let index = 0; index < output.length; index += 4) {
      for (let channel = 0; channel < 3; channel += 1) {
        const levelCount = Math.max(2, Math.round(levels[channel]));
        output[index + channel] = clampByte(Math.round((output[index + channel] / 255) * (levelCount - 1)) * (255 / (levelCount - 1)));
      }
      reportPixels(index, output.length);
    }
  } else if (effect === 'sepia') {
    const strength = value(parameters, 'strength', 100) / 100;
    for (let index = 0; index < output.length; index += 4) {
      const red = output[index];
      const green = output[index + 1];
      const blue = output[index + 2];
      const luminance = clampByte(red * 0.299 + green * 0.587 + blue * 0.114);
      output[index] = clampByte(red + (Math.min(255, luminance * 1.2) - red) * strength);
      output[index + 1] = clampByte(green + (luminance - green) * strength);
      output[index + 2] = clampByte(blue + (luminance * 0.8 - blue) * strength);
      reportPixels(index, output.length);
    }
  } else if (effect === 'fragment') {
    return processFragment(source, width, height, parameters);
  } else if (effect === 'gaussian-blur') {
    return gaussianBlur(source, width, height, value(parameters, 'radius', 2));
  } else if (effect === 'motion-blur') {
    return processMotionBlur(source, width, height, parameters);
  } else if (effect === 'radial-blur') {
    return processRadialBlur(source, width, height, parameters);
  } else if (effect === 'unfocus') {
    return boxBlur(source, width, height, value(parameters, 'radius', 4));
  } else if (effect === 'zoom-blur') {
    return processZoomBlur(source, width, height, parameters);
  } else if (effect === 'bulge') {
    return processBulge(source, width, height, parameters);
  } else if (effect === 'dents') {
    return processDents(source, width, height, parameters);
  } else if (effect === 'frosted-glass') {
    return processFrostedGlass(source, width, height, parameters);
  } else if (effect === 'pixelate') {
    return processPixelate(source, width, height, value(parameters, 'cellSize', 2));
  } else if (effect === 'polar-inversion') {
    return processPolarInversion(source, width, height, parameters);
  } else if (effect === 'tile-reflection') {
    return processTileReflection(source, width, height, parameters);
  } else if (effect === 'twist') {
    return processTwist(source, width, height, parameters);
  } else if (effect === 'add-noise') {
    processNoise(output, parameters);
  } else if (effect === 'median') {
    return processLocalHistogram(source, width, height, parameters, 'median');
  } else if (effect === 'reduce-noise') {
    return processLocalHistogram(source, width, height, parameters, 'reduce-noise');
  } else if (effect === 'ink-sketch') {
    return processInkSketch(source, width, height, parameters);
  } else if (effect === 'oil-painting') {
    return processOilPainting(source, width, height, parameters);
  } else if (effect === 'pencil-sketch') {
    return processPencilSketch(source, width, height, parameters);
  } else if (effect === 'dithering') {
    return processDithering(source, width, height, parameters);
  } else if (effect === 'cells') {
    return processCells(source, width, height, parameters);
  } else if (effect === 'clouds') {
    return processClouds(source, width, height, parameters);
  } else if (effect === 'julia-fractal') {
    return processFractal(source, width, height, parameters, 'julia');
  } else if (effect === 'mandelbrot-fractal') {
    return processFractal(source, width, height, parameters, 'mandelbrot');
  } else if (effect === 'voronoi-diagram') {
    return processVoronoi(source, width, height, parameters);
  } else if (effect === 'align-object') {
    return processAlignObject(source, width, height, parameters);
  } else if (effect === 'feather-object') {
    return processFeatherObject(source, width, height, parameters);
  } else if (effect === 'outline-object') {
    return processOutlineObject(source, width, height, parameters);
  } else if (effect === 'glow') {
    return processGlow(source, width, height, parameters);
  } else if (effect === 'red-eye-removal') {
    processRedEyeRemoval(output, parameters);
  } else if (effect === 'sharpen') {
    const amount = value(parameters, 'amount', 2);
    return convolve(source, width, height, [0, -amount, 0, -amount, 1 + amount * 4, -amount, 0, -amount, 0]);
  } else if (effect === 'soften-portrait') {
    return processSoftenPortrait(source, width, height, parameters);
  } else if (effect === 'vignette') {
    processVignette(output, width, height, parameters);
  } else if (effect === 'edge-detect') {
    return processDirectionalDifference(source, width, height, value(parameters, 'angle', 45), 0, false);
  } else if (effect === 'emboss') {
    return processDirectionalDifference(source, width, height, value(parameters, 'angle', 0), 0, true);
  } else if (effect === 'outline-edge') {
    return processLocalHistogram(source, width, height, parameters, 'outline-edge');
  } else if (effect === 'relief') {
    return processDirectionalDifference(source, width, height, value(parameters, 'angle', 45), 1, false);
  } else if (effect === 'chromatic-aberration') {
    return processChromaticAberration(source, width, height, parameters);
  } else if (effect === 'scanlines') {
    return processScanlines(source, width, height, parameters);
  } else if (effect === 'colored-artifacts') {
    return processColoredArtifacts(source, width, height, parameters);
  } else if (effect === 'pixel-drag') {
    return processPixelDrag(source, width, height, parameters);
  } else if (effect === 'row-slice') {
    return processRowSlice(source, width, height, parameters);
  } else if (effect === 'adjustment-noise') {
    processAdjustmentNoise(output, parameters);
  } else if (effect === 'colored-grayscale') {
    processColoredGrayscale(output, parameters);
  } else if (effect === 'hexagon-pixelate') {
    return processHexagonPixelate(source, width, height, parameters);
  } else if (effect === 'night-vision') {
    processNightVision(output, parameters);
  }
  return output;
  } finally {
    reportProgress(1, true);
    activeProgressReporter = undefined;
    progressRangeStart = 0;
    progressRangeEnd = 1;
  }
}
