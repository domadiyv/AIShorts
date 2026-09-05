'use server';
import { revalidatePath } from 'next/cache';

const API = process.env.API_URL || 'http://localhost:4000';
const TOKEN = process.env.ADMIN_TOKEN || '';
const headers = { 'x-admin-token': TOKEN, 'content-type': 'application/json' };

// Fail loudly: a silent no-op on approve/reject is worse than an error page.
// Returns the parsed JSON body so bulk actions can report how many cards changed.
async function call(path: string, init: RequestInit): Promise<any> {
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
  return res.json().catch(() => ({}));
}

// Read-only variant of `call()` for GETs invoked during a Server Component
// render (page.tsx). It must NOT call revalidatePath — doing so during render
// throws in a production build, which previously surfaced as empty source/
// category lists in the Manage panel.
async function read(path: string): Promise<any> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, { headers, cache: 'no-store' });
  } catch {
    throw new Error(`API unreachable at ${API} — is the API server running?`);
  }
  if (!res.ok) throw new Error(`API ${res.status} on ${path}`);
  return res.json().catch(() => ({}));
}

export async function approveCard(formData: FormData) {
  const id = String(formData.get('id'));
  await call(`/v1/admin/cards/${id}/approve`, { method: 'POST', headers, body: '{}' });
}

export async function rejectCard(formData: FormData) {
  const id = String(formData.get('id'));
  await call(`/v1/admin/cards/${id}/reject`, { method: 'POST', headers, body: '{}' });
}

// Bulk approve/reject — called directly (not via a <form>) from the selection
// toolbar. Returns how many cards actually changed status so the UI can confirm.
export async function approveCards(ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const data = await call(`/v1/admin/cards/bulk-approve`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ids }),
  });
  return Number(data?.count ?? 0);
}

export async function rejectCards(ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const data = await call(`/v1/admin/cards/bulk-reject`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ids }),
  });
  return Number(data?.count ?? 0);
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

// Save a card edit. Called directly (not via a <form>) so the UI can show a
// clear success/error message and keep the user's edits on screen. Returns a
// result rather than throwing so the client can render the failure inline.
export type SaveResult = { ok: boolean; error?: string };

export async function saveCard(input: {
  id: string;
  title: string;
  summary: string;
  category: string;
  tags: string[];
  importance: number;
}): Promise<SaveResult> {
  const { id, title, summary, category, tags, importance } = input;
  const body = JSON.stringify({ title, summary, category, tags, importance });
  try {
    await call(`/v1/admin/cards/${id}`, { method: 'PATCH', headers, body });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Save failed.' };
  }
}

// ---- Categories (list for dropdowns + add new) ----
export async function fetchCategories(): Promise<string[]> {
  try {
    const data = await read(`/v1/admin/categories`);
    return (data?.categories ?? []).map((c: any) => c.name as string);
  } catch {
    return [];
  }
}

export async function createCategory(name: string): Promise<SaveResult> {
  const clean = name.trim();
  if (!clean) return { ok: false, error: 'Enter a category name.' };
  try {
    await call(`/v1/admin/categories`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: clean }),
    });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not add category.';
    return { ok: false, error: /409/.test(msg) ? 'That category already exists.' : msg };
  }
}

// Full category objects (id + name + how many cards use each) for the manage
// panel's edit/delete UI. `cardCount` drives whether delete needs a move-to pick.
export type AdminCategory = {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  active: boolean;
  cardCount: number;
};

export async function fetchAdminCategories(): Promise<AdminCategory[]> {
  try {
    const data = await read(`/v1/admin/categories`);
    return (data?.categories ?? []) as AdminCategory[];
  } catch {
    return [];
  }
}

// Rename a category. The API migrates every card carrying the old name too.
export async function updateCategory(id: string, name: string): Promise<SaveResult> {
  const clean = name.trim();
  if (!clean) return { ok: false, error: 'Enter a category name.' };
  try {
    await call(`/v1/admin/categories/${id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ name: clean }),
    });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not rename category.';
    return { ok: false, error: /409/.test(msg) ? 'That category name already exists.' : msg };
  }
}

// Delete a category. If cards still use it, `reassignTo` (a category name) must
// be supplied — those cards move there first.
export async function deleteCategory(id: string, reassignTo?: string): Promise<SaveResult> {
  try {
    await call(`/v1/admin/categories/${id}`, {
      method: 'DELETE',
      headers,
      body: JSON.stringify(reassignTo ? { reassignTo } : {}),
    });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not delete category.';
    if (/reassign_required/.test(msg))
      return { ok: false, error: 'Pick a category to move the cards to first.' };
    return { ok: false, error: msg };
  }
}

// ---- Sources (list + edit priority/status) ----
export type AdminSource = {
  id: string;
  name: string;
  url: string;
  type: string;
  trusted: boolean;
  active: boolean;
  priority: number;
  itemCount: number;
};

export async function fetchSources(): Promise<AdminSource[]> {
  try {
    const data = await read(`/v1/admin/sources`);
    return (data?.sources ?? []) as AdminSource[];
  } catch {
    return [];
  }
}

export async function updateSource(
  id: string,
  patch: { priority?: number; active?: boolean; trusted?: boolean },
): Promise<SaveResult> {
  try {
    await call(`/v1/admin/sources/${id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(patch),
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Update failed.' };
  }
}

// Validate + preview a feed URL before adding it. Returns the feed title, item
// count, and a few sample headlines so the operator can confirm it's the right
// feed (and we auto-fill the display name from the title).
export type FeedPreviewResult = {
  ok: boolean;
  title?: string;
  itemCount?: number;
  sampleTitles?: string[];
  error?: string;
};

export async function previewSource(url: string): Promise<FeedPreviewResult> {
  const clean = url.trim();
  if (!clean) return { ok: false, error: 'Paste a feed URL first.' };
  try {
    const data = await call(`/v1/admin/sources/preview`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url: clean }),
    });
    return data as FeedPreviewResult;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not check that feed.';
    return { ok: false, error: /400/.test(msg) ? 'That is not a valid URL.' : msg };
  }
}

export async function createSource(input: {
  name: string;
  url: string;
  priority: number;
  trusted: boolean;
}): Promise<SaveResult> {
  const name = input.name.trim();
  const url = input.url.trim();
  if (!name || !url) return { ok: false, error: 'Name and feed URL are required.' };
  try {
    await call(`/v1/admin/sources`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name, url, priority: input.priority, trusted: input.trusted }),
    });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not add source.';
    return { ok: false, error: /409/.test(msg) ? 'That feed is already a source.' : msg };
  }
}

export async function deleteSource(id: string): Promise<SaveResult> {
  try {
    // Body must be present since `headers` sets content-type: application/json.
    await call(`/v1/admin/sources/${id}`, { method: 'DELETE', headers, body: '{}' });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not delete source.' };
  }
}
