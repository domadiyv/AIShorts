import { z } from 'zod';
import { EVENT_TYPES, type EventType } from './constants';

const eventTypeEnum = z.enum(EVENT_TYPES as unknown as [EventType, ...EventType[]]);

// Category is a free-form string now (categories live in the DB and can be added
// from the admin panel), so we validate shape/length rather than a fixed enum.
const categoryString = z.string().min(1).max(40);

// Structured output we REQUIRE from the summarizer for each article. The worker
// validates the model's JSON against this before writing a draft card. Category
// is validated loosely here and reconciled against the live category list by the
// worker (unknown values are remapped to the closest known bucket).
export const cardDraftSchema = z.object({
  title: z.string().min(1).max(80),
  summary: z.string().min(1),
  whyItMatters: z.string().optional().default(''),
  category: categoryString,
  tags: z.array(z.string()).max(6).default([]),
  // How much this story matters to the world: 1 = top … 5 = low. The summarizer
  // judges this per article; the admin can edit it before approving.
  importance: z.number().int().min(1).max(5).optional().default(3),
});
export type CardDraft = z.infer<typeof cardDraftSchema>;

// Public feed card shape returned by the API to web/mobile clients.
export const feedCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  whyItMatters: z.string().nullable(),
  category: z.string(),
  tags: z.array(z.string()),
  imageUrl: z.string().nullable(),
  sourceName: z.string(),
  sourceUrl: z.string(),
  publishedAt: z.string().nullable(),
});
export type FeedCard = z.infer<typeof feedCardSchema>;

// Admin card edit payload (PATCH /v1/admin/cards/:id) — every field optional.
export const cardUpdateSchema = z
  .object({
    title: z.string().min(1).max(200),
    summary: z.string().min(1),
    whyItMatters: z.string(),
    category: categoryString,
    tags: z.array(z.string()).max(10),
    importance: z.number().int().min(1).max(5),
  })
  .partial();
export type CardUpdate = z.infer<typeof cardUpdateSchema>;

// ---- Admin: categories, sources, operator login ----

// Create a new category from the admin panel.
export const categoryCreateSchema = z.object({
  name: z.string().min(1).max(40),
});
export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>;

// Rename a category. Renaming also migrates every card carrying the old name.
export const categoryUpdateSchema = z.object({
  name: z.string().min(1).max(40),
});
export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>;

// Delete a category. If cards still use it, `reassignTo` names the category they
// move to (required by the API when the count is non-zero).
export const categoryDeleteSchema = z.object({
  reassignTo: z.string().min(1).max(40).optional(),
});
export type CategoryDeleteInput = z.infer<typeof categoryDeleteSchema>;

// Add a content source from the admin panel. `url` is the RSS/Atom feed URL.
export const sourceCreateSchema = z.object({
  name: z.string().min(1).max(120),
  url: z.string().url().max(500),
  type: z.enum(['rss', 'api', 'manual']).optional().default('rss'),
  priority: z.number().int().min(1).max(5).optional().default(3),
  trusted: z.boolean().optional().default(false),
  active: z.boolean().optional().default(true),
});
export type SourceCreateInput = z.infer<typeof sourceCreateSchema>;

// Validate/preview a feed URL before adding it (server fetches + parses it).
export const sourcePreviewSchema = z.object({
  url: z.string().url().max(500),
});
export type SourcePreviewInput = z.infer<typeof sourcePreviewSchema>;

// Edit a source's ingest preference / status from the Sources list.
export const sourceUpdateSchema = z
  .object({
    // Source importance on the feed: 1 = top … 5 = low.
    priority: z.number().int().min(1).max(5),
    active: z.boolean(),
    trusted: z.boolean(),
  })
  .partial();
export type SourceUpdateInput = z.infer<typeof sourceUpdateSchema>;

// Admin operator login (verified against the admin_users table).
export const adminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});
export type AdminLoginInput = z.infer<typeof adminLoginSchema>;

// Engagement event payload (POST /v1/events).
export const cardEventSchema = z.object({
  cardId: z.string().min(1),
  type: eventTypeEnum,
  deviceId: z.string().optional(),
});
export type CardEventInput = z.infer<typeof cardEventSchema>;

// ---- Auth ----
export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  name: z.string().min(1).max(80).optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

// Google SSO: the client sends the Google ID token (a JWT). In mock mode
// (no GOOGLE_CLIENT_ID configured) it's a base64url-encoded JSON identity.
export const googleAuthSchema = z.object({
  idToken: z.string().min(1),
});
export type GoogleAuthInput = z.infer<typeof googleAuthSchema>;

// Public user shape returned to clients (never includes passwordHash).
export const publicUserSchema = z.object({
  id: z.string(),
  email: z.string().nullable(),
  name: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  provider: z.string(),
});
export type PublicUser = z.infer<typeof publicUserSchema>;

// Newsletter signup payload.
export const subscribeSchema = z.object({
  email: z.string().email(),
  categories: z.array(z.string()).optional().default([]),
});
export type SubscribeInput = z.infer<typeof subscribeSchema>;
