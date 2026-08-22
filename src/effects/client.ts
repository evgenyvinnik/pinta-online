import type { EffectId, EffectParameters } from './types';

interface EffectResponse {
  id: number;
  width?: number;
  height?: number;
  buffer?: ArrayBuffer;
  error?: string;
}

interface PendingEffect {
  resolve: (image: ImageData) => void;
  reject: (error: Error) => void;
}

let effectWorker: Worker | null = null;
let nextRequestId = 1;
const pending = new Map<number, PendingEffect>();

function getWorker() {
  if (effectWorker) return effectWorker;
  effectWorker = new Worker(new URL('./effects.worker.ts', import.meta.url), { type: 'module', name: 'pinta-effects' });
  effectWorker.onmessage = (event: MessageEvent<EffectResponse>) => {
    const response = event.data;
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    if (response.error || !response.buffer || !response.width || !response.height) {
      request.reject(new Error(response.error ?? 'The effect worker returned an invalid image.'));
      return;
    }
    request.resolve(new ImageData(new Uint8ClampedArray(response.buffer), response.width, response.height));
  };
  effectWorker.onerror = (event) => {
    const error = new Error(event.message || 'The effect worker stopped unexpectedly.');
    for (const request of pending.values()) request.reject(error);
    pending.clear();
    effectWorker?.terminate();
    effectWorker = null;
  };
  return effectWorker;
}

export function runImageEffect(image: ImageData, effect: EffectId, parameters: EffectParameters = {}) {
  const id = nextRequestId++;
  const pixels = image.data.slice();
  return new Promise<ImageData>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({
      id,
      effect,
      parameters,
      width: image.width,
      height: image.height,
      buffer: pixels.buffer,
    }, [pixels.buffer]);
  });
}

