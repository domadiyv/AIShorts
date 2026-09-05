'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, SESSION_TTL_MS, sessionSecret, createSessionToken } from '../../lib/auth';

const API = process.env.API_URL || 'http://localhost:4000';
const TOKEN = process.env.ADMIN_TOKEN || '';

// Only allow same-site relative paths — never an attacker-supplied absolute URL.
function safeNext(raw: string): string {
  return raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
}

// Verify credentials against the admin_users table (via the API, which holds the
// bcrypt hashes). The Next server never sees any password hash — it forwards the
// email/password over the service token and trusts the API's yes/no.
async function verifyCredentials(email: string, password: string): Promise<boolean> {
  try {
    const res = await fetch(`${API}/v1/admin/auth/login`, {
      method: 'POST',
      headers: { 'x-admin-token': TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
      cache: 'no-store',
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function login(formData: FormData) {
  const secret = sessionSecret();
  const next = safeNext(String(formData.get('next') ?? '/'));
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!secret) redirect('/login?error=unconfigured');
  if (!email || !password || !(await verifyCredentials(email, password))) {
    redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
  }

  const jar = await cookies();
  jar.set(SESSION_COOKIE, await createSessionToken(secret), {
    httpOnly: true, // not readable from JavaScript
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
    // `secure` stays off: this runs over plain http on the LAN, and a secure
    // cookie would simply never be stored. Set it if you ever serve https.
  });
  redirect(next);
}

export async function logout() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  redirect('/login');
}
