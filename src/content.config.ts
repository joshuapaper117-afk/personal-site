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
    draft: z.boolean().default(false),
  }),
});

const ideas = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/ideas' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    // idea = just floating it, exploring = actively researching it
    stage: z.enum(['idea', 'exploring']).default('idea'),
    tags: z.array(z.string()).default([]),
  }),
});

export const collections = { builds, ideas };
