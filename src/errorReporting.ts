/**
 * Production error visibility and noise control.
 *
 * Google Analytics is already loaded and consented to for page views, so its `exception` event
 * is the cheapest way to learn that a crash is happening at all — no new vendor, no new
 * dependency. Only the message and a coarse area are sent: a stack trace can carry local file
 * paths, and nothing here should widen what the app collects.
 */

export type ErrorArea = 'render' | 'worker' | 'persistence' | 'codec' | 'unknown';

type GtagWindow = typeof window & {
  gtag?: (command: string, event: string, parameters: Record<string, unknown>) => void;
};

/** Errors seen recently, so one thrown per animation frame cannot flood anything. */
const recent = new Map<string, number>();
const REPEAT_WINDOW_MS = 10_000;

export function errorMessageOf(error: unknown) {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}

/**
 * True when an error came from somewhere the application cannot act on — a browser extension,
 * an injected script, or a cross-origin frame. Blocking the editor behind a dialog about one of
 * those tells the user nothing and hides their work for no reason.
 */
export function isForeignError(event: ErrorEvent) {
  if (!event.filename) {
    // A missing filename is the signature of an opaque cross-origin script error.
    return event.message === 'Script error.' || event.message === 'Script error';
  }
  try {
    return new URL(event.filename, location.href).origin !== location.origin;
  } catch {
    return true;
  }
}

/**
 * Returns how many times this message has been seen in the current window. Callers use a
 * non-zero result to collapse repeats instead of opening another dialog.
 */
export function countRepeat(message: string) {
  const now = Date.now();
  for (const [seen, at] of recent) if (now - at > REPEAT_WINDOW_MS) recent.delete(seen);
  const previous = recent.get(message) ?? 0;
  recent.set(message, now);
  return previous;
}

export function noteRepeat(message: string) {
  recent.set(message, Date.now());
}

/** Sends one `exception` event. Never throws, and silently does nothing without analytics. */
export function reportError(error: unknown, area: ErrorArea = 'unknown') {
  try {
    const { gtag } = window as GtagWindow;
    if (!gtag) return;
    gtag('event', 'exception', {
      description: `${area}: ${errorMessageOf(error).slice(0, 180)}`,
      fatal: area === 'render',
    });
  } catch {
    // Reporting a failure must never become a second failure.
  }
}
