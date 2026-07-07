# AIShorts

Inshorts-style daily **AI news & learning** in ~60-word swipeable cards. A hybrid content
engine (RSS ingest → Groq summarization → human approval in the admin PWA) feeds a
mobile-first Expo app.

**See [RUNBOOK.md](RUNBOOK.md) for full history, decisions, and exact run instructions.**

## Monorepo layout (npm workspaces)

```
packages/shared    Types, zod schemas, Prisma client (the data model, Neon Postgres)
services/worker    RSS ingestion → dedup → full-article fetch → Groq summarize → pending cards
services/api       Fastify REST API @ :4000 + Upstash Redis cache
apps/admin         Next.js admin PWA @ :4001 (review/approve/edit cards)
apps/mobile        Expo app (swipe feed, filters, bookmarks) — not a workspace member
```

## Prerequisites

- Node.js 20+ and npm
- A `.env` file at the repo root (see `.env.example`) with Neon Postgres, Upstash Redis,
  and Groq credentials. **Never commit `.env`.**

## Getting started

```bash
npm install
npm run db:migrate                    # create tables in Neon
npm run worker:ingest                 # pull AI news, summarize, write pending cards
npm run -w @aishorts/api start        # API on http://localhost:4000
npm run -w @aishorts/admin dev        # admin on http://localhost:4001
```

Mobile app: `cd apps/mobile && npm install && npx expo start` — set
`EXPO_PUBLIC_API_URL` in `apps/mobile/.env` to your PC's LAN IP for a physical device
(details + firewall setup in RUNBOOK.md §7B).
