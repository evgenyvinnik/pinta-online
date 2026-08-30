import { defineConfig, devices } from '@playwright/test';
import base from './playwright.e2e.config';

/**
 * The dialog cross-product opens hundreds of dialog instances across its eight tests. Give each
 * test a fresh Chromium process so accumulated canvas/layout resources cannot stall the next one.
 */
export default defineConfig({
  ...base,
  testMatch: /dialog-layout\.spec\.ts/,
  projects: [
    {
      name: 'chromium-layout',
      use: {
        ...devices['Desktop Chrome'],
        contextOptions: { reducedMotion: 'reduce' },
        viewport: { width: 1440, height: 960 },
      },
    },
  ],
});
