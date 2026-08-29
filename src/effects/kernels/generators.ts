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
import { gaussianBlur } from './distortions';
import { processGlow } from './pixelOps';

type RenderColor = [number, number, number, number];
type GradientStop = { offset: number; color: RenderColor };
type ControlPoint = { x: number; y: number; color?: RenderColor };


export function wrapCoordinate(coordinate: number, size: number) {
  if (size <= 1) return 0;
  return ((coordinate % size) + size) % size;
}

export function reflectCoordinate(coordinate: number, size: number) {
  if (size <= 1) return 0;
  const maximum = size - 1;
  const period = maximum * 2;
  const reflected = ((coordinate % period) + period) % period;
  return reflected > maximum ? period - reflected : reflected;
}

export function renderColorFromNumber(valueToConvert: number): RenderColor {
  const packed = Math.max(0, Math.min(0xffffff, Math.round(valueToConvert)));
  return [(packed >> 16) & 255, (packed >> 8) & 255, packed & 255, 255];
}

export function presetGradient(choice: number): GradientStop[] {
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

export function effectGradient(parameters: EffectParameters, defaultChoice: number) {
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

export function gradientColor(stops: GradientStop[], amountValue: number): RenderColor {
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

export function processClouds(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
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

export function juliaValue(realValue: number, imaginaryValue: number) {
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

export function mandelbrotValue(realValue: number, imaginaryValue: number, factor: number) {
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

export function processFractal(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters, kind: 'julia' | 'mandelbrot') {
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

export function createControlPoints(width: number, height: number, parameters: EffectParameters) {
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

export function relativeDistance(x: number, y: number, point: ControlPoint, metric: number) {
  const dx = Math.abs(x - point.x);
  const dy = Math.abs(y - point.y);
  return metric === 1 ? dx + dy : metric === 2 ? Math.max(dx, dy) : dx * dx + dy * dy;
}

export function actualDistance(relative: number, metric: number) {
  return metric === 0 ? Math.sqrt(relative) : relative;
}

export function renderPointColor(parameters: EffectParameters) {
  return renderColorFromNumber(value(parameters, 'pointColor', 0));
}

export function processCells(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
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

export function processVoronoi(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
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

export function processNoise(data: Uint8ClampedArray, parameters: EffectParameters) {
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

export function processInkSketch(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
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

export function processOilPainting(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
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

export function processPencilSketch(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
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

export function processAlignObject(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
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

export function collectObjectBorders(
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

export function nearestObjectBorder(x: number, y: number, borderRows: number[][], radius: number) {
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

export function processFeatherObject(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
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

export function blendNativeOutlineUnderPixel(output: Uint8ClampedArray, index: number, outline: RenderColor) {
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

export function processOutlineObject(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
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

export function processScanlines(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
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

export function processColoredArtifacts(source: Uint8ClampedArray, width: number, height: number, parameters: EffectParameters) {
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

export function processAdjustmentNoise(data: Uint8ClampedArray, parameters: EffectParameters) {
  const random = createSeededRandom(value(parameters, 'seed', 0));
  const intensity = Math.max(1, Math.min(64, value(parameters, 'intensity', 16)));
  for (let index = 0; index < data.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) data[index + channel] = clampByte(data[index + channel] + (random() * 2 - 1) * intensity);
    reportPixels(index, data.length);
  }
}
