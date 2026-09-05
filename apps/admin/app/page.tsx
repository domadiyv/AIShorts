import { CATEGORIES } from '@aishorts/shared';
import {
  approveCard,
  approveCards,
  createCategory,
  createSource,
  deleteCategory,
  deleteSource,
  fetchAdminCategories,
  getRefreshState,
  fetchSources,
  previewSource,
  rejectCard,
  rejectCards,
  saveCard,
  updateCategory,
  updateSource,
  type RefreshState,
} from './actions';
import { logout } from './login/actions';
import { ReviewList } from './ReviewList';
import { ReviewToolbar } from './ReviewToolbar';
import { RefreshButton } from './RefreshButton';
import { ManagePanel } from './ManagePanel';

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
const PAGE_SIZE = 50;

// Distinguish *why* a load failed so the UI can tell the truth: a rate-limit
// (429) or bad token (401) is NOT "the API is down". `total` is the full match
// count across all pages so the UI shows the real number.
type CardsError = 'rate_limited' | 'unauthorized' | 'error' | 'unreachable';
type CardsResult = { cards: any[]; total: number } | { error: CardsError };

async function getCards(status: string, page: number, q: string): Promise<CardsResult> {
  const params = new URLSearchParams({
    status,
    limit: String(PAGE_SIZE),
    offset: String((page - 1) * PAGE_SIZE),
  });
  if (q) params.set('q', q);
  try {
    const r = await fetch(`${API}/v1/admin/cards?${params}`, {
      headers: { 'x-admin-token': TOKEN },
      cache: 'no-store',
    });
    if (!r.ok) {
      if (r.status === 429) return { error: 'rate_limited' };
      if (r.status === 401 || r.status === 403) return { error: 'unauthorized' };
      return { error: 'error' };
    }
    const data = await r.json();
    return { cards: data.cards as any[], total: Number(data.total ?? 0) };
  } catch {
    return { error: 'unreachable' }; // network-level: DNS/connection refused
  }
}

// Live category names for the edit dropdowns; falls back to the seed list.
async function getCategories(): Promise<string[]> {
  try {
    const r = await fetch(`${API}/v1/categories`, { cache: 'no-store' });
    if (!r.ok) return [...CATEGORIES];
    const names = (await r.json()).categories as string[];
    return names.length ? names : [...CATEGORIES];
  } catch {
    return [...CATEGORIES];
  }
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const status = (STATUSES as readonly string[]).includes(sp.status ?? '')
    ? (sp.status as string)
    : 'pending';
  const query = (sp.q ?? '').trim();
  const page = Math.max(1, Number(sp.page) || 1);
  // Read the job state server-side so a refresh already in flight (started on
  // another device, or before a reload) shows as running immediately.
  const [result, refreshState, categories, sources, adminCategories] = await Promise.all([
    getCards(status, page, query),
    getRefreshState().catch(() => IDLE_REFRESH),
    getCategories(),
    fetchSources().catch(() => []),
    fetchAdminCategories().catch(() => []),
  ]);
  const cardsError = 'error' in result ? result.error : null;
  const cards = 'cards' in result ? result.cards : null;
  const total = 'total' in result ? result.total : 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstOnPage = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastOnPage = Math.min(page * PAGE_SIZE, total);
  // Build a link to another page of the CURRENT status/search (used by prev/next).
  const pageHref = (p: number) => {
    const params = new URLSearchParams({ status });
    if (query) params.set('q', query);
    if (p > 1) params.set('page', String(p));
    return `/?${params}`;
  };

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
      <ManagePanel
        sources={sources}
        categories={adminCategories}
        createCategory={createCategory}
        updateCategory={updateCategory}
        deleteCategory={deleteCategory}
        updateSource={updateSource}
        createSource={createSource}
        deleteSource={deleteSource}
        previewSource={previewSource}
      />
      <ReviewToolbar status={status} query={query} />
      {cardsError ? (
        <div className="empty">
          {cardsError === 'rate_limited' ? (
            <>The API is rate-limiting requests right now. Wait a few seconds and reload.</>
          ) : cardsError === 'unauthorized' ? (
            <>
              The API rejected the admin token (401/403). Check <code>ADMIN_TOKEN</code> in .env.
            </>
          ) : cardsError === 'unreachable' ? (
            <>
              Can&apos;t reach the API at {API}. Make sure it&apos;s running (
              <code>npm run -w @aishorts/api start</code>).
            </>
          ) : (
            <>The API returned an error. Check the API logs (<code>docker compose logs api</code>).</>
          )}
        </div>
      ) : cards === null ? (
        <div className="empty">The API returned an error. Check the API logs.</div>
      ) : (
        <>
          <p className="count">
            {query ? (
              <>
                {total} match{total === 1 ? '' : 'es'} for &ldquo;{query}&rdquo; in {status}
              </>
            ) : (
              <>
                {total} {status} card{total === 1 ? '' : 's'}
              </>
            )}
            {total > 0 && (
              <span className="count-range">
                {' '}
                · showing {firstOnPage}–{lastOnPage}
              </span>
            )}
          </p>
          {cards.length === 0 && (
            <div className="empty">
              {query ? `No ${status} cards match “${query}”.` : `No ${status} cards.`}
            </div>
          )}
          <ReviewList
            cards={cards}
            status={status}
            categories={categories}
            approveCard={approveCard}
            rejectCard={rejectCard}
            saveCard={saveCard}
            approveCards={approveCards}
            rejectCards={rejectCards}
          />
          {totalPages > 1 && (
            <nav className="pager" aria-label="Pagination">
              {page > 1 ? (
                <a className="pager-btn" href={pageHref(page - 1)}>
                  ← Prev
                </a>
              ) : (
                <span className="pager-btn disabled">← Prev</span>
              )}
              <span className="pager-status">
                Page {page} of {totalPages}
              </span>
              {page < totalPages ? (
                <a className="pager-btn" href={pageHref(page + 1)}>
                  Next →
                </a>
              ) : (
                <span className="pager-btn disabled">Next →</span>
              )}
            </nav>
          )}
        </>
      )}
    </main>
  );
}
