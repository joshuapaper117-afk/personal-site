import { getCollection, type CollectionEntry } from 'astro:content';

export type Build = CollectionEntry<'builds'> & { n: number };

export const pad = (n: number, len = 3) => String(n).padStart(len, '0');

export const statusLabel = {
  planned: 'Planned',
  'in-progress': 'In progress',
  shipped: 'Shipped',
} as const;

// Newest first. `n` is the build number: oldest build is N°001.
export async function getBuilds(): Promise<Build[]> {
  const all = (await getCollection('builds', (b) => !b.data.draft)).sort(
    (a, b) => a.data.date.valueOf() - b.data.date.valueOf(),
  );
  return all.map((e, i) => ({ ...e, n: i + 1 })).reverse();
}

export const tones = ['accent', 'ink', 'paper'] as const;
export const toneFor = (n: number) => tones[(n - 1) % tones.length];
