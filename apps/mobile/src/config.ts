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

/** Current API base (honors the runtime override). Use this for all requests. */
export function getApiBase(): string {
  return currentApiUrl;
}

/** Load any saved override into memory. Call once before the first request. */
export async function loadApiBase(): Promise<string> {
  try {
    const saved = await AsyncStorage.getItem(API_URL_KEY);
    if (saved && saved.trim()) currentApiUrl = normalize(saved);
  } catch {
    // ignore — fall back to the compile-time default
  }
  return currentApiUrl;
}

/** Persist a new API base (empty string clears the override → back to default). */
export async function setApiBase(url: string): Promise<string> {
  const next = normalize(url);
  currentApiUrl = next || DEFAULT_API_URL;
  try {
    if (next) await AsyncStorage.setItem(API_URL_KEY, next);
    else await AsyncStorage.removeItem(API_URL_KEY);
  } catch {
    // ignore write failures — the in-memory value still applies this session
  }
  return currentApiUrl;
}

export const CATEGORIES = ['Models', 'Tools', 'Research', 'Business', 'Policy', 'How-to'] as const;
export const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'] as const;
