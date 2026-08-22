import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react()],
  publicDir: resolve(rootDir, 'original/Pinta.Resources/icons/hicolor/scalable'),
  server: {
    port: 4173,
  },
});
