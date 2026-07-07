import { z } from 'zod';
import {
  CATEGORIES,
  DIFFICULTIES,
  EVENT_TYPES,
  type Category,
  type DifficultyLevel,
  type EventType,
} from './constants';

const categoryEnum = z.enum(CATEGORIES as unknown as [Category, ...Category[]]);
const difficultyEnum = z.enum(
  DIFFICULTIES as unknown as [DifficultyLevel, ...DifficultyLevel[]],
);
const eventTypeEnum = z.enum(EVENT_TYPES as unknown as [EventType, ...EventType[]]);

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

// Admin card edit payload (PATCH /v1/admin/cards/:id) — every field optional,
// but category/difficulty must be canonical or the card falls out of feed filters.
export const cardUpdateSchema = z
  .object({
    title: z.string().min(1).max(200),
    summary: z.string().min(1),
    whyItMatters: z.string(),
    category: categoryEnum,
    difficulty: difficultyEnum,
    tags: z.array(z.string()).max(10),
  })
  .partial();
export type CardUpdate = z.infer<typeof cardUpdateSchema>;

// Engagement event payload (POST /v1/events).
export const cardEventSchema = z.object({
  cardId: z.string().min(1),
  type: eventTypeEnum,
  deviceId: z.string().optional(),
});
export type CardEventInput = z.infer<typeof cardEventSchema>;

// Newsletter signup payload.
export const subscribeSchema = z.object({
  email: z.string().email(),
  categories: z.array(z.string()).optional().default([]),
});
export type SubscribeInput = z.infer<typeof subscribeSchema>;
