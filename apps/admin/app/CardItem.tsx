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
  approveCard,
  rejectCard,
  saveCard,
}: {
  card: Card;
  approveCard: Action;
  rejectCard: Action;
  saveCard: Action;
}) {
  const words = card.summary.trim().split(/\s+/).filter(Boolean).length;
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
        <input name="category" defaultValue={card.category} style={{ maxWidth: 160 }} />
        <input name="difficulty" defaultValue={card.difficulty} style={{ maxWidth: 160 }} />
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
