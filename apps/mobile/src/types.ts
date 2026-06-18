export type Card = {
  id: string;
  title: string;
  summary: string;
  whyItMatters: string | null;
  category: string;
  difficulty: string;
  tags: string[];
  imageUrl: string | null;
  sourceName: string;
  sourceUrl: string;
  publishedAt: string | null;
};
