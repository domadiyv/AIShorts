import { CATEGORIES, DIFFICULTIES } from '@aishorts/shared';
import { approveCard, rejectCard, saveCard } from './actions';
import { CardItem } from './CardItem';

const API = process.env.API_URL || 'http://localhost:4000';
const TOKEN = process.env.ADMIN_TOKEN || '';
const STATUSES = ['pending', 'published', 'rejected'] as const;

// null = API unreachable/unauthorized (distinct from an empty list).
async function getCards(status: string) {
  try {
    const r = await fetch(`${API}/v1/admin/cards?status=${status}&limit=100`, {
      headers: { 'x-admin-token': TOKEN },
      cache: 'no-store',
    });
    if (!r.ok) return null;
    return (await r.json()).cards as any[];
  } catch {
    return null;
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
      {cards === null ? (
        <div className="empty">
          Can&apos;t reach the API at {API}. Start it with{' '}
          <code>npm run -w @aishorts/api start</code> and check ADMIN_TOKEN in .env.
        </div>
      ) : (
        <>
          <p className="count">
            {cards.length} {status} card(s)
          </p>
          {cards.length === 0 && <div className="empty">No {status} cards.</div>}
          {cards.map((c) => (
            <CardItem
              key={c.id}
              card={c}
              categories={CATEGORIES}
              difficulties={DIFFICULTIES}
              approveCard={approveCard}
              rejectCard={rejectCard}
              saveCard={saveCard}
            />
          ))}
        </>
      )}
    </main>
  );
}
