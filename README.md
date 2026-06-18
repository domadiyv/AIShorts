# AIShorts

Inshorts-style daily **AI news & learning** in ~60-word swipeable cards. A hybrid content
engine (RSS + Claude summarization, human-approved) feeds a newsletter/web validation layer
first, then a React Native (Expo) mobile app.

See the full build plan: `C:\Users\USER\.claude\plans\you-are-a-world-hidden-moler.md`.

## Monorepo layout (npm workspaces)

```
packages/shared    Types, zod schemas, Prisma client (the data model)
services/worker    RSS ingestion → dedup → Claude summarization → pending cards
services/api       NestJS REST API + Upstash Redis cache
apps/admin         Next.js admin panel (review/approve cards)
apps/web           Next.js public feed + newsletter signup (validation layer)
apps/mobile        Expo app (built after newsletter validation)
```

## Prerequisites

- Node.js 20+ and npm (installed at `D:\Program Files`)
- A `.env` file at the repo root (see `.env.example`) with Neon Postgres, Upstash Redis,
  and Anthropic credentials. **Never commit `.env`.**

## Getting started

```bash
npm install
npm run db:migrate     # create tables in Neon
npm run worker:ingest  # pull AI news, summarize, write pending cards
```

Build status is tracked phase-by-phase; see the plan file.
