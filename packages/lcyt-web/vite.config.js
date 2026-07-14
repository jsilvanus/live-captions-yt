import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { realpathSync } from 'fs';
import react from '@vitejs/plugin-react';

const __dirname = realpathSync(fileURLToPath(new URL('.', import.meta.url)));

export default defineConfig({
  plugins: [react()],
  root: __dirname,
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
  resolve: {
    // Array form ensures more-specific sub-path aliases match before 'lcyt'
    alias: [
      // Polyfill Node.js built-ins used by @jsilvanus/matrox-monarch-control
      { find: 'node:events', replacement: 'events' },
      { find: 'lcyt/backend', replacement: resolve(__dirname, '../lcyt/src/backend-sender.js') },
      { find: 'lcyt/errors',  replacement: resolve(__dirname, '../lcyt/src/errors.js') },
      { find: 'lcyt/config',  replacement: resolve(__dirname, '../lcyt/src/config.js') },
      { find: 'lcyt/logger',  replacement: resolve(__dirname, '../lcyt/src/logger.js') },
      { find: 'lcyt',         replacement: resolve(__dirname, '../lcyt/src/sender.js') },
      // Point imports of the shim to a small ESM wrapper inside the repo.
      // This avoids aliasing directly to a CJS file which can confuse
      // Vite/esbuild during dependency optimization on Windows.
      { find: 'use-sync-external-store/shim/index.js', replacement: resolve(__dirname, 'vite-compat/use-sync-external-store-shim.mjs') },
      { find: 'use-sync-external-store/shim', replacement: resolve(__dirname, 'vite-compat/use-sync-external-store-shim.mjs') },
    ]
  },
  server: {
    port: 5174,
    headers: {
      'Permissions-Policy': 'on-device-speech-recognition=*',
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    },
    fs: {
      // Allow Vite to access the monorepo root so symlinked packages resolve correctly.
      allow: [__dirname, resolve(__dirname, '..', '..')]
    }
  }
});
