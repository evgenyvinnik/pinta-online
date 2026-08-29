import { describe, expect, it } from 'vitest';
import {
  MAX_DIFF_DEPTH,
  chainDepth,
  promoteToAnchor,
  shouldAnchorAt,
  demoteToDiff,
  pixelNode,
  pixelNodeByteSize,
  resolvePixels,
} from '../../src/editor/historyPixels';

function surface(width: number, height: number, seed = 0) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = (index + seed) % 256;
    pixels[index + 1] = (index * 3 + seed) % 256;
    pixels[index + 2] = (index * 7 + seed) % 256;
    pixels[index + 3] = 255;
  }
  return new ImageData(pixels, width, height);
}

function withDot(image: ImageData, x: number, y: number, value: number) {
  const next = new ImageData(new Uint8ClampedArray(image.data), image.width, image.height);
  next.data.set([value, value, value, 255], (y * image.width + x) * 4);
  return next;
}

/** Builds a chain the way pushHistory does: newest stays full, its predecessor is demoted. */
function chainOf(states: ImageData[]) {
  const nodes = states.map(pixelNode);
  for (let index = 1; index < nodes.length; index += 1) {
    if (shouldAnchorAt(index - 1)) continue;
    demoteToDiff(nodes[index - 1], nodes[index]);
  }
  return nodes;
}

describe('resolvePixels', () => {
  it('returns an anchor untouched', () => {
    const image = surface(8, 8);
    expect(resolvePixels(pixelNode(image))).toBe(image);
  });

  it('rebuilds a demoted node exactly', () => {
    // Entry 0 is always an anchor, so the demoted one to inspect is entry 1.
    const first = surface(16, 16);
    const second = withDot(first, 3, 4, 200);
    const third = withDot(second, 9, 2, 40);
    const nodes = chainOf([first, second, third]);

    expect(nodes[0].image).not.toBeNull();
    expect(nodes[1].image).toBeNull();
    expect([...resolvePixels(nodes[1]).data]).toEqual([...second.data]);
    // The newest entry keeps its real pixels, so undo costs one diff and no walking.
    expect(resolvePixels(nodes[2])).toBe(third);
  });

  it('rebuilds every entry of a long chain', () => {
    const states = [surface(24, 24)];
    for (let step = 1; step < 15; step += 1) states.push(withDot(states[step - 1], step, step, step * 5));
    const nodes = chainOf(states);

    for (let index = 0; index < states.length; index += 1) {
      expect([...resolvePixels(nodes[index]).data], `entry ${index}`).toEqual([...states[index].data]);
    }
  });

  it('gives a reconstructed node its own buffer each time', () => {
    const first = surface(8, 8);
    const second = withDot(first, 1, 1, 9);
    const nodes = chainOf([first, second, withDot(second, 4, 4, 3)]);
    const original = second.data[0];

    const resolved = resolvePixels(nodes[1]);
    resolved.data[0] = 123;
    // A second read must not see the first caller's scribble.
    expect(resolvePixels(nodes[1]).data[0]).toBe(original);
  });
});

describe('demoteToDiff', () => {
  it('frees the older full copy', () => {
    const before = surface(32, 32);
    const older = pixelNode(before);
    const newer = pixelNode(withDot(before, 5, 5, 100));

    expect(demoteToDiff(older, newer)).toBe(true);
    expect(older.image).toBeNull();
    expect(older.diff).not.toBeNull();
  });

  it('refuses when the surfaces differ in size, as a canvas resize does', () => {
    const older = pixelNode(surface(16, 16));
    const newer = pixelNode(surface(20, 16));

    expect(demoteToDiff(older, newer)).toBe(false);
    expect(older.image).not.toBeNull();
  });

  it('refuses when the change is too large to be worth a diff', () => {
    // Every pixel differs, so SurfaceDiff declines and the full copy is the better trade.
    const older = pixelNode(surface(16, 16, 0));
    const newer = pixelNode(surface(16, 16, 5));

    expect(demoteToDiff(older, newer)).toBe(false);
    expect(older.image).not.toBeNull();
  });

  it('refuses to demote a node against itself', () => {
    const shared = pixelNode(surface(8, 8));
    expect(demoteToDiff(shared, shared)).toBe(false);
  });

  it('anchors the chain so restore cost stays bounded', () => {
    const states = [surface(20, 20)];
    for (let step = 1; step <= MAX_DIFF_DEPTH + 8; step += 1) {
      states.push(withDot(states[step - 1], step % 20, Math.floor(step / 20), step));
    }
    const nodes = chainOf(states);

    expect(Math.max(...nodes.map(chainDepth))).toBeLessThanOrEqual(MAX_DIFF_DEPTH);
    // Past the limit the chain must fall back to full copies rather than growing.
    expect(nodes.filter((node) => node.image !== null).length).toBeGreaterThan(1);
    // And every entry still rebuilds correctly across the anchor boundary.
    for (let index = 0; index < states.length; index += 1) {
      expect([...resolvePixels(nodes[index]).data], `entry ${index}`).toEqual([...states[index].data]);
    }
  });
});

describe('pixelNodeByteSize', () => {
  it('charges a shared node once', () => {
    const shared = pixelNode(surface(16, 16));
    const seen = new Set<object>();

    expect(pixelNodeByteSize(shared, seen)).toBe(16 * 16 * 4);
    expect(pixelNodeByteSize(shared, seen)).toBe(0);
  });

  it('shows a diff costing far less than the copy it replaced', () => {
    const before = surface(200, 200);
    const middle = withDot(before, 100, 100, 1);
    const nodes = chainOf([before, middle, withDot(middle, 20, 20, 2)]);

    expect(pixelNodeByteSize(nodes[1], new Set())).toBeLessThan(before.data.byteLength / 50);
  });

  it('makes a long chain cost a fraction of storing every step in full', () => {
    const states = [surface(120, 120)];
    for (let step = 1; step < 20; step += 1) states.push(withDot(states[step - 1], step, step, step * 3));
    const nodes = chainOf(states);

    const seen = new Set<object>();
    const stored = nodes.reduce((total, node) => total + pixelNodeByteSize(node, seen), 0);
    const full = states.length * states[0].data.byteLength;

    expect(stored).toBeLessThan(full / 5);
  });
});

describe('promoteToAnchor', () => {
  it('turns a diff back into a full copy without changing what it holds', () => {
    const first = surface(16, 16);
    const second = withDot(first, 2, 2, 40);
    const nodes = chainOf([first, second, withDot(second, 7, 7, 80)]);
    expect(nodes[1].image).toBeNull();

    promoteToAnchor(nodes[1]);

    expect(nodes[1].image).not.toBeNull();
    expect(nodes[1].base).toBeNull();
    expect([...resolvePixels(nodes[1]).data]).toEqual([...second.data]);
  });

  it('cuts the link to entries a discarded redo tail is about to drop', () => {
    const states = [surface(16, 16)];
    for (let step = 1; step < 5; step += 1) states.push(withDot(states[step - 1], step, 1, step * 9));
    const nodes = chainOf(states);

    // Undo to entry 2, then push: entries 3 and 4 leave the history, and entry 2 must not
    // still be rebuilding itself from them.
    promoteToAnchor(nodes[2]);

    expect(nodes[2].base).toBeNull();
    expect([...resolvePixels(nodes[2]).data]).toEqual([...states[2].data]);
  });

  it('leaves an anchor alone', () => {
    const image = surface(8, 8);
    const node = pixelNode(image);
    promoteToAnchor(node);
    expect(node.image).toBe(image);
  });
});
