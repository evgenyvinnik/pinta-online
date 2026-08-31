import { reportError } from '../errorReporting';
import type { EffectId, EffectParameters } from './types';

interface EffectResponse {
  id: number;
  type: 'progress' | 'complete' | 'error';
  progress?: number;
  width?: number;
  height?: number;
  buffer?: ArrayBuffer;
  error?: string;
}

interface PendingEffect {
  width: number;
  height: number;
  resolve: (image: ImageData) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
  fallback: () => Promise<ImageData>;
  onProgress?: (progress: number) => void;
}

interface WorkerSession {
  worker: Worker;
  pending: Map<number, PendingEffect>;
  stopped: boolean;
}

let activeSession: WorkerSession | null = null;
let nextRequestId = 1;
/**
 * Set when the worker cannot be constructed or posted to at all — a strict CSP, a chunk that
 * will not load offline, or a browser without module-worker support. Runtime worker crashes do
 * not set this flag: their in-flight requests fall back safely, and a later request gets a fresh
 * worker so one transient failure does not disable background rendering for the whole session.
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
  // Yield once so a caller that only wanted to show a spinner gets a frame to paint it.
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (signal?.aborted) throw cancellationError();
  const pixels = processEffect(
    new Uint8ClampedArray(image.data),
    image.width,
    image.height,
    effect,
    parameters,
    onProgress,
  );
  if (signal?.aborted) throw cancellationError();
  return new ImageData(pixels, image.width, image.height);
}

function cancellationError() {
  return new DOMException('Effect rendering was canceled.', 'AbortError');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function invalidWorkerResponse(message = 'The effect worker returned an invalid response.') {
  return new Error(message);
}

function settleWithFallback(request: PendingEffect) {
  request.cleanup();
  request.fallback().then(request.resolve, request.reject);
}

function stopWorker(session: WorkerSession, error: Error, fallback: boolean) {
  if (session.stopped) return;
  session.stopped = true;
  if (activeSession === session) activeSession = null;

  session.worker.onmessage = null;
  session.worker.onerror = null;
  session.worker.onmessageerror = null;
  session.worker.terminate();

  const requests = [...session.pending.values()];
  session.pending.clear();
  for (const request of requests) {
    if (fallback) settleWithFallback(request);
    else {
      request.cleanup();
      request.reject(error);
    }
  }
}

function failWorkerProtocol(session: WorkerSession, message?: string) {
  const error = invalidWorkerResponse(message);
  reportError(error, 'worker');
  stopWorker(session, error, true);
}

function getWorkerSession() {
  if (activeSession) return activeSession;

  const worker = new Worker(new URL('./effects.worker.ts', import.meta.url), {
    type: 'module',
    name: 'pinta-effects',
  });
  const session: WorkerSession = { worker, pending: new Map(), stopped: false };
  activeSession = session;

  worker.onmessage = (event: MessageEvent<unknown>) => {
    if (session.stopped) return;
    const candidate = event.data;
    if (!isRecord(candidate) || !Number.isSafeInteger(candidate.id)) {
      failWorkerProtocol(session);
      return;
    }

    const response = candidate as unknown as EffectResponse;
    const request = session.pending.get(response.id);
    if (!request) return;

    if (response.type === 'progress') {
      if (typeof response.progress !== 'number' || !Number.isFinite(response.progress)) {
        failWorkerProtocol(session, 'The effect worker returned invalid progress.');
        return;
      }
      request.onProgress?.(Math.max(0, Math.min(1, response.progress)));
      return;
    }

    if (response.type === 'error') {
      session.pending.delete(response.id);
      request.cleanup();
      request.reject(new Error(typeof response.error === 'string' ? response.error : 'Effect processing failed.'));
      return;
    }

    const expectedByteLength = request.width * request.height * 4;
    if (
      response.type !== 'complete' ||
      response.width !== request.width ||
      response.height !== request.height ||
      !(response.buffer instanceof ArrayBuffer) ||
      response.buffer.byteLength !== expectedByteLength
    ) {
      failWorkerProtocol(session, 'The effect worker returned invalid image data.');
      return;
    }

    try {
      const image = new ImageData(new Uint8ClampedArray(response.buffer), response.width, response.height);
      session.pending.delete(response.id);
      request.cleanup();
      request.resolve(image);
    } catch (error) {
      failWorkerProtocol(session, error instanceof Error ? error.message : undefined);
    }
  };

  worker.onerror = (event) => {
    if (session.stopped) return;
    event.preventDefault();
    const error = new Error(event.message || 'The effect worker stopped unexpectedly.');
    reportError(error, 'worker');
    stopWorker(session, error, true);
  };

  worker.onmessageerror = (event) => {
    if (session.stopped) return;
    event.preventDefault();
    const error = invalidWorkerResponse('The browser could not decode an effect worker response.');
    reportError(error, 'worker');
    stopWorker(session, error, true);
  };

  return session;
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

    let session: WorkerSession;
    try {
      session = getWorkerSession();
    } catch (error) {
      workerUnavailable = true;
      reportError(error, 'worker');
      console.warn('Pinta Online is running effects on the main thread; the worker is unavailable.', error);
      runOnMainThread(image, effect, parameters, signal, onProgress).then(resolve, reject);
      return;
    }

    const onAbort = () => {
      if (!session.pending.has(id)) return;
      // Effect processors run synchronously inside the worker, so terminating it is the only
      // prompt cancellation primitive. Pinta serializes effect rendering too, making cancellation
      // of every queued preview the least surprising behavior here.
      stopWorker(session, cancellationError(), false);
    };
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const fallback = () => runOnMainThread(image, effect, parameters, signal, onProgress);
    signal?.addEventListener('abort', onAbort, { once: true });
    session.pending.set(id, {
      width: image.width,
      height: image.height,
      resolve,
      reject,
      cleanup,
      fallback,
      onProgress,
    });

    try {
      session.worker.postMessage(
        {
          id,
          effect,
          parameters,
          width: image.width,
          height: image.height,
          buffer: pixels.buffer,
        },
        [pixels.buffer],
      );
    } catch (error) {
      workerUnavailable = true;
      reportError(error, 'worker');
      console.warn('Pinta Online is running effects on the main thread; the worker is unavailable.', error);
      stopWorker(session, error instanceof Error ? error : new Error('The effect worker could not start.'), true);
    }
  });
}
