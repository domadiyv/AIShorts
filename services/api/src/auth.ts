import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  prisma,
  registerSchema,
  loginSchema,
  googleAuthSchema,
  type PublicUser,
} from '@aishorts/shared';

// A dev fallback keeps local setup zero-config; override in production.
const DEV_JWT_SECRET = 'dev-jwt-secret-change-me';
// Fall back to the dev secret when AUTH_JWT_SECRET is unset OR empty/whitespace
// (`??` alone would let `AUTH_JWT_SECRET=` through as an empty signing key). This
// keeps the insecure value pinned to DEV_JWT_SECRET so assertAuthConfig catches it.
const JWT_SECRET = process.env.AUTH_JWT_SECRET?.trim() || DEV_JWT_SECRET;
const TOKEN_TTL = '30d';
// When set, Google ID tokens are verified for real (via Google's tokeninfo
// endpoint). When unset, we run in MOCK mode — see verifyGoogleIdToken.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Refuse to boot with insecure auth defaults in production. The dev JWT secret
// lets anyone forge sessions, and unset GOOGLE_CLIENT_ID puts Google login into
// MOCK mode where any base64 identity is accepted (account takeover). These are
// fine locally but must never ship. Called from the server bootstrap.
export function assertAuthConfig(): void {
  if (!IS_PRODUCTION) return;
  const problems: string[] = [];
  if (JWT_SECRET === DEV_JWT_SECRET)
    problems.push('AUTH_JWT_SECRET is unset/empty/dev-default — set a strong secret.');
  else if (JWT_SECRET.length < 32)
    problems.push('AUTH_JWT_SECRET is too short — use at least 32 characters.');
  if (!GOOGLE_CLIENT_ID)
    problems.push('GOOGLE_CLIENT_ID is unset — Google login would run in insecure MOCK mode.');
  if (problems.length) {
    throw new Error(
      `Refusing to start in production with insecure auth config:\n  - ${problems.join('\n  - ')}`,
    );
  }
}

type UserRow = NonNullable<Awaited<ReturnType<typeof prisma.user.findFirst>>>;

function publicUser(u: UserRow): PublicUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    avatarUrl: u.avatarUrl,
    provider: u.provider,
  };
}

function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

export function verifyToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return typeof payload === 'object' && payload.sub ? String(payload.sub) : null;
  } catch {
    return null;
  }
}

type GoogleIdentity = { sub: string; email: string; name?: string; picture?: string };

// Google's OIDC issuer values (both forms are valid in Google id_tokens).
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

// Real mode: hit Google's tokeninfo endpoint (which validates the token's
// signature and expiry server-side) and then verify every claim we rely on:
//   - aud  === our client ID     (token was minted for THIS app, not another)
//   - iss  is a Google issuer    (token really came from Google)
//   - exp  is in the future      (defense-in-depth; tokeninfo also rejects expired)
//   - email_verified === 'true'  (don't trust an unverified email for linking)
// Mock mode: the "idToken" is base64url(JSON({ sub, email, name, picture })),
// produced by the mobile app when no client ID is configured. Swapping in a
// real client ID (server GOOGLE_CLIENT_ID + client EXPO_PUBLIC_GOOGLE_CLIENT_ID)
// flips this to real verification with no other code changes.
async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
  if (GOOGLE_CLIENT_ID) {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
    );
    if (!res.ok) throw new Error('invalid_google_token');
    const info = (await res.json()) as Record<string, string>;
    if (info.aud !== GOOGLE_CLIENT_ID) throw new Error('invalid_google_token');
    if (!GOOGLE_ISSUERS.has(info.iss)) throw new Error('invalid_google_token');
    // tokeninfo returns strings; exp is seconds since epoch.
    const expMs = Number(info.exp) * 1000;
    if (!Number.isFinite(expMs) || expMs <= Date.now()) throw new Error('invalid_google_token');
    if (info.email_verified !== 'true') throw new Error('invalid_google_token');
    if (!info.sub || !info.email) throw new Error('invalid_google_token');
    return { sub: info.sub, email: info.email, name: info.name, picture: info.picture };
  }
  // MOCK mode (no GOOGLE_CLIENT_ID). Never allow this in production — assertAuthConfig
  // already blocks boot, but guard here too so it can't be reached by mistake.
  if (IS_PRODUCTION) throw new Error('google_login_unavailable');
  try {
    const json = Buffer.from(idToken, 'base64url').toString('utf8');
    const p = JSON.parse(json) as Partial<GoogleIdentity>;
    if (!p.sub || !p.email) throw new Error('invalid_google_token');
    return { sub: String(p.sub), email: String(p.email), name: p.name, picture: p.picture };
  } catch {
    throw new Error('invalid_google_token');
  }
}

// Bearer-token guard. Sets req.userId; used by protected routes.
export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const userId = token ? verifyToken(token) : null;
  if (!userId) {
    reply.code(401).send({ error: 'unauthorized' });
    return;
  }
  (req as FastifyRequest & { userId?: string }).userId = userId;
}

// Tight limit for credential endpoints — brute-forcing a password or spamming
// signups is the main abuse vector once the API is internet-facing.
const AUTH_RATE_LIMIT = { config: { rateLimit: { max: 15, timeWindow: '5 minutes' } } };

export function registerAuthRoutes(app: FastifyInstance) {
  app.post('/v1/auth/register', AUTH_RATE_LIMIT, async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_registration' });
    const { email, password, name } = parsed.data;
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return reply.code(409).send({ error: 'email_taken' });
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email, name: name ?? null, passwordHash, provider: 'password' },
    });
    return { token: signToken(user.id), user: publicUser(user) };
  });

  app.post('/v1/auth/login', AUTH_RATE_LIMIT, async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_login' });
    const { email, password } = parsed.data;
    const user = await prisma.user.findUnique({ where: { email } });
    // Same generic error whether the email is unknown or the password is wrong.
    if (!user || !user.passwordHash) return reply.code(401).send({ error: 'invalid_credentials' });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return reply.code(401).send({ error: 'invalid_credentials' });
    return { token: signToken(user.id), user: publicUser(user) };
  });

  app.post('/v1/auth/google', AUTH_RATE_LIMIT, async (req, reply) => {
    const parsed = googleAuthSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_google_request' });
    let identity: GoogleIdentity;
    try {
      identity = await verifyGoogleIdToken(parsed.data.idToken);
    } catch {
      return reply.code(401).send({ error: 'invalid_google_token' });
    }
    // Match by Google sub first, then by email (account linking), else create.
    let user =
      (await prisma.user.findUnique({ where: { googleSub: identity.sub } })) ??
      (await prisma.user.findUnique({ where: { email: identity.email } }));
    if (user) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          googleSub: identity.sub,
          provider: 'google',
          name: user.name ?? identity.name ?? null,
          avatarUrl: user.avatarUrl ?? identity.picture ?? null,
        },
      });
    } else {
      user = await prisma.user.create({
        data: {
          email: identity.email,
          name: identity.name ?? null,
          avatarUrl: identity.picture ?? null,
          googleSub: identity.sub,
          provider: 'google',
        },
      });
    }
    return { token: signToken(user.id), user: publicUser(user) };
  });

  app.get('/v1/auth/me', { preHandler: requireAuth }, async (req, reply) => {
    const userId = (req as FastifyRequest & { userId?: string }).userId!;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return reply.code(404).send({ error: 'not_found' });
    return { user: publicUser(user) };
  });

  // Permanent account deletion — required by the App Store (5.1.1(v)) and Google
  // Play. Erases the user and everything linked to them (bookmarks, registered
  // devices, and their analytics events) in one transaction. Irreversible.
  app.delete('/v1/auth/me', { preHandler: requireAuth }, async (req, reply) => {
    const userId = (req as FastifyRequest & { userId?: string }).userId!;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return reply.code(404).send({ error: 'not_found' });
    // Order matters: remove rows that reference the user before the user itself
    // (bookmarks/devices are ON DELETE RESTRICT by default). CardEvent.userId is
    // a plain column (no FK), so clear those rows too to drop the user's trail.
    await prisma.$transaction([
      prisma.bookmark.deleteMany({ where: { userId } }),
      prisma.cardEvent.deleteMany({ where: { userId } }),
      prisma.device.deleteMany({ where: { userId } }),
      prisma.user.delete({ where: { id: userId } }),
    ]);
    return { ok: true };
  });
}
