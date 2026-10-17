import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const builds = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/builds' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    date: z.coerce.date(),
    status: z.enum(['planned', 'in-progress', 'shipped']).default('shipped'),
    tags: z.array(z.string()).default([]),
    repo: z.string().url().optional(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { builds };
