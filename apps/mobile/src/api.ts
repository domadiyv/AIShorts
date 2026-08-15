import { API_URL } from './config';
import type { Card } from './types';

export type FeedResponse = { cards: Card[]; nextCursor: string | null };

export async function fetchFeed(
  opts: { category?: string; difficulty?: string; cursor?: string } = {},
): Promise<FeedResponse> {
  const qs = new URLSearchParams({ limit: '20' });
  if (opts.category) qs.set('category', opts.category);
  if (opts.difficulty) qs.set('difficulty', opts.difficulty);
  if (opts.cursor) qs.set('cursor', opts.cursor);
  const res = await fetch(`${API_URL}/v1/feed?${qs.toString()}`);
  if (!res.ok) throw new Error(`feed request failed: ${res.status}`);
  return (await res.json()) as FeedResponse;
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
  const res = await fetch(`${API_URL}${path}`, {
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

// Fire-and-forget analytics (view / read_more / share / bookmark).
export function recordEvent(cardId: string, type: string): void {
  fetch(`${API_URL}/v1/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cardId, type }),
  }).catch(() => {});
}
