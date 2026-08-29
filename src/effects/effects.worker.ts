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

self.onmessage = (event: MessageEvent<EffectRequest>) => {
  const { id, effect, parameters, width, height, buffer } = event.data;
  try {
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
