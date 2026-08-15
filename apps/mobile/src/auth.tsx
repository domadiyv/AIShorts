import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiGoogle, apiLogin, apiRegister, type AuthUser } from './api';

// Real Google Sign-In (native). expo-auth-session's Google provider is deprecated
// in SDK 54; Google/Expo now recommend this library. It needs a native build
// (our local APK via `expo prebuild` — not Expo Go), so we import it lazily and
// fall back to the mock identity when it's unavailable (e.g. web/Expo Go) or when
// no web client ID is configured.
//
// GOOGLE_WEB_CLIENT_ID must be the OAuth "Web application" client ID, and must
// match the server's GOOGLE_CLIENT_ID (the id_token's `aud`). The Android OAuth
// client (registered with the APK's SHA-1) makes native sign-in work but isn't
// passed here — Google matches it by package name + SHA-1.
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? '';
const googleConfigured = GOOGLE_WEB_CLIENT_ID.length > 0 && Platform.OS !== 'web';

// Persist the session so the user stays logged in across app restarts.
const TOKEN_KEY = 'aishorts.auth.token.v1';
const USER_KEY = 'aishorts.auth.user.v1';

type AuthContextValue = {
  user: AuthUser | null;
  token: string | null;
  loading: boolean; // true only during the initial session restore
  register: (email: string, password: string, name?: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

// UTF-8-safe base64url. Used to build the mock Google ID token below.
function toBase64Url(s: string): string {
  const bytes = encodeURIComponent(s).replace(/%([0-9A-F]{2})/g, (_, h) =>
    String.fromCharCode(parseInt(h, 16)),
  );
  const b64 =
    typeof btoa !== 'undefined'
      ? btoa(bytes)
      : // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).Buffer.from(s, 'utf8').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// A stable demo identity so repeated "Continue with Google" taps resolve to the
// same account. To go live: create an OAuth client, set EXPO_PUBLIC_GOOGLE_CLIENT_ID
// (client) + GOOGLE_CLIENT_ID (server), and replace this mock token with a real
// Google id_token obtained via expo-auth-session. The server already verifies
// real tokens when GOOGLE_CLIENT_ID is set.
const MOCK_GOOGLE_IDENTITY = {
  sub: 'google-demo-user',
  email: 'demo.google@gmail.com',
  name: 'Demo Google User',
  picture: 'https://i.pravatar.cc/150?img=68',
};

// Configure the native Google client once (idempotent-ish; cheap to repeat).
let googleConfigured_ = false;
function configureGoogle(mod: typeof import('@react-native-google-signin/google-signin')): void {
  if (googleConfigured_) return;
  mod.GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });
  googleConfigured_ = true;
}

// Run the real native Google flow and return a Google id_token, or null if the
// native module isn't available in this build (falls back to the mock).
async function nativeGoogleIdToken(): Promise<string | null> {
  if (!googleConfigured) return null;
  let mod: typeof import('@react-native-google-signin/google-signin');
  try {
    // Lazy require: importing the native module on web/Expo Go would throw.
    mod = require('@react-native-google-signin/google-signin');
  } catch {
    return null;
  }
  configureGoogle(mod);
  await mod.GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const res = await mod.GoogleSignin.signIn();
  if (mod.isSuccessResponse(res)) {
    return res.data.idToken ?? (await mod.GoogleSignin.getTokens()).idToken ?? null;
  }
  // User cancelled the sheet.
  throw new Error('google_cancelled');
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore any saved session on mount.
  useEffect(() => {
    (async () => {
      try {
        const [t, u] = await Promise.all([
          AsyncStorage.getItem(TOKEN_KEY),
          AsyncStorage.getItem(USER_KEY),
        ]);
        if (t && u) {
          setToken(t);
          setUser(JSON.parse(u) as AuthUser);
        }
      } catch {
        /* ignore — start logged out */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const persist = useCallback(async (res: { token: string; user: AuthUser }) => {
    setToken(res.token);
    setUser(res.user);
    await AsyncStorage.multiSet([
      [TOKEN_KEY, res.token],
      [USER_KEY, JSON.stringify(res.user)],
    ]);
  }, []);

  const register = useCallback(
    async (email: string, password: string, name?: string) => {
      await persist(await apiRegister({ email, password, name }));
    },
    [persist],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      await persist(await apiLogin({ email, password }));
    },
    [persist],
  );

  const signInWithGoogle = useCallback(async () => {
    // Real native Google when configured; otherwise the mock demo identity so the
    // web preview and unconfigured dev builds still work.
    const realToken = await nativeGoogleIdToken();
    const idToken = realToken ?? toBase64Url(JSON.stringify(MOCK_GOOGLE_IDENTITY));
    await persist(await apiGoogle(idToken));
  }, [persist]);

  const logout = useCallback(async () => {
    setToken(null);
    setUser(null);
    await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY]);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, token, loading, register, login, signInWithGoogle, logout }),
    [user, token, loading, register, login, signInWithGoogle, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
