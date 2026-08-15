'use client';

type Card = {
  id: string;
  title: string;
  summary: string;
  whyItMatters?: string | null;
  category: string;
  difficulty: string;
  tags: string[];
  sourceName: string;
  sourceUrl: string;
  status: string;
  articlePublishedAt?: string | null; // when the ORIGINAL article was published
  sourcedAt?: string | null; // when our pipeline fetched it
};

type Action = (fd: FormData) => Promise<void>;

// "22 Jul 2026, 14:00" — unambiguous (no US/EU day-month confusion) and short
// enough for a phone. Rendered client-side, so it shows the reviewer's local time.
function formatStamp(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Flag articles that were already old when we ingested them.
function ageInDays(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

export function CardItem({
  card,
  categories,
  difficulties,
  approveCard,
  rejectCard,
  saveCard,
  selectable = false,
  selected = false,
  onToggleSelect,
}: {
  card: Card;
  categories: readonly string[];
  difficulties: readonly string[];
  approveCard: Action;
  rejectCard: Action;
  saveCard: Action;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const words = card.summary.trim().split(/\s+/).filter(Boolean).length;
  // Keep non-canonical legacy values visible instead of silently coercing them.
  const categoryOpts = categories.includes(card.category)
    ? categories
    : [card.category, ...categories];
  const difficultyOpts = difficulties.includes(card.difficulty)
    ? difficulties
    : [card.difficulty, ...difficulties];
  const days = ageInDays(card.articlePublishedAt);

  return (
    <form className={`card${selected ? ' card-selected' : ''}`}>
      <input type="hidden" name="id" value={card.id} />
      {selectable && (
        // Unnamed checkbox → never submitted with the per-card formAction buttons;
        // it only drives the parent's bulk selection state.
        <label className="card-select">
          <input type="checkbox" checked={selected} onChange={() => onToggleSelect?.()} />
          Select for bulk action
        </label>
      )}
      <div className="meta">
        <span className={`pill diff-${card.difficulty}`}>{card.difficulty}</span>
        <span className="pill">{card.category}</span>
        <span className="pill">{words} words</span>
        <span className="pill">{card.sourceName}</span>
        {days !== null && days > 14 && (
          <span className="pill pill-warn" title="The original article is over two weeks old">
            {days}d old
          </span>
        )}
      </div>
      <input name="title" defaultValue={card.title} />
      <textarea name="summary" defaultValue={card.summary} />
      <input name="whyItMatters" defaultValue={card.whyItMatters ?? ''} placeholder="Why it matters" />
      <div className="row">
        <select name="category" defaultValue={card.category} style={{ maxWidth: 160 }}>
          {categoryOpts.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select name="difficulty" defaultValue={card.difficulty} style={{ maxWidth: 160 }}>
          {difficultyOpts.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>

      <div className="stamps">
        <span>
          <span className="stamp-label">Article published</span>
          {formatStamp(card.articlePublishedAt)}
        </span>
        <span>
          <span className="stamp-label">Sourced</span>
          {formatStamp(card.sourcedAt)}
        </span>
      </div>

      {/* Opens in a new tab so in-progress edits on this form are never lost. */}
      <a className="src-link" href={card.sourceUrl} target="_blank" rel="noopener noreferrer">
        Read original article ↗
        <span className="src-url">{card.sourceUrl}</span>
      </a>

      <div className="row">
        {card.status !== 'published' && (
          <button className="btn-approve" formAction={approveCard}>
            Approve
          </button>
        )}
        <button className="btn-save" formAction={saveCard}>
          Save edits
        </button>
        {card.status !== 'rejected' && (
          <button className="btn-reject" formAction={rejectCard}>
            Reject
          </button>
        )}
      </div>
    </form>
  );
}
