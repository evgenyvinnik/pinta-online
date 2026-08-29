import { describe, expect, it } from 'vitest';
import { deduplicateHistoryPixels, snapshotSelection, selectionFromSnapshot } from '../../src/editor/layerSnapshots';
import { pixelNode, resolvePixels } from '../../src/editor/historyPixels';
import type { HistorySnapshot, LayerSnapshot, Selection } from '../../src/editor/types';

// The canvas-backed members (makeLayer, paintLayer, snapshotOf, layerFromSnapshot and the
// floating-pixel pair) need a real rasteriser and remain Playwright's. These three are pure.

function image(width: number, height: number, seed: number) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < pixels.length; index += 1) pixels[index] = (index + seed) % 256;
  return new ImageData(pixels, width, height);
}

function layer(pixels: ImageData, id: string): LayerSnapshot {
  return { id, name: id, visible: true, opacity: 1, blendMode: 'normal', pixels: pixelNode(pixels) };
}

function entry(layers: LayerSnapshot[]): HistorySnapshot {
  return { label: 'Step', layers, activeLayerId: layers[0]?.id ?? '', width: 4, height: 4 };
}

describe('deduplicateHistoryPixels', () => {
  it('shares one node between adjacent entries whose pixels match', () => {
    const history = [entry([layer(image(4, 4, 1), 'a')]), entry([layer(image(4, 4, 1), 'a')])];
    const result = deduplicateHistoryPixels(history);

    // Restoring from storage rebuilds every entry separately, so identical layers arrive as
    // distinct buffers. Sharing them again is what keeps a restored history affordable.
    expect(result[1].layers[0].pixels).toBe(result[0].layers[0].pixels);
  });

  it('leaves a layer that genuinely changed alone', () => {
    const history = [entry([layer(image(4, 4, 1), 'a')]), entry([layer(image(4, 4, 9), 'a')])];
    const result = deduplicateHistoryPixels(history);

    expect(result[1].layers[0].pixels).not.toBe(result[0].layers[0].pixels);
    expect([...resolvePixels(result[1].layers[0].pixels).data]).toEqual([...image(4, 4, 9).data]);
  });

  it('matches layers by id, not by position', () => {
    const history = [
      entry([layer(image(4, 4, 1), 'a'), layer(image(4, 4, 2), 'b')]),
      entry([layer(image(4, 4, 2), 'b'), layer(image(4, 4, 1), 'a')]),
    ];
    const result = deduplicateHistoryPixels(history);

    const first = new Map(result[0].layers.map((entry) => [entry.id, entry.pixels]));
    for (const item of result[1].layers) expect(item.pixels, item.id).toBe(first.get(item.id));
  });

  it('carries sharing along a chain, not just between neighbours', () => {
    const history = [1, 1, 1, 1].map((seed) => entry([layer(image(4, 4, seed), 'a')]));
    const result = deduplicateHistoryPixels(history);

    for (const item of result) expect(item.layers[0].pixels).toBe(result[0].layers[0].pixels);
  });

  it('handles an empty history and a single entry', () => {
    expect(deduplicateHistoryPixels([])).toEqual([]);
    const single = [entry([layer(image(4, 4, 1), 'a')])];
    expect(deduplicateHistoryPixels(single)).toHaveLength(1);
  });
});

describe('snapshotSelection', () => {
  const selection: Selection = {
    tool: 'rectangle-select',
    start: { x: 1, y: 2 },
    end: { x: 30, y: 40 },
    points: [{ x: 1, y: 2 }, { x: 30, y: 40 }],
  };

  it('round-trips the geometry a selection is defined by', () => {
    const restored = selectionFromSnapshot(snapshotSelection(selection));
    expect(restored).toMatchObject({ tool: 'rectangle-select', start: { x: 1, y: 2 }, end: { x: 30, y: 40 } });
    expect(restored?.points).toEqual(selection.points);
  });

  it('copies the points rather than aliasing them', () => {
    const snapshot = snapshotSelection(selection);
    selection.points![0].x = 999;
    expect(snapshot?.points?.[0].x).toBe(1);
  });

  it('passes null through in both directions', () => {
    expect(snapshotSelection(null)).toBeNull();
    expect(selectionFromSnapshot(null)).toBeNull();
    expect(selectionFromSnapshot(undefined)).toBeNull();
  });
});
