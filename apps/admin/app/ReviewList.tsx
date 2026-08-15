'use client';

import { useMemo, useState, useTransition } from 'react';
import { CardItem } from './CardItem';

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
  articlePublishedAt?: string | null;
  sourcedAt?: string | null;
};

type Action = (fd: FormData) => Promise<void>;
type BulkAction = (ids: string[]) => Promise<number>;

// Wraps the card list with a selection toolbar. Per-card edit/approve/reject
// still work through CardItem's own <form>; this adds "select many → one action".
// Bulk controls only appear on the `pending` tab, where approve/reject apply.
export function ReviewList({
  cards,
  status,
  categories,
  difficulties,
  approveCard,
  rejectCard,
  saveCard,
  approveCards,
  rejectCards,
}: {
  cards: Card[];
  status: string;
  categories: readonly string[];
  difficulties: readonly string[];
  approveCard: Action;
  rejectCard: Action;
  saveCard: Action;
  approveCards: BulkAction;
  rejectCards: BulkAction;
}) {
  const showBulk = status === 'pending' && cards.length > 0;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);

  const allIds = useMemo(() => cards.map((c) => c.id), [cards]);
  const allSelected = selected.size > 0 && selected.size === cards.length;

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const toggleAll = () =>
    setSelected((s) => (s.size === cards.length ? new Set() : new Set(allIds)));

  const run = (verb: 'Approved' | 'Rejected', action: BulkAction, ids: string[]) => {
    if (!ids.length || pending) return;
    setMsg(null);
    startTransition(async () => {
      try {
        const count = await action(ids);
        setSelected(new Set());
        setMsg({ text: `${verb} ${count} card(s).` });
      } catch (e) {
        setMsg({ text: e instanceof Error ? e.message : 'Bulk action failed.', err: true });
      }
    });
  };

  return (
    <>
      {showBulk && (
        <div className="bulkbar">
          <label className="bulk-check">
            <input
              type="checkbox"
              checked={allSelected}
              // Indeterminate when some (not all) are selected.
              ref={(el) => {
                if (el) el.indeterminate = selected.size > 0 && !allSelected;
              }}
              onChange={toggleAll}
            />
            Select all ({cards.length})
          </label>
          <span className="bulk-count">{selected.size} selected</span>
          <div className="bulk-actions">
            <button
              type="button"
              className="btn-approve"
              disabled={pending || selected.size === 0}
              onClick={() => run('Approved', approveCards, [...selected])}
            >
              Approve selected
            </button>
            <button
              type="button"
              className="btn-reject"
              disabled={pending || selected.size === 0}
              onClick={() => run('Rejected', rejectCards, [...selected])}
            >
              Reject selected
            </button>
            <button
              type="button"
              className="btn-approve-all"
              disabled={pending}
              onClick={() => {
                if (window.confirm(`Approve and publish all ${cards.length} pending card(s)?`)) {
                  run('Approved', approveCards, allIds);
                }
              }}
            >
              Approve all ({cards.length})
            </button>
          </div>
          {msg && (
            <span className={`bulk-msg${msg.err ? ' bulk-err' : ' bulk-ok'}`}>{msg.text}</span>
          )}
        </div>
      )}
      {cards.map((c) => (
        <CardItem
          key={c.id}
          card={c}
          categories={categories}
          difficulties={difficulties}
          approveCard={approveCard}
          rejectCard={rejectCard}
          saveCard={saveCard}
          selectable={showBulk}
          selected={selected.has(c.id)}
          onToggleSelect={() => toggle(c.id)}
        />
      ))}
    </>
  );
}
