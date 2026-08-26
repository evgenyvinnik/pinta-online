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
  cleanup: () => void;
}

let effectWorker: Worker | null = null;
let nextRequestId = 1;
const pending = new Map<number, PendingEffect>();

function cancellationError() {
  return new DOMException('Effect rendering was canceled.', 'AbortError');
}

function stopWorker(error: Error) {
  const requests = [...pending.values()];
  pending.clear();
  effectWorker?.terminate();
  effectWorker = null;
  for (const request of requests) {
    request.cleanup();
    request.reject(error);
  }
}

function getWorker() {
  if (effectWorker) return effectWorker;
  effectWorker = new Worker(new URL('./effects.worker.ts', import.meta.url), { type: 'module', name: 'pinta-effects' });
  effectWorker.onmessage = (event: MessageEvent<EffectResponse>) => {
    const response = event.data;
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    request.cleanup();
    if (response.error || !response.buffer || !response.width || !response.height) {
      request.reject(new Error(response.error ?? 'The effect worker returned an invalid image.'));
      return;
    }
    request.resolve(new ImageData(new Uint8ClampedArray(response.buffer), response.width, response.height));
  };
  effectWorker.onerror = (event) => {
    stopWorker(new Error(event.message || 'The effect worker stopped unexpectedly.'));
  };
  return effectWorker;
}

export function runImageEffect(image: ImageData, effect: EffectId, parameters: EffectParameters = {}, signal?: AbortSignal) {
  const id = nextRequestId++;
  const pixels = image.data.slice();
  return new Promise<ImageData>((resolve, reject) => {
    if (signal?.aborted) {
      reject(cancellationError());
      return;
    }
    const onAbort = () => {
      if (!pending.has(id)) return;
      // Effect processors run synchronously inside the worker, so terminating
      // it is the only prompt cancellation primitive available to the web.
      // Pinta serializes effect rendering too, making cancellation of every
      // queued preview the correct behavior here.
      stopWorker(cancellationError());
    };
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    signal?.addEventListener('abort', onAbort, { once: true });
    pending.set(id, { resolve, reject, cleanup });
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
