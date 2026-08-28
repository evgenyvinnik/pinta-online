/**
 * `getContext('2d')` returns null when the browser refuses the allocation. That is routine on
 * iOS Safari, which caps total canvas memory per tab, and this editor holds a canvas per layer
 * plus preview, selection, and history surfaces.
 *
 * Asserting the result away turns that refusal into "Cannot read properties of null" from
 * whichever line happened to touch it first. This names the real cause instead, so the error
 * boundary and the error dialog can say something a user can act on.
 */
export class CanvasAllocationError extends Error {
  constructor(width: number, height: number) {
    super(
      `The browser could not provide a drawing surface for a ${width} × ${height} area. `
      + 'This usually means the image is too large for the memory this browser allows. '
      + 'Closing other images or tabs and trying again often helps.',
    );
    this.name = 'CanvasAllocationError';
  }
}

export function context2d(
  canvas: HTMLCanvasElement,
  options?: CanvasRenderingContext2DSettings,
): CanvasRenderingContext2D {
  const context = canvas.getContext('2d', options);
  if (!context) throw new CanvasAllocationError(canvas.width, canvas.height);
  return context;
}
