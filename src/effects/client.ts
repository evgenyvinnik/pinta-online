import type { EffectId, EffectParameters } from './types';

interface EffectResponse {
  id: number;
  type?: 'progress' | 'complete' | 'error';
  progress?: number;
  width?: number;
  height?: number;
  buffer?: ArrayBuffer;
  error?: string;
}

interface PendingEffect {
  resolve: (image: ImageData) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
  onProgress?: (progress: number) => void;
}

let effectWorker: Worker | null = null;
let nextRequestId = 1;
const pending = new Map<number, PendingEffect>();
/**
 * Set when the worker cannot be constructed at all — a strict CSP, or a chunk that will not
 * load offline. Without a fallback every adjustment and effect would fail permanently, so the
 * processor runs on the main thread instead. It blocks the UI and cannot be cancelled midway,
 * which is why this is a fallback and not the normal path.
 */
let workerUnavailable = false;

async function runOnMainThread(
  image: ImageData,
  effect: EffectId,
  parameters: EffectParameters,
  signal?: AbortSignal,
  onProgress?: (progress: number) => void,
) {
  if (signal?.aborted) throw cancellationError();
  const { processEffect } = await import('./processor');
  if (signal?.aborted) throw cancellationError();
  onProgress?.(0);
  // Yield once so a caller that only wanted to show a spinner gets a frame to paint it.
  await new Promise((resolve) => setTimeout(resolve, 0));
  const pixels = processEffect(new Uint8ClampedArray(image.data), image.width, image.height, effect, parameters);
  onProgress?.(1);
  return new ImageData(pixels, image.width, image.height);
}

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
    if (response.type === 'progress') {
      request.onProgress?.(Math.max(0, Math.min(1, response.progress ?? 0)));
      return;
    }
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

export function runImageEffect(
  image: ImageData,
  effect: EffectId,
  parameters: EffectParameters = {},
  signal?: AbortSignal,
  onProgress?: (progress: number) => void,
) {
  if (workerUnavailable) return runOnMainThread(image, effect, parameters, signal, onProgress);

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
    pending.set(id, { resolve, reject, cleanup, onProgress });
    try {
      getWorker().postMessage({
        id,
        effect,
        parameters,
        width: image.width,
        height: image.height,
        buffer: pixels.buffer,
      }, [pixels.buffer]);
    } catch (error) {
      // Construction failed rather than the effect itself, so retrying the worker for later
      // requests would fail the same way. Fall back for the rest of the session.
      pending.delete(id);
      cleanup();
      workerUnavailable = true;
      effectWorker = null;
      console.warn('Pinta Online is running effects on the main thread; the worker is unavailable.', error);
      runOnMainThread(image, effect, parameters, signal, onProgress).then(resolve, reject);
    }
  });
}
