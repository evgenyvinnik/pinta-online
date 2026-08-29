import type { RgbHistogram } from '../../../editor/usePaintEditor';
import type { EffectParameters } from '../../../effects/types';

export type LevelChannel = 'red' | 'green' | 'blue';

export type LevelControlKey = 'inputLow' | 'inputHigh' | 'gamma' | 'outputLow' | 'outputHigh';

export const LEVEL_CONTROLS: Array<{
  key: LevelControlKey;
  label: string;
  min: number;
  max: number;
  step: number;
}> = [
  { key: 'inputLow', label: 'Input low', min: 0, max: 254, step: 1 },
  { key: 'inputHigh', label: 'Input high', min: 1, max: 255, step: 1 },
  { key: 'gamma', label: 'Gamma', min: 0.1, max: 10, step: 0.1 },
  { key: 'outputLow', label: 'Output low', min: 0, max: 254, step: 1 },
  { key: 'outputHigh', label: 'Output high', min: 1, max: 255, step: 1 },
];

export function levelParameterKey(channel: LevelChannel, control: LevelControlKey) {
  return `levels_${channel}_${control}`;
}

export function levelValue(parameters: EffectParameters, channel: LevelChannel, control: LevelControlKey) {
  return parameters[levelParameterKey(channel, control)];
}

export function levelColor(parameters: EffectParameters, control: Exclude<LevelControlKey, 'gamma'>) {
  return `#${(['red', 'green', 'blue'] as LevelChannel[])
    .map((channel) => Math.round(levelValue(parameters, channel, control)).toString(16).padStart(2, '0'))
    .join('')}`;
}

export function mapLevelValue(input: number, parameters: EffectParameters, channel: LevelChannel) {
  const inputLow = levelValue(parameters, channel, 'inputLow');
  const inputHigh = levelValue(parameters, channel, 'inputHigh');
  const outputLow = levelValue(parameters, channel, 'outputLow');
  const outputHigh = levelValue(parameters, channel, 'outputHigh');
  const gamma = levelValue(parameters, channel, 'gamma');
  if (input <= inputLow) return outputLow;
  if (input >= inputHigh) return outputHigh;
  return Math.max(0, Math.min(255, Math.round(
    outputLow + (outputHigh - outputLow) * ((input - inputLow) / (inputHigh - inputLow)) ** gamma,
  )));
}

export function leveledHistogram(histogram: RgbHistogram, parameters: EffectParameters): RgbHistogram {
  const output: RgbHistogram = {
    red: Array<number>(256).fill(0),
    green: Array<number>(256).fill(0),
    blue: Array<number>(256).fill(0),
  };
  for (const channel of ['red', 'green', 'blue'] as LevelChannel[]) {
    histogram[channel].forEach((occurrences, input) => {
      output[channel][mapLevelValue(input, parameters, channel)] += occurrences;
    });
  }
  return output;
}
