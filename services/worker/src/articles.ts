// Fetch the real article body so the summarizer has material for a full
// ~60-word card. RSS feeds only carry a short teaser. We extract readable
// text to summarize + link back — we never republish the full article.
const ARTICLE_FETCH_TIMEOUT_MS = 15000;

const withTimeout = <T>(p: Promise<T>, ms: number, label: string): Promise<T> =>
  Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms).unref?.(),
    ),
  ]);

export async function getArticleText(url: string, fallback: string): Promise<string> {
  try {
    // ESM-only package — load via dynamic import under our CommonJS build.
    const mod: any = await import('@extractus/article-extractor');
    const extract = mod.extract ?? mod.default?.extract ?? mod.default;
    // Bound the fetch: a hung page must not freeze the whole pipeline. On
    // timeout we fall through to the RSS teaser like any other extract failure.
    const article: any = await withTimeout(extract(url), ARTICLE_FETCH_TIMEOUT_MS, 'article fetch');
    const html: string = article?.content ?? '';
    const text = html
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length > 250) return text;
  } catch {
    // Paywall, block, timeout, or unparseable — fall back to the RSS teaser.
  }
  return fallback;
}
