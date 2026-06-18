import crypto from 'node:crypto';
import Parser from 'rss-parser';
import { prisma } from '@aishorts/shared';
import { SEED_SOURCES } from './sources';

const parser = new Parser({ timeout: 20000 });

// Cap items pulled per feed each run — keeps the feed fresh and avoids
// summarizing an entire blog archive (feeds are newest-first).
const MAX_ITEMS_PER_SOURCE = Number(process.env.MAX_ITEMS_PER_SOURCE ?? 30);

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

// Ensure seed sources exist (idempotent).
async function ensureSources(): Promise<void> {
  for (const s of SEED_SOURCES) {
    await prisma.source.upsert({
      where: { url: s.url },
      create: { name: s.name, url: s.url, trusted: s.trusted, type: 'rss' },
      update: { name: s.name, trusted: s.trusted },
    });
  }
}

export async function ingest(): Promise<{ fetched: number; inserted: number }> {
  await ensureSources();
  const sources = await prisma.source.findMany({ where: { active: true, type: 'rss' } });

  let fetched = 0;
  let inserted = 0;

  for (const source of sources) {
    try {
      const feed = await parser.parseURL(source.url);
      for (const item of (feed.items ?? []).slice(0, MAX_ITEMS_PER_SOURCE)) {
        const link = item.link?.trim();
        const title = item.title?.trim();
        if (!link || !title) continue;
        fetched++;

        const hash = sha1(normalizeUrl(link));
        const exists = await prisma.rawItem.findUnique({ where: { hash } });
        if (exists) continue;

        const text =
          (item.contentSnippet || (item as any)['content:encodedSnippet'] || item.content || '')
            .toString()
            .slice(0, 4000);
        const imageUrl = (item.enclosure?.url as string | undefined) ?? null;

        await prisma.rawItem.create({
          data: {
            sourceId: source.id,
            sourceName: source.name,
            sourceUrl: link,
            externalId: item.guid ?? null,
            title,
            rawText: text || null,
            hash,
            clusterId: clusterKey(title),
            imageUrl,
            publishedAt: item.isoDate ? new Date(item.isoDate) : null,
          },
        });
        inserted++;
      }
      console.log(`  [${source.name}] ok`);
    } catch (err) {
      console.warn(`  [${source.name}] FAILED: ${(err as Error).message}`);
    }
  }

  console.log(`Ingest: ${fetched} items seen, ${inserted} new raw items stored.`);
  return { fetched, inserted };
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
