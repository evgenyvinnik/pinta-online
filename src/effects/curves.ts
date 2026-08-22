import type { EffectParameters } from './types';

export type CurveChannel = 'luminosity' | 'red' | 'green' | 'blue';

export interface CurvePoint {
  x: number;
  y: number;
}

const CHANNELS: CurveChannel[] = ['luminosity', 'red', 'green', 'blue'];

function key(channel: CurveChannel, x: number) {
  return `curve_${channel}_${Math.round(x)}`;
}

export function defaultCurveParameters(): EffectParameters {
  const parameters: EffectParameters = { curveMode: 0 };
  for (const channel of CHANNELS) {
    parameters[key(channel, 0)] = 0;
    parameters[key(channel, 255)] = 255;
  }
  return parameters;
}

export function curvePointsFromParameters(parameters: EffectParameters, channel: CurveChannel): CurvePoint[] {
  const prefix = `curve_${channel}_`;
  const points = Object.entries(parameters)
    .filter(([parameterKey]) => parameterKey.startsWith(prefix))
    .map(([parameterKey, y]) => ({ x: Number(parameterKey.slice(prefix.length)), y }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .map((point) => ({
      x: Math.max(0, Math.min(255, Math.round(point.x))),
      y: Math.max(0, Math.min(255, Math.round(point.y))),
    }))
    .sort((first, second) => first.x - second.x);
  if (!points.some((point) => point.x === 0)) points.unshift({ x: 0, y: 0 });
  if (!points.some((point) => point.x === 255)) points.push({ x: 255, y: 255 });
  return points.filter((point, index) => index === 0 || point.x !== points[index - 1].x);
}

export function setCurvePoints(parameters: EffectParameters, channel: CurveChannel, points: CurvePoint[]) {
  const prefix = `curve_${channel}_`;
  const next = Object.fromEntries(Object.entries(parameters).filter(([parameterKey]) => !parameterKey.startsWith(prefix)));
  for (const point of points) next[key(channel, point.x)] = Math.max(0, Math.min(255, Math.round(point.y)));
  return next;
}

export function buildCurveLookup(pointsValue: CurvePoint[]) {
  const points = [...pointsValue].sort((first, second) => first.x - second.x);
  const count = points.length;
  const secondDerivatives = new Float64Array(count);
  const temporary = new Float64Array(count);

  for (let index = 1; index < count - 1; index += 1) {
    const span = points[index + 1].x - points[index - 1].x;
    const sigma = (points[index].x - points[index - 1].x) / span;
    const factor = sigma * secondDerivatives[index - 1] + 2;
    secondDerivatives[index] = (sigma - 1) / factor;
    const slopeDifference =
      (points[index + 1].y - points[index].y) / (points[index + 1].x - points[index].x) -
      (points[index].y - points[index - 1].y) / (points[index].x - points[index - 1].x);
    temporary[index] = (6 * slopeDifference / span - sigma * temporary[index - 1]) / factor;
  }

  for (let index = count - 2; index >= 0; index -= 1) {
    secondDerivatives[index] = secondDerivatives[index] * secondDerivatives[index + 1] + temporary[index];
  }

  const lookup = new Uint8Array(256);
  let lower = 0;
  for (let x = 0; x < 256; x += 1) {
    while (lower < count - 2 && x > points[lower + 1].x) lower += 1;
    const upper = lower + 1;
    const width = points[upper].x - points[lower].x;
    const a = (points[upper].x - x) / width;
    const b = (x - points[lower].x) / width;
    const interpolated = a * points[lower].y + b * points[upper].y +
      ((a ** 3 - a) * secondDerivatives[lower] + (b ** 3 - b) * secondDerivatives[upper]) * width ** 2 / 6;
    lookup[x] = Math.max(0, Math.min(255, Math.round(interpolated)));
  }
  return lookup;
}

export function curveSvgPath(points: CurvePoint[]) {
  const lookup = buildCurveLookup(points);
  return Array.from(lookup, (output, input) => `${input === 0 ? 'M' : 'L'}${input} ${255 - output}`).join(' ');
}
