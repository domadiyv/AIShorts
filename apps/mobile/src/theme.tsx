import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Theme preference. 'system' follows the OS light/dark setting; the other two
// pin a scheme regardless of the OS. Persisted on-device so it survives restarts.
export type ThemeMode = 'light' | 'dark' | 'system';
export type Scheme = 'light' | 'dark';

// Every color the UI needs, resolved for the active scheme. Components read tokens
// off this object (via useTheme) instead of hardcoding hex, so a single palette
// swap re-themes the whole app.
export type Palette = {
  scheme: Scheme;
  bg: string; // app / feed background
  surface: string; // cards, header, menus, modals
  surfaceAlt: string; // chips, back button, dividers-on-surface
  surfaceMuted: string; // icon buttons, muted chips
  inputBg: string;
  border: string;
  borderMuted: string;
  inputBorder: string;
  text: string; // primary text
  textStrong: string; // body copy
  textMuted: string; // secondary text
  textFaint: string; // tertiary (dates, hints, placeholders)
  textFaint2: string; // separators between meta
  primary: string; // accent
  primaryText: string; // text/icon on primary
  danger: string;
  catBg: string; // category badge background
  catText: string; // category badge text
  icon: string; // default icon color
  overlay: string; // modal backdrop
  scrollIndicator: 'black' | 'white';
};

const light: Palette = {
  scheme: 'light',
  bg: '#f5f6f8',
  surface: '#ffffff',
  surfaceAlt: '#eceef2',
  surfaceMuted: '#f1f3f5',
  inputBg: '#fbfcfd',
  border: '#e6e8ec',
  borderMuted: '#eef0f3',
  inputBorder: '#dfe3e8',
  text: '#14161a',
  textStrong: '#23262b',
  textMuted: '#6b7280',
  textFaint: '#9aa3b2',
  textFaint2: '#c2c8d0',
  primary: '#2563eb',
  primaryText: '#ffffff',
  danger: '#b91c1c',
  catBg: '#eef2ff',
  catText: '#4338ca',
  icon: '#6b7280',
  overlay: 'rgba(15,18,25,0.45)',
  scrollIndicator: 'black',
};

const dark: Palette = {
  scheme: 'dark',
  bg: '#0e1116',
  surface: '#171a21',
  surfaceAlt: '#242832',
  surfaceMuted: '#1f232b',
  inputBg: '#1b1f27',
  border: '#2a2f3a',
  borderMuted: '#242832',
  inputBorder: '#333a47',
  text: '#f2f4f8',
  textStrong: '#e4e7ec',
  textMuted: '#9aa3b2',
  textFaint: '#7b8494',
  textFaint2: '#4b5563',
  primary: '#3b82f6',
  primaryText: '#ffffff',
  danger: '#f87171',
  catBg: '#20284a',
  catText: '#a5b4fc',
  icon: '#9aa3b2',
  overlay: 'rgba(0,0,0,0.62)',
  scrollIndicator: 'white',
};

const KEY = 'aishorts.theme.v1';

type ThemeContextValue = { mode: ThemeMode; colors: Palette; setMode: (m: ThemeMode) => void };

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme(); // 'light' | 'dark' | null
  const [mode, setModeState] = useState<ThemeMode>('system');

  // Restore the saved preference on mount.
  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((v) => {
        if (v === 'light' || v === 'dark' || v === 'system') setModeState(v);
      })
      .catch(() => {
        /* ignore — default to system */
      });
  }, []);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    AsyncStorage.setItem(KEY, m).catch(() => {
      /* in-memory value still applies this session */
    });
  }, []);

  const scheme: Scheme = mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : mode;
  const colors = scheme === 'dark' ? dark : light;

  const value = useMemo<ThemeContextValue>(() => ({ mode, colors, setMode }), [mode, colors, setMode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
