/**
 * A port of `Pinta.Core/Classes/SurfaceDiff.cs`.
 *
 * History entries store a full copy of every changed layer, which is what makes undo expensive
 * on a large document. Native stores the *difference* instead: the bounding box of the changed
 * pixels, a bit per pixel inside that box saying whether it changed, and the old value of only
 * the pixels that did.
 *
 * The diff is reversible. `applyAndSwapSurfaceDiff` writes the stored pixels into a surface and
 * keeps what it overwrote, so one diff serves both undo and redo — which is why native's history
 * needs a single object per step rather than a before and an after.
 *
 * Cairo stores premultiplied BGRA and the browser stores straight RGBA. That difference does not
 * reach this code: it compares and copies whole pixels without interpreting the channels.
 */

/** Below this, the bookkeeping costs more than the diff saves and native keeps the full copy. */
const MINIMUM_SAVINGS_PERCENT = 10;

export interface DiffBounds {
  x: number;
  y: number;
  /** Inclusive, matching `RectangleI.FromLTRB` in the original. */
  right: number;
  /** Inclusive. */
  bottom: number;
}

export interface SurfaceDiff {
  bounds: DiffBounds;
  /** One bit per pixel in `bounds`, row-major: set when that pixel differs. */
  bitmask: Uint8Array;
  /** RGBA of only the changed pixels, in the same order the bitmask visits them. */
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
}

function readBit(bitmask: Uint8Array, index: number) {
  return (bitmask[index >> 3] & (1 << (index & 7))) !== 0;
}

function setBit(bitmask: Uint8Array, index: number) {
  bitmask[index >> 3] |= 1 << (index & 7);
}

function pixelsDiffer(a: Uint8ClampedArray, b: Uint8ClampedArray, offset: number) {
  return (
    a[offset] !== b[offset] ||
    a[offset + 1] !== b[offset + 1] ||
    a[offset + 2] !== b[offset + 2] ||
    a[offset + 3] !== b[offset + 3]
  );
}

/** The bounding box of every pixel that differs, or null when the surfaces are identical. */
function differenceBounds(original: ImageData, updated: ImageData): DiffBounds | null {
  const { width, height } = original;
  const left0 = original.data;
  const left1 = updated.data;
  let x = width;
  let y = height;
  let right = -1;
  let bottom = -1;

  for (let row = 0; row < height; row += 1) {
    let rowLeft = width;
    let rowRight = -1;
    for (let column = 0; column < width; column += 1) {
      if (!pixelsDiffer(left0, left1, (row * width + column) * 4)) continue;
      if (column < rowLeft) rowLeft = column;
      rowRight = column;
    }
    if (rowRight < 0) continue;
    if (rowLeft < x) x = rowLeft;
    if (rowRight > right) right = rowRight;
    if (row < y) y = row;
    bottom = row;
  }

  return right < 0 ? null : { x, y, right, bottom };
}

/**
 * Builds a reversible diff holding `original`'s pixels wherever it differs from `updated`.
 *
 * Returns null when the surfaces differ in size, are identical, or when the change covers so
 * much of the surface that a full copy is the better trade. `force` skips the size check's
 * silence — it throws instead — and skips the savings test, for callers that need a diff.
 */
export function createSurfaceDiff(original: ImageData, updated: ImageData, force = false): SurfaceDiff | null {
  if (original.width !== updated.width || original.height !== updated.height) {
    if (force) throw new Error('Original and updated surfaces need to be same size.');
    return null;
  }

  const bounds = differenceBounds(original, updated);
  if (!bounds) return null;

  const { width, height } = original;
  const boundsWidth = bounds.right - bounds.x + 1;
  const boundsHeight = bounds.bottom - bounds.y + 1;
  const bitmask = new Uint8Array(Math.ceil((boundsWidth * boundsHeight) / 8));

  let changeCount = 0;
  let maskIndex = 0;
  for (let row = bounds.y; row <= bounds.bottom; row += 1) {
    for (let column = bounds.x; column <= bounds.right; column += 1) {
      if (pixelsDiffer(original.data, updated.data, (row * width + column) * 4)) {
        setBit(bitmask, maskIndex);
        changeCount += 1;
      }
      maskIndex += 1;
    }
  }

  // Native measures savings against the whole surface, not the bounding box, so a change that
  // is dense inside a small box still counts as a large saving.
  const savings = 100 - (changeCount / (width * height)) * 100;
  if (!force && savings < MINIMUM_SAVINGS_PERCENT) return null;

  const pixels = new Uint8ClampedArray(changeCount * 4);
  let pixelIndex = 0;
  maskIndex = 0;
  for (let row = bounds.y; row <= bounds.bottom; row += 1) {
    for (let column = bounds.x; column <= bounds.right; column += 1) {
      if (readBit(bitmask, maskIndex)) {
        const source = (row * width + column) * 4;
        pixels[pixelIndex] = original.data[source];
        pixels[pixelIndex + 1] = original.data[source + 1];
        pixels[pixelIndex + 2] = original.data[source + 2];
        pixels[pixelIndex + 3] = original.data[source + 3];
        pixelIndex += 4;
      }
      maskIndex += 1;
    }
  }

  return { bounds, bitmask, pixels, width, height };
}

function applyInternal(diff: SurfaceDiff, destination: ImageData, swap: boolean) {
  if (destination.width !== diff.width || destination.height !== diff.height) {
    throw new Error('The surface is not the size this difference was created against.');
  }
  const { bounds, bitmask, pixels } = diff;
  const data = destination.data;
  let maskIndex = 0;
  let pixelIndex = 0;

  for (let row = bounds.y; row <= bounds.bottom; row += 1) {
    for (let column = bounds.x; column <= bounds.right; column += 1) {
      if (readBit(bitmask, maskIndex)) {
        const target = (row * diff.width + column) * 4;
        for (let channel = 0; channel < 4; channel += 1) {
          const stored = pixels[pixelIndex + channel];
          if (swap) pixels[pixelIndex + channel] = data[target + channel];
          data[target + channel] = stored;
        }
        pixelIndex += 4;
      }
      maskIndex += 1;
    }
  }
}

/** Writes the stored pixels into the surface, leaving the diff unchanged. */
export function applySurfaceDiff(diff: SurfaceDiff, destination: ImageData) {
  applyInternal(diff, destination, false);
}

/**
 * Writes the stored pixels into the surface and keeps what they replaced, so applying the same
 * diff again reverses it. This is what lets one object serve both undo and redo.
 */
export function applyAndSwapSurfaceDiff(diff: SurfaceDiff, destination: ImageData) {
  applyInternal(diff, destination, true);
}

/** What the diff actually costs to retain, for the history memory budget. */
export function surfaceDiffByteSize(diff: SurfaceDiff) {
  return diff.bitmask.byteLength + diff.pixels.byteLength;
}
