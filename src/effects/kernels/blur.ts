import type { EffectParameters } from '../types';
import { buildCurveLookup, curvePointsFromParameters } from '../curves';
import {
  clampByte, clampTruncatedByte, createSeededRandom, dotNetRandom, fastMultiplyByte,
  histogramPercentile, histogramRange, histogramRank, histogramWeightedSum, intensityByte,
  nativeBilinearSample, nativeBilinearSampleWrapped, nativeReflectedCoordinate, nativeWarpSample,
  PERLIN_PERMUTATION, perlinGradient, perlinNoise, perlinPermutation, premultiplyChannel,
  addPremultipliedPixel, premultiplySurface, processLocalHistogram, processWarp, reportLoop, reportPixels, reportProgress,
  straightFromPremultiplied, value, warpBounds, withProgressRange, writeNativePremultipliedBlend,
} from './shared';

/**
 * Pinta's Gaussian blur is the Paint.NET port in
 * `original/Pinta.Effects/Effects/GaussianBlurEffect.cs`: a tent weight row rather than a
 * true Gaussian, alpha-weighted accumulation, and samples outside the surface excluded
 * from the weight sum instead of clamped to the edge. Canvas pixel buffers are already
 * straight-alpha, so the native premultiply round trip has no counterpart here.
 */
export function createGaussianBlurRow(amount: number) {
  const size = 1 + amount * 2;
  const weights = new Int32Array(size);
  for (let i = 0; i <= amount; i += 1) {
    weights[i] = 16 * (i + 1);
    weights[size - i - 1] = weights[i];
  }
  return weights;
}

export function gaussianBlur(source: Uint8ClampedArray, width: number, height: number, radiusValue: number) {
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

export function roundAwayFromZero(valueToRound: number) {
  return valueToRound < 0 ? -Math.round(-valueToRound) : Math.round(valueToRound);
}

export function processFragment(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
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

export function processMotionBlur(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
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

export function processRadialBlur(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
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

export function processZoomBlur(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
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
