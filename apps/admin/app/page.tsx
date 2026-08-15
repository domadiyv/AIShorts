import { CATEGORIES, DIFFICULTIES } from '@aishorts/shared';
import {
  approveCard,
  approveCards,
  getRefreshState,
  rejectCard,
  rejectCards,
  saveCard,
  type RefreshState,
} from './actions';
import { logout } from './login/actions';
import { ReviewList } from './ReviewList';
import { RefreshButton } from './RefreshButton';

const IDLE_REFRESH: RefreshState = {
  status: 'idle',
  message: '',
  startedAt: null,
  finishedAt: null,
  result: null,
  error: null,
};

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
  // Read the job state server-side so a refresh already in flight (started on
  // another device, or before a reload) shows as running immediately.
  const [cards, refreshState] = await Promise.all([
    getCards(status),
    getRefreshState().catch(() => IDLE_REFRESH),
  ]);

  return (
    <main className="wrap">
      <div className="topbar">
        <h1>AIShorts — Review</h1>
        <form action={logout}>
          <button className="btn-logout" type="submit">
            Sign out
          </button>
        </form>
      </div>
      <p className="sub">Approve, edit, or reject AI-drafted cards before they go live.</p>
      <RefreshButton initialState={refreshState} />
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
          <ReviewList
            cards={cards}
            status={status}
            categories={CATEGORIES}
            difficulties={DIFFICULTIES}
            approveCard={approveCard}
            rejectCard={rejectCard}
            saveCard={saveCard}
            approveCards={approveCards}
            rejectCards={rejectCards}
          />
        </>
      )}
    </main>
  );
}
