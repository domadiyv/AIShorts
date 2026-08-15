import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { CATEGORIES, getApiBase, setApiBase, loadApiBase, DEFAULT_API_URL } from './src/config';
import { fetchFeed, recordEvent, resolveMediaUrl } from './src/api';
import { getBookmarks, toggleBookmark } from './src/bookmarks';
import { getReads, markRead, markReadMany } from './src/reads';
import { AuthProvider, useAuth } from './src/auth';
import type { AuthUser } from './src/api';
import type { Card } from './src/types';

const DIFF_COLORS: Record<string, string> = {
  beginner: '#15803d',
  intermediate: '#b45309',
  advanced: '#b91c1c',
};

type Tab = 'feed' | 'saved' | 'read';

// Human-readable article date, e.g. "Jul 26, 2026". Empty string if unknown.
function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Page through the feed until we collect at least `minUnread` cards the user
// hasn't read yet, or the server runs out. Read cards are filtered client-side,
// so as the local history grows a single page can come back mostly (or entirely)
// filtered out — without this the feed would look empty even though the server
// still has plenty of unread cards. (No-login: history lives only on-device.)
async function fetchUnreadPage(opts: {
  category?: string;
  cursor?: string | null;
  readIds: Set<string>;
  minUnread?: number;
  maxPages?: number;
}): Promise<{ cards: Card[]; nextCursor: string | null }> {
  const minUnread = opts.minUnread ?? 5;
  const maxPages = opts.maxPages ?? 10;
  let cursor: string | undefined = opts.cursor ?? undefined;
  const collected: Card[] = [];
  let nextCursor: string | null = cursor ?? null;
  for (let i = 0; i < maxPages; i++) {
    const res = await fetchFeed({ category: opts.category, cursor });
    nextCursor = res.nextCursor;
    for (const c of res.cards) {
      if (!opts.readIds.has(c.id)) collected.push(c);
    }
    if (!res.nextCursor) break; // no more pages on the server
    cursor = res.nextCursor;
    if (collected.length >= minUnread) break; // enough unread to show
  }
  return { cards: collected, nextCursor };
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipOn]}>
      <Text style={[styles.chipText, active && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

// Dependency-free bottom fade: a stack of same-color layers of increasing height,
// each slightly opaque, so overlap builds up a gradient (opaque at the bottom,
// transparent toward the top). Signals "there's more to scroll" without pulling
// in a native gradient library. `pointerEvents=none` so it never eats scroll.
function ScrollFade({ height = 26, color = '#f5f6f8' }: { height?: number; color?: string }) {
  const layers = 7;
  return (
    <View pointerEvents="none" style={[styles.scrollFade, { height }]}>
      {Array.from({ length: layers }).map((_, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: (height * (i + 1)) / layers,
            backgroundColor: color,
            opacity: 0.22,
          }}
        />
      ))}
    </View>
  );
}

function CardView({
  card,
  height,
  saved,
  onToggleSave,
  onShare,
  onOpen,
}: {
  card: Card;
  height: number;
  saved: boolean;
  onToggleSave: (c: Card) => void;
  onShare: (c: Card) => void;
  onOpen: (c: Card) => void;
}) {
  const date = formatDate(card.publishedAt);
  // Responsive sizing so the full summary stays readable on every screen size.
  // One card == one screen (paged feed), and `height` is the measured card
  // height for THIS device, so deriving sizes from it adapts automatically:
  // small Androids get a tighter layout (more room for text), big iPhones/
  // tablets get larger type. The goal is to fit the whole summary WITHOUT
  // scrolling on typical devices — the image shrinks first — and only fall back
  // to an in-card scroll for the rare very-long-summary / very-short-screen case.
  const short = height > 0 && height < 720; // compact phones (e.g. iPhone SE, small Androids)
  const imageHeight = Math.round(Math.max(80, Math.min(132, height * 0.13)));
  const titleSize = short ? 18 : 21;
  const titleLineHeight = short ? 23 : 27;
  const summarySize = short ? 14 : 16;
  const summaryLineHeight = short ? 20 : 23;

  // The summary lives in a ScrollView so the full text is ALWAYS reachable even
  // when it can't fit. `overflow` tracks whether it actually exceeds the visible
  // box, so the fade/indicator only appear when there's genuinely more to scroll
  // (no misleading fade when everything already fits).
  const [overflow, setOverflow] = useState(false);
  const summaryViewH = useRef(0);
  const onSummaryLayout = (e: LayoutChangeEvent) => {
    summaryViewH.current = e.nativeEvent.layout.height;
  };
  const onSummaryContentSize = (_w: number, h: number) => {
    setOverflow(h > summaryViewH.current + 1);
  };
  return (
    <View style={[styles.card, { height }]}>
      {resolveMediaUrl(card.imageUrl) ? (
        <Image source={{ uri: resolveMediaUrl(card.imageUrl)! }} style={[styles.image, { height: imageHeight }]} />
      ) : null}
      <View style={styles.cardBody}>
        <View style={styles.badges}>
          <View style={styles.badgeGroup}>
            <View style={[styles.badge, { backgroundColor: '#eef2ff' }]}>
              <Text style={[styles.badgeText, { color: '#4338ca' }]}>{card.category}</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: '#f1f3f5' }]}>
              <Text style={[styles.badgeText, { color: DIFF_COLORS[card.difficulty] ?? '#444' }]}>
                {card.difficulty}
              </Text>
            </View>
          </View>
          <View style={styles.cardActions}>
            <Pressable style={styles.iconBtn} onPress={() => onShare(card)} hitSlop={8}>
              <Ionicons
                name={Platform.OS === 'android' ? 'share-social-outline' : 'share-outline'}
                size={19}
                color="#6b7280"
              />
            </Pressable>
            <Pressable
              style={[styles.iconBtn, saved && styles.iconBtnOn]}
              onPress={() => onToggleSave(card)}
              hitSlop={8}
            >
              <Ionicons
                name={saved ? 'star' : 'star-outline'}
                size={19}
                color={saved ? '#2563eb' : '#6b7280'}
              />
            </Pressable>
          </View>
        </View>
        <Text
          style={[styles.title, { fontSize: titleSize, lineHeight: titleLineHeight }]}
          numberOfLines={short ? 3 : 4}
        >
          {card.title}
        </Text>
        {/* The whole summary always fits on typical devices. If it can't (very
            long text on a very short screen), it scrolls IN-CARD — nestedScroll
            is required on Android for a ScrollView inside the paged FlatList, and
            the fade/indicator appear only when there's actually more to see. */}
        <View style={styles.summaryWrap} onLayout={onSummaryLayout}>
          <ScrollView
            style={styles.summaryScroll}
            contentContainerStyle={styles.summaryScrollContent}
            nestedScrollEnabled
            showsVerticalScrollIndicator={overflow}
            indicatorStyle="black"
            onContentSizeChange={onSummaryContentSize}
          >
            <Text style={[styles.summary, { fontSize: summarySize, lineHeight: summaryLineHeight }]}>
              {card.summary}
            </Text>
            {card.whyItMatters ? (
              <Text style={styles.why}>Why it matters: {card.whyItMatters}</Text>
            ) : null}
            <View style={styles.credit}>
              <Text style={styles.creditLabel}>Source</Text>
              <Text style={styles.creditSource} numberOfLines={1}>
                {card.sourceName}
              </Text>
              {date ? <Text style={styles.creditDot}>·</Text> : null}
              {date ? <Text style={styles.creditDate}>{date}</Text> : null}
            </View>
          </ScrollView>
          {overflow ? <ScrollFade /> : null}
        </View>
        <Pressable style={styles.readCta} onPress={() => onOpen(card)}>
          <View style={styles.readCtaText}>
            <Text style={styles.readCtaKicker}>CONTINUE READING</Text>
            <Text style={styles.readCtaTitle} numberOfLines={1}>
              Read the full story on {card.sourceName}
            </Text>
          </View>
          <View style={styles.readCtaArrowWrap}>
            <Text style={styles.readCtaArrow}>→</Text>
          </View>
        </Pressable>
      </View>
    </View>
  );
}

// A single vertically-paged card list. Extracted so each tab can own its own
// FlatList instance — that's what lets the Feed keep its scroll position while
// you visit other tabs (the instance stays mounted, just hidden).
function CardList({
  data,
  feedHeight,
  savedIds,
  refreshing,
  onRefresh,
  onToggleSave,
  onShare,
  onOpen,
  onEndReached,
  onScroll,
}: {
  data: Card[];
  feedHeight: number;
  savedIds: Set<string>;
  refreshing: boolean;
  onRefresh: () => void;
  onToggleSave: (c: Card) => void;
  onShare: (c: Card) => void;
  onOpen: (c: Card) => void;
  onEndReached?: () => void;
  onScroll?: (e: NativeScrollEvent) => void;
}) {
  return (
    <FlatList
      data={data}
      keyExtractor={(c) => c.id}
      pagingEnabled
      showsVerticalScrollIndicator={false}
      snapToInterval={feedHeight}
      decelerationRate="fast"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      onEndReachedThreshold={0.5}
      onEndReached={onEndReached}
      scrollEventThrottle={16}
      onScroll={onScroll ? (e: NativeSyntheticEvent<NativeScrollEvent>) => onScroll(e.nativeEvent) : undefined}
      renderItem={({ item }) => (
        <CardView
          card={item}
          height={feedHeight}
          saved={savedIds.has(item.id)}
          onToggleSave={onToggleSave}
          onShare={onShare}
          onOpen={onOpen}
        />
      )}
    />
  );
}

// Round avatar: photo if we have one, else an initial, else a guest glyph.
function Avatar({ user, size = 36 }: { user: AuthUser | null; size?: number }) {
  const dim = { width: size, height: size, borderRadius: size / 2 };
  if (user?.avatarUrl) return <Image source={{ uri: user.avatarUrl }} style={[styles.avatarImg, dim]} />;
  if (user) {
    const label = (user.name || user.email || '?').trim().charAt(0).toUpperCase();
    return (
      <View style={[styles.avatarCircle, dim]}>
        <Text style={[styles.avatarInitial, { fontSize: size * 0.42 }]}>{label}</Text>
      </View>
    );
  }
  return (
    <View style={[styles.avatarCircle, styles.avatarGuest, dim]}>
      <Text style={{ fontSize: size * 0.5 }}>👤</Text>
    </View>
  );
}

function MenuItem({
  label,
  onPress,
  danger,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable style={styles.menuItem} onPress={onPress}>
      <Text style={[styles.menuItemText, danger && styles.menuItemDanger]}>{label}</Text>
    </Pressable>
  );
}

// Dropdown anchored under the header avatar. Saved + History live here now.
function ProfileMenu({
  user,
  savedCount,
  readCount,
  onClose,
  onNavigate,
  onAuth,
  onLogout,
  onSettings,
}: {
  user: AuthUser | null;
  savedCount: number;
  readCount: number;
  onClose: () => void;
  onNavigate: (tab: Tab) => void;
  onAuth: (mode: 'login' | 'register') => void;
  onLogout: () => void;
  onSettings: () => void;
}) {
  return (
    <>
      <Pressable style={styles.menuBackdrop} onPress={onClose} />
      <View style={styles.menu}>
        {user ? (
          <View style={styles.menuHeader}>
            <Avatar user={user} size={40} />
            <View style={styles.menuHeaderText}>
              <Text style={styles.menuName} numberOfLines={1}>
                {user.name || 'Your account'}
              </Text>
              {user.email ? (
                <Text style={styles.menuEmail} numberOfLines={1}>
                  {user.email}
                </Text>
              ) : null}
            </View>
          </View>
        ) : (
          <View style={styles.menuHeaderText}>
            <Text style={styles.menuName}>Guest</Text>
            <Text style={styles.menuEmail}>Not logged in</Text>
          </View>
        )}
        <View style={styles.menuDivider} />
        <MenuItem label="Feed" onPress={() => onNavigate('feed')} />
        <MenuItem
          label={`Saved${savedCount ? ` (${savedCount})` : ''}`}
          onPress={() => onNavigate('saved')}
        />
        <MenuItem
          label={`History${readCount ? ` (${readCount})` : ''}`}
          onPress={() => onNavigate('read')}
        />
        <View style={styles.menuDivider} />
        <MenuItem label="Settings" onPress={onSettings} />
        <View style={styles.menuDivider} />
        {user ? (
          <MenuItem label="Log out" danger onPress={onLogout} />
        ) : (
          <>
            <MenuItem label="Log in" onPress={() => onAuth('login')} />
            <MenuItem label="Register" onPress={() => onAuth('register')} />
          </>
        )}
      </View>
    </>
  );
}

// Map API error codes to human-readable messages.
function friendlyError(code?: string): string {
  switch (code) {
    case 'email_taken':
      return 'That email is already registered — try logging in.';
    case 'invalid_credentials':
      return 'Wrong email or password.';
    case 'invalid_registration':
      return 'Enter a valid email and a password of at least 8 characters.';
    case 'invalid_login':
      return 'Enter your email and password.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

// Login / Register overlay with a "Continue with Google" button.
function AuthModal({
  mode,
  onClose,
  onSwitchMode,
}: {
  mode: 'login' | 'register';
  onClose: () => void;
  onSwitchMode: (m: 'login' | 'register') => void;
}) {
  const { login, register, signInWithGoogle } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isRegister = mode === 'register';

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (isRegister) await register(email.trim(), password, name.trim() || undefined);
      else await login(email.trim(), password);
      onClose();
    } catch (e) {
      setError(friendlyError(e instanceof Error ? e.message : undefined));
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
      onClose();
    } catch (e) {
      setError(friendlyError(e instanceof Error ? e.message : undefined));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.modalOverlay}>
      <Pressable style={styles.modalBackdrop} onPress={onClose} />
      <View style={styles.modalCard}>
        <Pressable onPress={onClose} style={styles.modalClose} hitSlop={10}>
          <Text style={styles.modalCloseText}>✕</Text>
        </Pressable>
        <Text style={styles.modalTitle}>{isRegister ? 'Create your account' : 'Welcome back'}</Text>
        <Text style={styles.modalSub}>
          {isRegister
            ? 'Register to keep your saved shorts and history.'
            : 'Log in to continue.'}
        </Text>

        <Pressable style={styles.googleBtn} onPress={google} disabled={busy}>
          <View style={styles.googleG}>
            <Text style={styles.googleGText}>G</Text>
          </View>
          <Text style={styles.googleBtnText}>Continue with Google</Text>
        </Pressable>

        <View style={styles.orRow}>
          <View style={styles.orLine} />
          <Text style={styles.orText}>or</Text>
          <View style={styles.orLine} />
        </View>

        {isRegister ? (
          <TextInput
            style={styles.input}
            placeholder="Name (optional)"
            placeholderTextColor="#9aa3b2"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
          />
        ) : null}
        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="#9aa3b2"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
        />
        <TextInput
          style={styles.input}
          placeholder={isRegister ? 'Password (min 8 characters)' : 'Password'}
          placeholderTextColor="#9aa3b2"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          onSubmitEditing={submit}
        />

        {error ? <Text style={styles.modalError}>{error}</Text> : null}

        <Pressable
          style={[styles.primaryBtn, busy && styles.primaryBtnDisabled]}
          onPress={submit}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryBtnText}>{isRegister ? 'Create account' : 'Log in'}</Text>
          )}
        </Pressable>

        <Pressable
          onPress={() => onSwitchMode(isRegister ? 'login' : 'register')}
          style={styles.switchRow}
        >
          <Text style={styles.switchText}>
            {isRegister ? 'Already have an account? Log in' : 'New here? Create an account'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// Runtime API URL override. Lets a single installed build point at the Mac tunnel
// now and a cloud URL later WITHOUT rebuilding. Saving reloads the feed so the
// change takes effect immediately.
function SettingsModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [url, setUrl] = useState(getApiBase());
  const [busy, setBusy] = useState(false);

  const save = async (value: string) => {
    setBusy(true);
    try {
      await setApiBase(value);
      onSaved();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.modalOverlay}>
      <Pressable style={styles.modalBackdrop} onPress={onClose} />
      <View style={styles.modalCard}>
        <Pressable onPress={onClose} style={styles.modalClose} hitSlop={10}>
          <Text style={styles.modalCloseText}>✕</Text>
        </Pressable>
        <Text style={styles.modalTitle}>Server settings</Text>
        <Text style={styles.modalSub}>
          Point the app at your backend. Use the HTTPS tunnel to your Mac now, or a
          cloud URL later — no reinstall needed.
        </Text>

        <TextInput
          style={styles.input}
          placeholder="https://your-backend.example.com"
          placeholderTextColor="#9aa3b2"
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          onSubmitEditing={() => save(url)}
        />

        <Text style={styles.settingsHint}>Default: {DEFAULT_API_URL}</Text>

        <Pressable
          style={[styles.primaryBtn, busy && styles.primaryBtnDisabled]}
          onPress={() => save(url)}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryBtnText}>Save & reload</Text>
          )}
        </Pressable>

        <Pressable onPress={() => save('')} style={styles.switchRow} disabled={busy}>
          <Text style={styles.switchText}>Reset to default</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Feed() {
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register' | null>(null);
  const [tab, setTab] = useState<Tab>('feed');
  const [category, setCategory] = useState<string | undefined>();
  const [cards, setCards] = useState<Card[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [bookmarks, setBookmarks] = useState<Card[]>([]);
  const [reads, setReads] = useState<Card[]>([]);
  const [feedHeight, setFeedHeight] = useState(0);

  const savedIds = useMemo(() => new Set(bookmarks.map((c) => c.id)), [bookmarks]);

  // View tracking for the feed: scrolling past a card marks it read (it moves to
  // the Read tab immediately), but the card stays in the current session's feed
  // until the next refresh — so the list doesn't reshuffle under your finger.
  const feedCardsRef = useRef<Card[]>([]);
  const feedHeightRef = useRef(0);
  // Highest card index reached so far (starts at the first card, index 0).
  const maxSeenRef = useRef(0);
  const onFeedScroll = useRef((e: NativeScrollEvent) => {
    const h = feedHeightRef.current;
    if (h <= 0) return;
    const idx = Math.round(e.contentOffset.y / h); // card currently on screen
    if (idx <= maxSeenRef.current) return;
    // Cards between the previous high-water mark and the current card have been
    // scrolled past → mark them read.
    const passed = feedCardsRef.current.slice(maxSeenRef.current, idx);
    maxSeenRef.current = idx;
    if (passed.length) markReadMany(passed).then(setReads);
  }).current;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const currentReads = await getReads();
      const readSet = new Set(currentReads.map((c) => c.id));
      setReads(currentReads);
      // Filter already-read cards out at fetch time (not live), so opening or
      // scrolling past a card doesn't yank it from under you mid-session. Page
      // ahead so a large history doesn't leave the first page empty.
      const res = await fetchUnreadPage({ category, readIds: readSet });
      setCards(res.cards);
      setNextCursor(res.nextCursor);
      maxSeenRef.current = 0;
    } catch {
      setCards([]);
      setNextCursor(null);
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    getBookmarks().then(setBookmarks);
    getReads().then(setReads);
  }, []);

  // Keep the ref the viewability callback reads in sync with the feed data.
  useEffect(() => {
    feedCardsRef.current = cards;
  }, [cards]);

  // Pull-to-refresh: re-fetch whichever list the active tab is showing.
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (tab === 'saved') {
        setBookmarks(await getBookmarks());
      } else if (tab === 'read') {
        setReads(await getReads());
      } else {
        const currentReads = await getReads();
        const readSet = new Set(currentReads.map((c) => c.id));
        setReads(currentReads);
        const res = await fetchUnreadPage({ category, readIds: readSet });
        setCards(res.cards);
        setNextCursor(res.nextCursor);
        maxSeenRef.current = 0;
      }
    } catch {
      /* keep existing */
    } finally {
      setRefreshing(false);
    }
  }, [tab, category]);

  const loadMore = useCallback(async () => {
    if (tab !== 'feed' || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const currentReads = await getReads();
      const readSet = new Set(currentReads.map((c) => c.id));
      const res = await fetchUnreadPage({ category, cursor: nextCursor, readIds: readSet });
      // Dedup against what's already on screen (paging overlap is possible).
      setCards((prev) => {
        const existing = new Set(prev.map((c) => c.id));
        return [...prev, ...res.cards.filter((c) => !existing.has(c.id))];
      });
      setNextCursor(res.nextCursor);
    } catch {
      /* ignore */
    } finally {
      setLoadingMore(false);
    }
  }, [tab, nextCursor, loadingMore, category]);

  const onToggleSave = useCallback((card: Card) => {
    toggleBookmark(card).then(setBookmarks);
    recordEvent(card.id, 'bookmark');
  }, []);

  const onShare = useCallback((card: Card) => {
    recordEvent(card.id, 'share');
    const url = card.sourceUrl;
    if (Platform.OS === 'web') {
      // Prefer the native Web Share sheet; fall back to copying the link.
      const nav = globalThis.navigator as
        | { share?: (d: { title?: string; url?: string }) => Promise<void>; clipboard?: { writeText: (s: string) => Promise<void> } }
        | undefined;
      if (nav?.share) nav.share({ title: card.title, url }).catch(() => {});
      else if (nav?.clipboard) nav.clipboard.writeText(url).catch(() => {});
      return;
    }
    Share.share({ title: card.title, message: `${card.title} — ${url}`, url }).catch(() => {});
  }, []);

  const onOpen = useCallback((card: Card) => {
    recordEvent(card.id, 'read_more');
    // Opening an article marks it read → it leaves the feed and moves to Read.
    markRead(card).then(setReads);
    WebBrowser.openBrowserAsync(card.sourceUrl).catch(() => {});
  }, []);

  const onFeedLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    feedHeightRef.current = h;
    setFeedHeight(h);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <View style={styles.brandBlock}>
            <Text style={styles.brand}>AIShorts</Text>
            <Text style={styles.tagline}>All about AI news</Text>
          </View>
          <View style={styles.avatarWrap}>
            <Pressable onPress={() => setMenuOpen((o) => !o)} hitSlop={8}>
              <Avatar user={user} />
            </Pressable>
            {menuOpen ? (
              <ProfileMenu
                user={user}
                savedCount={bookmarks.length}
                readCount={reads.length}
                onClose={() => setMenuOpen(false)}
                onNavigate={(t) => {
                  setTab(t);
                  setMenuOpen(false);
                }}
                onAuth={(m) => {
                  setAuthMode(m);
                  setMenuOpen(false);
                }}
                onLogout={() => {
                  logout();
                  setMenuOpen(false);
                }}
                onSettings={() => {
                  setSettingsOpen(true);
                  setMenuOpen(false);
                }}
              />
            ) : null}
          </View>
        </View>
        {tab === 'feed' ? (
          <View style={styles.filterRow}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.chipRow}
              contentContainerStyle={styles.chipRowContent}
            >
              <Chip label="All" active={!category} onPress={() => setCategory(undefined)} />
              {CATEGORIES.map((c) => (
                <Chip
                  key={c}
                  label={c}
                  active={category === c}
                  onPress={() => setCategory(category === c ? undefined : c)}
                />
              ))}
            </ScrollView>
          </View>
        ) : (
          <View style={styles.subHeader}>
            <Pressable style={styles.backBtn} onPress={() => setTab('feed')} hitSlop={8}>
              <Text style={styles.backBtnText}>← Feed</Text>
            </Pressable>
            <Text style={styles.subHeaderTitle}>{tab === 'saved' ? 'Saved' : 'History'}</Text>
          </View>
        )}
      </View>

      <View style={styles.feedArea} onLayout={onFeedLayout}>
        {feedHeight > 0 ? (
          <>
            {/* Feed layer stays mounted (just hidden) when other tabs are active,
                so its scroll position is preserved when you come back. */}
            <View
              style={[styles.tabLayer, tab !== 'feed' && styles.hidden]}
              pointerEvents={tab === 'feed' ? 'auto' : 'none'}
            >
              {loading ? (
                <View style={styles.center}>
                  <ActivityIndicator />
                </View>
              ) : cards.length === 0 ? (
                <View style={styles.center}>
                  <Text style={styles.empty}>No cards. Pull to refresh.</Text>
                </View>
              ) : (
                <CardList
                  data={cards}
                  feedHeight={feedHeight}
                  savedIds={savedIds}
                  refreshing={refreshing}
                  onRefresh={onRefresh}
                  onToggleSave={onToggleSave}
                  onShare={onShare}
                  onOpen={onOpen}
                  onEndReached={loadMore}
                  onScroll={onFeedScroll}
                />
              )}
            </View>

            {tab === 'saved' ? (
              <View style={styles.tabLayer}>
                {bookmarks.length === 0 ? (
                  <View style={styles.center}>
                    <Text style={styles.empty}>No saved shorts yet. Tap ☆ Save on a card.</Text>
                  </View>
                ) : (
                  <CardList
                    data={bookmarks}
                    feedHeight={feedHeight}
                    savedIds={savedIds}
                    refreshing={refreshing}
                    onRefresh={onRefresh}
                    onToggleSave={onToggleSave}
                    onShare={onShare}
                    onOpen={onOpen}
                  />
                )}
              </View>
            ) : null}

            {tab === 'read' ? (
              <View style={styles.tabLayer}>
                {reads.length === 0 ? (
                  <View style={styles.center}>
                    <Text style={styles.empty}>
                      Nothing here yet. Scroll through the feed or open a card and it lands in
                      your history.
                    </Text>
                  </View>
                ) : (
                  <CardList
                    data={reads}
                    feedHeight={feedHeight}
                    savedIds={savedIds}
                    refreshing={refreshing}
                    onRefresh={onRefresh}
                    onToggleSave={onToggleSave}
                    onShare={onShare}
                    onOpen={onOpen}
                  />
                )}
              </View>
            ) : null}
          </>
        ) : null}
      </View>

      {authMode ? (
        <AuthModal
          mode={authMode}
          onClose={() => setAuthMode(null)}
          onSwitchMode={setAuthMode}
        />
      ) : null}

      {settingsOpen ? (
        <SettingsModal onClose={() => setSettingsOpen(false)} onSaved={load} />
      ) : null}
    </View>
  );
}

export default function App() {
  // Load any persisted API URL override before the first request fires, so the
  // feed talks to the right backend from the very first fetch.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    loadApiBase().finally(() => setReady(true));
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {ready ? (
        <AuthProvider>
          <Feed />
        </AuthProvider>
      ) : (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f5f6f8' },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e6e8ec',
    zIndex: 30, // keep the Levels dropdown above the feed list
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 6,
  },
  brandBlock: { flexDirection: 'row', alignItems: 'baseline', gap: 8, flex: 1 },
  brand: { fontSize: 22, fontWeight: '700', color: '#14161a', letterSpacing: -0.5 },
  tagline: { fontSize: 12, color: '#6b7280' },
  // Avatar + profile menu
  avatarWrap: { position: 'relative', zIndex: 50 },
  avatarImg: { backgroundColor: '#e9edf2' },
  avatarCircle: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#2563eb' },
  avatarGuest: { backgroundColor: '#eceef2', borderWidth: 1, borderColor: '#dfe3e8' },
  avatarInitial: { color: '#ffffff', fontWeight: '700' },
  menuBackdrop: {
    position: 'absolute',
    top: -1000,
    left: -1000,
    right: -1000,
    bottom: -1000,
    zIndex: 49,
  },
  menu: {
    position: 'absolute',
    top: 44,
    right: 0,
    minWidth: 220,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e6e8ec',
    paddingVertical: 6,
    zIndex: 51,
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  menuHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  menuHeaderText: { flex: 1, paddingHorizontal: 14, paddingVertical: 8 },
  menuName: { fontSize: 15, fontWeight: '700', color: '#14161a' },
  menuEmail: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  menuDivider: { height: 1, backgroundColor: '#eef0f3', marginVertical: 4 },
  menuItem: { paddingHorizontal: 14, paddingVertical: 11 },
  menuItemText: { fontSize: 15, color: '#23262b', fontWeight: '600' },
  menuItemDanger: { color: '#b91c1c' },
  // Sub-header for Saved / History views
  subHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 },
  backBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: '#eceef2',
  },
  backBtnText: { fontSize: 13, color: '#374151', fontWeight: '600' },
  subHeaderTitle: { fontSize: 16, fontWeight: '700', color: '#14161a' },
  filterRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8, zIndex: 30 },
  chipRow: { flex: 1 },
  chipRowContent: { alignItems: 'center' },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: '#eceef2',
    marginRight: 6,
  },
  chipOn: { backgroundColor: '#2563eb' },
  chipText: { fontSize: 13, color: '#374151', textTransform: 'capitalize' },
  chipTextOn: { color: '#ffffff' },
  feedArea: { flex: 1, position: 'relative' },
  tabLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  hidden: { display: 'none' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  empty: { color: '#6b7280', textAlign: 'center', fontSize: 15 },
  card: { paddingHorizontal: 16, paddingTop: 14 },
  // height is set responsively inline (per device) in CardView.
  image: { width: '100%', borderRadius: 14, backgroundColor: '#e9edf2', marginBottom: 10 },
  cardBody: { flex: 1, paddingBottom: 12 },
  badges: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  badgeGroup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f1f3f5',
    borderWidth: 1,
    borderColor: '#e6e8ec',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnOn: { backgroundColor: '#eff4ff', borderColor: '#bfd3ff' },
  badge: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: 6 },
  badgeText: { fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
  title: {
    // fontSize / lineHeight set responsively inline in CardView.
    fontWeight: '700',
    color: '#14161a',
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  // Wrapper gives the fade an anchor at the bottom of the scroll region.
  summaryWrap: { flex: 1, position: 'relative' },
  summaryScroll: { flex: 1 },
  // Bottom padding so the last line clears the fade overlay and the CTA.
  summaryScrollContent: { paddingBottom: 22 },
  scrollFade: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  summary: { color: '#23262b' }, // fontSize / lineHeight set responsively inline
  why: { fontSize: 13, color: '#6b7280', marginTop: 10, fontStyle: 'italic', lineHeight: 19 },
  // Source label + source name + article date — one baseline, cohesive type.
  credit: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 12 },
  creditLabel: { fontSize: 12, lineHeight: 16, color: '#9aa3b2', fontWeight: '500' },
  creditSource: { fontSize: 12, lineHeight: 16, fontWeight: '600', color: '#6b7280', flexShrink: 1 },
  creditDot: { fontSize: 12, lineHeight: 16, color: '#c2c8d0' },
  creditDate: { fontSize: 12, lineHeight: 16, color: '#9aa3b2', fontWeight: '500' },
  // Full-width "read full article" call to action
  readCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#2563eb',
    borderRadius: 16,
    paddingVertical: 13,
    paddingHorizontal: 18,
    marginTop: 12,
    shadowColor: '#2563eb',
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  readCtaText: { flex: 1, marginRight: 12 },
  readCtaKicker: {
    fontSize: 11,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.72)',
    letterSpacing: 1.4,
    marginBottom: 3,
  },
  readCtaTitle: { fontSize: 16, fontWeight: '700', color: '#ffffff', letterSpacing: -0.2 },
  readCtaArrowWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  readCtaArrow: { fontSize: 18, color: '#ffffff', fontWeight: '700' },
  // Auth modal
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    zIndex: 100,
  },
  modalBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15,18,25,0.45)',
  },
  modalCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 24,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 16,
  },
  modalClose: { position: 'absolute', top: 14, right: 16, padding: 4, zIndex: 2 },
  modalCloseText: { fontSize: 18, color: '#9aa3b2', fontWeight: '600' },
  modalTitle: { fontSize: 22, fontWeight: '700', color: '#14161a', letterSpacing: -0.3 },
  modalSub: { fontSize: 14, color: '#6b7280', marginTop: 6, marginBottom: 18 },
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#dfe3e8',
    backgroundColor: '#ffffff',
  },
  googleG: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e6e8ec',
  },
  googleGText: { fontSize: 13, fontWeight: '800', color: '#4285F4' },
  googleBtnText: { fontSize: 15, fontWeight: '600', color: '#374151' },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 16 },
  orLine: { flex: 1, height: 1, backgroundColor: '#e6e8ec' },
  orText: { fontSize: 12, color: '#9aa3b2' },
  input: {
    borderWidth: 1,
    borderColor: '#dfe3e8',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#14161a',
    marginBottom: 10,
    backgroundColor: '#fbfcfd',
  },
  modalError: { color: '#b91c1c', fontSize: 13, marginBottom: 8, marginTop: 2 },
  primaryBtn: {
    backgroundColor: '#2563eb',
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    minHeight: 46,
  },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  switchRow: { alignItems: 'center', marginTop: 16 },
  switchText: { fontSize: 14, color: '#2563eb', fontWeight: '600' },
  settingsHint: { fontSize: 12, color: '#9aa3b2', marginTop: 10, marginBottom: 4 },
});
