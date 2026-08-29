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

interface HexCell {
  key: string;
  centerX: number;
  centerY: number;
  distanceSquared: number;
  nextDistanceSquared: number;
  neighborDistance: number;
}


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

export function addBilinearSample(
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

export function roundAwayFromZero(valueToRound: number) {
  return valueToRound < 0 ? -Math.round(-valueToRound) : Math.round(valueToRound);
}

export function addPremultipliedPixel(source: Uint8ClampedArray, index: number, totals: number[]) {
  const alpha = source[index + 3];
  totals[0] += premultiplyChannel(source[index], alpha);
  totals[1] += premultiplyChannel(source[index + 1], alpha);
  totals[2] += premultiplyChannel(source[index + 2], alpha);
  totals[3] += alpha;
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

export function processBulge(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
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

export const PERLIN_ROTATION = 137.2 * Math.PI / 180;

export const PERLIN_ROTATION_COSINE = Math.cos(PERLIN_ROTATION);

export const PERLIN_ROTATION_SINE = Math.sin(PERLIN_ROTATION);

export function fractalPerlin(x: number, y: number, detail: number, roughness: number, seed: number) {
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

export function processDents(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
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

export function processFrostedGlass(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
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

export function processPolarInversion(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
  const amount = Math.max(-4, Math.min(4, value(parameters, 'amount', 0)));
  return processWarp(source, width, height, parameters, value(parameters, 'quality', 2), (x, y, radius, output) => {
    const magnitudeSquared = x * x + y * y;
    const scale = 1 + (radius * radius / magnitudeSquared - 1) * amount;
    output.x = x * scale;
    output.y = y * scale;
  });
}

export function processTileReflection(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
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
        const sampledX = Math.fround(Math.fround(cosine * transformedX) - Math.fround(sine * transformedY));
        const sampledY = Math.fround(Math.fround(sine * transformedX) + Math.fround(cosine * transformedY));
        const preliminaryX = Math.fround(centerX + sampledX);
        const preliminaryY = Math.fround(centerY + sampledY);

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

export function processTwist(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
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

export function processPixelate(source: Uint8ClampedArray, width: number, height: number, cellSizeValue: number) {
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

export function processPixelDrag(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
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

export function processRowSlice(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
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

export function nearestHexCell(x: number, y: number, radius: number, offsetX: number, offsetY: number): HexCell {
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

export function processHexagonPixelate(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
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
