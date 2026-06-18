# AIShorts — Mobile app (Expo / React Native)

Inshorts-style vertical swipe feed of AI news cards. Reads the AIShorts API (`/v1/feed`).

## Features
- Vertical **swipe feed** (one card per screen), pull-to-refresh, infinite scroll
- **Category** + **difficulty** filter chips
- **Read full article** (opens in-app browser)
- **Save** cards (Saved tab, stored on-device)

## Run it on your phone (free, no deployment)

You need the free **Expo Go** app (iOS App Store / Google Play).

1. **Start the API** on your computer (from the repo root):
   ```
   npm run -w @aishorts/api start
   ```
   (It listens on `0.0.0.0:4000`, so it's reachable on your WiFi.)

2. **Point the app at your computer's IP.** Find it with `ipconfig` (Windows) — the
   IPv4 like `192.168.1.20`. Edit `apps/mobile/.env`:
   ```
   EXPO_PUBLIC_API_URL=http://192.168.1.20:4000
   ```
   (Phone and computer must be on the **same WiFi**. If it can't connect, allow
   Node through the Windows firewall.)

3. **Start the app:**
   ```
   cd apps/mobile
   npx expo start
   ```
   Scan the QR code with Expo Go (Android) or the Camera app (iOS).

### Simulators (alternative, on the computer)
- iOS simulator / web: `EXPO_PUBLIC_API_URL=http://localhost:4000` works.
- Android emulator: use `http://10.0.2.2:4000`.

## Notes
- This app is intentionally **outside** the npm workspace (Expo manages its own
  `node_modules`), so install/run from inside `apps/mobile`.
- No admin features here — content review is the separate admin PWA.
- App icon/splash are still the Expo defaults; swap later in `app.json` + `assets/`.
