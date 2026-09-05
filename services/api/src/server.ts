import { timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import Fastify, {
  type FastifyError,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import {
  prisma,
  CATEGORIES,
  slugify,
  computeRankScore,
  RANK_DEFAULT,
  RANK_WEIGHTS,
  RANK_SCALE_MAX,
  subscribeSchema,
  cardUpdateSchema,
  cardEventSchema,
  categoryCreateSchema,
  categoryUpdateSchema,
  categoryDeleteSchema,
  sourceCreateSchema,
  sourcePreviewSchema,
  sourceUpdateSchema,
  adminLoginSchema,
  mediaDir,
  MEDIA_ROUTE,
  imageAssetUrl,
  ensureSeedMedia,
  type FeedCard,
} from '@aishorts/shared';
import { cacheGet, cacheSet, feedCacheVersion, bumpFeedCacheVersion } from './redis';
import { getRefreshState, startRefresh, startHourlyRefresh } from './refreshJob';
import { registerAuthRoutes, assertAuthConfig } from './auth';
import { previewFeed } from '@aishorts/worker';

// Categories live in the DB now; fall back to the seed list only if the table
// can't be read (e.g. mid-migration), so the feed/admin never break.
async function activeCategoryNames(): Promise<string[]> {
  try {
    const rows = await prisma.category.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { name: true },
    });
    if (rows.length) return rows.map((r) => r.name);
  } catch {
    /* fall through to the bundled list */
  }
  return [...CATEGORIES];
}

// Ensure at least one admin operator exists. Bootstraps the first one from env
// (ADMIN_BOOTSTRAP_EMAIL/PASSWORD) so a fresh deploy isn't locked out; after that
// operators are managed with the create-admin script.
async function bootstrapAdminUser(): Promise<void> {
  try {
    const count = await prisma.adminUser.count();
    if (count > 0) return;
    const email = process.env.ADMIN_BOOTSTRAP_EMAIL;
    const password = process.env.ADMIN_BOOTSTRAP_PASSWORD || process.env.ADMIN_PASSWORD;
    if (!email || !password) return;
    await prisma.adminUser.create({
      data: {
        email: email.toLowerCase(),
        name: 'Admin',
        passwordHash: await bcrypt.hash(password, 10),
      },
    });
    console.log(`Bootstrapped admin operator ${email}`);
  } catch (err) {
    console.warn(`Admin bootstrap skipped: ${(err as Error).message}`);
  }
}

const PORT = Number(process.env.API_PORT ?? 4000);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? '';
const FEED_TTL = 60; // seconds

type CardRow = NonNullable<Awaited<ReturnType<typeof prisma.card.findFirst>>>;
// Queries that feed the client include the linked raw item's original publish
// date so the card shows when the ARTICLE was published, not when we approved it.
type FeedCardRow = CardRow & { rawItem?: { publishedAt: Date | null } | null };

function toFeedCard(c: FeedCardRow): FeedCard {
  // Readers should see the ORIGINAL article's publish date (denormalized onto the
  // card as articlePublishedAt). Fall back to the linked raw item, then to our own
  // publish (approval) timestamp for seed/manual cards with no real date.
  const displayDate = c.articlePublishedAt ?? c.rawItem?.publishedAt ?? c.publishedAt;
  return {
    id: c.id,
    title: c.title,
    summary: c.summary,
    whyItMatters: c.whyItMatters,
    category: c.category,
    tags: c.tags,
    // Prefer the DB-stored image (served from /v1/images/:id); fall back to any
    // legacy relative URL (e.g. bundled /media/seed/*.png on older seed cards).
    imageUrl: c.imageAssetId ? imageAssetUrl(c.imageAssetId) : c.imageUrl,
    sourceName: c.sourceName,
    sourceUrl: c.sourceUrl,
    publishedAt: displayDate ? displayDate.toISOString() : null,
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
  // trustProxy: the API sits behind the Cloudflare tunnel (cloudflared →
  // localhost), so the real client IP arrives in X-Forwarded-For. Trusting it
  // makes req.ip the actual caller, which the rate limiter keys on. Only our own
  // tunnel connects to this port, so trusting the forwarded header is safe here.
  const app = Fastify({ logger: true, trustProxy: true });

  // CORS: the RN app sends no Origin header (so it's never blocked), and the
  // admin panel calls the API server-side over the Docker network (no CORS at
  // all). Browser origins are therefore an allowlist: set CORS_ORIGINS (comma-
  // separated) in production to lock it down; unset falls back to reflecting any
  // origin for local dev.
  const corsOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  await app.register(cors, { origin: corsOrigins.length ? corsOrigins : true });

  // The service token the trusted admin Next server presents on every call. Used
  // below to exempt admin *read* polling from the public rate limit.
  const adminToken = process.env.ADMIN_TOKEN ?? '';

  // Rate limiting: the API is internet-facing via the tunnel, so cap requests
  // per client IP to blunt brute-force (auth) and spam (events/subscribers).
  // Global default is generous for a feed reader; sensitive POSTs override it
  // with a much tighter per-route limit (see rateLimit config on those routes).
  await app.register(rateLimit, {
    global: true,
    max: Number(process.env.RATE_LIMIT_MAX ?? 300),
    timeWindow: process.env.RATE_LIMIT_WINDOW ?? '1 minute',
    // Key each bucket on the REAL client so every end user gets their own budget
    // instead of everyone sharing the tunnel's single IP. Behind Cloudflare the
    // real client is in `cf-connecting-ip`; fall back to the X-Forwarded-For-
    // derived req.ip (trustProxy), then the socket address.
    keyGenerator: (req) => {
      const cf = req.headers['cf-connecting-ip'];
      return (Array.isArray(cf) ? cf[0] : cf) || req.ip;
    },
    allowList: (req) => {
      // Health checks (Docker + uptime pings) shouldn't burn the budget.
      if (req.url === '/v1/health') return true;
      // Card images / static media are cacheable, non-sensitive GETs — a feed
      // screen fires one per card, so metering them would throttle real users
      // scrolling. (They're cached on-device for a year after first load.)
      if (req.url.startsWith('/v1/images/') || req.url.startsWith(`${MEDIA_ROUTE}/`)) return true;
      // Trusted first-party admin SERVER reads: the review list + the 2s
      // refresh-state poll come from one container IP and would otherwise
      // exhaust a single bucket. Only GETs carrying the service token are
      // exempt — every POST (login, approve, reject) stays metered, so
      // brute-force / bulk protection is untouched.
      if (
        req.method === 'GET' &&
        req.url.startsWith('/v1/admin/') &&
        adminToken &&
        req.headers['x-admin-token'] === adminToken
      ) {
        return true;
      }
      return false;
    },
  });

  // Serve self-hosted card images (Pexels downloads + bundled seed placeholders)
  // at /media/*. mediaDir() creates the dir if missing so this never throws on a
  // fresh install/volume. imageUrls in the DB are stored relative (/media/x.jpg).
  ensureSeedMedia(); // hydrate bundled placeholders into the (possibly empty) volume
  await bootstrapAdminUser(); // create the first admin operator if none exists
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

  // Fail fast if production auth secrets are missing/insecure (see auth.ts).
  assertAuthConfig();
  registerAuthRoutes(app);

  app.get('/v1/categories', async () => ({
    categories: await activeCategoryNames(),
  }));

  // Public feed: published cards, newest first, cursor-paginated.
  app.get('/v1/feed', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const limit = Math.min(Math.max(Number(q.limit) || 20, 1), 50);
    // Categories are dynamic; accept any non-empty value and let the DB filter.
    const category = q.category && q.category.trim() ? q.category.trim() : undefined;
    const cursor = q.cursor || undefined;

    const ver = await feedCacheVersion();
    const cacheKey = `feed:v${ver}:${category ?? '*'}:${cursor ?? '0'}:${limit}`;
    const cached = await cacheGet<{ cards: FeedCard[]; nextCursor: string | null }>(cacheKey);
    if (cached) return cached;

    const rows = await prisma.card.findMany({
      where: {
        status: 'published',
        ...(category ? { category } : {}),
      },
      // Blended ranking: importance + source priority + article recency, all
      // baked into rankScore. id is the stable tiebreaker for cursor pagination.
      orderBy: [{ rankScore: 'desc' }, { id: 'desc' }],
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
    const card = await prisma.card.findFirst({
      where: { id, status: 'published' },
      include: { rawItem: { select: { publishedAt: true } } },
    });
    if (!card) return reply.code(404).send({ error: 'not_found' });
    return toFeedCard(card);
  });

  // Serve a self-hosted image stored in Postgres (media_assets.data bytea).
  // Immutable content (id is content-derived) → cache hard.
  app.get('/v1/images/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const asset = await prisma.mediaAsset.findUnique({
      where: { id },
      select: { data: true, contentType: true },
    });
    if (!asset) return reply.code(404).send({ error: 'not_found' });
    return reply
      .header('Content-Type', asset.contentType)
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .send(Buffer.from(asset.data));
  });

  app.get('/v1/search', async (req) => {
    const qp = req.query as { q?: string; category?: string };
    const q = qp.q?.trim() ?? '';
    if (q.length < 2) return { cards: [] };
    // Optional category scope so search matches the active filter chip (empty =
    // search the whole catalog, which is what the feed's "All" view expects).
    const category = qp.category && qp.category.trim() ? qp.category.trim() : undefined;
    const rows = await prisma.card.findMany({
      where: {
        status: 'published',
        ...(category ? { category } : {}),
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { summary: { contains: q, mode: 'insensitive' } },
          { tags: { has: q.toLowerCase() } },
        ],
      },
      orderBy: [{ rankScore: 'desc' }, { id: 'desc' }],
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
    const q = req.query as {
      status?: string;
      limit?: string;
      offset?: string;
      q?: string;
    };
    const status = ['pending', 'published', 'rejected'].includes(q.status ?? '')
      ? q.status
      : 'pending';
    // Case-insensitive search across the fields a reviewer scans by: headline,
    // summary body, and the originating source name.
    const search = (q.q ?? '').trim();
    const where = {
      status: status as never,
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: 'insensitive' as const } },
              { summary: { contains: search, mode: 'insensitive' as const } },
              { sourceName: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const take = Math.min(Number(q.limit) || 50, 200);
    const skip = Math.max(Number(q.offset) || 0, 0);
    // `total` is the full match count (ignoring pagination) so the UI can show the
    // real number of cards and compute page counts.
    const [rows, total] = await Promise.all([
      prisma.card.findMany({
        where,
        // Published: newest-published first (by approval time). Pending/rejected have
        // no publishedAt, so order those by when the card was created.
        orderBy: status === 'published' ? { publishedAt: 'desc' } : { createdAt: 'desc' },
        take,
        skip,
        // Reviewers need the ORIGINAL article's date and when we ingested it —
        // both live on the linked raw item, not on the card.
        include: { rawItem: { select: { publishedAt: true, fetchedAt: true } } },
      }),
      prisma.card.count({ where }),
    ]);
    return {
      total,
      cards: rows.map(({ rawItem, ...card }) => ({
        ...card,
        imageUrl: card.imageAssetId ? imageAssetUrl(card.imageAssetId) : card.imageUrl,
        articlePublishedAt: rawItem?.publishedAt ?? card.articlePublishedAt ?? null,
        sourcedAt: rawItem?.fetchedAt ?? null,
      })),
    };
  });

  // ---- Admin: sources (list + edit ingest priority/status) ----
  app.get('/v1/admin/sources', { preHandler: requireAdmin }, async () => {
    const sources = await prisma.source.findMany({
      // Priority is 1 = top … 5 = low, so ascending puts top sources first.
      orderBy: [{ priority: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { rawItems: true } } },
    });
    return {
      sources: sources.map((s) => ({
        id: s.id,
        name: s.name,
        url: s.url,
        type: s.type,
        trusted: s.trusted,
        active: s.active,
        priority: s.priority,
        itemCount: s._count.rawItems,
      })),
    };
  });

  // Validate + preview a feed URL before adding it. Fetches/parses the feed so
  // dead links or non-feed pages are caught in the UI, not on the next ingest.
  app.post('/v1/admin/sources/preview', { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = sourcePreviewSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ ok: false, error: 'invalid_url' });
    const result = await previewFeed(parsed.data.url);
    return result;
  });

  // Add a new source. New cards from it rank with the source's priority (default
  // 3 = Normal). Existing raw_items/cards are unaffected until the next ingest.
  app.post('/v1/admin/sources', { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = sourceCreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_source' });
    const b = parsed.data;
    try {
      const source = await prisma.source.create({
        data: {
          name: b.name.trim(),
          url: b.url.trim(),
          type: b.type,
          priority: b.priority,
          trusted: b.trusted,
          active: b.active,
        },
      });
      return reply.code(201).send({ ok: true, source });
    } catch (err) {
      // P2002 = unique violation on url — this feed is already a source.
      if (prismaCode(err) === 'P2002') return reply.code(409).send({ error: 'source_exists' });
      throw err;
    }
  });

  // Delete a source. Non-destructive to content: raw_items.sourceId is
  // ON DELETE SET NULL and the denormalized sourceName/sourceUrl on raw_items and
  // cards preserve attribution, so published cards keep working.
  app.delete('/v1/admin/sources/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      await prisma.source.delete({ where: { id } });
      return { ok: true };
    } catch (err) {
      if (prismaCode(err) === 'P2025') return reply.code(404).send({ error: 'not_found' });
      throw err;
    }
  });

  app.patch('/v1/admin/sources/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = sourceUpdateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_source_update' });
    const b = parsed.data;
    try {
      const source = await prisma.source.update({
        where: { id },
        data: {
          ...(b.priority !== undefined ? { priority: b.priority } : {}),
          ...(b.active !== undefined ? { active: b.active } : {}),
          ...(b.trusted !== undefined ? { trusted: b.trusted } : {}),
        },
      });
      // Changing a source's priority re-ranks every card that came from it.
      // Recompute rankScore in one UPDATE (mirrors computeRankScore in shared):
      //   W_imp*(MAX+1-importance) + W_src*(MAX+1-priority) + W_age*days(articleDate)
      if (b.priority !== undefined) {
        await prisma.$executeRaw`
          UPDATE "cards" c
          SET "rankScore" =
              ${RANK_WEIGHTS.importance} * (${RANK_SCALE_MAX + 1} - c."importance")
            + ${RANK_WEIGHTS.source} * (${RANK_SCALE_MAX + 1} - ${b.priority})
            + ${RANK_WEIGHTS.agePerDay} * (EXTRACT(EPOCH FROM COALESCE(c."articlePublishedAt", c."publishedAt", c."createdAt")) / 86400.0)
          FROM "raw_items" r
          WHERE c."rawItemId" = r."id" AND r."sourceId" = ${id}
        `;
        await bumpFeedCacheVersion();
      }
      return { ok: true, source };
    } catch (err) {
      if (prismaCode(err) === 'P2025') return reply.code(404).send({ error: 'not_found' });
      throw err;
    }
  });

  // ---- Admin: categories (list all + add / rename / delete) ----
  app.get('/v1/admin/categories', { preHandler: requireAdmin }, async () => {
    const categories = await prisma.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    // Category is a free-form string on cards (not a FK), so count how many cards
    // carry each name — the UI needs this to require a reassign target on delete.
    const grouped = await prisma.card.groupBy({
      by: ['category'],
      _count: { _all: true },
    });
    const counts = new Map(grouped.map((g) => [g.category, g._count._all]));
    return {
      categories: categories.map((c) => ({ ...c, cardCount: counts.get(c.name) ?? 0 })),
    };
  });

  app.post('/v1/admin/categories', { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = categoryCreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_category' });
    const name = parsed.data.name.trim();
    const slug = slugify(name);
    if (!slug) return reply.code(400).send({ error: 'invalid_category' });
    // Next sortOrder = after the current max, so new categories append.
    const max = await prisma.category.aggregate({ _max: { sortOrder: true } });
    try {
      const category = await prisma.category.create({
        data: { name, slug, sortOrder: (max._max.sortOrder ?? 0) + 10 },
      });
      return reply.code(201).send({ ok: true, category });
    } catch (err) {
      // P2002 = unique violation (name or slug already exists).
      if (prismaCode(err) === 'P2002') return reply.code(409).send({ error: 'category_exists' });
      throw err;
    }
  });

  // Rename a category. Because card.category is a free-form string (not a FK),
  // renaming must migrate every card carrying the old name in the same
  // transaction so the feed's category filters stay consistent.
  app.patch('/v1/admin/categories/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = categoryUpdateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_category' });
    const name = parsed.data.name.trim();
    const slug = slugify(name);
    if (!slug) return reply.code(400).send({ error: 'invalid_category' });
    const existing = await prisma.category.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    if (existing.name === name) return { ok: true, category: existing, moved: 0 };
    try {
      const [category, moved] = await prisma.$transaction([
        prisma.category.update({ where: { id }, data: { name, slug } }),
        prisma.card.updateMany({ where: { category: existing.name }, data: { category: name } }),
      ]);
      await bumpFeedCacheVersion();
      return { ok: true, category, moved: moved.count };
    } catch (err) {
      if (prismaCode(err) === 'P2002') return reply.code(409).send({ error: 'category_exists' });
      throw err;
    }
  });

  // Delete a category. If cards still carry its name, `reassignTo` (an existing
  // category name) is required and those cards move there first; otherwise the
  // feed would show a category filter that resolves to nothing.
  app.delete('/v1/admin/categories/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = categoryDeleteSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    const existing = await prisma.category.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    const count = await prisma.card.count({ where: { category: existing.name } });
    const reassignTo = parsed.data.reassignTo?.trim();
    if (count > 0) {
      if (!reassignTo) return reply.code(400).send({ error: 'reassign_required', count });
      if (reassignTo === existing.name)
        return reply.code(400).send({ error: 'reassign_invalid' });
      const target = await prisma.category.findFirst({ where: { name: reassignTo } });
      if (!target) return reply.code(400).send({ error: 'reassign_target_missing' });
      await prisma.card.updateMany({
        where: { category: existing.name },
        data: { category: reassignTo },
      });
    }
    await prisma.category.delete({ where: { id } });
    await bumpFeedCacheVersion();
    return { ok: true, moved: count };
  });

  // ---- Admin: operator login (verified against admin_users) ----
  // Guarded by the service token (the admin Next server holds it and calls this
  // on the operator's behalf); the browser never sees the service token.
  app.post(
    '/v1/admin/auth/login',
    { preHandler: requireAdmin, config: { rateLimit: { max: 15, timeWindow: '5 minutes' } } },
    async (req, reply) => {
    const parsed = adminLoginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_login' });
    const email = parsed.data.email.toLowerCase();
    const user = await prisma.adminUser.findUnique({ where: { email } });
    // Same generic error whether the email is unknown, inactive, or the password
    // is wrong — never reveal which.
    if (!user || !user.active) return reply.code(401).send({ error: 'invalid_credentials' });
    const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
    if (!ok) return reply.code(401).send({ error: 'invalid_credentials' });
    return { ok: true, user: { id: user.id, email: user.email, name: user.name } };
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
      // Editing importance re-ranks the card, so recompute its blended rankScore
      // from the (new) importance, the source's priority, and the article date.
      let rankScore: number | undefined;
      if (b.importance !== undefined) {
        const existing = await prisma.card.findUnique({
          where: { id },
          select: {
            articlePublishedAt: true,
            rawItem: { select: { publishedAt: true, source: { select: { priority: true } } } },
          },
        });
        if (!existing) return reply.code(404).send({ error: 'not_found' });
        rankScore = computeRankScore({
          importance: b.importance,
          sourcePriority: existing.rawItem?.source?.priority ?? RANK_DEFAULT,
          articleDate: existing.articlePublishedAt ?? existing.rawItem?.publishedAt ?? null,
        });
      }
      const card = await prisma.card.update({
        where: { id },
        data: {
          ...(b.title !== undefined ? { title: b.title } : {}),
          ...(b.summary !== undefined ? { summary: b.summary } : {}),
          ...(b.whyItMatters !== undefined ? { whyItMatters: b.whyItMatters || null } : {}),
          ...(b.category !== undefined ? { category: b.category } : {}),
          ...(b.tags !== undefined ? { tags: b.tags } : {}),
          ...(b.importance !== undefined ? { importance: b.importance } : {}),
          ...(rankScore !== undefined ? { rankScore } : {}),
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
  .then((addr) => {
    console.log(`API listening on ${addr}`);
    // Kick off the hourly background fetch once the server is up. It shares the
    // manual "Fetch" job state, so a collision with an admin click is handled
    // gracefully (see startHourlyRefresh).
    startHourlyRefresh((msg) => console.log(msg));
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
