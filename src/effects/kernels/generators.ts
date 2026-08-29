import type { EffectParameters } from '../types';
import { buildCurveLookup, curvePointsFromParameters } from '../curves';
import {
  clampByte, clampTruncatedByte, createSeededRandom, dotNetRandom, fastMultiplyByte,
  histogramPercentile, histogramRange, histogramRank, histogramWeightedSum, intensityByte,
  nativeBilinearSample, nativeBilinearSampleWrapped, nativeReflectedCoordinate, nativeWarpSample,
  PERLIN_PERMUTATION, perlinGradient, perlinNoise, perlinPermutation, premultiplyChannel,
  premultiplySurface, processLocalHistogram, processWarp, reportLoop, reportPixels, reportProgress,
  straightFromPremultiplied, value, warpBounds, type RenderColor, withProgressRange, writeNativePremultipliedBlend,
} from './shared';
import { gaussianBlur } from './blur';
import { processGlow } from './pixelOps';

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

