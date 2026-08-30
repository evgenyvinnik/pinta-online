import { defineConfig, devices } from '@playwright/test';
import base from './playwright.e2e.config';

/**
 * WebKit, on its own, so the suite can run in fresh-process shards.
 *
 * It is a separate file rather than a project in the e2e config because `npm run gate` runs that
 * config with no project filter. The standalone runner restarts WebKit for each quarter of the
 * suite, avoiding the canvas/history resource accumulation observed in one long-lived engine.
 * Section 4 of docs/final_polish.md records the evidence and release-gating boundary.
 *
 * The layout cross-product is excluded. It opens forty-three dialogs one at a time and WebKit is
 * slow enough that it exhausts the timeout, which tells us nothing about WebKit and costs several
 * minutes of a triage run.
 */
export default defineConfig({
  ...base,
  testIgnore: [/touch\.spec\.ts/, /dialog-layout\.spec\.ts/],
  projects: [
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 960 } },
    },
  ],
});
