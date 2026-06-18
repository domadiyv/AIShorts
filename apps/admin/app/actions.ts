'use server';
import { revalidatePath } from 'next/cache';

const API = process.env.API_URL || 'http://localhost:4000';
const TOKEN = process.env.ADMIN_TOKEN || '';
const headers = { 'x-admin-token': TOKEN, 'content-type': 'application/json' };

export async function approveCard(formData: FormData) {
  const id = String(formData.get('id'));
  await fetch(`${API}/v1/admin/cards/${id}/approve`, { method: 'POST', headers, body: '{}' });
  revalidatePath('/');
}

export async function rejectCard(formData: FormData) {
  const id = String(formData.get('id'));
  await fetch(`${API}/v1/admin/cards/${id}/reject`, { method: 'POST', headers, body: '{}' });
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
  await fetch(`${API}/v1/admin/cards/${id}`, { method: 'PATCH', headers, body });
  revalidatePath('/');
}
