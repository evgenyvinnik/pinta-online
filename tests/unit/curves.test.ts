import { describe, expect, it } from 'vitest';
import {
  buildCurveLookup,
  curvePointsFromParameters,
  curveSvgPath,
  defaultCurveParameters,
  setCurvePoints,
  type CurvePoint,
} from '../../src/effects/curves';

describe('defaultCurveParameters', () => {
  it('starts every channel as the identity line', () => {
    const parameters = defaultCurveParameters();
    expect(parameters.curveMode).toBe(0);
    for (const channel of ['luminosity', 'red', 'green', 'blue'] as const) {
      expect(parameters[`curve_${channel}_0`]).toBe(0);
      expect(parameters[`curve_${channel}_255`]).toBe(255);
    }
  });
});

describe('curvePointsFromParameters', () => {
  it('reads only its own channel and returns points in ascending x', () => {
    const parameters = { curve_red_128: 200, curve_blue_64: 10, ...defaultCurveParameters() };
    const red = curvePointsFromParameters(parameters, 'red');

    expect(red).toEqual([
      { x: 0, y: 0 },
      { x: 128, y: 200 },
      { x: 255, y: 255 },
    ]);
    expect(curvePointsFromParameters(parameters, 'green')).toEqual([
      { x: 0, y: 0 },
      { x: 255, y: 255 },
    ]);
  });

  it('supplies the endpoints a stored curve is missing', () => {
    // Without both ends the spline has nothing to interpolate between at the edges.
    const points = curvePointsFromParameters({ curve_red_128: 90 }, 'red');
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points.at(-1)).toEqual({ x: 255, y: 255 });
  });

  it('clamps and rounds values a hand-edited parameter set could contain', () => {
    const points = curvePointsFromParameters({ curve_red_10: 400, curve_red_20: -5, 'curve_red_30.5': 12.6 }, 'red');
    expect(points).toContainEqual({ x: 10, y: 255 });
    expect(points).toContainEqual({ x: 20, y: 0 });
  });

  it('drops entries that are not numbers rather than emitting NaN points', () => {
    const points = curvePointsFromParameters({ curve_red_abc: 40, curve_red_50: 60 }, 'red');
    expect(points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
    expect(points).toContainEqual({ x: 50, y: 60 });
  });

  it('collapses duplicate x values, which would divide by zero in the spline', () => {
    const points = curvePointsFromParameters({ curve_red_100: 20, 'curve_red_100.4': 200 } as never, 'red');
    expect(points.filter((point) => point.x === 100)).toHaveLength(1);
  });
});

describe('setCurvePoints', () => {
  it('replaces the channel wholesale and leaves the others alone', () => {
    const parameters = setCurvePoints(defaultCurveParameters(), 'red', [
      { x: 0, y: 0 },
      { x: 255, y: 128 },
    ]);

    expect(parameters.curve_red_255).toBe(128);
    expect(parameters.curve_blue_255).toBe(255);
    expect(parameters.curveMode).toBe(0);
  });

  it('does not leave stale control points behind', () => {
    const withMidpoint = setCurvePoints({}, 'red', [
      { x: 0, y: 0 },
      { x: 128, y: 200 },
      { x: 255, y: 255 },
    ]);
    const withoutMidpoint = setCurvePoints(withMidpoint, 'red', [
      { x: 0, y: 0 },
      { x: 255, y: 255 },
    ]);

    expect(withoutMidpoint.curve_red_128).toBeUndefined();
  });

  it('clamps the stored output the same way reading does', () => {
    const parameters = setCurvePoints({}, 'red', [
      { x: 0, y: -30 },
      { x: 255, y: 900 },
    ]);
    expect(parameters.curve_red_0).toBe(0);
    expect(parameters.curve_red_255).toBe(255);
  });
});

describe('buildCurveLookup', () => {
  const identity: CurvePoint[] = [
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ];

  it('maps every input to itself for the default curve', () => {
    const lookup = buildCurveLookup(identity);
    expect(lookup).toHaveLength(256);
    for (let input = 0; input < 256; input += 1) expect(lookup[input]).toBe(input);
  });

  it('pins both endpoints exactly, whatever the curve does between them', () => {
    const lookup = buildCurveLookup([
      { x: 0, y: 0 },
      { x: 128, y: 220 },
      { x: 255, y: 255 },
    ]);
    expect(lookup[0]).toBe(0);
    expect(lookup[255]).toBe(255);
    // The control point is honoured, not merely approached.
    expect(lookup[128]).toBe(220);
  });

  it('stays inside the byte range even where the spline overshoots', () => {
    // A steep step makes the natural cubic overshoot past 255 and below 0 before clamping.
    const lookup = buildCurveLookup([
      { x: 0, y: 0 },
      { x: 120, y: 0 },
      { x: 130, y: 255 },
      { x: 255, y: 255 },
    ]);
    expect(Math.min(...lookup)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...lookup)).toBeLessThanOrEqual(255);
  });

  it('inverts monotonically when the curve is inverted', () => {
    const lookup = buildCurveLookup([
      { x: 0, y: 255 },
      { x: 255, y: 0 },
    ]);
    for (let input = 1; input < 256; input += 1) expect(lookup[input]).toBeLessThanOrEqual(lookup[input - 1]);
  });

  it('accepts points in any order', () => {
    const shuffled = buildCurveLookup([
      { x: 255, y: 255 },
      { x: 128, y: 64 },
      { x: 0, y: 0 },
    ]);
    const sorted = buildCurveLookup([
      { x: 0, y: 0 },
      { x: 128, y: 64 },
      { x: 255, y: 255 },
    ]);
    expect([...shuffled]).toEqual([...sorted]);
  });

  it('survives a two-point curve that does not span the full range', () => {
    const lookup = buildCurveLookup([
      { x: 40, y: 10 },
      { x: 200, y: 240 },
    ]);
    expect(lookup).toHaveLength(256);
    expect([...lookup].every((value) => value >= 0 && value <= 255)).toBe(true);
  });
});

describe('curveSvgPath', () => {
  it('draws one command per input with y flipped for screen coordinates', () => {
    const commands = curveSvgPath([
      { x: 0, y: 0 },
      { x: 255, y: 255 },
    ]).split(' L');
    expect(commands).toHaveLength(256);
    expect(commands[0]).toBe('M0 255');
    expect(commands.at(-1)).toBe('255 0');
  });
});
