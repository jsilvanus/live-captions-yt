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
    ]
  },
  server: {
    headers: {
      'Permissions-Policy': 'on-device-speech-recognition=*',
    },
    proxy: {
      '/live': 'http://localhost:3000',
      '/captions': 'http://localhost:3000',
      '/sync': 'http://localhost:3000',
    }
    ,
    fs: {
      // Allow Vite to access the monorepo root so symlinked packages resolve correctly.
      allow: [__dirname, resolve(__dirname, '..', '..')]
    }
  }
});
