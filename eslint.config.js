import js from '@eslint/js';
import globals from 'globals';
import typescript from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import importX from 'eslint-plugin-import-x';

/**
 * `npm run lint` remains `tsc -b`; this is a second, complementary check. TypeScript proves the
 * types line up, and these rules cover what it cannot see: stale hook dependencies, import cycles,
 * and the module boundaries the refactoring plan depends on.
 *
 * The rule set is deliberately small. A config that reports hundreds of pre-existing problems gets
 * ignored, so anything not worth fixing today is either off or a warning, and every `error` here is
 * something that should block a commit.
 */
export default typescript.config(
  {
    ignores: [
      'dist/**',
      'playwright-report*/**',
      'test-results/**',
      'original/**',
      'src/i18n/locales.generated.*',
      '**/*.d.ts',
    ],
  },

  js.configs.recommended,
  ...typescript.configs.recommended,

  {
    files: ['**/*.{ts,tsx,mjs,js}'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.browser, ...globals.es2023 },
    },
    plugins: { 'import-x': importX },
    rules: {
      /**
       * The one that matters most here. `usePaintEditor` carries 66 refs and App had a 42-entry
       * dependency array; a missing dependency is a stale closure, which shows up as an edit that
       * silently does nothing. Warning rather than error only because the existing code has not
       * been audited against it yet.
       */
      'import-x/no-cycle': ['error', { maxDepth: Infinity, ignoreExternal: true }],
      /** Section 4.4 of docs/refactoring.md: barrels hide the dependency graph. */
      'import-x/no-self-import': 'error',
      'import-x/no-duplicates': 'error',

      // TypeScript already reports unused locals; this would just duplicate it with different
      // wording, and the two disagree about function parameters.
      '@typescript-eslint/no-unused-vars': 'off',
      // The codebase uses `any` deliberately in a few DOM-shim spots, each commented.
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  {
    // Node scripts and config files run outside the browser.
    files: ['scripts/**/*.mjs', '*.config.{ts,js,mjs}', 'web-assets/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },

  {
    files: ['tests/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      'react-refresh/only-export-components': 'off',
      // Playwright declares a fixture with no dependencies as `async ({}, use)`. That is the
      // framework's required signature, not an oversight.
      'no-empty-pattern': 'off',
    },
  },
);
