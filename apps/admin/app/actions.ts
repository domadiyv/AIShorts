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
