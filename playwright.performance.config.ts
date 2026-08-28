import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PINTA_PERFORMANCE_PORT ?? 4175);

export default defineConfig({
  testDir: './tests/performance',
  outputDir: 'test-results/performance',
  timeout: 120_000,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report-performance', open: 'never' }]],
  expect: { timeout: 15_000 },
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
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 960 } } }],
  webServer: {
    command: `npm run build && npm run preview -- --host 0.0.0.0 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    stderr: 'pipe',
    stdout: 'ignore',
    timeout: 120_000,
  },
});
