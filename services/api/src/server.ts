import { timingSafeEqual } from 'node:crypto';
import Fastify, {
  type FastifyError,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import {
  prisma,
  CATEGORIES,
  DIFFICULTIES,
  subscribeSchema,
  cardUpdateSchema,
  cardEventSchema,
  mediaDir,
  MEDIA_ROUTE,
  ensureSeedMedia,
  type FeedCard,
} from '@aishorts/shared';
import { cacheGet, cacheSet, feedCacheVersion, bumpFeedCacheVersion } from './redis';
import { getRefreshState, startRefresh } from './refreshJob';
import { registerAuthRoutes } from './auth';

const PORT = Number(process.env.API_PORT ?? 4000);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? '';
const FEED_TTL = 60; // seconds

type CardRow = Awaited<ReturnType<typeof prisma.card.findFirst>>;

function toFeedCard(c: NonNullable<CardRow>): FeedCard {
  return {
    id: c.id,
    title: c.title,
    summary: c.summary,
    whyItMatters: c.whyItMatters,
    category: c.category,
    difficulty: c.difficulty,
    tags: c.tags,
    imageUrl: c.imageUrl,
    sourceName: c.sourceName,
    sourceUrl: c.sourceUrl,
    publishedAt: c.publishedAt ? c.publishedAt.toISOString() : null,
  };
}

// Constant-time token comparison — a plain !== leaks length/prefix timing.
function tokenMatches(candidate: unknown): boolean {
  if (!ADMIN_TOKEN || typeof candidate !== 'string') return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(ADMIN_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Reject requests to /v1/admin/* without the shared admin token.
function requireAdmin(req: FastifyRequest, reply: FastifyReply, done: () => void) {
  if (!tokenMatches(req.headers['x-admin-token'])) {
    reply.code(401).send({ error: 'unauthorized' });
    return;
  }
  done();
}

// Prisma error code, if this is a known Prisma request error.
function prismaCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code: unknown }).code)
    : undefined;
}

async function build() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  // Serve self-hosted card images (Pexels downloads + bundled seed placeholders)
  // at /media/*. mediaDir() creates the dir if missing so this never throws on a
  // fresh install/volume. imageUrls in the DB are stored relative (/media/x.jpg).
  ensureSeedMedia(); // hydrate bundled placeholders into the (possibly empty) volume
  await app.register(fastifyStatic, {
    root: mediaDir(),
    prefix: `${MEDIA_ROUTE}/`,
    decorateReply: false,
    maxAge: '7d',
  });

  // Never echo internal error details (Prisma queries, file paths) to clients.
  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err.statusCode && err.statusCode < 500) {
      reply.code(err.statusCode).send({ error: err.message });
      return;
    }
    req.log.error(err);
    reply.code(500).send({ error: 'internal_error' });
  });

  app.get('/v1/health', async () => ({ ok: true, time: new Date().toISOString() }));

  registerAuthRoutes(app);

  app.get('/v1/categories', async () => ({
    categories: CATEGORIES,
    difficulties: DIFFICULTIES,
  }));

  // Public feed: published cards, newest first, cursor-paginated.
  app.get('/v1/feed', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const limit = Math.min(Math.max(Number(q.limit) || 20, 1), 50);
    const category = CATEGORIES.includes(q.category as never) ? q.category : undefined;
    const difficulty = DIFFICULTIES.includes(q.difficulty as never) ? q.difficulty : undefined;
    const cursor = q.cursor || undefined;

    const ver = await feedCacheVersion();
    const cacheKey = `feed:v${ver}:${category ?? '*'}:${difficulty ?? '*'}:${cursor ?? '0'}:${limit}`;
    const cached = await cacheGet<{ cards: FeedCard[]; nextCursor: string | null }>(cacheKey);
    if (cached) return cached;

    const rows = await prisma.card.findMany({
      where: {
        status: 'published',
        ...(category ? { category } : {}),
        ...(difficulty ? { difficulty: difficulty as never } : {}),
      },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const result = {
      cards: page.map(toFeedCard),
      nextCursor: hasMore ? page[page.length - 1]!.id : null,
    };
    await cacheSet(cacheKey, result, FEED_TTL);
    return result;
  });

  app.get('/v1/cards/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const card = await prisma.card.findFirst({ where: { id, status: 'published' } });
    if (!card) return reply.code(404).send({ error: 'not_found' });
    return toFeedCard(card);
  });

  app.get('/v1/search', async (req) => {
    const q = (req.query as { q?: string }).q?.trim() ?? '';
    if (q.length < 2) return { cards: [] };
    const rows = await prisma.card.findMany({
      where: {
        status: 'published',
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { summary: { contains: q, mode: 'insensitive' } },
          { tags: { has: q.toLowerCase() } },
        ],
      },
      orderBy: { publishedAt: 'desc' },
      take: 30,
    });
    return { cards: rows.map(toFeedCard) };
  });

  // Newsletter signup (validation layer).
  app.post('/v1/subscribers', async (req, reply) => {
    const parsed = subscribeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_email' });
    const { email, categories } = parsed.data;
    await prisma.subscriber.upsert({
      where: { email },
      create: { email, categories, status: 'active' },
      update: { status: 'active', categories },
    });
    return { ok: true };
  });

  // Lightweight analytics event (view/read_more/share/bookmark/...).
  app.post('/v1/events', async (req, reply) => {
    const parsed = cardEventSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_event' });
    const { cardId, type, deviceId } = parsed.data;
    try {
      await prisma.cardEvent.create({ data: { cardId, type, deviceId: deviceId ?? null } });
    } catch (err) {
      // P2003 = foreign key violation → the cardId doesn't exist.
      if (prismaCode(err) === 'P2003') return reply.code(404).send({ error: 'card_not_found' });
      throw err;
    }
    return { ok: true };
  });

  // ---- Admin (token-guarded) ----
  app.get('/v1/admin/cards', { preHandler: requireAdmin }, async (req) => {
    const q = req.query as { status?: string; limit?: string };
    const status = ['pending', 'published', 'rejected'].includes(q.status ?? '')
      ? q.status
      : 'pending';
    const rows = await prisma.card.findMany({
      where: { status: status as never },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(q.limit) || 50, 200),
      // Reviewers need the ORIGINAL article's date and when we ingested it —
      // both live on the linked raw item, not on the card.
      include: { rawItem: { select: { publishedAt: true, fetchedAt: true } } },
    });
    return {
      cards: rows.map(({ rawItem, ...card }) => ({
        ...card,
        articlePublishedAt: rawItem?.publishedAt ?? null,
        sourcedAt: rawItem?.fetchedAt ?? null,
      })),
    };
  });

  // Content refresh — kicked off from the admin panel's "Fetch new articles".
  // Returns immediately; the panel polls GET for progress.
  app.post('/v1/admin/refresh', { preHandler: requireAdmin }, async (_req, reply) => {
    const { started, state } = startRefresh();
    if (!started) return reply.code(409).send({ error: 'already_running', state });
    return reply.code(202).send({ ok: true, state });
  });

  app.get('/v1/admin/refresh', { preHandler: requireAdmin }, async () => getRefreshState());

  app.post('/v1/admin/cards/:id/approve', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const card = await prisma.card.update({
        where: { id },
        data: { status: 'published', publishedAt: new Date() },
      });
      await bumpFeedCacheVersion();
      return { ok: true, card };
    } catch (err) {
      // P2025 = record not found.
      if (prismaCode(err) === 'P2025') return reply.code(404).send({ error: 'not_found' });
      throw err;
    }
  });

  app.post('/v1/admin/cards/:id/reject', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      await prisma.card.update({ where: { id }, data: { status: 'rejected' } });
      await bumpFeedCacheVersion();
      return { ok: true };
    } catch (err) {
      if (prismaCode(err) === 'P2025') return reply.code(404).send({ error: 'not_found' });
      throw err;
    }
  });

  // Bulk approve / reject — powers the panel's "Approve all" / "Approve selected".
  // One updateMany (single DB round-trip + one cache bump) for the whole batch.
  // Scoped so it's idempotent and can't clobber prior decisions: approve only
  // touches pending drafts; reject leaves already-rejected cards alone. Re-sending
  // an id that no longer qualifies is a safe no-op (reflected in the count).
  const parseIds = (body: unknown): string[] | null => {
    const ids = (body as { ids?: unknown })?.ids;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500) return null;
    if (!ids.every((x) => typeof x === 'string' && x.length > 0)) return null;
    return ids as string[];
  };

  app.post('/v1/admin/cards/bulk-approve', { preHandler: requireAdmin }, async (req, reply) => {
    const ids = parseIds(req.body);
    if (!ids) return reply.code(400).send({ error: 'invalid_ids' });
    const { count } = await prisma.card.updateMany({
      where: { id: { in: ids }, status: 'pending' },
      data: { status: 'published', publishedAt: new Date() },
    });
    await bumpFeedCacheVersion();
    return { ok: true, count };
  });

  app.post('/v1/admin/cards/bulk-reject', { preHandler: requireAdmin }, async (req, reply) => {
    const ids = parseIds(req.body);
    if (!ids) return reply.code(400).send({ error: 'invalid_ids' });
    const { count } = await prisma.card.updateMany({
      where: { id: { in: ids }, status: { not: 'rejected' } },
      data: { status: 'rejected' },
    });
    await bumpFeedCacheVersion();
    return { ok: true, count };
  });

  app.patch('/v1/admin/cards/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = cardUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_card_update',
        details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    }
    const b = parsed.data;
    try {
      const card = await prisma.card.update({
        where: { id },
        data: {
          ...(b.title !== undefined ? { title: b.title } : {}),
          ...(b.summary !== undefined ? { summary: b.summary } : {}),
          ...(b.whyItMatters !== undefined ? { whyItMatters: b.whyItMatters || null } : {}),
          ...(b.category !== undefined ? { category: b.category } : {}),
          ...(b.difficulty !== undefined ? { difficulty: b.difficulty } : {}),
          ...(b.tags !== undefined ? { tags: b.tags } : {}),
        },
      });
      await bumpFeedCacheVersion();
      return { ok: true, card };
    } catch (err) {
      if (prismaCode(err) === 'P2025') return reply.code(404).send({ error: 'not_found' });
      throw err;
    }
  });

  return app;
}

build()
  .then((app) => app.listen({ port: PORT, host: '0.0.0.0' }))
  .then((addr) => console.log(`API listening on ${addr}`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
