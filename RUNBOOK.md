# AIShorts — Project Runbook & History

_Last updated: 2026-07-22. This is the single source of truth for what AIShorts is,
what we decided, what broke, what's resolved vs not, and exactly how to run it._

> **Status: the full stack runs, including the app on the iPhone (verified 2026-07-22).**
> Just want to run it? → **§7.1**. Refresh the news? → **§7.5**. Firewall/security? → **§7.6**.
> **App was working but suddenly won't load?** → **§7.3.1** (99% the Wi-Fi went Public).

> **📦 Packaging & deployment (Docker, Android APK, cloud) moved to [DEPLOY.md](DEPLOY.md).**
> This RUNBOOK is the **historical dev record** (Windows/Expo-Go-over-LAN, Neon+Upstash).
> The shipping path — self-contained Docker stack (bundled Postgres, no Neon/Upstash
> needed), one-command run, Cloudflare tunnel, local Android APK build, no-login cache,
> Google SSO, self-hosted Pexels media, and the Phase 1 → Phase 2 (cloud) migration — is
> all in **[DEPLOY.md](DEPLOY.md)**. See **§10** below for what changed.

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
| Content worker | `services/worker` | ✅ RSS ingest (5 feeds, §7.8) → dedup → **full-article fetch** → **Groq** summarize → review queue; **newest-first + 21-day freshness cutoff** (§6.16); enforces **≤62-word** cards. Triggerable from the admin panel. |
| API server | `services/api` | ✅ **Fastify @ :4000** — feed (cursor + category/difficulty filters), search, categories, subscribers, events, **token-guarded admin** (approve/reject/edit); Upstash Redis cache. Verified live. |
| Admin panel | `apps/admin` | ✅ **Next.js @ :4001** — **password-protected** (§7.7); review/approve/edit cards, clickable source link + article-published/sourced timestamps; installable **PWA**. Verified. |
| Public web feed | `apps/web` | ❌ **Removed** (we went mobile-first) |
| Mobile app | `apps/mobile` | ✅ **RUNNING ON THE iPHONE (verified 2026-07-22)** — Expo (**SDK 54** — must match the phone's store Expo Go, see §6.13), swipe feed, category/difficulty filters, bookmarks, read-more. Run steps: §7.1. |

**Content in the database (2026-07-22, after the freshness fix):** **131 cards** — 46
published, **50 pending review (all published today)**, 35 stale ones rejected — plus
**1,199 raw articles** in Neon. Refresh procedure: §7.5.

---

## 5. Accounts, keys, environment

All secrets live in `D:\Claude\AiShorts\.env` (**git-ignored, never committed**):

| Key | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres (cloud — persists across reboots) |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | Upstash Redis cache (cloud) |
| `GROQ_API_KEY` | Groq free tier (summarization) |
| `ANTHROPIC_API_KEY` | present but **unused** (we use Groq) |
| `ADMIN_TOKEN` | `dev-admin-token-change-me` — guards the admin **REST API** (`x-admin-token` header) |
| `ADMIN_PASSWORD` | login password for the admin **panel UI** at :4001 (added 2026-07-22). **Fails closed** — if unset, nobody can sign in. Changing it invalidates all sessions. |
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
11. **Android emulator NOT viable on this machine (re-verified 2026-06-17).** Two compounding causes: (a) **no hardware acceleration** — `accel: 0` because Hyper-V holds the hypervisor (so it runs software-slow); (b) **8 GB total RAM** — the emulator alone uses ~0.9 GB and dropped free RAM to **0.4 GB**, so **Metro (~1 GB) cannot start alongside it**. With the emulator OFF, ~2.6 GB frees up and Metro starts fine. **Conclusion: this PC cannot run the emulator + Metro together.** Use a physical device instead (§7.4). ❌
12. **iPhone + Expo Go — root cause IDENTIFIED (2026-06-17), fix not yet device-confirmed.** Two compounding problems: (a) **SDK mismatch** — FIXED: project pinned to **SDK 55**, the current store Expo Go (PROVEN working against Expo Go 55.0.7 on the Android emulator). (b) **Windows Firewall** blocks the iPhone from reaching Metro (8081) + API (4000) over the LAN — there is no inbound allow rule. FIX = open the firewall (§7.0) + same Wi-Fi + LAN API URL. Both known blockers are now addressed; remaining is your firewall command + scan. ⚠️ **The SDK-55 pin was WRONG — see issue 13 for the real story.**
13. **"Project is incompatible with this version of Expo Go" — TRUE root cause found 2026-07-07.** The iPhone's **App Store Expo Go is pinned at SDK 54** (client 54.0.7; the Play Store one is likewise stuck at 54.0.8, May 2026). Expo published newer Expo Go clients (55/56/57) but they never shipped to the app stores — they exist only via expo.dev/go (Android APK sideload; **no iOS option at all**). So the June "pin to SDK 55" could never fix the iPhone: 55 ≠ 54. The emulator worked in June only because it had a sideloaded/dev Expo Go 55.0.7. **FIX (applied 2026-07-07): project downgraded to SDK 54** (`npm install expo@sdk-54` + `npx expo install --fix`; now expo 54.0.35 / RN 0.81.5 / React 19.1). Typecheck + iOS bundle export verified clean. **RULE: before ever changing the project SDK, open Expo Go on the actual phone → App info → "supported sdk" — the project MUST match that number exactly.** Firewall rule "AIShorts dev" (8081, 4000) confirmed created 2026-07-06.
14. **Phone shows "Could not connect to the server. exp://127.0.0.1:8081" (2026-07-07).** Metro advertised `127.0.0.1` instead of the LAN IP: Expo's IP autodetection fails on this PC (6 network adapters, 5 dead `169.254.*` link-local ones) and falls back to localhost, which a phone can never reach. **FIX (applied + verified): `REACT_NATIVE_PACKAGER_HOSTNAME=192.168.1.180` added to `apps/mobile/.env`** — Expo CLI loads it on every start; manifest verified to advertise `192.168.1.180:8081`. If the PC's Wi-Fi IP ever changes, update BOTH lines in that .env.
15. **Firewall rule existed but was DORMANT — and something broader was doing the work (2026-07-22).** Symptom: the app worked even though `AIShorts dev` was scoped to **Private** while the Wi-Fi was categorized **Public** (so that rule could not apply). Cause: two auto-created **`Node.js JavaScript Runtime`** rules allowed *any* Node process on *any* port on **Public** networks — a Windows "Allow access?" popup accepted long ago. **Lesson: when auditing Windows Firewall, check program-scoped rules (`Get-NetFirewallApplicationFilter`), not just port-scoped ones — a port-only audit misses them and gives a wrong answer.** **RESOLVED:** network set to Private, `AIShorts dev` now live, broad Node rules disabled. iPhone still connects → the narrow rule is sufficient. Full posture + audit commands in **§7.6**. ⚠️ **RECURS — see issue 17.**
17. **🔁 App "suddenly won't load" — Wi-Fi silently re-flipped to Public (CONFIRMED recurrence 2026-07-24, RESOLVED same day).** Exactly the return predicted in issue 15. All servers were healthy (Metro advertising `192.168.1.180:8081` SDK 54, API answering on LAN, feed had cards), but the phone couldn't connect. Cause: Windows had created a **new** connection profile for the same SSID — `Verizon_4D9JKQ-5G` (previously it was `Verizon_4D9JKQ-5G 2`) — and new profiles default to **Public**, so the Private-scoped `AIShorts dev` rule went dormant again. With the broad Node rules now disabled (issue 15), nothing masked it → fully blocked. **FIX (applied + VERIFIED by user 2026-07-24 — app loaded fine after):** `Set-NetConnectionProfile -Name "<exact name>" -NetworkCategory Private` (Terminal as Admin), then reload the app — **no server restart needed.** **This is the #1 recurring failure; documented as the first row of the §7.3 troubleshooting table + dedicated §7.3.1.**
16. **🐛 "I refreshed the news but every card is months old" — the summarizer was mining a stale backlog (found & fixed 2026-07-22).** Symptom: ingest reported success (`65 new raw items`) yet every card showed `Sourced Jun 15` and articles 39–195 days old. **Ingestion was never broken** — the audit showed 65 articles fetched on 22 Jul and **0 of them summarized**. Cause: `summarize.ts` ordered `fetchedAt: 'asc'` (**oldest first**) and took 25 per run, against a **1,084-item backlog** from the first bulk ingest (Hugging Face's 797-post archive + 257 arXiv). At 25/run, today's news was ~43 runs away; the next items queued were published in **March**. **FIX:** order by `publishedAt: 'desc'` (freshest article first) **and** filter out anything older than `MAX_ARTICLE_AGE_DAYS` (default 21) so a daily-news app can never draft stale news. Old rows are kept, just ineligible. Also added `reject:stale` to clear the queue (34 stale pending cards rejected). **VERIFIED:** next run produced 25 cards, all published **the same day** (0d old), zero stale pills. **Lesson: "the job reported success" ≠ "the job did the useful thing" — check the output dates, not the exit code.**

---

## 7. HOW TO RUN — ✅ VERIFIED END-TO-END 2026-07-22

**The whole stack now runs, including the app on the iPhone.** Steps below are the exact
verified sequence. One-time setup is §7.0 — after that, every session is just §7.1.

### 7.0 One-time setup (already done on this PC — verify, don't redo)

| # | What | Verify it's still true |
|---|---|---|
| 1 | Home Wi-Fi categorized **Private** ⚠️ *reverts to Public on its own — see §7.3.1* | `Get-NetConnectionProfile` → `NetworkCategory : Private` |
| 2 | Firewall rule **AIShorts dev** (inbound TCP 8081+4000, Private) | `Get-NetFirewallRule -DisplayName "AIShorts dev"` → `Enabled: True` |
| 3 | Broad **Node.js JavaScript Runtime** rules **disabled** (tighter security, §7.6) | `Get-NetFirewallRule -DisplayName "Node.js JavaScript Runtime"` → `Enabled: False` |
| 4 | `apps/mobile/.env` has the PC's LAN IP in **both** lines | see §7.2 |
| 5 | Expo Go installed on the iPhone, project SDK matches it (**SDK 54**) | §6.13 |

If step 1 or 2 is wrong, fix in **Terminal (Admin)**:
```
Set-NetConnectionProfile -Name "<your Wi-Fi name>" -NetworkCategory Private
New-NetFirewallRule -DisplayName "AIShorts dev" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8081,4000 -Profile Private
```

### 7.1 Every session — two windows, in this order

**Window 1 — API** (must be started *before* the app loads):
```
cd "D:\Claude\AiShorts"
npm run -w @aishorts/api start
```
Wait for `API listening on http://0.0.0.0:4000`. **Leave open.**

**Window 2 — Metro** (the app bundler):
```
cd "D:\Claude\AiShorts\apps\mobile"
npx expo start
```
A **QR code** appears. **Leave open.** Use `npx expo start -c` (clears cache) after any
dependency/SDK change. Use a *real* terminal window — in a hidden/background shell Expo
can hang at "Starting project".

⚠️ **Check the URL printed above the QR reads `exp://192.168.1.180:8081` — NOT `127.0.0.1`.**
If it says `127.0.0.1`, see §6.14.

**On the iPhone** — same Wi-Fi as the PC (not cellular, not a guest network) → **Camera**
app → point at the QR → tap **"Open in Expo Go"**. First bundle takes ~1–2 min on this
machine; after that it's fast. The AIShorts feed appears.

**Optional third window — admin panel** (to publish new cards, §7.5):
```
cd "D:\Claude\AiShorts"
npm run -w @aishorts/admin dev      # http://localhost:4001
```
Sign in with `ADMIN_PASSWORD` from `.env`. The session lasts 30 days, so a phone only
asks once. To review **from your phone**, see §7.7.

### 7.2 If the PC's Wi-Fi IP ever changes

Find it with `(Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias 'Wi-Fi').IPAddress`,
then update **both** lines in `apps/mobile/.env` and restart Metro with `-c`:
```
EXPO_PUBLIC_API_URL=http://<NEW_IP>:4000
REACT_NATIVE_PACKAGER_HOSTNAME=<NEW_IP>
```

### 7.3 Troubleshooting — symptom → cause

| Symptom on the phone | Cause & fix |
|---|---|
| **Was working, now the app won't load / connect at all** | ⭐ **#1 cause: Windows re-flipped the Wi-Fi to Public → the firewall rule went dormant.** This recurs after reboots / router reconnects. **Fix → §7.3.1.** |
| "Project is incompatible with this version of Expo Go" | Project SDK ≠ phone's Expo Go SDK → §6.13 |
| "Could not connect to the server. exp://**127.0.0.1**:8081" | Metro advertising localhost → §6.14 (`REACT_NATIVE_PACKAGER_HOSTNAME`) |
| Can't connect to `192.168.1.180` (correct IP shown) | Firewall/network profile → §7.3.1; or phone on a different Wi-Fi |
| App loads but shows **"No cards"** | API window not running, or `EXPO_PUBLIC_API_URL` wrong → §7.2. Test: open `http://192.168.1.180:4000/v1/health` in the **phone's** browser |
| Feed looks stale | Cards need approval → §7.5 |

#### 7.3.1 ⭐ App suddenly stopped loading — the Wi-Fi went Public (MOST COMMON)

**This is the single most likely reason a previously-working app stops loading** — hit and
fixed twice already (2026-07-22 and again 2026-07-24; the second time the fix below was
applied and the app loaded fine immediately). Windows periodically re-categorizes your
home Wi-Fi as **Public** (after reboots, router restarts, or when it creates a *new*
profile entry for the same SSID — e.g. `Verizon_4D9JKQ-5G` vs `Verizon_4D9JKQ-5G 2`). The
`AIShorts dev` firewall rule is scoped to **Private only**, so on a Public network it does
nothing and the phone is blocked. (We disabled the broad `Node.js` fallback rules for
security, so there's no longer anything masking this.)

**Diagnose** (read-only, normal PowerShell):
```
Get-NetConnectionProfile | Select-Object Name, NetworkCategory
```
If `NetworkCategory` is **anything but `Private`**, that's the problem.

**Fix** — **Terminal (Admin)**, using the exact `Name` from the command above:
```
Set-NetConnectionProfile -Name "Verizon_4D9JKQ-5G" -NetworkCategory Private
```
Then reload in Expo Go (shake → Reload, or re-scan the QR). **No need to restart Metro or
the API.** Servers are almost never the cause here — verify with the checks in §7.3.2.

#### 7.3.2 Confirm the PC side is actually healthy (30-second check)

Run in a normal PowerShell — all three should be true before blaming the phone/network:
```
# 1) all three ports listening?
Get-NetTCPConnection -State Listen | Where-Object LocalPort -in 4000,4001,8081
# 2) API answering, feed has cards?
curl http://192.168.1.180:4000/v1/health
curl "http://192.168.1.180:4000/v1/feed?limit=1"
# 3) Metro advertising the LAN IP (NOT 127.0.0.1), SDK 54?
curl -H "expo-platform: ios" http://localhost:8081/
```
If all three pass but the phone still can't connect → it's the network profile (§7.3.1)
or the phone is on a different Wi-Fi / cellular.

### 7.4 Other device routes (reference)

| Route | Status | Verdict |
|---|---|---|
| **iPhone via Expo Go (LAN)** | ✅ **WORKING — verified 2026-07-22** | The path documented above. |
| **Android emulator (this PC)** | ❌ Not viable | 8 GB RAM can't run emulator + Metro together; no HW accel (§6.11). |
| **Physical Android phone (USB)** | ✅ High confidence, untested | No RAM/firewall issues. |
| **Standalone EAS build** | Bulletproof, not set up | Android APK free; iOS needs $99 Apple Developer. |

#### Fallback if Expo Go ever fails: standalone build (EAS)
- **Android:** `eas build -p android --profile preview` (free Expo account) → install the
  APK on any Android phone. No Metro, no Expo Go, no RAM issue. (Needs an Android phone.)
- **iOS:** needs an **Apple Developer account ($99/yr)** → `eas build -p ios` → install via
  TestFlight on your iPhone. Most robust iPhone path; costs $99/yr.

> **Why this machine is hard:** 8 GB RAM can't host the Android emulator + Metro at once,
> and Apple ships no emulator/build tools for Windows. The free path that fits your
> hardware is **iPhone + Expo Go over LAN** (above). The bulletproof path is an **EAS
> standalone build**.

### 7.5 Refreshing the news (✅ verified 2026-07-22)

Content is a **two-step** process by design: the AI drafts, **you** publish. Newly
summarized cards land as `pending` and are **invisible to the app** until approved.

**Easiest — from the admin panel:** click **"Fetch new articles"** (top of the page).
It runs the same pipeline in the background, shows live progress, and reloads the
review list when it finishes. Safe to navigate away or close the tab — the job keeps
running on the API server and the button shows it still running when you come back.
Only one run at a time (a second click returns "already running").

**Or from the command line:**
```
cd "D:\Claude\AiShorts"
npm run -w @aishorts/worker ingest        # pull + summarize (~2-4 min)
npm run -w @aishorts/admin dev            # http://localhost:4001 -> "pending" tab
```

Approved cards appear in the mobile feed **immediately** (admin actions bump the Redis
feed-cache version — no 60 s wait, no restart). Pull-to-refresh in the app to see them.

The summarizer caps at **25 cards per run** — click again / re-run to draft more.

**Freshness rules (fixed 2026-07-22 — see §6.16):**
- Articles are summarized **newest-first**, by the article's own publish date.
- Anything older than **`MAX_ARTICLE_AGE_DAYS`** (default **21**) is **never** drafted.
  Stale rows stay in `raw_items` — nothing is deleted — they just stop being eligible.
  Raise the variable temporarily if you ever want to mine the archive on purpose.

Other worker commands: `summarize:only` (skip fetching), `normalize` (re-trim summaries
to ≤62 words), `check` (DB counts + sample cards), `reset:drafts` (delete pending cards
and re-queue their articles), **`reject:stale`** (reject pending cards whose article is
past the age cutoff — **dry-run by default**, add `-- --yes` to apply).

**How to verify content is fresh:**
- **In the app:** pull down to refresh. Approved cards appear at the top immediately
  (admin actions bump the Redis feed-cache version — no restart, no 60 s wait).
- **In the admin panel:** the *pending* tab count = your unpublished backlog.
- **From a terminal:** `npm run -w @aishorts/worker check` → totals + pending/published
  split. Or `curl -s "http://localhost:4000/v1/feed?limit=5"` for what's live right now.
- Rule of thumb: **`raw_items` grew** ⇒ fetching worked. **`published` grew** ⇒ your
  approvals landed. Baseline 2026-07-22: 1,165 raw items, 81 cards (46 published).

### 7.6 Firewall & security posture (settled 2026-07-22)

**Final configuration — the tightest of the working options:**

| Setting | Value | Why |
|---|---|---|
| Home Wi-Fi category | **Private** | A rule only applies if its profile matches the *current* network's category. Home Wi-Fi = trusted = Private. |
| `AIShorts dev` rule | **Enabled**, inbound TCP **8081+4000**, **Private** only | Exactly the two ports needed, only on the home network. Dormant everywhere else. |
| `Node.js JavaScript Runtime` rules | **Disabled** | These allowed **any** Node process on **any** port on **Public** networks (cafés/airports). Far broader than needed. |

**Verified consequence:** with the Node rules OFF, the iPhone still connects — proving the
narrow `AIShorts dev` rule is sufficient on its own.

**Is this a security risk?** Low, and bounded:
- **Not internet-facing.** The PC is `192.168.1.180` (RFC1918) behind router NAT at
  `192.168.1.1`. There is no inbound route from the internet.
- Dev servers bind `0.0.0.0`/`::` (all interfaces) — required for the phone to reach
  them, and it does not extend past the LAN.
- Realistic threat model: *a device already on your home Wi-Fi* could reach Metro (which
  serves project source) and the API.
- ⚠️ **Remaining gap:** `ADMIN_TOKEN` is still the default `dev-admin-token-change-me`,
  so anyone on the LAN could approve/reject/edit cards. **Change it to a long random
  string in `.env`** to close this. (Must match the token the admin app sends.)

**Read-only audit commands** (change nothing; run anytime):
```
Get-NetConnectionProfile                                             # network category
Get-NetTCPConnection -State Listen | Where-Object LocalPort -in 4000,4001,8081
Get-NetFirewallRule -DisplayName "*Node*","AIShorts dev" -ErrorAction SilentlyContinue |
  Select-Object DisplayName, Enabled, Profile, Direction, Action
```

**To pause LAN exposure between sessions** (optional):
`Disable-NetFirewallRule -DisplayName "AIShorts dev"` — re-enable with `Enable-` when you
next want to run on the phone.

### 7.7 Reviewing cards from your phone (admin panel over LAN)

The admin panel is a **PWA** — installable on the iPhone home screen. It is **password-
protected** (added 2026-07-22), so exposing it on the LAN is safe.

**One-time — open port 4001**, in **Terminal (Admin)**:
```
Set-NetFirewallRule -DisplayName "AIShorts dev" -LocalPort 8081,4000,4001
```

**Then**, with the admin server running (`npm run -w @aishorts/admin dev`), on the iPhone:
1. Safari → `http://192.168.1.180:4001`
2. Sign in with `ADMIN_PASSWORD` from `.env` (once — the session lasts 30 days)
3. Optional: **Share → Add to Home Screen** for a fullscreen app icon

**How the auth works** (`apps/admin/lib/auth.ts` + `middleware.ts`):
- Middleware gates every route; only `/login` and the PWA assets are public.
- Session cookie is an **HMAC-SHA256 signed token** (`<expiry>.<signature>`) keyed on
  `ADMIN_PASSWORD`, so it can't be forged and changing the password kills all sessions.
- Cookie is **httpOnly** (invisible to JavaScript), `sameSite=lax`, 30-day expiry.
- Password check is **constant-time** (`timingSafeEqual`).
- **Fails closed:** no `ADMIN_PASSWORD` set ⇒ nobody gets in; the login page says so.
- `secure` is deliberately **off** — this is plain http on the LAN, and a secure cookie
  would never be stored. Turn it on if you ever serve the panel over https.

> **Still open:** `ADMIN_TOKEN` (the REST API guard, separate from the panel password) is
> still the default. Anyone on the LAN who knows it can call the admin API directly,
> bypassing the panel. See §8 item 2.

### 7.8 Content sources — what exists today

**Yes, sources are predefined** — 5 RSS feeds in `services/worker/src/sources.ts`:

| Source | Trusted |
|---|---|
| TechCrunch AI | ✅ |
| The Verge AI | ✅ |
| VentureBeat AI | ✅ |
| Hugging Face Blog | ✅ |
| arXiv cs.AI | ❌ |

They are **upserted into the `sources` DB table on every ingest**, so the table — not the
file — is the runtime source of truth. The schema already carries `active`, `trusted`,
`type` (`rss｜api｜manual`) and a `name`, so **turning a source off or adding one is a data
change, not a schema change.**

To change sources **today**: edit `sources.ts` and re-run ingest (adds/updates), or flip
`active=false` directly in the DB (`npm run db:studio`) to stop pulling from one.

**Managing them from the admin UI is not built yet — see §8 item 3** for the design.

---

## 8. Outstanding TODOs (not yet done)

1. ~~**Resolve device-run reliably**~~ ✅ **DONE 2026-07-22** — iPhone + Expo Go over LAN,
   verified working. Steps in §7.1.
2. **Change `ADMIN_TOKEN`** from the default `dev-admin-token-change-me` to a long random
   string in `.env` — the remaining security gap. (The admin *panel* is now password-
   gated, §7.7; this is the separate REST-API guard. Changing it needs **both** the API
   and the admin server restarted, since both read the same value.)
3. **Source management in the admin UI** (you asked for this 2026-07-22; deferred by
   agreement). Groundwork is already done — the `sources` table has `name/url/type/
   active/trusted`, and ingest reads from the DB, so **no schema change is needed**.
   Planned design:
   - A **Sources** tab in the admin panel listing each feed with its article count and
     last-fetch time, plus an **active on/off** toggle (a source you turn off stops being
     pulled; its existing cards are untouched).
   - **Add a feed:** paste an RSS URL → the server *validates it by actually parsing the
     feed* before saving, auto-fills the title, and rejects duplicates/unreachable URLs.
     Validation-before-save matters: a bad URL would otherwise fail silently every run.
   - API: `GET/POST/PATCH /v1/admin/sources`, token-guarded like the other admin routes.
   - Keep `sources.ts` as the **seed list** for a fresh database; the DB stays
     authoritative at runtime.
   - Later: per-source `MAX_ITEMS_PER_SOURCE`, and a category hint per source.
4. **World-class modular refactor of the mobile app** (you requested this) — it's still a
   single `App.tsx`; planned: feature modules, TanStack Query data layer, typed API
   client from `packages/shared`, design-system/theme, expo-router. (Not started.)
5. **Mobile polish:** onboarding screen, push notifications, real app icon/splash.
6. **Deploy the API** (Render/Railway free tier; Neon+Upstash already cloud) — only
   needed to use the app off your Wi-Fi / share / production.
7. Improve near-duplicate clustering (several SpaceX/IPO near-dupes; dedup is exact-title only).
8. Automated tests; then learning track; then monetization.

---

## 9. Quick reference

- Repo: `D:\Claude\AiShorts` — **run steps in §7.1**, troubleshooting in §7.3.
- Two windows to run the app: API (`npm run -w @aishorts/api start`) + Metro
  (`cd apps\mobile; npx expo start`) → scan QR with iPhone Camera.
- Worker scripts: `ingest`, `summarize:only`, `normalize`, `reset:drafts`, `check`
  (run as `npm run -w @aishorts/worker <script>`). News refresh: §7.5.
- Mobile app config: `apps/mobile/.env` → `EXPO_PUBLIC_API_URL` **and**
  `REACT_NATIVE_PACKAGER_HOSTNAME`, both `192.168.1.180` (update both if the IP changes, §7.2).
- Ports: API **4000**, admin **4001**, Metro **8081**. Expo SDK **54** (must match the
  phone's Expo Go, §6.13). Firewall/security posture: §7.6.
- Admin token for API admin calls: header `x-admin-token: dev-admin-token-change-me`.

---

## 10. Delivery / packaging phase (2026-08-02) — what changed

This phase made the app **shippable on real devices and portable to the cloud**. Full
operator guide is **[DEPLOY.md](DEPLOY.md)**; this section is the "what & why" for the
history. Confirmed decisions: **Android first / iPhone later**, **local builds** (no EAS),
**bundled Postgres container + data** (Neon/Upstash no longer required), **Pexels photos
self-hosted**. The admin panel was explicitly **retained** as a first-class service.

**Added / changed:**
- **Dockerized the whole backend** (`Dockerfile`, `docker-compose.yml`, `.dockerignore`):
  one `node:20-bookworm-slim` image runs api + worker (via `tsx`) and admin (`next dev`);
  `postgres:16` with a `pgdata` volume; a one-shot `migrate` service (`prisma migrate
  deploy` + idempotent seed); a `media` volume for self-hosted images; worker under the
  `jobs` profile. `scripts/docker-up.sh` = one-command stack. **No cloud DB needed** — the
  bundled Postgres replaces Neon; the API runs cache-less so **Upstash is not required**.
- **Data migration** (`scripts/db-dump.sh`, `db-restore.sh`, `migrate-data.sh`): dump/
  restore and a one-shot source→target move for lifting the already-summarized cards into
  the container or the cloud.
- **Internet exposure** (`scripts/tunnel.sh`): Cloudflare Tunnel (quick or named) gives an
  **HTTPS** URL — required because Android release builds block cleartext HTTP.
- **Android APK, local** (`scripts/build-android.sh`): `expo prebuild -p android` →
  `gradlew assembleRelease` → `apps/mobile/dist/aishorts-release.apk`. `app.json` now sets
  `android.package` / `ios.bundleIdentifier` = `com.aishorts.app`.
- **Runtime API URL override:** in-app **Settings** screen writes `aishorts.apiurl.v1`, so
  a built APK can be pointed at the tunnel (or later the cloud) **without rebuilding**;
  falls back to the baked `EXPO_PUBLIC_API_URL`.
- **No-login cache hardening:** the feed pages ahead until enough **unread** cards
  accumulate, so a growing read-history never leaves the feed empty (read cards are
  filtered client-side). Saved/History persist and grow unbounded by design.
- **Real Google SSO:** `@react-native-google-signin/google-signin` (native — expo-auth-
  session's Google provider is deprecated in SDK 54). Falls back to the mock identity when
  no client ID is set, so web/dev demos keep working. Server already verifies real
  id_tokens when `GOOGLE_CLIENT_ID` is set.
- **License-safe media (Pexels, self-hosted):** API serves `/media/*` via `@fastify/
  static`; images stored as **relative** URLs so they follow whatever backend the app
  points at. Ingest fetches a Pexels photo per card (commercial-OK, no attribution);
  fallback chain **Pexels → RSS image → bundled per-category placeholder** (self-generated
  gradients under `services/api/media/seed/`, so it works offline in the container).
  Backfill via `npm run -w @aishorts/worker backfill:media`.

**Env additions** (`.env.example`): `AUTH_JWT_SECRET`, `GOOGLE_CLIENT_ID`,
`PEXELS_API_KEY`, `POSTGRES_USER/PASSWORD/DB/PORT` (default host port **5433** to dodge a
local Homebrew Postgres on 5432), optional `MEDIA_DIR`. Mobile: `apps/mobile/.env.example`
with `EXPO_PUBLIC_API_URL` + `EXPO_PUBLIC_GOOGLE_CLIENT_ID`. **Secrets still never
committed** — `.env`/`.env.*` stay gitignored and `.dockerignored`; only `.env.example`
placeholders are tracked, and nothing real is baked into the image.

**Verified 2026-08-02:** `docker compose up -d --build` → migrate exit 0, `/v1/health` ok,
`/v1/feed` returns relative `/media/seed/<category>.png` URLs, `/media/seed/*.png` serve
HTTP 200 image/png, admin :4001 login 200. Typecheck/build gates clean (shared, api,
worker builds; `apps/mobile` `tsc --noEmit`).
