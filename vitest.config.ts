import { defineConfig } from 'vitest/config';

/**
 * Unit tests reuse the application's own Vite pipeline, so there is no second build to keep in
 * step. Playwright owns everything that needs a real browser; this layer owns the pure logic
 * that a browser test would only reach indirectly.
 */
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['tests/unit/setup.ts'],
    globals: false,
    restoreMocks: true,
  },
});
