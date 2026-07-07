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
};

type Action = (fd: FormData) => Promise<void>;

export function CardItem({
  card,
  categories,
  difficulties,
  approveCard,
  rejectCard,
  saveCard,
}: {
  card: Card;
  categories: readonly string[];
  difficulties: readonly string[];
  approveCard: Action;
  rejectCard: Action;
  saveCard: Action;
}) {
  const words = card.summary.trim().split(/\s+/).filter(Boolean).length;
  // Keep non-canonical legacy values visible instead of silently coercing them.
  const categoryOpts = categories.includes(card.category)
    ? categories
    : [card.category, ...categories];
  const difficultyOpts = difficulties.includes(card.difficulty)
    ? difficulties
    : [card.difficulty, ...difficulties];
  return (
    <form className="card">
      <input type="hidden" name="id" value={card.id} />
      <div className="meta">
        <span className={`pill diff-${card.difficulty}`}>{card.difficulty}</span>
        <span className="pill">{card.category}</span>
        <span className="pill">{words} words</span>
        <span className="pill">{card.sourceName}</span>
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
      <div className="src">{card.sourceUrl}</div>
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
