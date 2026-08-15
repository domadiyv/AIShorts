// Seed AI news/research sources. These are upserted into the `sources` table
// on each run, so the DB is the source of truth and this list can grow.
// Only official/public RSS feeds — we summarize + link back, never republish.
export interface SeedSource {
  name: string;
  url: string;
  trusted: boolean;
}

export const SEED_SOURCES: SeedSource[] = [
  // News (free public feeds — headline + teaser only; we summarize + link back).
  { name: 'TechCrunch AI', url: 'https://techcrunch.com/category/artificial-intelligence/feed/', trusted: true },
  { name: 'The Verge AI', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', trusted: true },
  { name: 'VentureBeat AI', url: 'https://venturebeat.com/category/ai/feed/', trusted: true },
  { name: 'Ars Technica AI', url: 'https://arstechnica.com/ai/feed/', trusted: true },
  { name: 'The Guardian AI', url: 'https://www.theguardian.com/technology/artificialintelligenceai/rss', trusted: true },
  { name: 'The Register AI/ML', url: 'https://www.theregister.com/software/ai_ml/headlines.atom', trusted: true },
  { name: 'MIT Technology Review AI', url: 'https://www.technologyreview.com/topic/artificial-intelligence/feed', trusted: true },

  // First-party official blogs — published for public dissemination, safest to
  // summarize + link. Free, no paywall.
  { name: 'Hugging Face Blog', url: 'https://huggingface.co/blog/feed.xml', trusted: true },
  { name: 'Google Research', url: 'https://research.google/blog/rss/', trusted: true },
  { name: 'Google DeepMind', url: 'https://deepmind.google/blog/rss.xml', trusted: true },
  { name: 'OpenAI News', url: 'https://openai.com/news/rss.xml', trusted: true },
  { name: 'Microsoft Research', url: 'https://www.microsoft.com/en-us/research/feed/', trusted: true },
  { name: 'AWS Machine Learning', url: 'https://aws.amazon.com/blogs/machine-learning/feed/', trusted: true },

  // Academic / open-access — CC or institutional, no licensing concern.
  { name: 'arXiv cs.AI', url: 'http://export.arxiv.org/rss/cs.AI', trusted: false },
  { name: 'arXiv cs.LG', url: 'http://export.arxiv.org/rss/cs.LG', trusted: false },
  { name: 'arXiv cs.CL', url: 'http://export.arxiv.org/rss/cs.CL', trusted: false },
  { name: 'MIT News AI', url: 'https://news.mit.edu/rss/topic/artificial-intelligence2', trusted: true },
  { name: 'Berkeley BAIR', url: 'https://bair.berkeley.edu/blog/feed.xml', trusted: true },
];
