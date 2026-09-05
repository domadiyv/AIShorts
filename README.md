# AIShorts

Inshorts-style daily **AI news & learning** delivered as ~60-word swipeable cards. A hybrid
content engine — **RSS ingest → LLM summarization → human approval** in an admin panel — feeds
a mobile-first Expo app and a REST API.

This README is the codebase guide: architecture, every folder, the data model, the content
pipeline, how to run it, and how to operate it. Two companion docs go deeper:

- **[RUNBOOK.md](RUNBOOK.md)** — project history, decisions, and LAN/Expo run instructions.
- **[DEPLOY.md](DEPLOY.md)** — Docker stack, Android APK build, tunnels, data migration, cloud.

---

## 1. What it is

- **Content is curated, not auto-published.** The worker pulls public RSS feeds, deduplicates,
  fetches the full article, summarizes it into a ~60-word card, and saves it as **`pending`**.
  A human reviews/edits and **approves** (`published`) in the admin panel before it reaches users.
- **Low runtime AI dependence by design.** Summarization uses an LLM (Groq by default, Anthropic
  optional), but when no key is configured the worker falls back to a **no-AI extractive** draft so
  the pipeline never silently produces nothing. Everything else (images, categories, dates) is
  computed without AI.
- **Self-hosted images.** Card images are stored **as bytes inside Postgres** and served by the
  API — no external hotlinks, no disk dependency.

---

## 2. Architecture

```
 RSS feeds ──► services/worker ──► Postgres ◄── services/api (REST :4000) ──► apps/mobile (Expo)
                (ingest→summarize)   ▲   │                                  └► apps/admin  (Next :4001)
                                     │   └─ images served from DB at /v1/images/:id
                       packages/shared (Prisma schema + client, zod schemas, shared constants)
```

Data flow for one card: **feed item → RawItem → (summarize + resolve image) → Card(`pending`) →
admin approve → Card(`published`) → `/v1/feed` → app.**

---

## 3. Monorepo layout (npm workspaces)

Workspaces: `packages/*`, `services/*`, `apps/admin`. **`apps/mobile` is intentionally not a
workspace** (Expo manages its own dependency tree).

```
packages/shared    The data model + everything shared across services.
services/worker    The content pipeline (RSS → summarize → pending cards).
services/api       Fastify REST API (@ :4000) + optional Redis cache.
apps/admin         Next.js admin panel (@ :4001): review / edit / approve / manage sources+categories.
apps/mobile        Expo app: swipe feed, category filters, bookmarks, auth.
scripts            Operational shell/node scripts (Docker, tunnel, DB dump/restore, image gen).
```

### `packages/shared`
The single source of truth for the data model, reused by every service.

| Path | What it does |
|------|--------------|
| `prisma/schema.prisma` | The full Postgres schema (see §4). |
| `prisma/migrations/` | Hand-reviewed SQL migrations, applied with `prisma migrate deploy`. |
| `prisma/seed.ts` | Seeds baseline categories, loads the sample-image library into the DB, and inserts ~24 demo cards. Idempotent (only manages its own `__seed__`-tagged rows). |
| `prisma/sample-images/` | Committed PNG tiles (4 per category + 4 generic). Pre-generated at authoring time because `sharp` isn't available in the Docker runtime. |
| `src/constants.ts` | `CATEGORIES` seed list + `CategoryName` type, `slugify()`, event types. |
| `src/schemas.ts` | zod schemas for every payload (card draft, card update, category/source admin, auth, events). |
| `src/mediaAssets.ts` | DB-backed image storage: read sample PNGs, `syncSampleAssets()`, `pickSampleAssetId()`, `storeSourceImage()`, `imageAssetUrl()`. |
| `src/media.ts` | Media-related shared helpers. |
| `src/index.ts` | Barrel export; also creates the shared singleton `PrismaClient`. |

> The package's `main` is `dist/index.js`, so consumers import the compiled build — run
> `npm run -w @aishorts/shared build` after changing shared code. The seed imports from
> `../src/*` directly so it runs under `tsx` without a build step.

### `services/worker`
The content pipeline. Run the whole thing with `npm run -w @aishorts/worker ingest`, or run stages
individually.

| File | Role |
|------|------|
| `index.ts` | CLI entry — calls `runPipeline()`. |
| `pipeline.ts` | Orchestrates `ingest()` then `summarizePending()`. Also invoked by the admin "Refresh" button via `POST /v1/admin/refresh`. |
| `sources.ts` | `SEED_SOURCES` — the curated list of public AI RSS/Atom feeds, upserted into the `sources` table each run. |
| `ingest.ts` | Fetch feeds (highest `priority` first), dedup, write `RawItem`s. |
| `articles.ts` | `extractArticle(url)` — fetch full article text + `og:image`, with timeout and teaser fallback. |
| `summarize.ts` | Turn `RawItem`s into `pending` cards: LLM prompt (catchy title, 50–65 word summary), category validation against the live DB set, extractive no-AI fallback. |
| `llm.ts` | Provider abstraction: `groq` (default) or `anthropic`, selected by `LLM_PROVIDER`. `llmAvailable()` gates the extractive fallback. |
| `media.ts` | `resolveCardImage()` — the image priority chain (see §5). |
| `check.ts` | Print a summary of DB card counts by status/category. |
| `purge.ts` | Retire cards whose article is older than `PURGE_AGE_DAYS` (default 60): copy the text into `archived_cards`, delete the live card, and free its per-card image bytes (see §9.1). Dry-run by default. |
| `scheduler.ts` | Always-on daemon that runs `purge.ts` daily at **00:00 IST** (see §9.1). Runs as the `scheduler` compose service. |
| `normalize.ts`, `reset.ts`, `reject-stale.ts`, `backfill-media.ts` | Maintenance jobs (see §9). |

### `services/api`
Fastify REST API. Runs from source via `tsx`.

| File | Role |
|------|------|
| `server.ts` | All routes (see §7), admin token guard, `toFeedCard()`, admin-user bootstrap, static media. |
| `auth.ts` | End-user auth routes (register / login / Google SSO / me), JWT-based. |
| `createAdmin.ts` | CLI to create/update an admin operator (bcrypt hash into `admin_users`). |
| `redis.ts` | Optional Upstash Redis cache — **degrades gracefully to no cache** if unconfigured. |
| `refreshJob.ts` | Single in-process job state behind the admin refresh endpoint, plus an **hourly auto-fetch** (`startHourlyRefresh`) that runs the ingest pipeline every 60 min through that same state — so a manual click and the timer can never collide (see §7). |

### `apps/admin` (Next.js App Router, port 4001)

| File | Role |
|------|------|
| `app/page.tsx` | Dashboard: loads pending cards, categories, sources; renders the review list + manage panel. |
| `app/ReviewList.tsx` / `app/CardItem.tsx` | The review queue. Each card has editable title/summary/category/tags, an image preview (or the blue null-image panel), a working **Save edits** button, plus approve/reject. |
| `app/ManagePanel.tsx` | **Sources:** add a source via a validated **Check feed** step (fetches/parses the RSS, shows title + item count + sample headlines, auto-fills the name), delete a source, and edit each source's **priority / active / trusted** inline. **Categories:** add, rename (migrates every card carrying the old name), and delete — with a required **move cards to** picker when the category is still in use. |
| `app/actions.ts` | Server actions: `saveCard`, `fetchCategories`, `createCategory`, `updateCategory`, `deleteCategory`, `fetchSources`, `updateSource`, `createSource`, `deleteSource`, `previewSource`. |
| `app/login/` | Email + password sign-in (checked against `admin_users`). |
| `lib/auth.ts` + `middleware.ts` | HMAC-signed session cookie keyed on `ADMIN_TOKEN`; middleware guards every route except `/login`. |
| `manifest.ts`, `RegisterSW.tsx` | PWA manifest + service worker registration. |

### `apps/mobile` (Expo / React Native — see [apps/mobile/AGENTS.md](apps/mobile/AGENTS.md))

| File | Role |
|------|------|
| `App.tsx` | The swipe feed + history, category chips (loaded from the API), fuzzy date labels, server-backed search, and image caching/prefetch (see below). |
| `src/api.ts` | API client (`fetchFeed`, `fetchCategories`, `search`, …). |
| `src/config.ts` | API base URL (build-time `EXPO_PUBLIC_API_URL`, HTTPS-only in release) with a runtime override persisted in `AsyncStorage` (Settings → Server settings), + fallback category list. |
| `src/theme.tsx` | Light/dark palette + `useTheme` / `useThemedStyles` (automatic dark mode). |
| `src/auth.tsx`, `src/bookmarks.ts`, `src/reads.ts` | Auth context (bearer token in Keychain/Keystore via `expo-secure-store`), bookmarks, read-tracking. |

**Mobile behaviours worth knowing:**
- **Image caching & prefetch** — card images use `expo-image` (native; a rebuild is required after changing it) with a memory+disk cache. As you read/scroll, the next few cards' images are prefetched so they're decoded before you swipe. Pull-to-refresh **clears** the memory+disk image cache (so images for cards that are gone leave the cache) and then re-warms the new first cards.
- **Search** — the feed search box queries the server (`/v1/search`, category-aware) rather than filtering only the already-loaded cards, so it covers the whole catalog. The feed's category chips fade into the header behind a borderless floating search icon.
- **UI-only vs native changes** — JS/UI edits to `App.tsx` ship in the JS bundle: for a distributable APK you must rebuild (`scripts/build-android.sh`) — a fast JS-bundle rebuild — while Expo Go / web preview pick them up over HMR. Changes touching a native module (e.g. `expo-image`, `expo-secure-store`) require a full native rebuild.

---

## 4. Data model (Postgres, via Prisma)

Defined in `packages/shared/prisma/schema.prisma`. Key tables:

- **`sources`** — RSS/API/manual content sources. `priority` (**1 = top … 5 = low**, feeds into
  feed ranking — see §5.1), `active`, `trusted`. Editable from the admin panel.
- **`categories`** — feed categories. Dynamic: operators add new ones from the admin panel and
  they appear everywhere (card dropdown, feed tabs) with no code change.
- **`media_assets`** — self-hosted image **bytes** (`BYTEA`). Two kinds: `sample` (reusable library
  tiles chosen by category) and `source` (fetched per-article). Deduplicated by `sha256`.
- **`admin_users`** — admin panel operators (bcrypt `passwordHash`). Replaces the old hardcoded
  password.
- **`raw_items`** — fetched articles before summarization (dedup + near-duplicate clustering).
- **`cards`** — the ~60-word cards. `status` = `pending | published | rejected`. Images via
  `imageAssetId` → `media_assets` (falls back to a legacy relative `imageUrl`). Feed ranking (see
  §5.1): `importance` (1 = top … 5 = low, judged at summarize time, admin-editable),
  `articlePublishedAt` (the article's own date, denormalized from `raw_items`), and `rankScore`
  (the stored blended score the feed sorts by).
- **`archived_cards`** — cold, text-only records of cards retired by the daily purge (article
  older than `PURGE_AGE_DAYS`). Keeps every text field + the original image URL, but **not** the
  image bytes — those are dropped to reclaim space. Nothing in the app reads it (see §10.1).
- **`users` / `devices` / `bookmarks` / `subscribers` / `card_events`** — end-user accounts,
  push devices, bookmarks, newsletter subscribers, and engagement analytics.

---

## 5. Image handling (priority chain)

`resolveCardImage()` in `services/worker/src/media.ts` resolves each card's image in order:

1. **Source image** — fetch the article/RSS image (`og:image` or feed image), store the bytes in
   `media_assets`, use it. *(Preferred.)*
2. **Pexels** — only if `ENABLE_PEXELS=true` and `PEXELS_API_KEY` is set (off by default).
3. **Sample library** — an on-the-fly, category-matched tile from the DB (`media_assets` seeded
   from `prisma/sample-images/`). Deterministic per card (stable across re-runs).
4. **Null image** — no asset; the UI shows the **blue text panel** fallback.

All stored images are served by the API at **`/v1/images/:id`**.

### 5.1 Feed ranking (blended score)

The feed (`/v1/feed`, `/v1/search`) is ordered by a single stored `cards.rankScore` (higher shown
first) that blends three signals — see `computeRankScore()` in `packages/shared/src/constants.ts`:

| Signal | Where it's set | Scale |
| --- | --- | --- |
| **Article importance** | Judged by the summarizer per article (`services/worker/src/summarize.ts`), admin-editable on each card | 1 = top … 5 = low |
| **Source priority** | Per source in the admin panel (Manage → Sources) | 1 = top … 5 = low |
| **Article recency** | The article's own `articlePublishedAt` | newer = higher |

```
rankScore = 12·(6 − importance) + 6·(6 − sourcePriority) + (days-since-epoch of articleDate)
```

Weights live in `RANK_WEIGHTS`. Importance dominates, then source, then recency as the tie-breaker
(so a one-step importance gain outweighs ~2 source steps or up to ~12 days of recency). The age term
uses **absolute days since the epoch**, not "days ago": ordering depends only on differences between
cards, so the huge shared constant cancels out — the score is stable over time (no daily recompute)
and safe for cursor pagination. `rankScore` is recomputed when a card's importance is edited, and for
**all** of a source's cards when its priority changes.

---

## 6. Environment variables

Put these in a repo-root `.env` (never commit it). The Docker stack overrides `DATABASE_URL` to
point at its own Postgres container.

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Postgres connection string. **Required.** |
| `ADMIN_TOKEN` | Service-to-service admin auth (`x-admin-token`) **and** the admin session-cookie secret. **Required for the admin panel.** |
| `LLM_PROVIDER` | `groq` (default) or `anthropic`. |
| `GROQ_API_KEY` / `GROQ_MODEL` | Groq summarization (default provider). Omit to use the no-AI extractive fallback. |
| `ANTHROPIC_API_KEY` / `CLAUDE_MODEL_BULK` | Anthropic provider (when `LLM_PROVIDER=anthropic`). |
| `ADMIN_BOOTSTRAP_EMAIL` / `ADMIN_BOOTSTRAP_PASSWORD` | Optional: auto-create the first operator on API startup if `admin_users` is empty (`ADMIN_PASSWORD` is used if bootstrap password is unset). |
| `API_PORT` / `API_URL` / `NEXT_PUBLIC_API_URL` | API port; admin→API base URL; mobile→API base URL. |
| `AUTH_JWT_SECRET` | Signs end-user JWTs. |
| `GOOGLE_CLIENT_ID` | Google SSO for end users (mock mode if unset). |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | Optional feed cache; runs without a cache if unset. |
| `ENABLE_PEXELS` / `PEXELS_API_KEY` | Optional Pexels image fallback (off by default). |
| `MAX_ITEMS_PER_SOURCE` / `MAX_ARTICLE_AGE_DAYS` / `INGEST_LOOKBACK_DAYS` / `ITEM_TIMEOUT_MS` / `LLM_ITEM_BUDGET_MS` | Pipeline tuning. |
| `PURGE_AGE_DAYS` | Retention window for the daily purge (default `60`) — cards whose article is older are archived and their images freed (see §10.1). |

---

## 7. API reference

**Public**
- `GET /v1/health` — liveness.
- `GET /v1/categories` — active category names.
- `GET /v1/feed?limit=&category=` — published cards (cached).
- `GET /v1/cards/:id` — one card.
- `GET /v1/images/:id` — image bytes from `media_assets`.
- `GET /v1/search?q=` — search published cards.
- `POST /v1/events` — engagement events. `POST /v1/subscribers` — newsletter signup.

**End-user auth**
- `POST /v1/auth/register` · `POST /v1/auth/login` · `POST /v1/auth/google` · `GET /v1/auth/me`.

**Admin** (all require the `x-admin-token: $ADMIN_TOKEN` header)
- `GET /v1/admin/cards` — pending queue.
- `PATCH /v1/admin/cards/:id` — edit. `POST .../approve` · `.../reject`.
- `POST /v1/admin/cards/bulk-approve` · `bulk-reject`.
- `GET /v1/admin/sources` · `POST /v1/admin/sources` (add) · `PATCH /v1/admin/sources/:id` (priority/active/trusted) · `DELETE /v1/admin/sources/:id` · `POST /v1/admin/sources/preview` (validate/preview a feed URL before adding).
- `GET /v1/admin/categories` (with per-category card counts) · `POST /v1/admin/categories` (add) · `PATCH /v1/admin/categories/:id` (rename + migrate cards) · `DELETE /v1/admin/categories/:id` (`{ reassignTo }` required when cards still use it).
- `POST /v1/admin/refresh` (trigger pipeline) · `GET /v1/admin/refresh` (status). The API also **auto-fetches hourly** through the same single-job state, so freshness doesn't depend on anyone clicking. If a manual "Fetch" arrives while a run (manual or the hourly tick) is in flight, the endpoint returns **409 with the running job's state** and the admin button simply polls that job's progress instead of starting a second one; likewise an in-flight manual run makes the next hourly tick a no-op.
- `POST /v1/admin/auth/login` — verify an operator's email+password against `admin_users`.

---

## 8. Running

### Prerequisites
- Node.js 20+ and npm.
- Docker (for the recommended stack) **or** a reachable Postgres for local dev.
- A repo-root `.env` (see §6).

### Option A — Docker (recommended, self-contained)
Brings up Postgres, applies migrations, seeds, and starts the API (:4000) and admin (:4001):

```bash
docker compose up --build -d
```

Run the content pipeline on demand (it's a job, not a long-running service):

```bash
docker compose --profile jobs run --rm worker
```

Apply a new migration + reseed without a full rebuild:

```bash
docker compose run --rm migrate
```

`scripts/docker-up.sh` wraps the common startup.

### Option B — Local dev (no Docker)
```bash
npm install
npm run db:migrate                    # apply migrations to $DATABASE_URL
npx dotenv -e .env -- npx tsx packages/shared/prisma/seed.ts   # optional: demo data
npm run worker:ingest                 # pull AI news → summarize → pending cards
npm run -w @aishorts/api start        # API  → http://localhost:4000
npm run -w @aishorts/admin dev        # admin → http://localhost:4001
```

### Exposing to the internet (phone access from anywhere)

The API (:4000) and admin (:4001) can be reached off-network over Cloudflare tunnels.
One-off: `scripts/tunnel.sh`. Always-on (both services, survives reboot) runs as macOS
LaunchAgents — see **[DEPLOY.md §2.1](DEPLOY.md)**. Check the live public URLs and health
any time:

```bash
scripts/tunnel-status.sh              # current tunnel URLs + reachability + agent status
```

> Quick-tunnel URLs rotate on every cloudflared restart; re-enter the new API URL in the
> app's **Settings → Server settings**. For a permanent URL use a named tunnel (Cloudflare
> account + domain) — DEPLOY.md §2.1.

---

## 9. Creating an admin operator

The admin panel checks the **`admin_users`** table (no hardcoded password). Create your operator
with the interactive script — the password is entered at a **masked prompt**, so it never lands in
your shell history:

**Docker:**
```bash
docker compose run --rm api npx tsx services/api/src/createAdmin.ts
```

**Local:**
```bash
npm run -w @aishorts/api create-admin
```

Non-interactive form (avoid on shared shells — password enters history):
```bash
npm run -w @aishorts/api create-admin -- --email you@example.com --name "You" --password 'your-password'
```

Re-running with an existing email updates that operator. Then sign in at
http://localhost:4001. Alternatively set `ADMIN_BOOTSTRAP_EMAIL` (+ `ADMIN_PASSWORD`) in `.env`
and restart the API to auto-create the first operator.

---

## 10. Operational commands (worker)

```bash
npm run -w @aishorts/worker ingest          # full pipeline (ingest + summarize)
npm run -w @aishorts/worker ingest:only     # fetch feeds → raw_items only
npm run -w @aishorts/worker summarize:only  # summarize existing raw_items → pending cards
npm run -w @aishorts/worker check           # DB card counts by status/category
npm run -w @aishorts/worker reset:drafts    # reset pending drafts
npm run -w @aishorts/worker reject:stale    # auto-reject stale pending cards
npm run -w @aishorts/worker backfill:media  # backfill images for cards missing an asset
npm run -w @aishorts/worker normalize       # normalize existing card data
npm run -w @aishorts/worker purge:old       # DRY RUN: archive + free images of cards >60d old
npm run -w @aishorts/worker purge:old -- --yes   # actually archive + purge
```

### 10.1 Automatic purge (archive + reclaim image space)

Images are stored as raw bytes **inside Postgres** (`media_assets.data`, a `bytea`), so old
cards accumulate real storage — a per-card source image averages **~280 kB**. To keep the DB
from growing unbounded, `purge:old` retires any card whose **article** is older than
`PURGE_AGE_DAYS` (default **60**):

1. Copies the card's text + its **original image URL** into the cold `archived_cards` table
   (nothing in the app reads it; it's for reference / manual re-fetch).
2. Deletes the live card and its dependent `bookmarks` / `card_events` rows.
3. Deletes the freed per-card **`source`** image asset — never the shared **`sample`** library
   images, and never an asset another card still references.

The **image bytes are deliberately not preserved** (they dominate storage); the archived
`imageUrl` lets you re-fetch a picture by hand later if you ever want it. `raw_items` are kept
(they're the dedup record, so a purged article can't silently re-ingest).

The **`scheduler`** compose service runs this automatically **every day at 00:00 IST**
(`services/worker/src/scheduler.ts`, timezone-fixed to Asia/Kolkata / UTC+05:30). It comes up
with the normal stack and Docker restarts it after a reboot, so no host cron/launchd is needed:

```bash
docker compose up -d scheduler     # start (part of the default stack)
docker compose logs -f scheduler   # watch — logs the next run time and each purge summary
```

Database helpers: `scripts/db-dump.sh`, `scripts/db-restore.sh`, `scripts/migrate-data.sh`,
and `npm run db:studio` (Prisma Studio). Tunnel helpers: `scripts/tunnel.sh` (start),
`scripts/tunnel-status.sh` (current public URLs + health).

---

## 11. Running the mobile app (Expo Go over LAN)

Two terminals, then scan the QR with the iPhone Camera:

```bash
npm run -w @aishorts/api start        # window 1 — API on :4000, leave open
cd apps/mobile && npx expo start      # window 2 — Metro on :8081, leave open
```

The QR must show `exp://<your-LAN-IP>:8081` (not `127.0.0.1`), and the phone must be on the same
Wi-Fi. Full one-time firewall setup and troubleshooting: **[RUNBOOK.md §7](RUNBOOK.md)**. To build
an installable Android APK, see **[DEPLOY.md](DEPLOY.md)** / `scripts/build-android.sh`.

---

## 12. Tech stack

- **Language:** TypeScript everywhere.
- **DB / ORM:** PostgreSQL + Prisma 6.
- **API:** Fastify (+ optional Upstash Redis cache).
- **Admin:** Next.js (App Router) PWA.
- **Mobile:** Expo / React Native.
- **LLM:** Groq (default) or Anthropic, with a no-AI extractive fallback.
- **Packaging:** npm workspaces + a single Docker image (per-service command via docker-compose).
```
