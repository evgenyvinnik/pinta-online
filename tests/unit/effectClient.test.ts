import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface PostedEffect {
  id: number;
  width: number;
  height: number;
  buffer: ArrayBuffer;
}

class FakeWorker {
  static instances: FakeWorker[] = [];

  onmessage: ((event: MessageEvent<unknown>) => unknown) | null = null;
  onerror: ((event: ErrorEvent) => unknown) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => unknown) | null = null;
  readonly messages: PostedEffect[] = [];
  readonly terminate = vi.fn();

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(message: PostedEffect) {
    this.messages.push(message);
  }

  complete(index = 0, pixels?: Uint8ClampedArray) {
    const request = this.messages[index];
    const buffer = pixels?.buffer ?? request.buffer;
    this.onmessage?.({
      data: {
        id: request.id,
        type: 'complete',
        width: request.width,
        height: request.height,
        buffer,
      },
    } as MessageEvent);
  }

  fail(message: string) {
    const event = {
      message,
      preventDefault: vi.fn(),
    } as unknown as ErrorEvent;
    this.onerror?.(event);
    return event;
  }
}

function image(red = 10, green = 20, blue = 30) {
  return new ImageData(new Uint8ClampedArray([red, green, blue, 255]), 1, 1);
}

async function clientWithFakeWorker() {
  vi.resetModules();
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);
  return import('../../src/effects/client');
}

beforeEach(() => {
  Object.defineProperty(window, 'gtag', { configurable: true, writable: true, value: undefined });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('effect worker client', () => {
  it('falls back safely when a worker returns malformed image data', async () => {
    const { runImageEffect } = await clientWithFakeWorker();
    const result = runImageEffect(image(), 'invert');
    const worker = FakeWorker.instances[0];
    const request = worker.messages[0];

    worker.onmessage?.({
      data: {
        id: request.id,
        type: 'complete',
        width: request.width,
        height: request.height,
        buffer: new ArrayBuffer(1),
      },
    } as MessageEvent);

    await expect(result).resolves.toMatchObject({ width: 1, height: 1 });
    expect([...(await result).data]).toEqual([245, 235, 225, 255]);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('retries in-flight work after a runtime crash and creates a fresh worker later', async () => {
    const { runImageEffect } = await clientWithFakeWorker();
    const first = runImageEffect(image(), 'invert');
    const failedWorker = FakeWorker.instances[0];
    const errorEvent = failedWorker.fail('injected worker crash');

    expect(errorEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect([...(await first).data]).toEqual([245, 235, 225, 255]);

    const second = runImageEffect(image(), 'invert');
    expect(FakeWorker.instances).toHaveLength(2);
    FakeWorker.instances[1].complete(0, new Uint8ClampedArray([9, 8, 7, 255]));
    expect([...(await second).data]).toEqual([9, 8, 7, 255]);
  });

  it('cannot let a stale terminated worker reject a newer session', async () => {
    const { runImageEffect } = await clientWithFakeWorker();
    const controller = new AbortController();
    const canceled = runImageEffect(image(), 'sepia', {}, controller.signal);
    const oldWorker = FakeWorker.instances[0];
    const staleErrorHandler = oldWorker.onerror;
    const rejection = expect(canceled).rejects.toMatchObject({ name: 'AbortError' });

    controller.abort();
    await rejection;

    const current = runImageEffect(image(), 'invert');
    expect(FakeWorker.instances).toHaveLength(2);
    staleErrorHandler?.({ message: 'late stale error', preventDefault: vi.fn() } as unknown as ErrorEvent);
    FakeWorker.instances[1].complete(0, new Uint8ClampedArray([1, 2, 3, 255]));
    expect([...(await current).data]).toEqual([1, 2, 3, 255]);
  });

  it('rejects an effect error once without discarding the healthy worker', async () => {
    const { runImageEffect } = await clientWithFakeWorker();
    const failed = runImageEffect(image(), 'sepia');
    const worker = FakeWorker.instances[0];
    const request = worker.messages[0];
    worker.onmessage?.({
      data: { id: request.id, type: 'error', error: 'invalid effect parameters' },
    } as MessageEvent);
    await expect(failed).rejects.toThrow('invalid effect parameters');

    const next = runImageEffect(image(), 'invert');
    expect(FakeWorker.instances).toHaveLength(1);
    worker.complete(1, new Uint8ClampedArray([4, 5, 6, 255]));
    expect([...(await next).data]).toEqual([4, 5, 6, 255]);
  });

  it('uses the main-thread processor when worker construction is unavailable', async () => {
    vi.resetModules();
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          throw new Error('module workers blocked');
        }
      } as unknown as typeof Worker,
    );
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { runImageEffect } = await import('../../src/effects/client');

    expect([...(await runImageEffect(image(), 'invert')).data]).toEqual([245, 235, 225, 255]);
    expect(warning).toHaveBeenCalledTimes(1);
    // The construction failure is permanent for this page, so the second request must not keep
    // throwing from another attempted constructor.
    expect([...(await runImageEffect(image(1, 2, 3), 'invert')).data]).toEqual([254, 253, 252, 255]);
    expect(warning).toHaveBeenCalledTimes(1);
  });
});
