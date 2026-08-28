import type { HistorySnapshot } from './types';

/**
 * History is deliberately unbounded, matching native Pinta, and snapshots already share the
 * pixel buffers of layers that did not change between steps. What is left still grows without
 * limit on a large document, and a tab that runs out of memory loses everything rather than
 * one undo step.
 *
 * This budget is a last line of defence, not a cap: it sheds the oldest entries only once the
 * retained pixels would otherwise threaten the tab, and never trims below the floor below.
 */
export const MINIMUM_HISTORY_ENTRIES = 12;

export function historyByteBudget() {
  const gigabytes = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  // An eighth of reported memory, floored so a phone keeps a usable stack and capped so a
  // workstation does not try to hold a whole session of full-resolution snapshots.
  return Math.max(256, Math.min(1536, gigabytes * 128)) * 1024 * 1024;
}

/** Counts each pixel buffer once, since unchanged layers are shared across snapshots. */
export function retainedBytesOf(entry: HistorySnapshot, seen: Set<ArrayBufferLike>) {
  let bytes = 0;
  const add = (image: ImageData | null | undefined) => {
    if (!image || seen.has(image.data.buffer)) return;
    seen.add(image.data.buffer);
    bytes += image.data.byteLength;
  };
  for (const layer of entry.layers) add(layer.pixels);
  add(entry.selection?.mask);
  add(entry.floatingPixels?.pixels);
  return bytes;
}

/**
 * Walks back from the newest entry and returns the oldest index that still fits the budget —
 * one pass, counting shared buffers once. Returns 0 when the whole stack fits.
 */
export function firstAffordableHistoryIndex(history: HistorySnapshot[], budget: number) {
  const seen = new Set<ArrayBufferLike>();
  let bytes = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    bytes += retainedBytesOf(history[index], seen);
    if (bytes > budget && history.length - index > MINIMUM_HISTORY_ENTRIES) return index + 1;
  }
  return 0;
}
