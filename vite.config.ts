import { defineConfig, normalizePath } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const originalIcons = resolve(rootDir, 'original/Pinta.Resources/icons/hicolor/scalable');
const originalRasterActions = resolve(rootDir, 'original/Pinta.Resources/icons/hicolor/16x16/actions');
const pintaStandardIcons = resolve(rootDir, 'web-assets/pinta-standard-icons');

export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        { src: normalizePath(resolve(rootDir, 'public/icons/*')), dest: 'icons', rename: { stripBase: true } },
        { src: normalizePath(resolve(originalRasterActions, '*')), dest: 'actions', rename: { stripBase: true } },
        { src: normalizePath(resolve(pintaStandardIcons, '*.svg')), dest: 'standard-icons', rename: { stripBase: true } },
        { src: normalizePath(resolve(pintaStandardIcons, 'NOTICE.md')), dest: 'standard-icons', rename: { stripBase: true } },
      ],
    }),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'script-defer',
      manifest: {
        id: '/',
        name: 'Pinta Online',
        short_name: 'Pinta',
        description: 'A simple, capable image editor for the web.',
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
        file_handlers: [{
          action: '/',
          accept: {
            'image/png': ['.png'],
            'image/jpeg': ['.jpg', '.jpeg'],
            'image/webp': ['.webp'],
            'image/gif': ['.gif'],
            'image/bmp': ['.bmp'],
            'image/openraster': ['.ora'],
            'image/x-portable-pixmap': ['.ppm'],
            'image/x-tga': ['.tga'],
          },
        }],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{html,js,css,png,svg}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
  // paint.rip serves the application from the domain root.
  base: '/',
  publicDir: originalIcons,
  server: {
    port: 4173,
  },
});
