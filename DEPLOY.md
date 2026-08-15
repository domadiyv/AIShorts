# AIShorts — Deploy, Package & Migrate

How to run the backend in Docker, expose it to a phone over the internet, build a
standalone Android APK, migrate data, and later move the whole thing to the cloud.

- **Phase 1 (now):** your Mac runs the backend in Docker; an Android APK on a phone/
  emulator reaches it over an HTTPS tunnel.
- **Phase 2 (later):** the *same* Docker stack runs on a cloud VM; data moves with a
  script; the app flips to the cloud URL with no rebuild.

> Quick links: [README.md](README.md) · [RUNBOOK.md](RUNBOOK.md) (history & decisions)

---

## 0. Prerequisites

| For | Install |
|-----|---------|
| Backend (Docker) | Docker Desktop (Docker 24+) |
| Tunnel | `brew install cloudflared` (or `ngrok`) |
| Android APK | Android Studio + SDK, JDK 17, and `npm install` inside `apps/mobile` |
| Data scripts | `pg_dump` / `pg_restore` (comes with `postgresql` via Homebrew) |

Copy env files and fill them in (never commit real ones):

```bash
cp .env.example .env                      # backend secrets + Postgres/Pexels/Google
cp apps/mobile/.env.example apps/mobile/.env   # mobile build-time config
```

---

## 1. Run the backend in Docker (one command)

```bash
scripts/docker-up.sh            # = docker compose up --build   (add -d to detach)
```

This starts everything and hydrates data automatically:

- **postgres** — `postgres:16`, data in the named volume `pgdata` (survives restarts).
- **migrate** — one-shot: `prisma migrate deploy` then an idempotent seed (~24 demo
  cards). Exits 0 when done.
- **api** — Fastify on **:4000**, serves the feed and `/media/*` images.
- **admin** — Next.js panel on **:4001** (review/approve/edit cards).

Verify:

```bash
curl -s http://localhost:4000/v1/health           # {"ok":true,...}
curl -s "http://localhost:4000/v1/feed?limit=3"   # cards with /media/... imageUrls
open http://localhost:4001/login                  # admin panel
```

Data persists across `docker compose down` + `up` (the `pgdata` volume). To wipe and
start clean: `docker compose down -v`.

### Fetching real news (worker)

The worker is a one-shot job (RSS ingest → LLM summarize → self-hosted images):

```bash
docker compose --profile jobs run --rm worker                                   # full pipeline
docker compose --profile jobs run --rm worker "npx tsx services/worker/src/summarize.ts"   # one stage
```

New cards land as **pending** — approve them in the admin panel to publish. (You can
also trigger the pipeline from the admin "Fetch new articles" button, which runs it
in-process in the API.)

**Summarization has a no-key fallback.** With `GROQ_API_KEY` (or `ANTHROPIC_API_KEY`)
set, cards get clean AI-written summaries. With **no key set**, the worker falls back
to an **extractive** draft built from each article's own headline + RSS teaser
(category guessed by keyword, tags from the title). Quality is lower and it's clearly a
draft to edit before publishing, but "Fetch new articles" always produces reviewable
cards instead of silently creating nothing. Add a key anytime for AI-written summaries.

---

## 2. Expose your Mac to a phone (Phase 1 tunnel)

Android release builds block cleartext HTTP, so a device needs an **HTTPS** URL.

```bash
scripts/tunnel.sh                 # quick random https URL (no account)
# or a stable hostname you own:
scripts/tunnel.sh my-tunnel-name  # named Cloudflare tunnel (after `cloudflared tunnel login`)
```

Copy the printed `https://…` URL — you'll point the app at it (in the APK build, or at
runtime via the app's **Settings** screen). Verify from off-network:

```bash
curl -s https://<tunnel-host>/v1/feed?limit=1
```

---

## 3. Build the Android APK (local, no EAS)

```bash
cd apps/mobile && npm install                    # first time only
# bake the tunnel URL (or your Mac's LAN IP for same-Wi-Fi testing),
# or bake a placeholder and set it later in-app:
EXPO_PUBLIC_API_URL=https://<tunnel-host> ../../scripts/build-android.sh
```

Output: `apps/mobile/dist/aishorts-release.apk`. Install it:

```bash
adb install -r apps/mobile/dist/aishorts-release.apk   # emulator or USB device
```

**Switching backends without rebuilding:** open the app → avatar menu → **Settings** →
enter a new backend URL → *Save & reload*. Stored on-device (`aishorts.apiurl.v1`);
this is how you flip from the Mac tunnel to the cloud later. "Reset to default" restores
the URL baked at build time.

> **Android emulator tip:** to reach a backend on the Mac host directly (no tunnel),
> use `http://10.0.2.2:4000` — the emulator's alias for the host loopback.

> **iPhone (later):** needs an Apple Developer account. Set `ios.bundleIdentifier`
> (already `com.aishorts.app`), run `npx expo prebuild -p ios`, and archive in Xcode
> (or switch to EAS). Deferred by decision — Android first.

---

## 4. No-login experience (device-local)

The app works with **no account**. Everything is cached on-device (AsyncStorage):

- Read/scrolled-past cards move to **History** and are filtered out of the feed. The
  feed pages ahead automatically so a growing history never leaves it empty.
- **Saved** cards and **History** persist across relaunches. The cache is allowed to
  grow (no eviction) — matching the product decision.
- Signing in with Google (below) is optional and additive.

---

## 5. Google SSO

Uses `@react-native-google-signin/google-signin` (native — works in the built APK, not
Expo Go). Without a client ID configured, the app falls back to a built-in mock identity
so web/dev demos still work.

1. In **Google Cloud Console → Credentials**, create OAuth 2.0 Client IDs:
   - **Web application** — this ID is the source of truth for the token audience.
   - **Android** — package `com.aishorts.app` + your signing key's SHA-1
     (`keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android`).
     You don't reference its ID in code; Google matches it by package + SHA-1.
2. Set the **same Web client ID** in both places:
   - server: `GOOGLE_CLIENT_ID` in root `.env` (the API verifies the id_token's `aud`).
   - app: `EXPO_PUBLIC_GOOGLE_CLIENT_ID` in `apps/mobile/.env`, then rebuild the APK.
3. Tap **Continue with Google** → real id_token → `POST /v1/auth/google` → app JWT.

---

## 6. Card media (license-safe, self-hosted)

Images are served by the API at `/media/*` and stored as **relative** URLs, so they
follow whatever backend URL the app is pointed at.

- **Seed/offline:** bundled per-category placeholders under `services/api/media/seed/`
  (self-generated gradients — zero external deps; regenerate with
  `node scripts/gen-placeholders.mjs`). Baked into the image and auto-copied into the
  media volume on API startup.
- **Real photos (Pexels):** set `PEXELS_API_KEY` in `.env` (free, commercial use OK, no
  attribution required). New cards fetch a relevant photo at summarize time; the file is
  downloaded into the media volume and served locally — no hotlink/expiry risk.
- **Backfill existing cards:**

  ```bash
  docker compose --profile jobs run --rm worker "npx tsx services/worker/src/backfill-media.ts"
  # or locally:  npm run -w @aishorts/worker backfill:media
  ```

Fallback chain per card: **Pexels → original RSS image → bundled placeholder.**

---

## 7. Data migration

All scripts read/write via `DATABASE_URL`s you pass in.

```bash
# Dump the current DB (local Homebrew or Neon) to a timestamped file:
DATABASE_URL=postgresql://hjyani@localhost:5432/aishorts scripts/db-dump.sh

# Restore a dump into a target DB:
TARGET_URL=postgresql://aishorts:aishorts@localhost:5433/aishorts scripts/db-restore.sh <file.dump>

# One-shot move (dump source -> migrate target schema -> restore). Example seeds the
# Docker container's Postgres (host port 5433) from your existing local DB:
SOURCE_URL=postgresql://hjyani@localhost:5432/aishorts \
TARGET_URL=postgresql://aishorts:aishorts@localhost:5433/aishorts \
scripts/migrate-data.sh
```

This moves the already-ingested + AI-summarized cards, users, sources, events, and
subscribers. Media files are re-derivable — run `backfill:media` on the target, or copy
the `media` volume's contents.

---

## 8. Phase 2 — move to the cloud

The container stack is the unit of deployment; nothing is Mac-specific.

1. Provision a Linux VM with Docker. Copy the repo (or push the built image to a
   registry and pull it).
2. Put your production secrets in `.env` on the VM (strong `POSTGRES_PASSWORD`,
   `ADMIN_TOKEN`, `AUTH_JWT_SECRET`, real `GOOGLE_CLIENT_ID`, `PEXELS_API_KEY`).
3. `scripts/docker-up.sh -d` — same stack, now in the cloud.
4. Migrate data with `scripts/migrate-data.sh` (SOURCE = your Mac/Neon, TARGET = cloud).
5. Point the app at the cloud URL — either rebuild the APK with the new
   `EXPO_PUBLIC_API_URL`, or just change it in the app's **Settings** screen.
6. Put HTTPS in front (a reverse proxy like Caddy/Traefik, or the same Cloudflare
   Tunnel) so devices can reach it.

---

## 9. Environment matrix

| Variable | Where | Purpose |
|----------|-------|---------|
| `DATABASE_URL` | root `.env` | DB connection (overridden to the container in compose) |
| `POSTGRES_USER/PASSWORD/DB/PORT` | root `.env` | Bundled Postgres container creds + host port |
| `ADMIN_TOKEN` | root `.env` | Guards `/v1/admin/*` |
| `ADMIN_PASSWORD` | root `.env` | Admin panel login |
| `AUTH_JWT_SECRET` | root `.env` | Signs app JWTs |
| `GOOGLE_CLIENT_ID` | root `.env` | Verifies Google id_tokens (Web client ID) |
| `PEXELS_API_KEY` | root `.env` | Self-hosted card photos |
| `LLM_PROVIDER` / `GROQ_API_KEY` / `ANTHROPIC_API_KEY` | root `.env` | Summarization |
| `MEDIA_DIR` | root `.env` (optional) | Media storage path (defaults to `services/api/media`) |
| `EXPO_PUBLIC_API_URL` | `apps/mobile/.env` | Backend URL baked into the APK |
| `EXPO_PUBLIC_GOOGLE_CLIENT_ID` | `apps/mobile/.env` | Web client ID for Google sign-in |

---

## 10. Troubleshooting

- **`Cannot connect to the Docker daemon`** — start Docker Desktop (`open -a Docker`),
  wait for `docker info` to succeed.
- **Host port 5432 already in use** — a local Homebrew Postgres is running. The compose
  file maps the container to **5433** by default; change with `POSTGRES_PORT`.
- **Feed images are blank in the APK** — the app can't reach `/media/*`. Confirm the
  backend URL in Settings is the HTTPS tunnel and `curl https://<host>/media/seed/models.png`
  returns an image.
- **Cleartext HTTP blocked on device** — use the HTTPS tunnel, not `http://<LAN-IP>`.
- **Google sign-in does nothing / mock user appears** — `EXPO_PUBLIC_GOOGLE_CLIENT_ID`
  wasn't set at build time, or you're on web/Expo Go. Rebuild the APK with it set.
- **`google_cancelled`** — the user dismissed the Google sheet; harmless.
- **Seed images missing after upgrading** — the API copies them into the volume on
  startup; restart the `api` service (`docker compose restart api`).
