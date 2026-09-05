// Fetch the real article body so the summarizer has material for a full
// ~60-word card, and surface the article's lead image (og:image) so we can
// self-host it. RSS feeds only carry a short teaser. We extract readable text to
// summarize + link back — we never republish the full article.
const ARTICLE_FETCH_TIMEOUT_MS = 15000;

const withTimeout = <T>(p: Promise<T>, ms: number, label: string): Promise<T> =>
  Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms).unref?.(),
    ),
  ]);

export type ExtractedArticle = { text: string; imageUrl: string | null };

// Fetch + extract once, returning both the readable text and the lead image.
// On any failure (paywall, block, timeout, unparseable) the text falls back to
// the RSS teaser and the image is null.
export async function extractArticle(url: string, fallback: string): Promise<ExtractedArticle> {
  try {
    // ESM-only package — load via dynamic import under our CommonJS build.
    const mod: any = await import('@extractus/article-extractor');
    const extract = mod.extract ?? mod.default?.extract ?? mod.default;
    const article: any = await withTimeout(extract(url), ARTICLE_FETCH_TIMEOUT_MS, 'article fetch');
    const html: string = article?.content ?? '';
    const text = html
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const imageUrl: string | null =
      typeof article?.image === 'string' && /^https?:\/\//i.test(article.image)
        ? article.image
        : null;
    return { text: text.length > 250 ? text : fallback, imageUrl };
  } catch {
    return { text: fallback, imageUrl: null };
  }
}

// Back-compat convenience: just the text.
export async function getArticleText(url: string, fallback: string): Promise<string> {
  return (await extractArticle(url, fallback)).text;
}
