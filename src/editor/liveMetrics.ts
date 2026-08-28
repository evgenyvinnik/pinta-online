import type { Point } from './types';

export interface SelectionSize {
  width: number;
  height: number;
}

export interface RafValueStore<T> {
  getSnapshot: () => T;
  subscribe: (listener: () => void) => () => void;
  publish: (value: T) => void;
}

function scheduleFrame(callback: () => void) {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback);
  return setTimeout(callback, 0) as unknown as number;
}

/** Coalesces high-frequency paint-surface telemetry to one notification per display frame. */
export function createRafValueStore<T>(initialValue: T): RafValueStore<T> {
  let current = initialValue;
  let pending = initialValue;
  let scheduled = false;
  const listeners = new Set<() => void>();

  return {
    getSnapshot: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publish: (value) => {
      pending = value;
      if (scheduled) return;
      scheduled = true;
      scheduleFrame(() => {
        scheduled = false;
        if (Object.is(current, pending)) return;
        current = pending;
        for (const listener of listeners) listener();
      });
    },
  };
}

export interface EditorLiveMetrics {
  pointer: RafValueStore<Point>;
  selectionSize: RafValueStore<SelectionSize | null>;
}

export function createEditorLiveMetrics(): EditorLiveMetrics {
  return {
    pointer: createRafValueStore<Point>({ x: 0, y: 0 }),
    selectionSize: createRafValueStore<SelectionSize | null>(null),
  };
}
