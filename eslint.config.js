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
 * ignored. Every enabled rule is therefore an error, and the npm script independently rejects any
 * future warning so a configuration change cannot silently weaken the gate.
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
       * silently does nothing. The dependency audit is complete, so regressions block the gate.
       */
      'import-x/no-cycle': ['error', { maxDepth: Infinity, ignoreExternal: true }],
      /** Section 4.4 of docs/refactoring.md: barrels hide the dependency graph. */
      'import-x/no-self-import': 'error',
      'import-x/no-duplicates': 'error',

      // This was 'off' with a comment claiming TypeScript already reported unused locals. It
      // does not — noUnusedLocals is not set in any tsconfig — so nothing was checking, and
      // 358 dead imports had accumulated in src/, most of them left behind by the kernel and
      // hook extractions. Parameters stay exempt via the ignore patterns, which is the one
      // place the two tools genuinely disagree.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],
      // The codebase uses `any` deliberately in a few DOM-shim spots, each commented.
      '@typescript-eslint/no-explicit-any': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'react-refresh/only-export-components': ['error', { allowConstantExport: true }],
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
