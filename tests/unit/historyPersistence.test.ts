import { describe, expect, it, vi } from 'vitest';
import { pixelNode } from '../../src/editor/historyPixels';
import type { HistorySnapshot, LayerSnapshot } from '../../src/editor/types';

/**
 * History is the largest thing the workspace writes, and the in-memory model already shares a
 * `PixelNode` between steps that left a layer untouched. These tests pin the write path to
 * actually using that: one PNG encode per distinct node, and the identical `Blob` instance handed
 * back for a repeat so structured clone stores it once.
 *
 * `canvasToPngBlob` is mocked because jsdom cannot encode a canvas, and because counting calls is
 * the assertion — the point is how many encodes happen, not what comes out of them.
 */
const encodes = vi.hoisted(() => ({ count: 0 }));

vi.mock('../../src/editor/workspacePersistence', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/editor/workspacePersistence')>()),
  canvasToPngBlob: vi.fn(() => {
    encodes.count += 1;
    return Promise.resolve(new Blob([new Uint8Array([encodes.count])]));
  }),
}));

vi.mock('../../src/editor/canvasUtils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/editor/canvasUtils')>()),
  imageDataCanvas: vi.fn(() => ({}) as HTMLCanvasElement),
}));

const { persistedHistorySnapshotOf } = await import('../../src/editor/workspaceSerialization');

const image = (marker: number) => new ImageData(new Uint8ClampedArray([marker, 0, 0, 255]), 1, 1);

function layerSnapshot(id: string, pixels: ReturnType<typeof pixelNode>): LayerSnapshot {
  return { id, name: id, visible: true, opacity: 1, blendMode: 'normal', pixels };
}

function snapshot(label: string, layers: LayerSnapshot[]): HistorySnapshot {
  return { label, layers, activeLayerId: layers[0].id, width: 1, height: 1, selection: null };
}

describe('history persistence', () => {
  it('encodes a node once even when many steps share it', async () => {
    encodes.count = 0;
    // One background nobody touches, and a layer that changes at every step.
    const background = pixelNode(image(1));
    const steps = [pixelNode(image(2)), pixelNode(image(3)), pixelNode(image(4))];
    const history = steps.map((ink, index) =>
      snapshot(`step ${index}`, [layerSnapshot('background', background), layerSnapshot('ink', ink)]),
    );

    // A cache shared across the document is what persistedDocumentOf passes in.
    const encoded = new Map<ReturnType<typeof pixelNode>, Promise<Blob>>();
    const { canvasToPngBlob } = await import('../../src/editor/workspacePersistence');
    const { imageDataCanvas } = await import('../../src/editor/canvasUtils');
    const { resolvePixels } = await import('../../src/editor/historyPixels');
    const pngFor = (node: ReturnType<typeof pixelNode>) => {
      const existing = encoded.get(node);
      if (existing) return existing;
      const blob = canvasToPngBlob(imageDataCanvas(resolvePixels(node)));
      encoded.set(node, blob);
      return blob;
    };

    const written = await Promise.all(history.map((entry) => persistedHistorySnapshotOf(entry, pngFor)));

    // Four distinct nodes across six layer slots: without the cache this would be six.
    expect(encodes.count).toBe(4);

    // The shared background must be the *same* Blob in every step, which is what makes
    // structured clone store it once.
    const backgrounds = written.map((entry) => entry.layers.find((layer) => layer.id === 'background')!.pixels);
    expect(backgrounds[1]).toBe(backgrounds[0]);
    expect(backgrounds[2]).toBe(backgrounds[0]);

    // The layer that actually changed must not be shared.
    const inks = written.map((entry) => entry.layers.find((layer) => layer.id === 'ink')!.pixels);
    expect(new Set(inks).size).toBe(3);
  });

  it('encodes each node once per snapshot when called without a shared cache', async () => {
    encodes.count = 0;
    const shared = pixelNode(image(1));
    // Its own default cache still collapses repeats inside one snapshot.
    await persistedHistorySnapshotOf(snapshot('one', [layerSnapshot('a', shared), layerSnapshot('b', shared)]));

    expect(encodes.count).toBe(1);
  });
});
