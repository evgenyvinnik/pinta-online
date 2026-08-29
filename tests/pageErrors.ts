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

    page.on('pageerror', (error) => {
      const message = `uncaught: ${error.message.split('\n')[0]}`;
      if (!ignored(message) && !allowed.some((pattern) => pattern.test(message))) failures.push(message);
    });

    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = `console.error: ${message.text()}`;
      if (!ignored(text) && !allowed.some((pattern) => pattern.test(text))) failures.push(text);
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
