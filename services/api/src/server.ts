import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import {
  prisma,
  CATEGORIES,
  DIFFICULTIES,
  subscribeSchema,
  type FeedCard,
} from '@aishorts/shared';
import { cacheGet, cacheSet } from './redis';

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

// Reject requests to /v1/admin/* without the shared admin token.
function requireAdmin(req: FastifyRequest, reply: FastifyReply, done: () => void) {
  if (!ADMIN_TOKEN || req.headers['x-admin-token'] !== ADMIN_TOKEN) {
    reply.code(401).send({ error: 'unauthorized' });
    return;
  }
  done();
}

async function build() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  app.get('/v1/health', async () => ({ ok: true, time: new Date().toISOString() }));

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

    const cacheKey = `feed:${category ?? '*'}:${difficulty ?? '*'}:${cursor ?? '0'}:${limit}`;
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
    const b = req.body as { cardId?: string; type?: string; deviceId?: string };
    if (!b?.cardId || !b?.type) return reply.code(400).send({ error: 'cardId and type required' });
    await prisma.cardEvent.create({
      data: { cardId: b.cardId, type: b.type, deviceId: b.deviceId ?? null },
    });
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
    });
    return { cards: rows };
  });

  app.post('/v1/admin/cards/:id/approve', { preHandler: requireAdmin }, async (req) => {
    const { id } = req.params as { id: string };
    const card = await prisma.card.update({
      where: { id },
      data: { status: 'published', publishedAt: new Date() },
    });
    return { ok: true, card };
  });

  app.post('/v1/admin/cards/:id/reject', { preHandler: requireAdmin }, async (req) => {
    const { id } = req.params as { id: string };
    await prisma.card.update({ where: { id }, data: { status: 'rejected' } });
    return { ok: true };
  });

  app.patch('/v1/admin/cards/:id', { preHandler: requireAdmin }, async (req) => {
    const { id } = req.params as { id: string };
    const b = req.body as Partial<{
      title: string;
      summary: string;
      whyItMatters: string;
      category: string;
      difficulty: string;
      tags: string[];
    }>;
    const card = await prisma.card.update({
      where: { id },
      data: {
        ...(b.title !== undefined ? { title: b.title } : {}),
        ...(b.summary !== undefined ? { summary: b.summary } : {}),
        ...(b.whyItMatters !== undefined ? { whyItMatters: b.whyItMatters } : {}),
        ...(b.category !== undefined ? { category: b.category } : {}),
        ...(b.difficulty !== undefined ? { difficulty: b.difficulty as never } : {}),
        ...(b.tags !== undefined ? { tags: b.tags } : {}),
      },
    });
    return { ok: true, card };
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
