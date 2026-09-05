'use client';

import { useState, useTransition } from 'react';
import type { SaveResult } from './actions';

type Card = {
  id: string;
  title: string;
  summary: string;
  category: string;
  tags: string[];
  imageUrl?: string | null;
  sourceName: string;
  sourceUrl: string;
  status: string;
  importance?: number | null; // 1 = top … 5 = low; how much the story matters
  articlePublishedAt?: string | null; // when the ORIGINAL article was published
  sourcedAt?: string | null; // when our pipeline fetched it
};

type Action = (fd: FormData) => Promise<void>;
type SaveAction = (input: {
  id: string;
  title: string;
  summary: string;
  category: string;
  tags: string[];
  importance: number;
}) => Promise<SaveResult>;

// Importance scale labels shown in the selector (1 = top … 5 = low).
const IMPORTANCE_OPTS: Array<{ value: number; label: string }> = [
  { value: 1, label: '1 — Top story' },
  { value: 2, label: '2 — High' },
  { value: 3, label: '3 — Normal' },
  { value: 4, label: '4 — Low' },
  { value: 5, label: '5 — Minor' },
];

// Relative image URLs (/v1/images/:id) are served same-origin and proxied to the
// API by a Next rewrite (see next.config.mjs), so the panel works over localhost
// or any public tunnel. Absolute URLs (external images) pass through untouched.
function imageSrc(url: string | null | undefined): string | null {
  if (!url) return null;
  return url;
}

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

// A human, "sure-or-vague" label for a date. When the date is trustworthy we say
// exactly how old it is; when it's missing/unparseable we fall back to something
// meaningful ("recently") rather than a wrong or blank date.
function fuzzyAge(iso: string | null | undefined): string {
  if (!iso) return 'date unknown';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'date unknown';
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days < 0) return 'just now';
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'last week';
  if (days < 31) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return 'over a year ago';
}

export function CardItem({
  card,
  categories,
  saveCard,
  approveCard,
  rejectCard,
  selectable = false,
  selected = false,
  onToggleSelect,
}: {
  card: Card;
  categories: readonly string[];
  saveCard: SaveAction;
  approveCard: Action;
  rejectCard: Action;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const [title, setTitle] = useState(card.title);
  const [summary, setSummary] = useState(card.summary);
  const [category, setCategory] = useState(card.category);
  const [importance, setImportance] = useState<number>(card.importance ?? 3);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);

  const words = summary.trim().split(/\s+/).filter(Boolean).length;
  // Keep non-canonical legacy values visible instead of silently coercing them.
  const categoryOpts = categories.includes(category) ? categories : [category, ...categories];
  const days = card.articlePublishedAt ? fuzzyAge(card.articlePublishedAt) : null;
  const src = imageSrc(card.imageUrl);

  // Have any of the inline fields been changed from what the card currently holds?
  const dirty =
    title !== card.title ||
    summary !== card.summary ||
    category !== card.category ||
    importance !== (card.importance ?? 3);

  const onSave = () => {
    if (pending) return;
    setMsg(null);
    startTransition(async () => {
      const res = await saveCard({ id: card.id, title, summary, category, tags: card.tags, importance });
      setMsg(
        res.ok
          ? { text: 'Saved.' }
          : { text: res.error ?? 'Save failed.', err: true },
      );
    });
  };

  // Approve must persist inline edits first. The Approve button used to be a bare
  // form submit that only carried the card id, so changing a field (e.g. category)
  // and clicking Approve published the *pre-edit* card and silently dropped the
  // edit. Now we save first (if anything changed), then approve — and if the save
  // fails we stop rather than approve the wrong version.
  const onApprove = () => {
    if (pending) return;
    setMsg(null);
    startTransition(async () => {
      if (dirty) {
        const res = await saveCard({ id: card.id, title, summary, category, tags: card.tags, importance });
        if (!res.ok) {
          setMsg({ text: res.error ?? 'Save failed — card not approved.', err: true });
          return;
        }
      }
      const fd = new FormData();
      fd.set('id', card.id);
      await approveCard(fd);
    });
  };

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

      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="card-image" src={src} alt="" loading="lazy" />
      ) : (
        <div className="card-image card-image-blank">Blue panel (no image) — text only</div>
      )}

      <div className="meta">
        <span className="pill">{category}</span>
        <span className="pill">{words} words</span>
        <span className="pill">{card.sourceName}</span>
        {days && (
          <span className="pill" title={formatStamp(card.articlePublishedAt)}>
            {days}
          </span>
        )}
      </div>

      <input name="title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea name="summary" value={summary} onChange={(e) => setSummary(e.target.value)} />
      <div className="row">
        <select
          name="category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          style={{ maxWidth: 200 }}
        >
          {categoryOpts.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <label className="importance-field" title="How much this story matters (1 = top … 5 = low). Affects feed ranking.">
          <span className="importance-label">Importance</span>
          <select
            name="importance"
            value={importance}
            onChange={(e) => setImportance(Number(e.target.value))}
            style={{ maxWidth: 160 }}
          >
            {IMPORTANCE_OPTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
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
          <button className="btn-approve" type="button" onClick={onApprove} disabled={pending}>
            {pending ? 'Working…' : 'Approve'}
          </button>
        )}
        <button className="btn-save" type="button" onClick={onSave} disabled={pending}>
          {pending ? 'Saving…' : 'Save edits'}
        </button>
        {card.status !== 'rejected' && (
          <button className="btn-reject" formAction={rejectCard}>
            Reject
          </button>
        )}
        {msg && <span className={`save-msg${msg.err ? ' save-err' : ' save-ok'}`}>{msg.text}</span>}
      </div>
    </form>
  );
}
