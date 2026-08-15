import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiGoogle, apiLogin, apiRegister, type AuthUser } from './api';

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
    const idToken = toBase64Url(JSON.stringify(MOCK_GOOGLE_IDENTITY));
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
