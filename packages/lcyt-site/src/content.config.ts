import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Use file:// URLs so Astro's loader can convert them on all platforms
// docs/ lives at packages/lcyt-site/src/../../.. => ../../../docs
const docsRoot = new URL('../../../docs/', import.meta.url);

export const collections = {
  lib: defineCollection({
    loader: glob({ pattern: '**/*.md', base: new URL('lib/', docsRoot) }),
    schema: z.object({
      title: z.string().optional(),
    }),
  }),
  api: defineCollection({
    loader: glob({ pattern: '**/*.md', base: new URL('api/', docsRoot) }),
    schema: z.object({
      title: z.string().optional(),
      methods: z.array(z.string()).optional(),
      auth: z.array(z.string()).optional(),
    }),
  }),
  mcp: defineCollection({
    loader: glob({ pattern: '**/*.md', base: new URL('mcp/', docsRoot) }),
    schema: z.object({
      title: z.string().optional(),
      stdio: z.boolean().optional(),
      sse: z.boolean().optional(),
    }),
  }),
  blog: defineCollection({
    loader: glob({ pattern: '**/*.md', base: new URL('./content/blog/', import.meta.url) }),
    schema: z.object({
      title: z.string(),
      date: z.string(),
      description: z.string().optional(),
    }),
  }),
};
