import { z } from 'zod';
import { CATEGORIES, DIFFICULTIES, type Category, type DifficultyLevel } from './constants';

const categoryEnum = z.enum(CATEGORIES as unknown as [Category, ...Category[]]);
const difficultyEnum = z.enum(
  DIFFICULTIES as unknown as [DifficultyLevel, ...DifficultyLevel[]],
);

// Structured output we REQUIRE from Claude for each summarized article.
// The worker validates Claude's JSON against this before writing a draft card.
export const cardDraftSchema = z.object({
  title: z.string().min(1).max(80),
  summary: z.string().min(1),
  whyItMatters: z.string().optional().default(''),
  category: categoryEnum,
  difficulty: difficultyEnum,
  tags: z.array(z.string()).max(6).default([]),
});
export type CardDraft = z.infer<typeof cardDraftSchema>;

// Public feed card shape returned by the API to web/mobile clients.
export const feedCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  whyItMatters: z.string().nullable(),
  category: z.string(),
  difficulty: z.string(),
  tags: z.array(z.string()),
  imageUrl: z.string().nullable(),
  sourceName: z.string(),
  sourceUrl: z.string(),
  publishedAt: z.string().nullable(),
});
export type FeedCard = z.infer<typeof feedCardSchema>;

// Newsletter signup payload.
export const subscribeSchema = z.object({
  email: z.string().email(),
  categories: z.array(z.string()).optional().default([]),
});
export type SubscribeInput = z.infer<typeof subscribeSchema>;
