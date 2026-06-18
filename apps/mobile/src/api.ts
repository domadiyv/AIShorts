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

// Fire-and-forget analytics (view / read_more / share / bookmark).
export function recordEvent(cardId: string, type: string): void {
  fetch(`${API_URL}/v1/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cardId, type }),
  }).catch(() => {});
}
