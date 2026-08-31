/// <reference lib="webworker" />

import { processEffect } from './processor';
import type { EffectId, EffectParameters } from './types';

interface EffectRequest {
  id: number;
  effect: EffectId;
  parameters: EffectParameters;
  width: number;
  height: number;
  buffer: ArrayBuffer;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function validateRequest(value: unknown): EffectRequest {
  if (!isRecord(value)) throw new Error('The effect worker received an invalid request.');
  const { id, effect, parameters, width, height, buffer } = value;
  if (!Number.isSafeInteger(id) || typeof id !== 'number' || id < 0) {
    throw new Error('The effect request id is invalid.');
  }
  if (typeof effect !== 'string') throw new Error('The effect id is invalid.');
  if (!isRecord(parameters)) throw new Error('The effect parameters are invalid.');
  if (!Number.isSafeInteger(width) || typeof width !== 'number' || width < 1) {
    throw new Error('The effect image width is invalid.');
  }
  if (!Number.isSafeInteger(height) || typeof height !== 'number' || height < 1) {
    throw new Error('The effect image height is invalid.');
  }
  const expectedByteLength = width * height * 4;
  if (!Number.isSafeInteger(expectedByteLength) || !(buffer instanceof ArrayBuffer)) {
    throw new Error('The effect image buffer is invalid.');
  }
  if (buffer.byteLength !== expectedByteLength) throw new Error('The effect image buffer has an invalid length.');
  return { id, effect: effect as EffectId, parameters: parameters as EffectParameters, width, height, buffer };
}

self.onmessage = (event: MessageEvent<unknown>) => {
  const candidate = event.data;
  const id =
    isRecord(candidate) && typeof candidate.id === 'number' && Number.isSafeInteger(candidate.id) ? candidate.id : -1;
  try {
    const { effect, parameters, width, height, buffer } = validateRequest(candidate);
    const pixels = processEffect(new Uint8ClampedArray(buffer), width, height, effect, parameters, (progress) => {
      self.postMessage({ id, type: 'progress', progress });
    });
    const result = pixels.buffer as ArrayBuffer;
    self.postMessage({ id, type: 'complete', width, height, buffer: result }, { transfer: [result] });
  } catch (error) {
    self.postMessage({
      id,
      type: 'error',
      error: error instanceof Error ? error.message : 'Effect processing failed.',
    });
  }
};

export {};
