import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { mediaDir, mediaUrlFor, MEDIA_ROUTE } from '@aishorts/shared';

// License-safe, self-hosted card images.
//
// Strategy (see WS6 in the plan): every card should end up with an image we host
// ourselves, so it never rots and carries no third-party hotlink/licensing risk.
//   1. Pexels  — free API, commercial use OK, no attribution required. Downloaded
//      to the media dir and served by the API at /media/<hash>.jpg.
//   2. RSS enclosure — if the feed gave us one and Pexels is unavailable, reuse it
//      (kept as an absolute URL; the client renders it directly).
//   3. Bundled placeholder — a per-category PNG committed under media/seed/, so a
//      card ALWAYS has something to show, even fully offline.

const PEXELS_API_KEY = process.env.PEXELS_API_KEY ?? '';

// Map our categories to a stable bundled placeholder (generated offline; see
// scripts/gen-placeholders.mjs). Falls back to default.png for anything else.
function placeholderFor(category: string): string {
  const slug = category.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const rel = `seed/${slug}.png`;
  // Known categories have their own placeholder; default.png covers the rest.
  return fs.existsSync(path.join(mediaDir(), rel))
    ? `${MEDIA_ROUTE}/${rel}`
    : `${MEDIA_ROUTE}/seed/default.png`;
}

type PexelsPhoto = { id: number; src?: { landscape?: string; large?: string; medium?: string } };
type PexelsSearch = { photos?: PexelsPhoto[] };

/**
 * Search Pexels for a photo matching `query`, download it into the media dir, and
 * return the relative URL (`/media/<hash>.jpg`). Returns null if no key is set,
 * nothing matches, or the download fails — callers fall back to a placeholder.
 */
export async function fetchPexelsImage(query: string): Promise<string | null> {
  if (!PEXELS_API_KEY) return null;
  const q = query.trim().slice(0, 120);
  if (!q) return null;
  try {
    // Bound both network calls: a stalled Pexels response must never hang the
    // whole summarize loop — on timeout we fall through to a placeholder.
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=1&orientation=landscape`;
    const res = await fetch(url, {
      headers: { Authorization: PEXELS_API_KEY },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as PexelsSearch;
    const photo = data.photos?.[0];
    const srcUrl = photo?.src?.landscape ?? photo?.src?.large ?? photo?.src?.medium;
    if (!photo || !srcUrl) return null;

    const imgRes = await fetch(srcUrl, { signal: AbortSignal.timeout(15000) });
    if (!imgRes.ok) return null;
    const buf = Buffer.from(await imgRes.arrayBuffer());

    // Content-addressed filename → the same photo dedups on disk.
    const name = `pexels-${photo.id}-${crypto.createHash('sha1').update(srcUrl).digest('hex').slice(0, 8)}.jpg`;
    fs.writeFileSync(`${mediaDir()}/${name}`, buf);
    return mediaUrlFor(name);
  } catch {
    return null;
  }
}

/**
 * Resolve the best available image for a card, applying the full fallback chain.
 * `existing` is any image the ingest step already found (e.g. RSS enclosure).
 */
export async function resolveCardImage(opts: {
  title: string;
  category: string;
  tags?: string[];
  existing?: string | null;
}): Promise<string> {
  // Prefer a keyword built from category + a couple of tags for relevant stock.
  const keywords = [opts.category, ...(opts.tags ?? []).slice(0, 2)].join(' ');
  const pexels = await fetchPexelsImage(keywords || opts.title);
  if (pexels) return pexels;
  if (opts.existing && /^https?:\/\//i.test(opts.existing)) return opts.existing;
  return placeholderFor(opts.category);
}
