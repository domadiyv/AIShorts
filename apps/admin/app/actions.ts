'use server';
import { revalidatePath } from 'next/cache';

const API = process.env.API_URL || 'http://localhost:4000';
const TOKEN = process.env.ADMIN_TOKEN || '';
const headers = { 'x-admin-token': TOKEN, 'content-type': 'application/json' };

// Fail loudly: a silent no-op on approve/reject is worse than an error page.
async function call(path: string, init: RequestInit): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, init);
  } catch {
    throw new Error(`API unreachable at ${API} — is the API server running?`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${res.status} on ${path}: ${body.slice(0, 300)}`);
  }
  revalidatePath('/');
}

export async function approveCard(formData: FormData) {
  const id = String(formData.get('id'));
  await call(`/v1/admin/cards/${id}/approve`, { method: 'POST', headers, body: '{}' });
}

export async function rejectCard(formData: FormData) {
  const id = String(formData.get('id'));
  await call(`/v1/admin/cards/${id}/reject`, { method: 'POST', headers, body: '{}' });
}

export type RefreshState = {
  status: 'idle' | 'running' | 'done' | 'error';
  message: string;
  startedAt: string | null;
  finishedAt: string | null;
  result: { fetched: number; inserted: number; created: number; skipped: number } | null;
  error: string | null;
};

// Kick off a content refresh. Returns the job state rather than throwing on 409
// (already running) — that's a normal outcome the UI just displays.
export async function startRefresh(): Promise<RefreshState> {
  const res = await fetch(`${API}/v1/admin/refresh`, { method: 'POST', headers, body: '{}' });
  if (res.status === 409) return (await res.json()).state as RefreshState;
  if (!res.ok) throw new Error(`Could not start refresh (API ${res.status})`);
  return (await res.json()).state as RefreshState;
}

// Polled by the client while a refresh runs.
export async function getRefreshState(): Promise<RefreshState> {
  const res = await fetch(`${API}/v1/admin/refresh`, { headers, cache: 'no-store' });
  if (!res.ok) throw new Error(`Could not read refresh status (API ${res.status})`);
  return (await res.json()) as RefreshState;
}

// Called by the client once a run finishes, so the new drafts appear.
export async function revalidateCards() {
  revalidatePath('/');
}

export async function saveCard(formData: FormData) {
  const id = String(formData.get('id'));
  const body = JSON.stringify({
    title: String(formData.get('title') ?? ''),
    summary: String(formData.get('summary') ?? ''),
    whyItMatters: String(formData.get('whyItMatters') ?? ''),
    category: String(formData.get('category') ?? ''),
    difficulty: String(formData.get('difficulty') ?? ''),
  });
  await call(`/v1/admin/cards/${id}`, { method: 'PATCH', headers, body });
}
