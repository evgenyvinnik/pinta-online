import { defineConfig, devices } from '@playwright/test';
import base from './playwright.e2e.config';

/**
 * Firefox runs in fresh-process shards, matching the WebKit stability topology.
 *
 * The exhaustive dialog-layout sweep is engine-independent layout coverage and already runs in
 * Chromium. Keeping it out of this config avoids opening 172 dialog instances before the Firefox
 * behavior suite starts, which needlessly accelerates canvas/browser resource exhaustion.
 */
export default defineConfig({
  ...base,
  testIgnore: [/touch\.spec\.ts/, /dialog-layout\.spec\.ts/],
  projects: [
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 960 } },
    },
  ],
});
