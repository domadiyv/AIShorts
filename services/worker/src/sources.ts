// Seed AI news/research sources. These are upserted into the `sources` table
// on each run, so the DB is the source of truth and this list can grow.
// Only official/public RSS feeds — we summarize + link back, never republish.
export interface SeedSource {
  name: string;
  url: string;
  trusted: boolean;
}

export const SEED_SOURCES: SeedSource[] = [
  { name: 'TechCrunch AI', url: 'https://techcrunch.com/category/artificial-intelligence/feed/', trusted: true },
  { name: 'The Verge AI', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', trusted: true },
  { name: 'VentureBeat AI', url: 'https://venturebeat.com/category/ai/feed/', trusted: true },
  { name: 'Hugging Face Blog', url: 'https://huggingface.co/blog/feed.xml', trusted: true },
  { name: 'arXiv cs.AI', url: 'http://export.arxiv.org/rss/cs.AI', trusted: false },
];
