// Session tokens for the admin panel.
//
// Uses ONLY Web Crypto (crypto.subtle), which exists in both the Edge runtime
// (middleware.ts) and Node (server actions) — so one implementation covers both.
//
// Token format: "<expiryMs>.<base64url(HMAC-SHA256(expiryMs))>".
// The signature is keyed on ADMIN_PASSWORD, so changing the password
// immediately invalidates every existing session.

export const SESSION_COOKIE = 'aishorts_admin_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — convenient on a phone

const encoder = new TextEncoder();

export function adminPassword(): string | null {
  const pw = process.env.ADMIN_PASSWORD;
  return pw && pw.length > 0 ? pw : null;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function toBase64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export async function createSessionToken(secret: string, ttlMs = SESSION_TTL_MS): Promise<string> {
  const payload = String(Date.now() + ttlMs);
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(payload));
  return `${payload}.${toBase64Url(sig)}`;
}

// Returns true only for an untampered, unexpired token.
// crypto.subtle.verify is constant-time, so this leaks no timing signal.
export async function verifySessionToken(secret: string, token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  let valid: boolean;
  try {
    valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      fromBase64Url(sig) as unknown as BufferSource,
      encoder.encode(payload),
    );
  } catch {
    return false; // malformed base64 etc.
  }
  if (!valid) return false;

  const expiry = Number(payload);
  return Number.isFinite(expiry) && expiry > Date.now();
}
