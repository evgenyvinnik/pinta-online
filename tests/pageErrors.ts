import { test as base, expect } from '@playwright/test';

/**
 * Playwright does not fail a test just because the page threw. Without this, a flow can raise
 * an uncaught error in an effect, never assert on it, and still pass — which is exactly how a
 * real regression stays invisible across a suite this wide.
 *
 * Specs import `test` from here instead of `@playwright/test`.
 */

/** Messages that are expected and carry no signal. Keep this list short and justified. */
const IGNORED = [
  // Chromium's advisory hint about getImageData; the editor reads back deliberately.
  /willReadFrequently/i,
  // Emitted by the browser, not the application, when a download or navigation is cancelled.
  /net::ERR_ABORTED/i,
];

function ignored(message: string) {
  return IGNORED.some((pattern) => pattern.test(message));
}

interface PageErrorFixtures {
  /**
   * Lets a test that deliberately provokes an error opt out, naming the reason so the
   * exemption stays reviewable.
   */
  allowPageErrors: (reason: string, ...patterns: RegExp[]) => void;
}

export const test = base.extend<PageErrorFixtures>({
  allowPageErrors: async ({}, use) => {
    // Replaced per test by the auto fixture below.
    await use(() => undefined);
  },

  page: async ({ page }, use, testInfo) => {
    const failures: string[] = [];
    const allowed: RegExp[] = [];

    // Matching is done on the bare message so the IGNORED and allowed patterns above stay simple,
    // but what gets reported carries the origin too. An intermittent uncaught error is otherwise
    // unactionable: a Firefox InvalidStateError went two rounds of investigation reported only as
    // its message, and the one thing nobody had was where it came from.
    const record = (message: string, origin: string) => {
      if (ignored(message) || allowed.some((pattern) => pattern.test(message))) return;
      failures.push(origin ? `${message}\n      at ${origin}` : message);
    };

    page.on('pageerror', (error) => {
      const frame = (error.stack ?? '')
        .split('\n')
        .slice(1)
        .map((line) => line.trim().replace(/^at\s+/, ''))
        .filter((line) => line && !line.includes('node_modules'))
        .slice(0, 3)
        .join('\n      at ');
      record(`uncaught: ${error.message.split('\n')[0]}`, frame);
    });

    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const at = message.location();
      const where = at?.url ? `${at.url}:${at.lineNumber ?? 0}:${at.columnNumber ?? 0}` : '';
      record(`console.error: ${message.text()}`, where);
    });

    // Expose the opt-out through the page fixture so tests can call it after navigation.
    Object.defineProperty(page, 'allowPageErrors', {
      configurable: true,
      value: (_reason: string, ...patterns: RegExp[]) => allowed.push(...patterns),
    });

    await use(page);

    if (testInfo.status === 'failed' || testInfo.status === 'timedOut') return;
    expect(failures, `the page reported errors that no assertion covered:\n  ${failures.join('\n  ')}`).toEqual([]);
  },
});

export { expect };

/** Narrow helper so specs get a typed opt-out without casting at every call site. */
export function allowPageErrors(page: unknown, reason: string, ...patterns: RegExp[]) {
  (page as { allowPageErrors?: (reason: string, ...patterns: RegExp[]) => void }).allowPageErrors?.(
    reason,
    ...patterns,
  );
}
