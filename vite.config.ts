import { defineConfig, normalizePath } from 'vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import { VitePWA } from 'vite-plugin-pwa';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const packageMetadata = JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf8')) as { version: string };
const appVersion = packageMetadata.version;
const originalIcons = resolve(rootDir, 'original/Pinta.Resources/icons/hicolor/scalable');
const originalRasterActions = resolve(rootDir, 'original/Pinta.Resources/icons/hicolor/16x16/actions');
const originalCursors = resolve(rootDir, 'original/Pinta.Resources/Resources');
const pintaStandardIcons = resolve(rootDir, 'web-assets/pinta-standard-icons');
const aboutAssets = resolve(rootDir, 'web-assets/about');
const seoAssets = resolve(rootDir, 'web-assets/seo');
const localeManifest = JSON.parse(readFileSync(resolve(rootDir, 'src/i18n/locales.generated.json'), 'utf8')) as {
  locales: Array<{ code: string }>;
  seoLocales: string[];
};
const editorLocales = localeManifest.locales.map(({ code }) => code).filter((code) => code !== 'en');
const localizedAboutLocales = localeManifest.seoLocales.filter((code) => code !== 'en');
const localizedPageInputs = Object.fromEntries([
  ...editorLocales.map((locale) => [`editor-${locale}`, resolve(rootDir, `${locale}/index.html`)]),
  ...localizedAboutLocales.map((locale) => [`about-${locale}`, resolve(rootDir, `${locale}/about/index.html`)]),
]);
const localizedAboutPattern = localizedAboutLocales.join('|');
const guideScreenshotRoot = resolve(rootDir, 'tests/visual/__screenshots__/chromium');

export default defineConfig({
  define: {
    __PINTA_ONLINE_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [
    {
      name: 'pinta-online-version',
      transformIndexHtml: {
        order: 'pre',
        handler: (html) => html.replaceAll('__PINTA_ONLINE_VERSION__', appVersion),
      },
    },
    react(),
    // React Compiler. The editor's hot paths are pointer handlers that re-render large trees on
    // every move, which is what automatic memoisation is for, and the budgets in tests/performance
    // guard the result. React is 19, so no runtime polyfill is needed.
    //
    // It runs as a separate Babel pass because plugin-react v6 does the JSX transform with oxc; the
    // preset carries its own file filter so only React sources are handed to Babel.
    babel({ presets: [reactCompilerPreset()] }),
    viteStaticCopy({
      targets: [
        { src: normalizePath(resolve(rootDir, 'public/icons/*')), dest: 'icons', rename: { stripBase: true } },
        { src: normalizePath(resolve(originalRasterActions, '*')), dest: 'actions', rename: { stripBase: true } },
        { src: normalizePath(resolve(originalCursors, 'Cursor.*.png')), dest: 'cursors', rename: { stripBase: true } },
        {
          src: normalizePath(resolve(pintaStandardIcons, '*.svg')),
          dest: 'standard-icons',
          rename: { stripBase: true },
        },
        {
          src: normalizePath(resolve(pintaStandardIcons, 'NOTICE.md')),
          dest: 'standard-icons',
          rename: { stripBase: true },
        },
        { src: normalizePath(resolve(aboutAssets, '*')), dest: 'about/assets', rename: { stripBase: true } },
        {
          src: normalizePath(resolve(guideScreenshotRoot, 'menubar-file.png')),
          dest: 'user-guide/assets',
          rename: { stripBase: true },
        },
        {
          src: normalizePath(resolve(guideScreenshotRoot, 'workspace-restored-magic-wand-selection.png')),
          dest: 'user-guide/assets',
          rename: { stripBase: true },
        },
        {
          src: normalizePath(resolve(guideScreenshotRoot, 'tool-paintbrush.png')),
          dest: 'user-guide/assets',
          rename: { stripBase: true },
        },
        {
          src: normalizePath(resolve(guideScreenshotRoot, 'dialog-layer-properties.png')),
          dest: 'user-guide/assets',
          rename: { stripBase: true },
        },
        {
          src: normalizePath(resolve(guideScreenshotRoot, 'dialog-resize-image.png')),
          dest: 'user-guide/assets',
          rename: { stripBase: true },
        },
        {
          src: normalizePath(resolve(guideScreenshotRoot, 'workspace-rulers-and-grid.png')),
          dest: 'user-guide/assets',
          rename: { stripBase: true },
        },
        {
          src: normalizePath(resolve(guideScreenshotRoot, 'dialog-save-image-as.png')),
          dest: 'user-guide/assets',
          rename: { stripBase: true },
        },
        { src: normalizePath(resolve(seoAssets, '*')), dest: '', rename: { stripBase: true } },
      ],
    }),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'script-defer',
      manifest: {
        id: '/',
        name: 'Pinta Online',
        short_name: 'Pinta',
        description:
          'A free browser image editor with drawing tools, layers, selections, text, effects, open formats, and offline support.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#242424',
        theme_color: '#242424',
        categories: ['graphics', 'photo', 'productivity'],
        icons: [
          { src: '/icons/pinta-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/pinta-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/apps/com.github.PintaProject.Pinta.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
        screenshots: [
          {
            src: '/about/assets/editor-dark.webp',
            sizes: '1200x800',
            type: 'image/webp',
            form_factor: 'wide',
            label: 'Pinta Online dark editing workspace',
          },
          {
            src: '/about/assets/text-editor.webp',
            sizes: '960x640',
            type: 'image/webp',
            form_factor: 'wide',
            label: 'On-canvas text editing in Pinta Online',
          },
        ],
        file_handlers: [
          {
            action: '/',
            accept: {
              'image/png': ['.png'],
              'image/jpeg': ['.jpg', '.jpeg'],
              'image/webp': ['.webp'],
              'image/gif': ['.gif'],
              'image/bmp': ['.bmp'],
              'image/tiff': ['.tif', '.tiff'],
              'image/openraster': ['.ora'],
              'image/x-portable-pixmap': ['.ppm'],
              'image/x-tga': ['.tga'],
            },
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{html,js,css,png,jpg,webp,svg,xml,txt}'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [new RegExp(`^/(?:about|user-guide|(?:${localizedAboutPattern})/about)(?:/|$)`)],
      },
    }),
  ],
  build: {
    rollupOptions: {
      input: {
        editor: resolve(rootDir, 'index.html'),
        about: resolve(rootDir, 'about/index.html'),
        userGuide: resolve(rootDir, 'user-guide/index.html'),
        ...localizedPageInputs,
      },
    },
  },
  // paint.rip serves the application from the domain root.
  base: '/',
  publicDir: originalIcons,
  server: {
    port: 4173,
  },
});
