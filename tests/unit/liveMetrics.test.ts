import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRafValueStore } from '../../src/editor/liveMetrics';

afterEach(() => vi.unstubAllGlobals());

describe('createRafValueStore', () => {
  it('coalesces rapid publications into one frame notification with the newest value', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    const store = createRafValueStore({ x: 0, y: 0 });
    const listener = vi.fn();
    store.subscribe(listener);

    store.publish({ x: 1, y: 2 });
    store.publish({ x: 3, y: 4 });
    store.publish({ x: 5, y: 6 });

    expect(frames).toHaveLength(1);
    expect(listener).not.toHaveBeenCalled();
    frames[0](16);
    expect(listener).toHaveBeenCalledOnce();
    expect(store.getSnapshot()).toEqual({ x: 5, y: 6 });
  });

  it('unsubscribes cleanly', () => {
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    });
    const store = createRafValueStore(0);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.publish(1);
    frame?.(16);
    expect(listener).not.toHaveBeenCalled();
  });
});
