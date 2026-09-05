import {
  prisma,
  imageAssetUrl,
  pickSampleAssetId,
  storeSourceImage,
} from '@aishorts/shared';

// Card images, resolved to a self-hosted asset stored IN Postgres (media_assets,
// bytea) and served by the API at /v1/images/:id. Nothing hotlinks a third party
// at render time, and no image library is needed at runtime.
//
// Priority (per product spec):
//   1. Source image — the article/feed's own lead image (RSS enclosure or
//      scraped og:image). Downloaded once and stored as bytes in the DB.
//   2. Sample library — a reusable themed tile chosen on the fly by category,
//      already loaded into the DB by the seed.
//   3. Blue panel — no image at all (imageAssetId null): the mobile client
//      renders its text-on-gradient fallback. Zero dependency.
//   4. Pexels (FUTURE, opt-in) — only when PEXELS_API_KEY + ENABLE_PEXELS are
//      set. Off by default to keep runtime free of external image services.

const PEXELS_API_KEY = process.env.PEXELS_API_KEY ?? '';
const PEXELS_ENABLED = process.env.ENABLE_PEXELS === 'true' && !!PEXELS_API_KEY;

// Don't pull huge originals into the DB; skip anything over this.
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

export type ResolvedImage = {
  imageAssetId: string | null;
  imageUrl: string | null; // convenience: imageAssetUrl(id) or null
};

const NONE: ResolvedImage = { imageAssetId: null, imageUrl: null };

/** Download an image URL to bytes, validating it's actually a bounded image. */
async function downloadImage(
  url: string,
): Promise<{ buffer: Buffer; contentType: string } | null> {
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim();
    if (!contentType.startsWith('image/')) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) return null;
    return { buffer, contentType };
  } catch {
    return null;
  }
}

/** Try to fetch + store one of the candidate source URLs, first that works. */
async function storeFirstSource(urls: (string | null | undefined)[]): Promise<ResolvedImage> {
  for (const url of urls) {
    if (!url) continue;
    const img = await downloadImage(url);
    if (!img) continue;
    const id = await storeSourceImage(prisma, img.buffer, img.contentType, url);
    return { imageAssetId: id, imageUrl: imageAssetUrl(id) };
  }
  return NONE;
}

type PexelsPhoto = { id: number; src?: { landscape?: string; large?: string; medium?: string } };
type PexelsSearch = { photos?: PexelsPhoto[] };

/** FUTURE/opt-in: search Pexels and store the result as a source asset. */
async function fetchPexelsAsset(query: string): Promise<ResolvedImage> {
  if (!PEXELS_ENABLED) return NONE;
  const q = query.trim().slice(0, 120);
  if (!q) return NONE;
  try {
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=1&orientation=landscape`;
    const res = await fetch(url, {
      headers: { Authorization: PEXELS_API_KEY },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return NONE;
    const data = (await res.json()) as PexelsSearch;
    const src = data.photos?.[0]?.src;
    return storeFirstSource([src?.landscape, src?.large, src?.medium]);
  } catch {
    return NONE;
  }
}

/**
 * Resolve the best available image for a card, applying the full priority chain.
 * `sourceUrls` are candidate lead-image URLs found during ingest/extraction
 * (RSS enclosure, og:image). `seed` (e.g. the card title) keeps sample-tile
 * selection deterministic per card.
 */
export async function resolveCardImage(opts: {
  category: string;
  tags?: string[];
  sourceUrls?: (string | null | undefined)[];
  seed?: string;
}): Promise<ResolvedImage> {
  // 1. Source image from the article/feed → stored as bytes in the DB.
  const source = await storeFirstSource(opts.sourceUrls ?? []);
  if (source.imageAssetId) return source;

  // 4 (future, opt-in) runs before the generic sample so a real photo wins.
  const pexels = await fetchPexelsAsset(
    [opts.category, ...(opts.tags ?? []).slice(0, 2)].join(' '),
  );
  if (pexels.imageAssetId) return pexels;

  // 2. On-the-fly sample tile from the DB library.
  const sampleId = await pickSampleAssetId(prisma, opts.category, opts.seed ?? '');
  if (sampleId) return { imageAssetId: sampleId, imageUrl: imageAssetUrl(sampleId) };

  // 3. Blue panel — the client renders text on a gradient.
  return NONE;
}
