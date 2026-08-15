# AIShorts

Inshorts-style daily **AI news & learning** in ~60-word swipeable cards. A hybrid content
engine (RSS ingest → Groq summarization → human approval in the admin PWA) feeds a
mobile-first Expo app.

**See [RUNBOOK.md](RUNBOOK.md) for full history, decisions, and exact run instructions.**
**See [DEPLOY.md](DEPLOY.md) to run the backend in Docker, build the Android APK, expose the Mac over the internet, migrate data, and move to the cloud.**

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

## Running the mobile app (iPhone + Expo Go over LAN — verified working)

Two terminal windows, then scan the QR with the iPhone Camera:

```bash
npm run -w @aishorts/api start        # window 1 — API on :4000, leave open
cd apps/mobile && npx expo start      # window 2 — Metro on :8081, leave open
```

The QR must show `exp://<your-LAN-IP>:8081`, not `127.0.0.1`. The phone must be on the
same Wi-Fi. **Full step-by-step, one-time firewall setup, and troubleshooting:
[RUNBOOK.md §7](RUNBOOK.md).**

## Package & deploy (Docker, Android APK, cloud)

For shipping — one self-contained backend, an installable Android app, and a path to the
cloud — use the Docker stack instead of the raw npm flow above:

```bash
scripts/docker-up.sh        # postgres + api (:4000) + admin (:4001) + data, one command
scripts/tunnel.sh           # expose the Mac at an HTTPS URL a phone can reach
scripts/build-android.sh    # build apps/mobile/dist/aishorts-release.apk (local, no EAS)
```

Full walkthrough — no-login cache, Google SSO, self-hosted Pexels media, data migration,
and Phase 2 cloud move — is in **[DEPLOY.md](DEPLOY.md)**.
