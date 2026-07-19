import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
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
import * as WebBrowser from 'expo-web-browser';
import { CATEGORIES, DIFFICULTIES } from './src/config';
import { fetchFeed, recordEvent } from './src/api';
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

// The difficulty picker options: "All levels" (undefined) + the real levels.
const LEVEL_OPTIONS: { label: string; value: string | undefined }[] = [
  { label: 'All levels', value: undefined },
  ...DIFFICULTIES.map((d) => ({ label: d[0].toUpperCase() + d.slice(1), value: d as string })),
];

// Compact difficulty dropdown: opens on tap (all platforms) and on hover (web),
// and applies the selection immediately. Replaces the old always-on level row.
function LevelsDropdown({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = LEVEL_OPTIONS.find((o) => o.value === value) ?? LEVEL_OPTIONS[0];
  return (
    <View style={styles.levels}>
      <Pressable
        style={[styles.levelsBtn, !!value && styles.levelsBtnOn]}
        onPress={() => setOpen((o) => !o)}
        onHoverIn={() => setOpen(true)}
      >
        <Text style={[styles.levelsBtnText, !!value && styles.levelsBtnTextOn]}>
          {current.label} ▾
        </Text>
      </Pressable>
      {open ? (
        <>
          <Pressable style={styles.levelsBackdrop} onPress={() => setOpen(false)} />
          <View style={styles.levelsMenu}>
            {LEVEL_OPTIONS.map((o) => {
              const active = o.value === value;
              return (
                <Pressable
                  key={o.label}
                  style={[styles.levelsItem, active && styles.levelsItemOn]}
                  onPress={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                >
                  <Text style={[styles.levelsItemText, active && styles.levelsItemTextOn]}>
                    {o.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipOn]}>
      <Text style={[styles.chipText, active && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

function CardView({
  card,
  height,
  saved,
  onToggleSave,
  onOpen,
}: {
  card: Card;
  height: number;
  saved: boolean;
  onToggleSave: (c: Card) => void;
  onOpen: (c: Card) => void;
}) {
  return (
    <View style={[styles.card, { height }]}>
      {card.imageUrl ? <Image source={{ uri: card.imageUrl }} style={styles.image} /> : null}
      <View style={styles.cardBody}>
        <View style={styles.badges}>
          <View style={[styles.badge, { backgroundColor: '#eef2ff' }]}>
            <Text style={[styles.badgeText, { color: '#4338ca' }]}>{card.category}</Text>
          </View>
          <View style={[styles.badge, { backgroundColor: '#f1f3f5' }]}>
            <Text style={[styles.badgeText, { color: DIFF_COLORS[card.difficulty] ?? '#444' }]}>
              {card.difficulty}
            </Text>
          </View>
        </View>
        <Text style={styles.title}>{card.title}</Text>
        <ScrollView style={styles.summaryScroll} showsVerticalScrollIndicator={false}>
          <Text style={styles.summary}>{card.summary}</Text>
          {card.whyItMatters ? (
            <Text style={styles.why}>Why it matters: {card.whyItMatters}</Text>
          ) : null}
        </ScrollView>
        <View style={styles.foot}>
          <Text style={styles.src} numberOfLines={1}>
            {card.sourceName}
          </Text>
          <View style={styles.footActions}>
            <Pressable onPress={() => onToggleSave(card)} hitSlop={10}>
              <Text style={[styles.save, saved && styles.saveOn]}>
                {saved ? '★ Saved' : '☆ Save'}
              </Text>
            </Pressable>
            <Pressable onPress={() => onOpen(card)} hitSlop={10}>
              <Text style={styles.read}>Read full →</Text>
            </Pressable>
          </View>
        </View>
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
}: {
  user: AuthUser | null;
  savedCount: number;
  readCount: number;
  onClose: () => void;
  onNavigate: (tab: Tab) => void;
  onAuth: (mode: 'login' | 'register') => void;
  onLogout: () => void;
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

function Feed() {
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register' | null>(null);
  const [tab, setTab] = useState<Tab>('feed');
  const [category, setCategory] = useState<string | undefined>();
  const [difficulty, setDifficulty] = useState<string | undefined>();
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
      const [res, currentReads] = await Promise.all([fetchFeed({ category, difficulty }), getReads()]);
      const readSet = new Set(currentReads.map((c) => c.id));
      setReads(currentReads);
      // Filter already-read cards out at fetch time (not live), so opening or
      // scrolling past a card doesn't yank it from under you mid-session.
      setCards(res.cards.filter((c) => !readSet.has(c.id)));
      setNextCursor(res.nextCursor);
      maxSeenRef.current = 0;
    } catch {
      setCards([]);
      setNextCursor(null);
    } finally {
      setLoading(false);
    }
  }, [category, difficulty]);

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
        const [res, currentReads] = await Promise.all([
          fetchFeed({ category, difficulty }),
          getReads(),
        ]);
        const readSet = new Set(currentReads.map((c) => c.id));
        setReads(currentReads);
        setCards(res.cards.filter((c) => !readSet.has(c.id)));
        setNextCursor(res.nextCursor);
        maxSeenRef.current = 0;
      }
    } catch {
      /* keep existing */
    } finally {
      setRefreshing(false);
    }
  }, [tab, category, difficulty]);

  const loadMore = useCallback(async () => {
    if (tab !== 'feed' || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetchFeed({ category, difficulty, cursor: nextCursor });
      const currentReads = await getReads();
      const readSet = new Set(currentReads.map((c) => c.id));
      const fresh = res.cards.filter((c) => !readSet.has(c.id));
      setCards((prev) => [...prev, ...fresh]);
      setNextCursor(res.nextCursor);
    } catch {
      /* ignore */
    } finally {
      setLoadingMore(false);
    }
  }, [tab, nextCursor, loadingMore, category, difficulty]);

  const onToggleSave = useCallback((card: Card) => {
    toggleBookmark(card).then(setBookmarks);
    recordEvent(card.id, 'bookmark');
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
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <View style={styles.brandBlock}>
            <Text style={styles.brand}>AIShorts</Text>
            <Text style={styles.tagline}>Today in AI, in 60 words</Text>
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
            <LevelsDropdown value={difficulty} onChange={setDifficulty} />
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
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <AuthProvider>
        <Feed />
      </AuthProvider>
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
  // Levels dropdown
  levels: { position: 'relative', marginLeft: 8, zIndex: 40 },
  levelsBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: '#eceef2',
    borderWidth: 1,
    borderColor: '#dfe3e8',
  },
  levelsBtnOn: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  levelsBtnText: { fontSize: 13, color: '#374151', fontWeight: '600', textTransform: 'capitalize' },
  levelsBtnTextOn: { color: '#ffffff' },
  levelsBackdrop: { position: 'absolute', top: -1000, left: -1000, right: -1000, bottom: -1000, zIndex: 39 },
  levelsMenu: {
    position: 'absolute',
    top: 40,
    right: 0,
    minWidth: 160,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e6e8ec',
    paddingVertical: 6,
    zIndex: 41,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  levelsItem: { paddingVertical: 9, paddingHorizontal: 14, borderRadius: 8 },
  levelsItemOn: { backgroundColor: '#eef2ff' },
  levelsItemText: { fontSize: 14, color: '#374151' },
  levelsItemTextOn: { color: '#4338ca', fontWeight: '700' },
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
  image: { width: '100%', height: 180, borderRadius: 14, backgroundColor: '#e9edf2', marginBottom: 14 },
  cardBody: { flex: 1, paddingBottom: 18 },
  badges: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  badge: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: 6 },
  badgeText: { fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#14161a',
    lineHeight: 30,
    marginBottom: 12,
    letterSpacing: -0.3,
  },
  summaryScroll: { flex: 1 },
  summary: { fontSize: 18, lineHeight: 28, color: '#23262b' },
  why: { fontSize: 14, color: '#6b7280', marginTop: 14, fontStyle: 'italic' },
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#e6e8ec',
    paddingTop: 12,
    marginTop: 10,
  },
  src: { fontSize: 12, color: '#8a91a0', flex: 1, marginRight: 10 },
  footActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  save: { fontSize: 14, color: '#6b7280', fontWeight: '600' },
  saveOn: { color: '#2563eb' },
  read: { fontSize: 14, color: '#2563eb', fontWeight: '700' },
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
});
