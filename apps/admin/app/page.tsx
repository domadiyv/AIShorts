import { approveCard, rejectCard, saveCard } from './actions';
import { CardItem } from './CardItem';

const API = process.env.API_URL || 'http://localhost:4000';
const TOKEN = process.env.ADMIN_TOKEN || '';
const STATUSES = ['pending', 'published', 'rejected'] as const;

async function getCards(status: string) {
  try {
    const r = await fetch(`${API}/v1/admin/cards?status=${status}&limit=100`, {
      headers: { 'x-admin-token': TOKEN },
      cache: 'no-store',
    });
    if (!r.ok) return [];
    return (await r.json()).cards as any[];
  } catch {
    return [];
  }
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sp = await searchParams;
  const status = (STATUSES as readonly string[]).includes(sp.status ?? '')
    ? (sp.status as string)
    : 'pending';
  const cards = await getCards(status);

  return (
    <main className="wrap">
      <h1>AIShorts — Review</h1>
      <p className="sub">Approve, edit, or reject AI-drafted cards before they go live.</p>
      <nav className="tabs">
        {STATUSES.map((s) => (
          <a key={s} className={`tab ${s === status ? 'active' : ''}`} href={`/?status=${s}`}>
            {s}
          </a>
        ))}
      </nav>
      <p className="count">
        {cards.length} {status} card(s)
      </p>
      {cards.length === 0 && <div className="empty">No {status} cards.</div>}
      {cards.map((c) => (
        <CardItem
          key={c.id}
          card={c}
          approveCard={approveCard}
          rejectCard={rejectCard}
          saveCard={saveCard}
        />
      ))}
    </main>
  );
}
