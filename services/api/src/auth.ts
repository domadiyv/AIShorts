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
const JWT_SECRET = process.env.AUTH_JWT_SECRET ?? 'dev-jwt-secret-change-me';
const TOKEN_TTL = '30d';
// When set, Google ID tokens are verified for real (via Google's tokeninfo
// endpoint). When unset, we run in MOCK mode — see verifyGoogleIdToken.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

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

// Real mode: hit Google's tokeninfo endpoint and check the audience.
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
    return { sub: info.sub, email: info.email, name: info.name, picture: info.picture };
  }
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

export function registerAuthRoutes(app: FastifyInstance) {
  app.post('/v1/auth/register', async (req, reply) => {
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

  app.post('/v1/auth/login', async (req, reply) => {
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

  app.post('/v1/auth/google', async (req, reply) => {
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
}
