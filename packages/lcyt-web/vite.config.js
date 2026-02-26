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
      { find: 'lcyt/backend', replacement: resolve(__dirname, '../lcyt/src/backend-sender.js') },
      { find: 'lcyt/errors',  replacement: resolve(__dirname, '../lcyt/src/errors.js') },
      { find: 'lcyt/config',  replacement: resolve(__dirname, '../lcyt/src/config.js') },
      { find: 'lcyt/logger',  replacement: resolve(__dirname, '../lcyt/src/logger.js') },
      { find: 'lcyt',         replacement: resolve(__dirname, '../lcyt/src/sender.js') },
    ]
  },
  server: {
    proxy: {
      '/live': 'http://localhost:3000',
      '/captions': 'http://localhost:3000',
      '/sync': 'http://localhost:3000',
    }
  }
});
