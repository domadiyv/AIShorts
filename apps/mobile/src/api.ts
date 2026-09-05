import { getApiBase } from './config';
import type { Card } from './types';

export type FeedResponse = { cards: Card[]; nextCursor: string | null };

// Resolve a possibly-relative card image (`/media/x.jpg`) against the API base,
// so self-hosted media follows the tunnel/cloud URL without rebaking cards.
export function resolveMediaUrl(url: string | null): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${getApiBase()}${url.startsWith('/') ? '' : '/'}${url}`;
}

export async function fetchFeed(
  opts: { category?: string; cursor?: string } = {},
): Promise<FeedResponse> {
  const qs = new URLSearchParams({ limit: '20' });
  if (opts.category) qs.set('category', opts.category);
  if (opts.cursor) qs.set('cursor', opts.cursor);
  const res = await fetch(`${getApiBase()}/v1/feed?${qs.toString()}`);
  if (!res.ok) throw new Error(`feed request failed: ${res.status}`);
  return (await res.json()) as FeedResponse;
}

// Full-catalog search (title/summary/tags), server-side so it finds cards that
// aren't in the locally-paginated feed yet. Optionally scoped to a category to
// match the active filter chip. Returns [] for queries shorter than 2 chars or
// on any failure (the caller can fall back to a local filter).
export async function apiSearch(query: string, category?: string): Promise<Card[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  try {
    const qs = new URLSearchParams({ q });
    if (category) qs.set('category', category);
    const res = await fetch(`${getApiBase()}/v1/search?${qs.toString()}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { cards?: Card[] };
    return data.cards ?? [];
  } catch {
    return [];
  }
}

// Live category list for the filter chips (admin-managed). Falls back to the
// caller's default on any failure.
export async function fetchCategories(): Promise<string[]> {
  try {
    const res = await fetch(`${getApiBase()}/v1/categories`);
    if (!res.ok) return [];
    const data = (await res.json()) as { categories?: string[] };
    return data.categories ?? [];
  } catch {
    return [];
  }
}

// ---- Auth ----
export type AuthUser = {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  provider: string;
};
export type AuthResponse = { token: string; user: AuthUser };

async function authPost(path: string, body: unknown): Promise<AuthResponse> {
  const res = await fetch(`${getApiBase()}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as AuthResponse & { error?: string };
  if (!res.ok) throw new Error(data?.error || `request failed: ${res.status}`);
  return data;
}

export function apiRegister(input: {
  email: string;
  password: string;
  name?: string;
}): Promise<AuthResponse> {
  return authPost('/v1/auth/register', input);
}

export function apiLogin(input: { email: string; password: string }): Promise<AuthResponse> {
  return authPost('/v1/auth/login', input);
}

export function apiGoogle(idToken: string): Promise<AuthResponse> {
  return authPost('/v1/auth/google', { idToken });
}

// Permanently delete the signed-in user's account and all associated data.
// Requires the bearer token; the caller clears the local session on success.
export async function apiDeleteAccount(token: string): Promise<void> {
  const res = await fetch(`${getApiBase()}/v1/auth/me`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data?.error || `request failed: ${res.status}`);
  }
}

// Fire-and-forget analytics (view / read_more / share / bookmark).
export function recordEvent(cardId: string, type: string): void {
  fetch(`${getApiBase()}/v1/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cardId, type }),
  }).catch(() => {});
}
