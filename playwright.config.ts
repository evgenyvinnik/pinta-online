import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const port = 4173;

export default defineConfig({
  testDir: './tests/visual',
  outputDir: 'test-results/visual',
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  expect: {
    timeout: 8_000,
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.0002,
      scale: 'css',
      stylePath: path.resolve('tests/visual/screenshot.css'),
      threshold: 0.2,
    },
  },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    colorScheme: 'dark',
    deviceScaleFactor: 1,
    locale: 'en-US',
    screenshot: 'only-on-failure',
    timezoneId: 'UTC',
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 960 },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        contextOptions: { reducedMotion: 'reduce' },
        viewport: { width: 1440, height: 960 },
      },
    },
  ],
  webServer: {
    command:
      `node scripts/run-preview-server.mjs visual-dev ` +
      `"npm run dev -- --host 127.0.0.1 --port ${port}"`,
    url: `http://127.0.0.1:${port}`,
    // Never reuse: the command rebuilds dist/, and a server left running from an earlier run
    // keeps serving the previous index.html, whose hashed asset names no longer exist. That
    // fails as ENOENT on the stylesheet and then ERR_CONNECTION_REFUSED across the whole suite —
    // 53 false failures in one run during the refactoring work, and several single-test
    // "flakes" before anyone noticed the pattern.
    reuseExistingServer: false,
    // Without this Playwright SIGKILLs the process group, so the wrapper never gets to record
    // why the server stopped — and "why" is the whole point of the log.
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    // The wrapper keeps the full transcript in test-results/server-logs/visual-dev.log;
    // these only control what additionally reaches the console.
    stderr: 'pipe',
    stdout: 'ignore',
    timeout: 120_000,
  },
});
