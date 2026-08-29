import { applySurfaceDiff, createSurfaceDiff, surfaceDiffByteSize, type SurfaceDiff } from './surfaceDiff';

/**
 * How history stores a layer's pixels.
 *
 * Native keeps one `SurfaceDiff` per history item and applies it to the live surface. The web
 * port restores an arbitrary index instead of stepping, so it needs each entry to be
 * reconstructable on its own. The chain runs *backwards*: the newest entry holds real pixels and
 * older entries hold a diff that rebuilds them from their successor. Undo therefore costs one
 * small diff, which is the move people actually make, and jumping to an old entry costs at most
 * `MAX_DIFF_DEPTH` of them because the chain is anchored by a full copy at that interval.
 *
 * Nodes are shared: when a step leaves a layer untouched, both entries point at the same node,
 * so an unchanged layer still costs nothing.
 */

/** Longest run of diffs before a full copy is kept as an anchor. Bounds restore cost. */
export const MAX_DIFF_DEPTH = 24;

export interface PixelNode {
  /** Set on anchors and on the newest entry; null once demoted to a diff. */
  image: ImageData | null;
  /** The newer node this one rebuilds from. */
  base: PixelNode | null;
  diff: SurfaceDiff | null;
}

export function pixelNode(image: ImageData): PixelNode {
  return { image, base: null, diff: null };
}

function copyOf(image: ImageData) {
  return new ImageData(new Uint8ClampedArray(image.data), image.width, image.height);
}

/**
 * Materialises a node's pixels.
 *
 * Walks to the nearest anchor first and then replays the diffs into a single buffer, so a depth
 * of twenty costs one full copy rather than twenty. The returned image belongs to the caller
 * only when it was reconstructed; anchors hand back their own buffer, which callers must treat
 * as read-only — every reader in the editor does.
 */
export function resolvePixels(node: PixelNode): ImageData {
  if (node.image) return node.image;

  const chain: PixelNode[] = [];
  let cursor: PixelNode | null = node;
  while (cursor && !cursor.image) {
    chain.push(cursor);
    cursor = cursor.base;
  }
  if (!cursor?.image) throw new Error('History pixels are missing the anchor they rebuild from.');

  const output = copyOf(cursor.image);
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const step = chain[index];
    if (!step.diff) throw new Error('History pixels are missing a difference in the chain.');
    applySurfaceDiff(step.diff, output);
  }
  return output;
}

/**
 * Replaces an older node's full copy with a diff against its successor, freeing the copy.
 *
 * Declines — leaving the full copy in place as a new anchor — when the chain is already at its
 * depth limit, when the two differ in size (a canvas resize), or when `SurfaceDiff` judges the
 * change too large to be worth storing. Returns whether the node was demoted.
 */
export function demoteToDiff(older: PixelNode, newer: PixelNode) {
  if (older === newer || !older.image) return false;

  const target = resolvePixels(newer);
  if (target.width !== older.image.width || target.height !== older.image.height) return false;

  // Stores the older pixels, so applying it to a copy of the newer surface rebuilds the older.
  const diff = createSurfaceDiff(older.image, target);
  if (!diff) return false;

  older.image = null;
  older.base = newer;
  older.diff = diff;
  return true;
}

/**
 * Whether the entry at this index keeps its full copy instead of becoming a diff.
 *
 * Depth cannot be tracked on the node itself: demoting one node silently lengthens the walk for
 * every node behind it, so a stored number goes stale the moment its successor is demoted. The
 * position decides instead. Every `maxDepth`-th entry stays whole, so a node walks at most that
 * far toward the next anchor. Being a function of the index alone makes it per-document and
 * stateless, and a layer whose own demotion was refused simply gains a nearer anchor.
 */
export function shouldAnchorAt(index: number, maxDepth = MAX_DIFF_DEPTH) {
  return index % maxDepth === 0;
}

/**
 * Materialises a node back into a full copy.
 *
 * Needed when the redo tail is discarded: the surviving newest entry may be a diff whose chain
 * runs through entries that are about to be dropped from the history. Promoting it cuts that
 * link and restores the invariant that the newest entry is always whole, which is what keeps
 * undo to a single diff.
 */
export function promoteToAnchor(node: PixelNode) {
  if (node.image) return;
  node.image = resolvePixels(node);
  node.base = null;
  node.diff = null;
}

/** The longest walk any node can need, for tests and for reasoning about restore cost. */
export function chainDepth(node: PixelNode) {
  let depth = 0;
  let cursor: PixelNode | null = node;
  while (cursor && !cursor.image) {
    depth += 1;
    cursor = cursor.base;
  }
  return depth;
}

/** What a node costs to retain, counting each shared buffer once. */
export function pixelNodeByteSize(node: PixelNode, seen: Set<object>) {
  if (seen.has(node)) return 0;
  seen.add(node);
  if (node.image) {
    if (seen.has(node.image.data.buffer)) return 0;
    seen.add(node.image.data.buffer);
    return node.image.data.byteLength;
  }
  return node.diff ? surfaceDiffByteSize(node.diff) : 0;
}
