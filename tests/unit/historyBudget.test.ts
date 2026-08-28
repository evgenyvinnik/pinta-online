import { afterEach, describe, expect, it } from 'vitest';
import {
  MINIMUM_HISTORY_ENTRIES,
  firstAffordableHistoryIndex,
  historyByteBudget,
  retainedBytesOf,
} from '../../src/editor/historyBudget';
import type { HistorySnapshot, LayerSnapshot } from '../../src/editor/types';

const MB = 1024 * 1024;

/** One megapixel is 4 MB of RGBA, which makes the arithmetic below readable. */
function megapixel(): ImageData {
  return new ImageData(new Uint8ClampedArray(4 * MB), 1024, 1024);
}

function layer(pixels: ImageData, id = 'layer'): LayerSnapshot {
  return { id, name: id, visible: true, opacity: 1, blendMode: 'normal', pixels };
}

function snapshot(layers: LayerSnapshot[], label = 'Step'): HistorySnapshot {
  return { label, layers, activeLayerId: layers[0]?.id ?? '', width: 1024, height: 1024 };
}

/** Mirrors the editor: a step that touched one layer reuses the other layers' buffers. */
function stack(steps: number, layersPerStep: number) {
  const untouched = Array.from({ length: layersPerStep - 1 }, (_, index) => layer(megapixel(), `static-${index}`));
  return Array.from({ length: steps }, () => snapshot([layer(megapixel(), 'painted'), ...untouched]));
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'deviceMemory');
});

describe('retainedBytesOf', () => {
  it('counts every distinct buffer a snapshot holds', () => {
    const entry = snapshot([layer(megapixel(), 'a'), layer(megapixel(), 'b')]);
    entry.selection = { tool: 'rectangle-select', mask: megapixel() } as HistorySnapshot['selection'];
    entry.floatingPixels = { layerId: 'a', pixels: megapixel() } as HistorySnapshot['floatingPixels'];

    expect(retainedBytesOf(entry, new Set())).toBe(16 * MB);
  });

  it('charges a shared buffer to the first snapshot only', () => {
    const shared = megapixel();
    const seen = new Set<ArrayBufferLike>();
    const first = snapshot([layer(shared, 'a')]);
    const second = snapshot([layer(shared, 'a')]);

    expect(retainedBytesOf(first, seen)).toBe(4 * MB);
    // The editor reuses the ImageData of layers a step did not touch; charging it twice would
    // evict far more history than the tab is actually holding.
    expect(retainedBytesOf(second, seen)).toBe(0);
  });
});

describe('historyByteBudget', () => {
  it('scales with reported memory but stays inside sane bounds', () => {
    const set = (value: number | undefined) =>
      Object.defineProperty(navigator, 'deviceMemory', { configurable: true, value });

    set(8);
    expect(historyByteBudget()).toBe(1024 * MB);
    // A 512 MB phone must still keep enough history to be usable.
    set(0.5);
    expect(historyByteBudget()).toBe(256 * MB);
    // A workstation reporting 64 GB should not try to hold a whole session.
    set(64);
    expect(historyByteBudget()).toBe(1536 * MB);
    // Safari and Firefox do not expose deviceMemory at all.
    set(undefined);
    expect(historyByteBudget()).toBe(512 * MB);
  });
});

describe('firstAffordableHistoryIndex', () => {
  it('keeps the whole stack when it fits', () => {
    expect(firstAffordableHistoryIndex(stack(20, 1), 1024 * MB)).toBe(0);
  });

  it('drops the oldest entries and keeps the newest once over budget', () => {
    // Twenty steps of one changed megapixel layer each: 80 MB, against a 60 MB budget.
    const history = stack(20, 1);
    const from = firstAffordableHistoryIndex(history, 60 * MB);

    expect(from).toBeGreaterThan(0);
    expect(history.length - from).toBeGreaterThanOrEqual(MINIMUM_HISTORY_ENTRIES);
    // Whatever survives has to fit, or the eviction did not achieve anything.
    expect(retainedTotal(history.slice(from))).toBeLessThanOrEqual(60 * MB);
  });

  it('never trims below the floor, even under a budget nothing can satisfy', () => {
    const history = stack(40, 1);
    const from = firstAffordableHistoryIndex(history, 1);

    expect(history.length - from).toBe(MINIMUM_HISTORY_ENTRIES);
  });

  it('ignores unchanged layers, so a many-layer document is not punished', () => {
    // Six layers per step, but only one differs between steps: shared buffers mean the real
    // cost is 20 changed megapixels plus five held once, not 120.
    const shared = firstAffordableHistoryIndex(stack(20, 6), 110 * MB);

    expect(shared).toBe(0);
  });

  it('handles an empty stack', () => {
    expect(firstAffordableHistoryIndex([], 1)).toBe(0);
  });
});

function retainedTotal(history: HistorySnapshot[]) {
  const seen = new Set<ArrayBufferLike>();
  return history.reduce((total, entry) => total + retainedBytesOf(entry, seen), 0);
}
