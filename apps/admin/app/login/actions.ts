'use server';
import { timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, SESSION_TTL_MS, adminPassword, createSessionToken } from '../../lib/auth';

// Constant-time compare so a wrong password can't be discovered byte-by-byte.
function passwordMatches(candidate: string, actual: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Only allow same-site relative paths — never an attacker-supplied absolute URL.
function safeNext(raw: string): string {
  return raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
}

export async function login(formData: FormData) {
  const secret = adminPassword();
  const next = safeNext(String(formData.get('next') ?? '/'));

  if (!secret) redirect('/login?error=unconfigured');
  if (!passwordMatches(String(formData.get('password') ?? ''), secret)) {
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
