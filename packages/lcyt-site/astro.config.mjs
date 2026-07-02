import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsDir = path.resolve(__dirname, '../../docs');
const sharedStylesDir = path.resolve(__dirname, '../shared-styles');

export default defineConfig({
  vite: {
    server: {
      fs: {
        allow: [docsDir, sharedStylesDir, path.resolve(__dirname, '../../')],
      }
    },
    resolve: {
      alias: {
        'shared-styles': sharedStylesDir,
      }
    }
  }
});
