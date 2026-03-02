import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsDir = path.resolve(__dirname, '../../docs');

export default defineConfig({
  vite: {
    server: {
      fs: {
        allow: [docsDir, path.resolve(__dirname, '../../')],
      }
    }
  }
});
