/**
 * Pinta's zoom model, transcribed from the native application.
 *
 * `original/Pinta.Core/Actions/ViewActions.cs` builds the combo's zoom collection from
 * these percentages, and `original/Pinta.Core/Classes/DocumentWorkspace.cs` steps through
 * that same collection for Zoom In / Zoom Out rather than multiplying by a fixed factor.
 */

/** Native `default_zoom_levels`, largest first, excluding the trailing `Window` entry. */
export const ZOOM_LEVELS: readonly number[] = [
  3600, 2400, 1600, 1200, 800, 700, 600, 500, 400, 300, 200, 175, 150,
  125, 100, 66, 50, 33, 25, 16, 12, 8, 5,
];

/** `DocumentWorkspace.ZoomAndRecenterView` clamps to 3600% before stepping. */
export const MAX_ZOOM = 36;

/**
 * The native combo bottoms out at 5%, but Best Fit sets the scale directly and is not
 * bounded by the list, so a very large image can still be fitted to the window.
 */
export const MIN_ZOOM = 0.01;

export function clampZoom(zoom: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/**
 * Native Zoom In selects the entry immediately above the first listed level that is at or
 * below the current scale, so a hand-typed 137% snaps up to the next preset.
 */
export function zoomInLevel(zoom: number) {
  const percent = zoom * 100;
  for (let index = 0; index < ZOOM_LEVELS.length; index += 1) {
    if (ZOOM_LEVELS[index] <= percent) return ZOOM_LEVELS[Math.max(0, index - 1)] / 100;
  }
  // Below the smallest preset the native loop reaches `Window` and steps back onto it.
  return ZOOM_LEVELS[ZOOM_LEVELS.length - 1] / 100;
}

/** Native Zoom Out selects the first listed level strictly below the current scale. */
export function zoomOutLevel(zoom: number) {
  const percent = zoom * 100;
  for (const level of ZOOM_LEVELS) {
    if (level < percent) return level / 100;
  }
  // Native leaves the scale untouched once it reaches the bottom of the collection.
  return zoom;
}

/** `ViewActions.ToPercent` renders `{0}%`; the parser accepts the same shape back. */
export function formatZoomPercent(zoom: number) {
  return `${Math.round(zoom * 100)}%`;
}

/** Mirrors `ViewActions.TryParsePercent`: a bare or `%`-suffixed number. */
export function parseZoomPercent(text: string): number | null {
  const match = /^\s*(\d+(?:[.,]\d+)?)\s*%?\s*$/.exec(text);
  if (!match) return null;
  const percent = Number(match[1].replace(',', '.'));
  return Number.isFinite(percent) && percent > 0 ? clampZoom(percent / 100) : null;
}
