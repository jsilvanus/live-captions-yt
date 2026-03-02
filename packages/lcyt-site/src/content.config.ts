import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// src/content.config.ts is at packages/lcyt-site/src/
// So ../../../docs resolves to the monorepo docs/ directory
const docsRoot = path.resolve(__dirname, '../../../docs');

export const collections = {
  lib: defineCollection({
    loader: glob({ pattern: '**/*.md', base: path.join(docsRoot, 'lib') }),
    schema: z.object({
      title: z.string().optional(),
    }),
  }),
  api: defineCollection({
    loader: glob({ pattern: '**/*.md', base: path.join(docsRoot, 'api') }),
    schema: z.object({
      title: z.string().optional(),
      methods: z.array(z.string()).optional(),
      auth: z.array(z.string()).optional(),
    }),
  }),
  mcp: defineCollection({
    loader: glob({ pattern: '**/*.md', base: path.join(docsRoot, 'mcp') }),
    schema: z.object({
      title: z.string().optional(),
      stdio: z.boolean().optional(),
      sse: z.boolean().optional(),
    }),
  }),
  blog: defineCollection({
    loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
    schema: z.object({
      title: z.string(),
      date: z.string(),
      description: z.string().optional(),
    }),
  }),
};
