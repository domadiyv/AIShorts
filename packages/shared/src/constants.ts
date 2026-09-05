// Default seed categories. Categories now live in the DB (the `categories` table)
// so operators can add new ones from the admin panel; this list only bootstraps a
// fresh database and serves as an offline fallback if the table can't be read.
export const CATEGORIES = [
  'Models',
  'Tools',
  'Research',
  'Business',
  'Policy',
  'How-to',
] as const;
// Named `CategoryName` (not `Category`) to avoid colliding with the Prisma
// `Category` model type once both are re-exported from the package barrel.
export type CategoryName = (typeof CATEGORIES)[number];

// URL/keyword-safe form of a category name, e.g. "How-to" -> "how-to". Used as
// the Category.slug and to name per-category sample images.
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Target word count for a card summary (Inshorts-style brevity).
export const SUMMARY_WORD_TARGET = { min: 50, max: 65 } as const;

// ---- Feed ranking (blended score) ----
//
// Cards are ordered in the feed by a single stored `rankScore` (higher = shown
// first) that blends three signals:
//   - article importance   (1 = top … 5 = low), judged per article
//   - source priority       (1 = top … 5 = low), set per source in the admin panel
//   - article recency        (the article's own published date)
//
// We convert the 1–5 scales to "goodness" (6 - value, so 1→5 … 5→1) and add a
// recency term measured in whole days. The age term uses absolute days since the
// epoch rather than "days ago": ordering depends only on differences between
// cards, and the huge shared constant cancels out — so the score is stable over
// time (no daily recompute) and safe for cursor pagination.
export const RANK_SCALE_MIN = 1;
export const RANK_SCALE_MAX = 5;
export const RANK_DEFAULT = 3;

// Relative pull of each signal. Importance dominates, then source, then recency
// acts as the tie-breaker: a one-step importance gain (=W_IMPORTANCE) outweighs
// ~2 source steps and up to 12 days of recency.
export const RANK_WEIGHTS = {
  importance: 12,
  source: 6,
  agePerDay: 1,
} as const;

const MS_PER_DAY = 86_400_000;

function clampRank(n: number): number {
  if (!Number.isFinite(n)) return RANK_DEFAULT;
  return Math.min(RANK_SCALE_MAX, Math.max(RANK_SCALE_MIN, Math.round(n)));
}

// Compute the stored blended rank score for a card. `articleDate` is the
// article's own published date (falls back to now if unknown).
export function computeRankScore(input: {
  importance: number;
  sourcePriority: number;
  articleDate: Date | string | number | null | undefined;
}): number {
  const importance = clampRank(input.importance);
  const sourcePriority = clampRank(input.sourcePriority);
  const dateMs =
    input.articleDate == null ? Date.now() : new Date(input.articleDate).getTime();
  const ageDays = (Number.isNaN(dateMs) ? Date.now() : dateMs) / MS_PER_DAY;
  return (
    RANK_WEIGHTS.importance * (RANK_SCALE_MAX + 1 - importance) +
    RANK_WEIGHTS.source * (RANK_SCALE_MAX + 1 - sourcePriority) +
    RANK_WEIGHTS.agePerDay * ageDays
  );
}

// Engagement event types accepted by POST /v1/events.
export const EVENT_TYPES = [
  'view',
  'read_more',
  'share',
  'bookmark',
  'email_open',
  'email_click',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];
