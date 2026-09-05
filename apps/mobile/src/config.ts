import AsyncStorage from '@react-native-async-storage/async-storage';

// Compile-time default. Expo inlines EXPO_PUBLIC_* at build time, so this is the
// URL baked into a shipped APK. For device testing, build with your tunnel URL:
//   EXPO_PUBLIC_API_URL=https://<tunnel-host> npx expo prebuild ...
export const DEFAULT_API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

const API_URL_KEY = 'aishorts.apiurl.v1';

// Runtime override (persisted on-device). Lets a single installed build point at
// a Mac tunnel now and a cloud URL later WITHOUT rebuilding — set it from the
// in-app Settings screen. loadApiBase() must run once at startup.
let currentApiUrl = DEFAULT_API_URL;

function normalize(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

// In release builds only HTTPS is permitted — cleartext HTTP is disabled at the
// native layer (Android network-security-config + iOS ATS) for store compliance,
// so an http:// API base simply wouldn't connect. In dev we allow http so the
// emulator/simulator can reach a local server. Empty string = clear override.
export function isAllowedApiUrl(url: string): boolean {
  const u = normalize(url);
  if (!u) return true;
  if (__DEV__) return /^https?:\/\//i.test(u);
  return /^https:\/\//i.test(u);
}

/** Current API base (honors the runtime override). Use this for all requests. */
export function getApiBase(): string {
  return currentApiUrl;
}

/** Load any saved override into memory. Call once before the first request. */
export async function loadApiBase(): Promise<string> {
  try {
    const saved = await AsyncStorage.getItem(API_URL_KEY);
    // Ignore a stale http:// override in a release build — it can't connect and
    // would silently break the app.
    if (saved && saved.trim() && isAllowedApiUrl(saved)) currentApiUrl = normalize(saved);
  } catch {
    // ignore — fall back to the compile-time default
  }
  return currentApiUrl;
}

/**
 * Persist a new API base (empty string clears the override → back to default).
 * Rejects a non-HTTPS URL in release builds (throws) so the user gets a clear
 * error instead of a silently-dead connection.
 */
export async function setApiBase(url: string): Promise<string> {
  const next = normalize(url);
  if (!isAllowedApiUrl(next)) {
    throw new Error('Enter an https:// URL — plain http is not allowed.');
  }
  currentApiUrl = next || DEFAULT_API_URL;
  try {
    if (next) await AsyncStorage.setItem(API_URL_KEY, next);
    else await AsyncStorage.removeItem(API_URL_KEY);
  } catch {
    // ignore write failures — the in-memory value still applies this session
  }
  return currentApiUrl;
}

// Fallback category chips. The live list is fetched from GET /v1/categories at
// startup (so admin-added categories show up); this covers the offline/first-load
// case and keeps the type stable.
export const CATEGORIES = ['Models', 'Tools', 'Research', 'Business', 'Policy', 'How-to'] as const;
