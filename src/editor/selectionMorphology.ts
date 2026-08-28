/**
 * Grow and shrink for selection masks, split out from the canvas plumbing around it so the
 * algorithm is reachable without a rasteriser. The caller supplies the rasterised mask bytes
 * and puts the result back on a canvas; everything decided here is pure.
 *
 * Both directions run off a summed-area table, so each output pixel costs four lookups
 * regardless of radius — a 200 px grow is the same work as a 2 px one.
 */

/** Counts selected pixels in any rectangle in constant time. */
function coverageTable(source: Uint8ClampedArray, width: number, height: number) {
  const stride = width + 1;
  const integral = new Uint32Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      rowSum += source[(y * width + x) * 4 + 3] > 0 ? 1 : 0;
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + rowSum;
    }
  }
  return integral;
}

/**
 * Returns opaque white where the offset mask is selected and transparent elsewhere, matching the
 * RGBA the selection canvases expect.
 *
 * A positive offset grows (a pixel is selected if *any* neighbour within the radius was), a
 * negative one shrinks (selected only if *every* pixel in the full window was). The shrink test
 * compares against the untruncated window area on purpose: near a border the clamped window is
 * smaller than the full one, so it can never match, and a selection touching the canvas edge
 * pulls away from it. That is what shrinking should do, and native behaves the same way.
 */
export function offsetMaskPixels(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  offset: number,
) {
  const radius = Math.abs(Math.round(offset));
  const output = new Uint8ClampedArray(width * height * 4);
  if (radius === 0) {
    output.set(source);
    return output;
  }

  const stride = width + 1;
  const integral = coverageTable(source, width, height);
  const expanding = offset > 0;
  const fullArea = (radius * 2 + 1) ** 2;

  for (let y = 0; y < height; y += 1) {
    const top = Math.max(0, y - radius);
    const bottom = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width - 1, x + radius);
      const selectedCount = integral[(bottom + 1) * stride + right + 1]
        - integral[top * stride + right + 1]
        - integral[(bottom + 1) * stride + left]
        + integral[top * stride + left];
      const selected = expanding ? selectedCount > 0 : selectedCount === fullArea;
      if (selected) {
        const index = (y * width + x) * 4;
        output[index] = 255;
        output[index + 1] = 255;
        output[index + 2] = 255;
        output[index + 3] = 255;
      }
    }
  }
  return output;
}
