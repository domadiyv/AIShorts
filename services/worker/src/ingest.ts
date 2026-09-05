import crypto from 'node:crypto';
import Parser from 'rss-parser';
import { prisma } from '@aishorts/shared';
import { SEED_SOURCES } from './sources';
import { isAiRelated } from './relevance';

const parser = new Parser({ timeout: 20000 });

// Cap items pulled per feed each run — keeps the feed fresh and avoids
// summarizing an entire blog archive (feeds are newest-first).
const MAX_ITEMS_PER_SOURCE = Number(process.env.MAX_ITEMS_PER_SOURCE ?? 30);

// On a source's FIRST fetch (no cursor yet) bound the backfill by DATE, not just
// count: pull only items published within the last N days. After that the
// lastItemAt cursor takes over and each run is incremental (only items newer than
// the cursor), so this floor only ever bites the first run / a fresh source.
// Kept in sync with MAX_ARTICLE_AGE_DAYS so we don't ingest items the summarizer
// will later reject as stale.
const INGEST_LOOKBACK_DAYS = Number(process.env.INGEST_LOOKBACK_DAYS ?? 30);

// Normalize a URL for dedup: strip query/hash and trailing slash, lowercase host.
function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.search = '';
    u.hash = '';
    let s = `${u.protocol}//${u.host.toLowerCase()}${u.pathname}`;
    return s.replace(/\/$/, '');
  } catch {
    return raw.trim();
  }
}

function sha1(s: string): string {
  return crypto.createHash('sha1').update(s).digest('hex');
}

// Feeds whose <guid> carries attributes (e.g. isPermaLink="false") are parsed by
// rss-parser into an object like { _: "the-id", $: { isPermaLink: "false" } }
// instead of a plain string. Coerce to the string form (or null) so Prisma's
// String column accepts it. Microsoft Research, Google Research, etc. do this.
function guidToString(guid: unknown): string | null {
  if (typeof guid === 'string') return guid.trim() || null;
  if (guid && typeof guid === 'object') {
    const inner = (guid as { _?: unknown })._;
    if (typeof inner === 'string') return inner.trim() || null;
  }
  return null;
}

// Cluster near-duplicate events: same normalized title => same cluster.
function clusterKey(title: string): string {
  return sha1(
    title
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

export type FeedPreview = {
  ok: boolean;
  title?: string;
  itemCount?: number;
  sampleTitles?: string[];
  error?: string;
};

// Validate + preview an RSS/Atom feed before an operator adds it as a source.
// Fetching and parsing here means dead links, non-feed pages, and empty feeds are
// caught in the admin UI instead of silently failing every ingest run afterwards.
export async function previewFeed(rawUrl: string): Promise<FeedPreview> {
  const url = rawUrl.trim();
  try {
    new URL(url);
  } catch {
    return { ok: false, error: 'That is not a valid URL.' };
  }
  try {
    const feed = await parser.parseURL(url);
    const items = feed.items ?? [];
    const sampleTitles = items
      .slice(0, 5)
      .map((i) => (i.title ?? '').trim())
      .filter(Boolean);
    if (items.length === 0) {
      return {
        ok: false,
        title: (feed.title ?? '').trim() || undefined,
        error: 'That feed parsed but has no items.',
      };
    }
    return {
      ok: true,
      title: (feed.title ?? '').trim() || undefined,
      itemCount: items.length,
      sampleTitles,
    };
  } catch (err) {
    return { ok: false, error: `Couldn't read a feed there: ${(err as Error).message}` };
  }
}

// Seed the default sources ONLY on a fresh (empty) database. After first boot
// the DB is the source of truth, so an operator deleting a source in the admin
// panel makes it stay deleted. (Previously this upserted the whole SEED_SOURCES
// list on every ingest, which silently re-created any source an operator had
// removed.) To add a new feed to an existing install, use the admin
// "Add source" flow rather than editing this list.
async function ensureSources(): Promise<void> {
  if ((await prisma.source.count()) > 0) return;
  for (const s of SEED_SOURCES) {
    await prisma.source.create({
      data: { name: s.name, url: s.url, trusted: s.trusted, type: 'rss' },
    });
  }
}

export async function ingest(): Promise<{ fetched: number; inserted: number; filtered: number }> {
  await ensureSources();
  // Higher-priority sources ingest first. Priority is 1 = top … 5 = low, so
  // ascending order puts the most-preferred sources first (operators set this
  // from the admin Sources list). Ties fall back to a stable name order.
  const sources = await prisma.source.findMany({
    where: { active: true, type: 'rss' },
    orderBy: [{ priority: 'asc' }, { name: 'asc' }],
  });

  let fetched = 0;
  let inserted = 0;
  let filtered = 0; // items dropped by the AI topic filter (not stored)
  // Guard the cursor against future-dated items (clock skew / bad feeds): never
  // advance it past "now", or we'd skip legitimately-new news next run.
  const nowMs = Date.now();

  for (const source of sources) {
    try {
      const feed = await parser.parseURL(source.url);
      const cursorMs = source.lastItemAt ? source.lastItemAt.getTime() : null;
      let newestMs = cursorMs ?? 0; // high-water mark to persist after this run

      // On the first run (no cursor) backfill only the last N days; on later runs
      // the cursor is always more recent than this floor, so it's a no-op then.
      const lookbackFloorMs =
        cursorMs === null ? nowMs - INGEST_LOOKBACK_DAYS * 86_400_000 : null;

      // Fetch by date, not a fixed window: keep only items published *after* the
      // source's high-water mark (feeds are newest-first). On the first run
      // (no cursor) keep items within the lookback window. Items without a publish
      // date can't be compared, so we keep them — the hash lookup below dedups them.
      const candidates = (feed.items ?? []).filter((item) => {
        if (!item.link?.trim() || !item.title?.trim()) return false;
        const t = item.isoDate ? new Date(item.isoDate).getTime() : null;
        if (cursorMs !== null && t !== null && t <= cursorMs) return false;
        if (lookbackFloorMs !== null && t !== null && t < lookbackFloorMs) return false;
        return true;
      });

      // Soft cap: process at most MAX_ITEMS_PER_SOURCE newest items per run. With
      // the cursor this only bites on the very first run or after a long outage
      // (a large backlog) — in steady state there are far fewer than 30 new items,
      // so the cap is a backstop, not the primary limit.
      const batch = candidates.slice(0, MAX_ITEMS_PER_SOURCE);

      for (const item of batch) {
        const link = item.link!.trim();
        const title = item.title!.trim();
        fetched++;

        // Advance the run's high-water mark for EVERY processed item (AI or not),
        // so a non-AI item that happens to be newest doesn't get re-filtered every
        // run. Ignore future timestamps so they can't push the cursor past reality.
        const publishedAt = item.isoDate ? new Date(item.isoDate) : null;
        if (publishedAt) {
          const t = publishedAt.getTime();
          if (t <= nowMs && t > newestMs) newestMs = t;
        }

        const text =
          (item.contentSnippet || (item as any)['content:encodedSnippet'] || item.content || '')
            .toString()
            .slice(0, 4000);

        // AI topic gate: only ingest AI-related items so broad feeds don't drip
        // non-AI news into the pipeline. Checked here (before storing) so noise
        // never competes with real AI news for the summarizer's queue slots.
        if (!isAiRelated(`${title}\n${text}`)) {
          filtered++;
          continue;
        }

        const hash = sha1(normalizeUrl(link));
        const exists = await prisma.rawItem.findUnique({ where: { hash } });
        if (exists) continue;

        const imageUrl = (item.enclosure?.url as string | undefined) ?? null;

        await prisma.rawItem.create({
          data: {
            sourceId: source.id,
            sourceName: source.name,
            sourceUrl: link,
            externalId: guidToString(item.guid),
            title,
            rawText: text || null,
            hash,
            clusterId: clusterKey(title),
            imageUrl,
            publishedAt,
          },
        });
        inserted++;
      }

      // Persist the advanced cursor so the next run starts strictly after it. Only
      // written when it moved forward — a run that saw nothing new leaves it be.
      if (newestMs > (cursorMs ?? 0)) {
        await prisma.source.update({
          where: { id: source.id },
          data: { lastItemAt: new Date(newestMs) },
        });
      }

      console.log(`  [${source.name}] ok`);
    } catch (err) {
      console.warn(`  [${source.name}] FAILED: ${(err as Error).message}`);
    }
  }

  console.log(
    `Ingest: ${fetched} items seen, ${inserted} new raw items stored` +
      (filtered ? `, ${filtered} filtered out (not AI-related).` : '.'),
  );
  return { fetched, inserted, filtered };
}

// Allow running this stage alone: `npm run -w @aishorts/worker ingest:only`
if (require.main === module) {
  ingest()
    .then(() => prisma.$disconnect())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
