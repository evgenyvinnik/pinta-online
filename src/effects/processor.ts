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

function roundAwayFromZero(valueToRound: number) {
  return valueToRound < 0 ? -Math.round(-valueToRound) : Math.round(valueToRound);
}

function addPremultipliedPixel(source: Uint8ClampedArray, index: number, totals: number[]) {
  const alpha = source[index + 3];
  totals[0] += premultiplyChannel(source[index], alpha);
  totals[1] += premultiplyChannel(source[index + 1], alpha);
  totals[2] += premultiplyChannel(source[index + 2], alpha);
  totals[3] += alpha;
}

function writeNativePremultipliedBlend(output: Uint8ClampedArray, index: number, totals: number[], count: number) {
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
function nativeBilinearSample(
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

function nativeBilinearSampleWrapped(
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

function nativeReflectedCoordinate(coordinate: number, size: number) {
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

function nativeWarpSample(
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

function processFragment(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
  const fragments = Math.max(2, Math.min(50, Math.round(value(parameters, 'fragments', 4))));
  const distance = Math.max(0, Math.min(100, Math.round(value(parameters, 'distance', 8))));
  if (distance === 0) return new Uint8ClampedArray(source);
  const rotation = value(parameters, 'rotation', 0) * Math.PI / 180 - Math.PI / 2;
  const offsets = Array.from({ length: fragments }, (_, index) => {
    const angle = rotation + Math.PI * 2 * index / fragments;
    return { x: roundAwayFromZero(-Math.sin(angle) * distance), y: roundAwayFromZero(-Math.cos(angle) * distance) };
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
        addPremultipliedPixel(source, sample, totals);
        count += 1;
      }
      const destination = (y * width + x) * 4;
      writeNativePremultipliedBlend(output, destination, totals, count);
    }
    reportLoop(y + 1, height);
  }
  return output;
}

function processMotionBlur(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
  const angle = (value(parameters, 'angle', 25) + 180) * Math.PI / 180;
  const distance = Math.max(0, Math.min(200, Math.round(value(parameters, 'distance', 10))));
  const centered = value(parameters, 'centered', 1) !== 0;
  const vectorX = distance * Math.cos(angle);
  const vectorY = -distance * Math.sin(angle);
  const startX = centered ? -vectorX / 2 : 0;
  const startY = centered ? -vectorY / 2 : 0;
  const endX = centered ? vectorX / 2 : vectorX;
  const endY = centered ? vectorY / 2 : vectorY;
  const sampleCount = Math.trunc((1 + distance) * 3 / 2);
  const points = Array.from({ length: sampleCount }, (_, index) => {
    if (sampleCount === 1) return { x: 0, y: 0 };
    const fraction = Math.fround(index / (sampleCount - 1));
    return {
      x: startX + fraction * (endX - startX),
      y: startY + fraction * (endY - startY),
    };
  });
  const output = new Uint8ClampedArray(source.length);
  const bilinear = [0, 0, 0, 0];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const totals = [0, 0, 0, 0];
      let count = 0;
      for (const point of points) {
        const sampleX = point.x + x;
        const sampleY = point.y + y;
        if (sampleX < 0 || sampleY < 0 || sampleX > width - 1 || sampleY > height - 1) continue;
        if (!nativeBilinearSample(source, width, height, sampleX, sampleY, bilinear)) continue;
        for (let channel = 0; channel < 4; channel += 1) totals[channel] += bilinear[channel];
        count += 1;
      }
      const destination = (y * width + x) * 4;
      writeNativePremultipliedBlend(output, destination, totals, count);
    }
    reportLoop(y + 1, height);
  }
  return output;
}

function processRadialBlur(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
  const angle = value(parameters, 'angle', 2);
  if (angle === 0) return new Uint8ClampedArray(source);
  const quality = Math.max(1, Math.min(5, Math.round(value(parameters, 'quality', 2))));
  const widthCenter = width << 15;
  const heightCenter = height << 15;
  const fixedCenterX = (widthCenter + Math.trunc(value(parameters, 'offsetX', 0) * widthCenter)) | 0;
  const fixedCenterY = (heightCenter + Math.trunc(value(parameters, 'offsetY', 0) * heightCenter)) | 0;
  const sampleCount = quality * quality * (30 + quality * quality);
  const rotation = Math.trunc(angle * Math.PI * 65536 / 181) | 0;
  const sampleRotation = Math.trunc(rotation / sampleCount) | 0;
  const rotate = (pointX: number, pointY: number, rotationStep: number) => {
    const squaredRotation = Math.imul(rotationStep, rotationStep) >> 11;
    return {
      x: (pointX - (Math.imul(pointY >> 8, rotationStep) >> 8) - (Math.imul(pointX >> 14, squaredRotation) >> 8)) | 0,
      y: (pointY + (Math.imul(pointX >> 8, rotationStep) >> 8) - (Math.imul(pointY >> 14, squaredRotation) >> 8)) | 0,
    };
  };
  const output = new Uint8ClampedArray(source.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const totals = [0, 0, 0, 0];
      const destination = (y * width + x) * 4;
      addPremultipliedPixel(source, destination, totals);
      let count = 1;
      const fixed = { x: ((x << 16) - fixedCenterX) | 0, y: ((y << 16) - fixedCenterY) | 0 };
      let clockwise = fixed;
      let counterClockwise = fixed;
      for (let sample = 0; sample < sampleCount; sample += 1) {
        clockwise = rotate(clockwise.x, clockwise.y, sampleRotation);
        counterClockwise = rotate(counterClockwise.x, counterClockwise.y, -sampleRotation);
        for (const point of [clockwise, counterClockwise]) {
          const sampleX = (((point.x + fixedCenterX + 32768) | 0) >> 16);
          const sampleY = (((point.y + fixedCenterY + 32768) | 0) >> 16);
          if (sampleX <= 0 || sampleY <= 0 || sampleX >= width || sampleY >= height) continue;
          addPremultipliedPixel(source, (sampleY * width + sampleX) * 4, totals);
          count += 1;
        }
      }
      writeNativePremultipliedBlend(output, destination, totals, count);
    }
    reportLoop(y + 1, height);
  }
  return output;
}


function processZoomBlur(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
  const amount = Math.max(0, Math.min(100, Math.round(value(parameters, 'amount', 10))));
  if (!amount) return new Uint8ClampedArray(source);
  const centerX = Math.trunc(width * value(parameters, 'offsetX', 0) * 32768) + width * 32768;
  const centerY = Math.trunc(height * value(parameters, 'offsetY', 0) * 32768) + height * 32768;
  const output = new Uint8ClampedArray(source.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const totals = [0, 0, 0, 0];
      const destination = (y * width + x) * 4;
      addPremultipliedPixel(source, destination, totals);
      let count = 1;
      let fixedX = x * 65536 - centerX;
      let fixedY = y * 65536 - centerY;
      for (let sample = 0; sample < 64; sample += 1) {
        fixedX -= Math.floor(Math.floor(fixedX / 16) * amount / 1024);
        fixedY -= Math.floor(Math.floor(fixedY / 16) * amount / 1024);
        const sampleX = Math.floor((fixedX + centerX + 32768) / 65536);
        const sampleY = Math.floor((fixedY + centerY + 32768) / 65536);
        if (sampleX < 0 || sampleY < 0 || sampleX >= width || sampleY >= height) continue;
        addPremultipliedPixel(source, (sampleY * width + sampleX) * 4, totals);
        count += 1;
      }
      writeNativePremultipliedBlend(output, destination, totals, count);
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

function processBulge(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
  const amountValue = Math.round(value(parameters, 'amount', 45));
  if (amountValue === 0) return new Uint8ClampedArray(source);
  const halfWidthBasis = Math.fround(width / 2);
  const halfHeightBasis = Math.fround(height / 2);
  const halfWidth = Math.fround(halfWidthBasis + Math.fround(Math.fround(value(parameters, 'offsetX', 0)) * halfWidthBasis));
  const halfHeight = Math.fround(halfHeightBasis + Math.fround(Math.fround(value(parameters, 'offsetY', 0)) * halfHeightBasis));
  const maximumRadius = Math.fround(Math.fround(Math.min(halfWidthBasis, halfHeightBasis)
    * Math.round(value(parameters, 'radiusPercentage', 100))) / 100);
  const amount = Math.fround(amountValue / 100);
  const output = new Uint8ClampedArray(source.length);
  const sample = [0, 0, 0, 0];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const destination = (y * width + x) * 4;
      const relativeX = Math.fround(x - halfWidth);
      const relativeY = Math.fround(y - halfHeight);
      const magnitudeSquared = Math.fround(
        Math.fround(relativeX * relativeX) + Math.fround(relativeY * relativeY),
      );
      const radialScale = Math.fround(1 - Math.fround(Math.fround(Math.sqrt(magnitudeSquared)) / maximumRadius));
      if (radialScale <= 0) {
        const totals = [0, 0, 0, 0];
        addPremultipliedPixel(source, destination, totals);
        writeNativePremultipliedBlend(output, destination, totals, 1);
        continue;
      }
      const scale = Math.fround(1 - Math.fround(Math.fround(amount * radialScale) * radialScale));
      sample.fill(0);
      nativeBilinearSample(
        source,
        width,
        height,
        Math.max(0, Math.min(width - 1, Math.fround(Math.fround(relativeX * scale) + halfWidth))),
        Math.max(0, Math.min(height - 1, Math.fround(Math.fround(relativeY * scale) + halfHeight))),
        sample,
      );
      writeNativePremultipliedBlend(output, destination, sample, 1);
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

function dotNetRandom(seedValue: number) {
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
    const random = dotNetRandom(value(parameters, 'colorSchemeSeed', 0));
    const randomColor = (): RenderColor => {
      const bytes = random.nextBytes(4);
      return [bytes[2], bytes[1], bytes[0], 255];
    };
    const startColor = randomColor();
    const endColor = randomColor();
    const stopCount = random.nextInt(0, 5);
    stops = [{ offset: 0, color: startColor }];
    for (let index = 0; index < stopCount; index += 1) {
      stops.push({
        offset: (index + 1) / (stopCount + 1),
        color: randomColor(),
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
  // ColorGradient<ColorBgra> interpolates the bytes already stored in Cairo's
  // premultiplied representation. Consumers aggregate these bytes directly and
  // only convert back to straight alpha at the browser ImageData boundary.
  const amount = Math.max(0, Math.min(1, amountValue));
  let rightIndex = stops.findIndex((stop) => stop.offset >= amount);
  if (rightIndex <= 0) return [...stops[Math.max(0, rightIndex)].color] as RenderColor;
  if (rightIndex < 0) rightIndex = stops.length - 1;
  const left = stops[rightIndex - 1];
  const right = stops[rightIndex];
  const span = right.offset - left.offset;
  const progress = span <= 0 ? 0 : (amount - left.offset) / span;
  return left.color.map((channel, index) => clampTruncatedByte(channel + (right.color[index] - channel) * progress)) as RenderColor;
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
      output[destination] = straightFromPremultiplied(color[0], color[3]);
      output[destination + 1] = straightFromPremultiplied(color[1], color[3]);
      output[destination + 2] = straightFromPremultiplied(color[2], color[3]);
      output[destination + 3] = color[3];
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
        totals[0] += color[0];
        totals[1] += color[1];
        totals[2] += color[2];
        totals[3] += color[3];
      }
      const destination = (y * width + x) * 4;
      const alpha = clampTruncatedByte(totals[3] / count);
      const red = clampTruncatedByte(totals[0] / count);
      const green = clampTruncatedByte(totals[1] / count);
      const blue = clampTruncatedByte(totals[2] / count);
      const invert = kind === 'mandelbrot' && value(parameters, 'invertColors', 0) !== 0;
      output[destination] = straightFromPremultiplied(invert ? alpha - red : red, alpha);
      output[destination + 1] = straightFromPremultiplied(invert ? alpha - green : green, alpha);
      output[destination + 2] = straightFromPremultiplied(invert ? alpha - blue : blue, alpha);
      output[destination + 3] = alpha;
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
    const random = dotNetRandom(value(parameters, 'pointSeed', 0));
    const used = new Set<number>();
    while (points.length < count) {
      const x = random.nextInt(bounds.x, bounds.x + bounds.width);
      const y = random.nextInt(bounds.y, bounds.y + bounds.height);
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
          let premultiplied = true;
          if (showPoints && distance <= pointRadius) color = pointColor;
          else if (distance <= cellRadius) color = gradientColor(gradient, distance / cellRadius);
          else if (edgeBehavior === 1) color = gradientColor(gradient, wrapCoordinate(distance, cellRadius) / cellRadius);
          else if (edgeBehavior === 2) color = gradientColor(gradient, reflectCoordinate(distance, cellRadius + 1) / cellRadius);
          else if (edgeBehavior === 3) color = [value(parameters, '__primaryR', 0), value(parameters, '__primaryG', 0), value(parameters, '__primaryB', 0), 255];
          else if (edgeBehavior === 4) color = [value(parameters, '__secondaryR', 255), value(parameters, '__secondaryG', 255), value(parameters, '__secondaryB', 255), 255];
          else if (edgeBehavior === 5) color = [0, 0, 0, 0];
          else if (edgeBehavior === 6) {
            color = [source[destination], source[destination + 1], source[destination + 2], source[destination + 3]];
            premultiplied = false;
          }
          else color = gradientColor(gradient, 1);
          const alpha = color[3];
          totals[0] += premultiplied ? color[0] : premultiplyChannel(color[0], alpha);
          totals[1] += premultiplied ? color[1] : premultiplyChannel(color[1], alpha);
          totals[2] += premultiplied ? color[2] : premultiplyChannel(color[2], alpha);
          totals[3] += alpha;
        }
      }
      writeNativePremultipliedBlend(output, destination, totals, quality * quality);
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
  const random = dotNetRandom(value(parameters, 'colorSeed', 0));
  const usedColors = new Set<number>();
  const colors: RenderColor[] = [];
  while (colors.length < points.length) {
    const bytes = random.nextBytes(4);
    const color: RenderColor = [bytes[2], bytes[1], bytes[0], 255];
    const packed = color[0] << 16 | color[1] << 8 | color[2];
    if (usedColors.has(packed)) continue;
    usedColors.add(packed);
    colors.push(color);
  }
  const sortChannel: 0 | 1 | 2 | null = sorting === 1 || sorting === 4 ? 2 : sorting === 2 || sorting === 5 ? 1 : sorting === 3 || sorting === 6 ? 0 : null;
  const sortedColors = sortChannel === null ? colors : [...colors].sort((first, second) => first[sortChannel] - second[sortChannel]);
  if (value(parameters, 'reverseColorSorting', 0) !== 0) sortedColors.reverse();
  points.forEach((point, index) => { point.color = sortedColors[index]; });
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
          const alpha = color[3];
          totals[0] += premultiplyChannel(color[0], alpha);
          totals[1] += premultiplyChannel(color[1], alpha);
          totals[2] += premultiplyChannel(color[2], alpha);
          totals[3] += alpha;
        }
      }
      writeNativePremultipliedBlend(output, destination, totals, quality * quality);
    }
    reportLoop(y + 1, height);
  }
  return output;
}

function processDents(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
  const refraction = Math.max(0, Math.min(200, value(parameters, 'refraction', 50)));
  const bounds = warpBounds(parameters, width, height);
  const radius = Math.min(bounds.width, bounds.height) / 2;
  const scale = Math.max(1, Math.min(200, value(parameters, 'scale', 25)));
  const scaleR = 400 / radius / scale;
  const roughnessValue = Math.max(0, Math.min(100, value(parameters, 'roughness', 10)));
  const detail = 1 + roughnessValue / 10;
  const maximumDetail = Math.floor(Math.log(scaleR) / Math.log(0.5));
  const effectiveDetail = detail > maximumDetail && maximumDetail >= 1 ? maximumDetail : detail;
  const normalizedRoughness = roughnessValue / 100;
  const refractionScale = refraction / 100 / scaleR;
  const theta = Math.PI * 2 * value(parameters, 'turbulence', 10) / 10;
  const seed = Math.max(0, Math.min(255, Math.trunc(value(parameters, 'seed', 0))));
  return processWarp(source, width, height, parameters, value(parameters, 'quality', 2), (x, y, _radius, output) => {
    const noise = fractalPerlin(x * scaleR, y * scaleR, effectiveDetail, normalizedRoughness, seed);
    output.x = x + refractionScale * Math.sin(-theta * noise);
    output.y = y + refractionScale * Math.cos(theta * noise);
  });
}

function processFrostedGlass(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
  const amount = Math.max(1, Math.min(10, Math.round(value(parameters, 'amount', 1))));
  const bounds = warpBounds(parameters, width, height);
  const leftBound = Math.max(0, Math.floor(bounds.x));
  const topBound = Math.max(0, Math.floor(bounds.y));
  const rightBound = Math.min(width, Math.ceil(bounds.x + bounds.width));
  const bottomBound = Math.min(height, Math.ceil(bounds.y + bounds.height));
  const rotateLeft = (input: number, count: number) => (input << count | input >>> (32 - count)) >>> 0;
  const queueRound = (hash: number, queued: number) => Math.imul(
    rotateLeft((hash + Math.imul(queued, 3266489917)) >>> 0, 17),
    668265263,
  ) >>> 0;
  let regionSeed = (374761393 + 12) >>> 0;
  regionSeed = queueRound(regionSeed, Math.round(value(parameters, 'seed', 0)) >>> 0);
  regionSeed = queueRound(regionSeed, leftBound >>> 0);
  regionSeed = queueRound(regionSeed, topBound >>> 0);
  regionSeed ^= regionSeed >>> 15;
  regionSeed = Math.imul(regionSeed, 2246822519) >>> 0;
  regionSeed ^= regionSeed >>> 13;
  regionSeed = Math.imul(regionSeed, 3266489917) >>> 0;
  regionSeed ^= regionSeed >>> 16;
  const random = dotNetRandom(regionSeed | 0);
  const output = new Uint8ClampedArray(source);
  for (let y = topBound; y < bottomBound; y += 1) {
    const top = Math.max(0, y - amount);
    const bottom = Math.min(height, y + amount + 1);
    for (let x = leftBound; x < rightBound; x += 1) {
      const intensityChoices: number[] = [];
      const counts = new Uint32Array(256);
      const redTotals = new Uint32Array(256);
      const greenTotals = new Uint32Array(256);
      const blueTotals = new Uint32Array(256);
      const alphaTotals = new Uint32Array(256);
      const left = Math.max(0, x - amount);
      const right = Math.min(width, x + amount + 1);
      for (let sampleY = top; sampleY < bottom; sampleY += 1) {
        for (let sampleX = left; sampleX < right; sampleX += 1) {
          const sample = (sampleY * width + sampleX) * 4;
          const alpha = source[sample + 3];
          const red = premultiplyChannel(source[sample], alpha);
          const green = premultiplyChannel(source[sample + 1], alpha);
          const blue = premultiplyChannel(source[sample + 2], alpha);
          const intensity = intensityByte(red, green, blue);
          intensityChoices.push(intensity);
          counts[intensity] += 1;
          redTotals[intensity] += red;
          greenTotals[intensity] += green;
          blueTotals[intensity] += blue;
          alphaTotals[intensity] += alpha;
        }
      }
      const chosen = intensityChoices[random.nextInt(0, intensityChoices.length)];
      const count = counts[chosen];
      const destination = (y * width + x) * 4;
      const alpha = Math.floor(alphaTotals[chosen] / count);
      output[destination] = straightFromPremultiplied(Math.floor(redTotals[chosen] / count), alpha);
      output[destination + 1] = straightFromPremultiplied(Math.floor(greenTotals[chosen] / count), alpha);
      output[destination + 2] = straightFromPremultiplied(Math.floor(blueTotals[chosen] / count), alpha);
      output[destination + 3] = alpha;
    }
    reportLoop(y - topBound + 1, bottomBound - topBound);
  }
  return output;
}

function processPolarInversion(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
  const amount = Math.max(-4, Math.min(4, value(parameters, 'amount', 0)));
  return processWarp(source, width, height, parameters, value(parameters, 'quality', 2), (x, y, radius, output) => {
    const magnitudeSquared = x * x + y * y;
    const scale = 1 + (radius * radius / magnitudeSquared - 1) * amount;
    output.x = x * scale;
    output.y = y * scale;
  });
}

function processTileReflection(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
  const intensityValue = Math.max(-20, Math.min(20, Math.round(value(parameters, 'intensity', 8))));
  const theta = value(parameters, 'rotation', 30) * Math.PI / 180;
  const sine = Math.fround(Math.sin(-theta));
  const cosine = Math.fround(Math.cos(-theta));
  const tileScale = Math.fround(Math.fround(Math.PI) / Math.max(2, Math.round(value(parameters, 'tileSize', 40))));
  const intensity = Math.fround(intensityValue * intensityValue / 10 * Math.sign(intensityValue));
  const curved = Math.round(value(parameters, 'tileType', 0)) === 1;
  const edgeBehavior = Math.round(value(parameters, 'edgeBehavior', 1));
  const centerX = Math.fround(width / 2);
  const centerY = Math.fround(height / 2);
  const sampleCount = 17;
  const offsets = Array.from({ length: sampleCount }, (_, index) => {
    const baseX = index * 4 / sampleCount;
    const offsetX = baseX - Math.trunc(baseX);
    const offsetY = index / sampleCount;
    return {
      x: cosine * offsetX + sine * offsetY,
      y: cosine * offsetY - sine * offsetX,
    };
  });
  const output = new Uint8ClampedArray(source.length);
  const sample = [0, 0, 0, 0];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const totals = [0, 0, 0, 0];
      const destination = (y * width + x) * 4;
      const relativeX = Math.fround(x - centerX);
      const relativeY = Math.fround(y - centerY);
      for (const offset of offsets) {
        const initialX = Math.fround(relativeX + Math.fround(offset.x));
        const initialY = Math.fround(relativeY - Math.fround(offset.y));
        const rotatedX = Math.fround(Math.fround(cosine * initialX) + Math.fround(sine * initialY));
        const rotatedY = Math.fround(Math.fround(-sine * initialX) + Math.fround(cosine * initialY));
        const waveArgumentX = Math.fround(rotatedX * tileScale);
        const waveArgumentY = Math.fround(rotatedY * tileScale);
        const waveX = Math.fround(curved ? Math.sin(waveArgumentX) : Math.tan(waveArgumentX));
        const waveY = Math.fround(curved ? Math.sin(waveArgumentY) : Math.tan(waveArgumentY));
        const transformedX = Math.fround(rotatedX + Math.fround(intensity * waveX));
        const transformedY = Math.fround(rotatedY + Math.fround(intensity * waveY));
        const finalX = Math.fround(Math.fround(cosine * transformedX) - Math.fround(sine * transformedY));
        const finalY = Math.fround(Math.fround(sine * transformedX) + Math.fround(cosine * transformedY));
        const preliminaryX = Math.fround(centerX + finalX);
        const preliminaryY = Math.fround(centerY + finalY);

        sample.fill(0);
        if (preliminaryX >= 0 && preliminaryX <= width - 1 && preliminaryY >= 0 && preliminaryY <= height - 1) {
          const nearest = (Math.floor(preliminaryY) * width + Math.floor(preliminaryX)) * 4;
          const alpha = source[nearest + 3];
          sample[0] = premultiplyChannel(source[nearest], alpha);
          sample[1] = premultiplyChannel(source[nearest + 1], alpha);
          sample[2] = premultiplyChannel(source[nearest + 2], alpha);
          sample[3] = alpha;
        } else {
          nativeWarpSample(
            source,
            width,
            height,
            preliminaryX,
            preliminaryY,
            edgeBehavior,
            destination,
            parameters,
            sample,
          );
        }
        for (let channel = 0; channel < 4; channel += 1) totals[channel] += sample[channel];
      }
      writeNativePremultipliedBlend(output, destination, totals, sampleCount);
    }
    reportLoop(y + 1, height);
  }
  return output;
}

function processTwist(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
  const amount = Math.max(-100, Math.min(100, Math.round(value(parameters, 'amount', 30))));
  const radiusPercentage = Math.max(0, Math.min(100, Math.round(value(parameters, 'radiusPercentage', 100))));
  const bounds = warpBounds(parameters, width, height);
  const halfWidth = bounds.width / 2;
  const halfHeight = bounds.height / 2;
  const centerX = halfWidth + bounds.x + value(parameters, 'offsetX', 0) * halfWidth;
  const centerY = halfHeight + bounds.y + value(parameters, 'offsetY', 0) * halfHeight;
  const maximumRadius = Math.min(halfWidth, halfHeight) * radiusPercentage / 100;
  const maximumRadiusSquared = maximumRadius * maximumRadius;
  const distanceThresholdSquared = (maximumRadius + 1) * (maximumRadius + 1);
  const preliminaryTwist = -amount;
  const twist = preliminaryTwist * preliminaryTwist * Math.sign(preliminaryTwist) / 100;
  const antialias = Math.max(0, Math.min(5, Math.round(value(parameters, 'antialias', 2))));
  const sampleCount = antialias * antialias + 1;
  const offsets = Array.from({ length: sampleCount }, (_, index) => {
    const baseX = index * antialias / sampleCount;
    return { x: baseX - Math.trunc(baseX), y: index / sampleCount };
  });
  const edgeBehavior = Math.round(value(parameters, 'edgeBehavior', 0));
  const output = new Uint8ClampedArray(source.length);
  const sample = [0, 0, 0, 0];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const destination = (y * width + x) * 4;
      const fromCenterX = x - centerX;
      const fromCenterY = y - centerY;
      const fromCenterSquared = fromCenterX * fromCenterX + fromCenterY * fromCenterY;
      if (fromCenterSquared > distanceThresholdSquared) {
        const totals = [0, 0, 0, 0];
        addPremultipliedPixel(source, destination, totals);
        writeNativePremultipliedBlend(output, destination, totals, 1);
        continue;
      }

      const totals = [0, 0, 0, 0];
      for (const offset of offsets) {
        const locationX = fromCenterX + offset.x;
        const locationY = fromCenterY + offset.y;
        const radialDistanceSquared = locationX * locationX + locationY * locationY;
        sample.fill(0);
        if (radialDistanceSquared > maximumRadiusSquared) {
          const alpha = source[destination + 3];
          sample[0] = premultiplyChannel(source[destination], alpha);
          sample[1] = premultiplyChannel(source[destination + 1], alpha);
          sample[2] = premultiplyChannel(source[destination + 2], alpha);
          sample[3] = alpha;
        } else {
          const radialDistance = Math.sqrt(radialDistanceSquared);
          const radialFactor = 1 - radialDistance / maximumRadius;
          const localTwist = radialFactor * radialFactor * radialFactor * twist;
          const cosine = Math.cos(localTwist);
          const sine = Math.sin(localTwist);
          const rotatedX = locationX * cosine - locationY * sine;
          const rotatedY = locationX * sine + locationY * cosine;
          const preliminaryX = centerX + rotatedX;
          const preliminaryY = centerY + rotatedY;
          const sampleX = Math.trunc(preliminaryX);
          const sampleY = Math.trunc(preliminaryY);
          if (sampleX >= 0 && sampleX < width && sampleY >= 0 && sampleY < height) {
            const nearest = (sampleY * width + sampleX) * 4;
            const alpha = source[nearest + 3];
            sample[0] = premultiplyChannel(source[nearest], alpha);
            sample[1] = premultiplyChannel(source[nearest + 1], alpha);
            sample[2] = premultiplyChannel(source[nearest + 2], alpha);
            sample[3] = alpha;
          } else {
            nativeWarpSample(
              source,
              width,
              height,
              preliminaryX,
              preliminaryY,
              edgeBehavior,
              destination,
              parameters,
              sample,
            );
          }
        }
        for (let channel = 0; channel < 4; channel += 1) totals[channel] += sample[channel];
      }
      writeNativePremultipliedBlend(output, destination, totals, sampleCount);
    }
    reportLoop(y + 1, height);
  }
  return output;
}


/** ColorBgra.GetIntensityByte: Paint.NET's fixed-point luminance, truncated. */
function intensityByte(red: number, green: number, blue: number) {
  return (19595 * red + 38470 * green + 7471 * blue) >> 16;
}

/**
 * BrightnessContrastPixelOp builds a transfer table indexed by the pixel's luminance, so
 * the shift applied to every channel depends on how bright the pixel already is, and a
 * contrast of 100 collapses to a hard threshold. A per-channel S-curve is a different
 * adjustment entirely.
 */
function applyBrightnessContrast(data: Uint8ClampedArray, brightnessValue: number, contrastValue: number) {
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
function posterizeLevels(levelCountValue: number) {
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
function levelChannel(input: number, gamma: number) {
  if (input <= 0) return 0;
  if (input >= 255) return 255;
  return clampTruncatedByte(255 * (input / 255) ** gamma);
}

function rgbToHsv(red: number, green: number, blue: number) {
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
function hsvToRgb(hue: number, saturationValue: number, brightnessValue: number) {
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
function blendConstant(channel: number, blendChannel: number, blendAlpha: number) {
  return Math.trunc((channel * (255 - blendAlpha) + blendChannel * blendAlpha) / 256);
}

function processHueSaturation(data: Uint8ClampedArray, parameters: EffectParameters) {
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
        addPremultipliedPixel(source, corner, totals);
      }
      const premultiplied = totals.map((total) => Math.floor((total + 2) / 4));
      const alpha = premultiplied[3];
      const color = [
        straightFromPremultiplied(premultiplied[0], alpha),
        straightFromPremultiplied(premultiplied[1], alpha),
        straightFromPremultiplied(premultiplied[2], alpha),
        alpha,
      ];
      for (let y = top; y < bottom; y += 1) {
        for (let x = left; x < right; x += 1) {
          const index = (y * width + x) * 4;
          for (let channel = 0; channel < 4; channel += 1) output[index + channel] = color[channel];
        }
      }
    }
    reportLoop(Math.min(height, top + cellSize), height);
  }
  return output;
}

/** ColorBgra.ToPremultipliedAlpha: integer truncation, not rounding. */
function premultiplyChannel(channel: number, alpha: number) {
  return Math.trunc(channel * alpha / 255);
}

/** ColorBgra.ToStraightAlpha, which yields zero for a fully transparent pixel. */
function straightFromPremultiplied(channel: number, alpha: number) {
  return alpha > 0 ? clampTruncatedByte(Math.trunc(channel * 255 / alpha)) : 0;
}

function premultiplySurface(surface: Uint8ClampedArray) {
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
function histogramWeightedSum(histogram: Uint32Array) {
  let total = 0;
  for (let bin = 1; bin < 256; bin += 1) total += bin * histogram[bin];
  return total;
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

function processInkSketch(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
  const coloringAdjustment = -(value(parameters, 'coloring', 50) - 50) * 2;
  const output = withProgressRange(0, 0.55, () => processGlow(source, width, height, {
    radius: 6,
    brightness: coloringAdjustment,
    contrast: coloringAdjustment,
  }));
  const threshold = Math.trunc(value(parameters, 'inkOutline', 50) * 255 / 100);
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
          const alpha = source[sample + 3];
          totals[0] += premultiplyChannel(source[sample], alpha) * weight;
          totals[1] += premultiplyChannel(source[sample + 1], alpha) * weight;
          totals[2] += premultiplyChannel(source[sample + 2], alpha) * weight;
          totals[3] += alpha * weight;
        }
      }
      const red = clampTruncatedByte(totals[0]);
      const green = clampTruncatedByte(totals[1]);
      const blue = clampTruncatedByte(totals[2]);
      const inkAlpha = clampTruncatedByte(totals[3]);
      const gray = (19595 * red + 38470 * green + 7471 * blue) >> 16;
      const straightGray = inkAlpha > 0 ? Math.trunc(gray * 255 / inkAlpha) & 255 : 0;
      const ink = straightGray > threshold ? inkAlpha : 0;
      const destination = (y * width + x) * 4;
      const glowAlpha = output[destination + 3];
      if (inkAlpha === 0) continue;
      if (glowAlpha === 0) {
        const straightInk = straightFromPremultiplied(ink, inkAlpha);
        output[destination] = straightInk;
        output[destination + 1] = straightInk;
        output[destination + 2] = straightInk;
        output[destination + 3] = inkAlpha;
        continue;
      }
      const inverseGlowAlpha = 255 - glowAlpha;
      const inverseInkAlpha = 255 - inkAlpha;
      const resultAlpha = glowAlpha + Math.floor((inkAlpha * inverseGlowAlpha + 128) / 255);
      for (let channel = 0; channel < 3; channel += 1) {
        const glow = premultiplyChannel(output[destination + channel], glowAlpha);
        const blended = Math.min(inkAlpha * glow, glowAlpha * ink);
        const premultiplied = Math.floor((
          inverseInkAlpha * glow + inverseGlowAlpha * ink + blended + 128
        ) / 255);
        output[destination + channel] = straightFromPremultiplied(premultiplied, resultAlpha);
      }
      output[destination + 3] = resultAlpha;
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
  // Native Pinta renders the Color Range adjustment and immediately overwrites it by
  // blurring the original source. Reproduce that observable quirk: the control remains
  // in the native dialog, but it intentionally has no effect on the finished pixels.
  const blurred = withProgressRange(0, 0.8, () => gaussianBlur(source, width, height, value(parameters, 'pencilTipSize', 2)));
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

const OLD_MS_PAINT_PALETTE = [
  [0, 0, 0],
  [128, 0, 0], [0, 128, 0], [128, 128, 0], [0, 0, 128], [128, 0, 128], [0, 128, 128], [128, 128, 128],
  [255, 0, 0], [0, 255, 0], [255, 255, 0], [0, 0, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255],
  [128, 64, 0], [0, 64, 64], [128, 128, 64], [255, 128, 64], [255, 0, 128], [0, 64, 128],
  [0, 255, 128], [255, 255, 128], [192, 192, 192], [128, 0, 255], [0, 128, 255],
  [128, 128, 255], [128, 255, 255],
];

const WINDOWS_16_PALETTE = [
  [0, 0, 0], [128, 0, 0], [0, 128, 0], [128, 128, 0],
  [0, 0, 128], [128, 0, 128], [0, 64, 128], [192, 192, 192],
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

function recentDitherPalette(parameters: EffectParameters) {
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

function presetDitherPalette(choice: number) {
  if (choice === 0) return [[0, 0, 0], [255, 255, 255]];
  if (choice === 1) return OLD_MS_PAINT_PALETTE;
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
  const targetX = column === 0 ? left
    : column === 1 ? left + Math.floor((right - left) / 2) - Math.floor(objectWidth / 2)
      : right - objectWidth;
  const targetY = row === 0 ? top
    : row === 1 ? top + Math.floor((bottom - top) / 2) - Math.floor(objectHeight / 2)
      : bottom - objectHeight;
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

function blendNativeOutlineUnderPixel(output: Uint8ClampedArray, index: number, outline: RenderColor) {
  const topAlpha = output[index + 3];
  if (topAlpha === 255) return;
  const outlineAlpha = outline[3];
  const outlinePremultiplied = [
    premultiplyChannel(outline[0], outlineAlpha),
    premultiplyChannel(outline[1], outlineAlpha),
    premultiplyChannel(outline[2], outlineAlpha),
  ];
  if (topAlpha === 0) {
    output[index] = straightFromPremultiplied(outlinePremultiplied[0], outlineAlpha);
    output[index + 1] = straightFromPremultiplied(outlinePremultiplied[1], outlineAlpha);
    output[index + 2] = straightFromPremultiplied(outlinePremultiplied[2], outlineAlpha);
    output[index + 3] = outlineAlpha;
    return;
  }
  const inverseTopAlpha = 255 - topAlpha;
  const inverseBottomAlpha = 255 - outlineAlpha;
  const outputAlpha = topAlpha + Math.floor((outlineAlpha * inverseTopAlpha + 128) / 255);
  for (let channel = 0; channel < 3; channel += 1) {
    const top = premultiplyChannel(output[index + channel], topAlpha);
    const premultiplied = Math.floor((
      inverseBottomAlpha * top
      + inverseTopAlpha * outlinePremultiplied[channel]
      + outlineAlpha * top
      + 128
    ) / 255);
    output[index + channel] = straightFromPremultiplied(premultiplied, outputAlpha);
  }
  output[index + 3] = outputAlpha;
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
      if (outlineAlpha === 0) continue;
      const progress = value(parameters, 'colorGradient', 1) !== 0 ? outlineAlpha / 255 : 1;
      const color: RenderColor = [
        clampTruncatedByte(secondary[0] + (primary[0] - secondary[0]) * progress),
        clampTruncatedByte(secondary[1] + (primary[1] - secondary[1]) * progress),
        clampTruncatedByte(secondary[2] + (primary[2] - secondary[2]) * progress),
        outlineAlpha,
      ];
      if (value(parameters, 'alphaGradient', 1) === 0) color[3] = 255;
      blendNativeOutlineUnderPixel(output, index, color);
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
      const gray = intensityByte(output[index], output[index + 1], output[index + 2]);
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
    const tables = [
      posterizeLevels(value(parameters, 'red', 16)),
      posterizeLevels(value(parameters, 'green', 16)),
      posterizeLevels(value(parameters, 'blue', 16)),
    ];
    for (let index = 0; index < output.length; index += 4) {
      output[index] = tables[0][output[index]];
      output[index + 1] = tables[1][output[index + 1]];
      output[index + 2] = tables[2][output[index + 2]];
      reportPixels(index, output.length);
    }
  } else if (effect === 'sepia') {
    // SepiaEffect desaturates, then runs a Level op whose per-channel gamma is
    // [B 1.2, G 1.0, R 0.8]; the tint comes from those curves, not a linear scale.
    const strength = value(parameters, 'strength', 100) / 100;
    for (let index = 0; index < output.length; index += 4) {
      const gray = intensityByte(output[index], output[index + 1], output[index + 2]);
      const toned = [levelChannel(gray, 0.8), levelChannel(gray, 1), levelChannel(gray, 1.2)];
      for (let channel = 0; channel < 3; channel += 1) {
        output[index + channel] = clampTruncatedByte(
          output[index + channel] + strength * (toned[channel] - output[index + channel]),
        );
      }
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
    return processLocalHistogram(source, width, height, parameters, 'unfocus');
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
    return processLocalHistogram(source, width, height, parameters, 'sharpen');
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
