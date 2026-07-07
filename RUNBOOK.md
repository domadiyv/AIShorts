# AIShorts — Project Runbook & History

_Last updated: 2026-06-17. This is the single source of truth for what AIShorts is,
what we decided, what broke, what's resolved vs not, and exactly how to run it._

---

## 1. What we're building (requirements)

- **AIShorts** = an **Inshorts-style mobile app for the AI world**: daily AI news +
  learning, delivered as short, swipeable **~60-word cards**.
- Goal: someone who wants to "get on top of what's happening in AI every day"
  downloads it to **stay updated AND learn**.
- Reference: inshorts.com and the `inshorts-clone` GitHub repo (UI inspiration only).
- **The end goal is the MOBILE APP** (you clarified this explicitly).

---

## 2. How I should work (your preferences — standing rules)

- Act as a **world-class lead architect / full-stack & mobile developer**.
- **No trial-and-error.** Diagnose root causes; **verify before presenting**.
- Deliver **clean, scalable, modular, flexible** designs.
- **Free tier** preferred; cost-conscious.
- **Mobile-first.**
- Don't make you babysit — act autonomously where safe — but **be extremely clear,
  don't waste time/tokens, and don't lose context.**
- Don't make you repeat yourself (these are saved in long-term memory).

---

## 3. Decisions we agreed on

| Area | Decision |
|---|---|
| Content engine | **Hybrid**: AI drafts cards → **human approves** in admin before publish |
| MVP scope | **News feed first**; structured "learning track" later (v2) |
| Audience | Beginners **and** practitioners via **difficulty levels** (beginner/intermediate/advanced) |
| Summarization | **Groq free tier** (`llama-3.3-70b-versatile`), behind a provider-agnostic layer (you rejected paying for Anthropic) |
| Backend API | **Fastify** (not NestJS — chosen for simplicity; my deviation, you were OK with it) |
| Validation surface | Originally newsletter+web → **both dropped**. **Mobile-first.** |
| Admin | **Separate, phone-installable PWA** — NOT bundled into the consumer app |
| Monetization | Design toward **subscription + in-feed ads** later; **none in MVP**. (Your "partners pay per click" idea → corrected to "partners pay for placement"; lead with subscription/ads.) |
| Legal | Original summaries + attribution + link to source; small-font credit is necessary-but-not-sufficient |

---

## 4. What's built (and verified)

Monorepo at `D:\Claude\AiShorts` (npm workspaces). Committed: `c0150d0` "Initial commit".

| Component | Path | Status |
|---|---|---|
| Shared data model | `packages/shared` | ✅ Prisma schema + zod types; migrated to **Neon Postgres** |
| Content worker | `services/worker` | ✅ RSS ingest (5 feeds) → dedup → **full-article fetch** → **Groq** summarize → review queue; enforces **≤62-word** cards |
| API server | `services/api` | ✅ **Fastify @ :4000** — feed (cursor + category/difficulty filters), search, categories, subscribers, events, **token-guarded admin** (approve/reject/edit); Upstash Redis cache. Verified live. |
| Admin panel | `apps/admin` | ✅ **Next.js @ :4001** — review/approve/edit cards; installable **PWA**. Verified. |
| Public web feed | `apps/web` | ❌ **Removed** (we went mobile-first) |
| Mobile app | `apps/mobile` | ✅ **Built** — Expo (**SDK 54** — must match the phone's store Expo Go, see §6.13), swipe feed, category/difficulty filters, bookmarks, read-more. Bundles clean. |

**Content in the database:** ~**31 published cards** + ~1,091 raw articles in Neon.

---

## 5. Accounts, keys, environment

All secrets live in `D:\Claude\AiShorts\.env` (**git-ignored, never committed**):

| Key | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres (cloud — persists across reboots) |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | Upstash Redis cache (cloud) |
| `GROQ_API_KEY` | Groq free tier (summarization) |
| `ANTHROPIC_API_KEY` | present but **unused** (we use Groq) |
| `ADMIN_TOKEN` | `dev-admin-token-change-me` — guards admin API |
| `API_PORT` | 4000 |

Machine facts:
- **Node v24** at `D:\Program Files` (on PATH — fresh terminals find `node`/`npm`).
- **Android SDK** at `C:\Users\USER\AppData\Local\Android\Sdk`; `ANDROID_HOME` set; `adb`/`emulator` on PATH.
- Emulator AVD `Pixel_3a_API_33_x86_64` **relocated to `D:\Android\avd`** (C: was full).
- LAN IP (Wi-Fi): `192.168.1.180`.
- Ports: API **4000**, admin **4001**, Metro (Expo) **8081**.

---

## 6. Every issue we hit, and how it was resolved

1. **Clean machine** (no Node/Docker) → found Node at `D:\Program Files`, added to PATH; chose **cloud Neon + Upstash** instead of Docker. ✅
2. **Anthropic had $0 credits** → blocked summarization → **switched to Groq free tier** behind a provider-agnostic `llm.ts`. ✅
3. **Groq rate limit** (12k tokens/min) → added **retry/backoff + delays + per-source caps + shorter excerpts**. ✅
4. **Summaries too short** (RSS feeds only carry teasers) → added **full-article extraction** (`@extractus/article-extractor`). ✅
5. **Summaries overshooting 60 words** → added `trimSummary` + a `normalize` script (≤62 words). ✅
6. **PowerShell mangles `$` in inline `node -e`** → use script files instead. ✅ (tooling note)
7. **Web page vs mobile confusion** → **dropped the web feed**, made admin a **PWA**, committed to **mobile-first**. ✅
8. **Expo SDK 56 too new for store Expo Go** → iPhone showed *"Project is incompatible with this version of Expo Go."* → **pinned project to SDK 55**. ⚠️ **This did NOT fix the iPhone — see issue 12.**
9. **Android emulator wouldn't start: "Not enough disk space"** → `C:` was full (0.7 GB) → **moved the 10 GB AVD to `D:`** (freed C:). ✅
10. **Emulator app showed "No cards"** → `10.0.2.2` NAT route was **firewall-blocked** → switched app to **`127.0.0.1` via `adb reverse`** (firewall-proof) → **app rendered real cards. VERIFIED with a screenshot on the Android emulator.** ✅
11. **Android emulator NOT viable on this machine (re-verified 2026-06-17).** Two compounding causes: (a) **no hardware acceleration** — `accel: 0` because Hyper-V holds the hypervisor (so it runs software-slow); (b) **8 GB total RAM** — the emulator alone uses ~0.9 GB and dropped free RAM to **0.4 GB**, so **Metro (~1 GB) cannot start alongside it**. With the emulator OFF, ~2.6 GB frees up and Metro starts fine. **Conclusion: this PC cannot run the emulator + Metro together.** Use a physical device instead (§7B). ❌
12. **iPhone + Expo Go — root cause IDENTIFIED (2026-06-17), fix not yet device-confirmed.** Two compounding problems: (a) **SDK mismatch** — FIXED: project pinned to **SDK 55**, the current store Expo Go (PROVEN working against Expo Go 55.0.7 on the Android emulator). (b) **Windows Firewall** blocks the iPhone from reaching Metro (8081) + API (4000) over the LAN — there is no inbound allow rule. FIX = open the firewall (§7B step 0) + same Wi-Fi + LAN API URL. Both known blockers are now addressed; remaining is your firewall command + scan. ⚠️ **The SDK-55 pin was WRONG — see issue 13 for the real story.**
13. **"Project is incompatible with this version of Expo Go" — TRUE root cause found 2026-07-07.** The iPhone's **App Store Expo Go is pinned at SDK 54** (client 54.0.7; the Play Store one is likewise stuck at 54.0.8, May 2026). Expo published newer Expo Go clients (55/56/57) but they never shipped to the app stores — they exist only via expo.dev/go (Android APK sideload; **no iOS option at all**). So the June "pin to SDK 55" could never fix the iPhone: 55 ≠ 54. The emulator worked in June only because it had a sideloaded/dev Expo Go 55.0.7. **FIX (applied 2026-07-07): project downgraded to SDK 54** (`npm install expo@sdk-54` + `npx expo install --fix`; now expo 54.0.35 / RN 0.81.5 / React 19.1). Typecheck + iOS bundle export verified clean. **RULE: before ever changing the project SDK, open Expo Go on the actual phone → App info → "supported sdk" — the project MUST match that number exactly.** Firewall rule "AIShorts dev" (8081, 4000) confirmed created 2026-07-06.
14. **Phone shows "Could not connect to the server. exp://127.0.0.1:8081" (2026-07-07).** Metro advertised `127.0.0.1` instead of the LAN IP: Expo's IP autodetection fails on this PC (6 network adapters, 5 dead `169.254.*` link-local ones) and falls back to localhost, which a phone can never reach. **FIX (applied + verified): `REACT_NATIVE_PACKAGER_HOSTNAME=192.168.1.180` added to `apps/mobile/.env`** — Expo CLI loads it on every start; manifest verified to advertise `192.168.1.180:8081`. If the PC's Wi-Fi IP ever changes, update BOTH lines in that .env.

---

## 7. HOW TO RUN — the honest, current state

### 7A. Backend (✅ fully verified — works every time)

Open a normal PowerShell (fresh window finds `node` automatically):

```
# 1) Start the API
cd "D:\Claude\AiShorts"
npm run -w @aishorts/api start
# wait ~10-20s for: "API listening on http://0.0.0.0:4000". Leave window open.

# 2) (optional) Admin panel to review/approve cards — another window
cd "D:\Claude\AiShorts"
npm run -w @aishorts/admin dev
# open http://localhost:4001  (approve cards -> they show in the feed)

# 3) (optional) Refresh content — another window
cd "D:\Claude\AiShorts"
npm run -w @aishorts/worker ingest        # pull feeds + summarize new cards
# other worker commands: summarize:only | normalize | reset:drafts | check
```

The API serves the cards the mobile app consumes. The DB (Neon) keeps your ~31
published cards across reboots, so the feed has content immediately.

### 7B. Mobile app on a device

**The app itself is built and PROVEN to run** (rendered real cards on the Android emulator, 2026-06-17). What remains is the *runtime environment*. Honest status on THIS machine (Windows, 8 GB RAM, you have an iPhone):

| Route | Status | Verdict |
|---|---|---|
| **Android emulator (this PC)** | ❌ Not viable | 8 GB RAM can't run emulator + Metro together; no HW accel (§6.11). |
| **iPhone via Expo Go (LAN)** | ✅ **Recommended** — PC side verified ready | Project SDK 54 = App Store Expo Go SDK 54 (§6.13); firewall rule created 2026-07-06. |
| **Physical Android phone (USB)** | ✅ High confidence, untested | If you get any Android phone: no RAM/firewall issues. |
| **Standalone EAS build** | Bulletproof, not set up | Android APK free (needs an Android phone); iOS needs $99 Apple Developer. |

#### Run it on your iPhone (free — recommended) — line by line

**Step 0 (once): open the Windows Firewall for the dev ports.** Right-click Start → **Terminal (Admin)** → paste:
```
New-NetFirewallRule -DisplayName "AIShorts dev" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8081,4000 -Profile Private
```

**Step 1: confirm the app's API URL is your PC's LAN IP.** `apps/mobile/.env` should read:
```
EXPO_PUBLIC_API_URL=http://192.168.1.180:4000
```
(If your PC's Wi-Fi IP changes, update this. Find it with `ipconfig` → IPv4 Address.)

**Step 2: start the API** — new PowerShell window:
```
cd "D:\Claude\AiShorts"
npm run -w @aishorts/api start
```
Leave it open (prints `API listening on http://0.0.0.0:4000`).

**Step 3: start Metro** — another new PowerShell window:
```
cd "D:\Claude\AiShorts\apps\mobile"
npx expo start
```
A **QR code** appears. Leave it open. (Use a real terminal window — in a hidden/background
shell Expo can hang at "Starting project"; a normal window is fine.)

**Step 4: on the iPhone** — same Wi-Fi as the PC → open the **Camera** app → point at the
QR code → tap **"Open in Expo Go"**. First load bundles ~1–2 min (slow machine), then the
AIShorts feed appears.

If it won't connect: re-check Step 0 (firewall) and that phone + PC are on the **same**
Wi-Fi (not a guest network or cellular).

#### Fallback if Expo Go still fails: standalone build (EAS)
- **Android:** `eas build -p android --profile preview` (free Expo account) → install the
  APK on any Android phone. No Metro, no Expo Go, no RAM issue. (Needs an Android phone.)
- **iOS:** needs an **Apple Developer account ($99/yr)** → `eas build -p ios` → install via
  TestFlight on your iPhone. Most robust iPhone path; costs $99/yr.

> **Why this machine is hard:** 8 GB RAM can't host the Android emulator + Metro at once,
> and Apple ships no emulator/build tools for Windows. The free path that fits your
> hardware is **iPhone + Expo Go over LAN** (above). The bulletproof path is an **EAS
> standalone build**.

---

## 8. Outstanding TODOs (not yet done)

1. **Resolve device-run reliably** — pick Route 1/2/3 in §7B.
2. **World-class modular refactor of the mobile app** (you requested this) — it's still a
   single `App.tsx`; planned: feature modules, TanStack Query data layer, typed API
   client from `packages/shared`, design-system/theme, expo-router. (Not started.)
3. **Mobile polish:** onboarding screen, push notifications, real app icon/splash.
4. **Deploy the API** (Render/Railway free tier; Neon+Upstash already cloud) — only
   needed to use the app off your Wi-Fi / share / production.
5. Improve near-duplicate clustering (several SpaceX/IPO near-dupes; dedup is exact-title only).
6. Automated tests; then learning track; then monetization.

---

## 9. Quick reference

- Repo: `D:\Claude\AiShorts` — start commands in §7A.
- Worker scripts: `ingest`, `summarize:only`, `normalize`, `reset:drafts`, `check`
  (run as `npm run -w @aishorts/worker <script>`).
- Mobile app config: `apps/mobile/.env` → `EXPO_PUBLIC_API_URL`
  (`http://192.168.1.180:4000` for a real device on Wi-Fi; `http://127.0.0.1:4000` for the emulator with `npm run android`).
- Admin token for API admin calls: header `x-admin-token: dev-admin-token-change-me`.
