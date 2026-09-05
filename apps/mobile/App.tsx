import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Linking,
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
import { Image as ExpoImage } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { CATEGORIES, getApiBase, setApiBase, loadApiBase, DEFAULT_API_URL } from './src/config';
import { fetchFeed, fetchCategories, apiSearch, recordEvent, resolveMediaUrl } from './src/api';
import { getBookmarks, toggleBookmark } from './src/bookmarks';
import { getReads, markRead, markReadMany } from './src/reads';
import { AuthProvider, useAuth } from './src/auth';
import { ThemeProvider, useTheme, type Palette, type ThemeMode } from './src/theme';
import type { AuthUser } from './src/api';
import type { Card } from './src/types';

type Tab = 'feed' | 'saved' | 'read';

// Pull the active palette and a matching stylesheet in one call. makeStyles is
// memoized on the palette, so switching light/dark rebuilds styles once — not on
// every render — and every component re-themes together.
function useThemedStyles() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return { colors, styles };
}

// Article date. Within the last week we show the exact date (e.g. "Sep 5"), so
// fresh news reads precisely; older than that we switch to a compact relative
// label ("1w ago", "3mo ago", "1y ago"). Missing/unparseable → "Recently".
function formatDate(iso: string | null): string {
  if (!iso) return 'Recently';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Recently';
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days < 0) return 'Just now';
  // Up to and including a week old: show the actual date.
  if (days <= 7) return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  // Older than a week: compact "<n><unit> ago" — weeks, then months, then years.
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

// Turn a #rrggbb into an rgba() string at the given alpha. Used to build a soft
// left→right gradient (transparent → surface) with stacked Views, so we get a
// fade edge without pulling in expo-linear-gradient (which needs a native build).
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Opacity ramp for the chip-row fade: 0 (fully clear, left) → 1 (solid surface,
// right), so category chips dissolve into the header as they reach the search
// button instead of being hard-clipped.
const FADE_STEPS = [0, 0.15, 0.35, 0.6, 0.82, 1];

// Case-insensitive match across the fields a reader would search by. Empty query
// matches everything. Order is never touched by callers (they filter in place),
// so results stay in the list's native order — latest first.
function matchesQuery(card: Card, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    card.title.toLowerCase().includes(q) ||
    card.summary.toLowerCase().includes(q) ||
    card.sourceName.toLowerCase().includes(q) ||
    card.category.toLowerCase().includes(q) ||
    (card.tags?.some((t) => t.toLowerCase().includes(q)) ?? false)
  );
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

// How many upcoming cards' images to warm ahead of the one on screen. Image
// bytes live in Postgres and take a moment to fetch+decode, so pre-warming the
// next few means they're already in expo-image's memory/disk cache by the time
// the user swipes to them — no visible load spinner.
const PREFETCH_AHEAD = 3;

// Prefetch the images for the `PREFETCH_AHEAD` cards after `fromIdx`. `seen`
// dedups across calls so we don't re-issue prefetches for URLs already warmed
// this session (it's reset when the feed is refreshed and the cache is cleared).
function prefetchAhead(list: Card[], fromIdx: number, seen: Set<string>) {
  const urls: string[] = [];
  for (let i = fromIdx; i < fromIdx + PREFETCH_AHEAD && i < list.length; i++) {
    const u = resolveMediaUrl(list[i]?.imageUrl ?? null);
    if (u && !seen.has(u)) {
      seen.add(u);
      urls.push(u);
    }
  }
  if (urls.length) ExpoImage.prefetch(urls).catch(() => {});
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { styles } = useThemedStyles();
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipOn]}>
      <Text style={[styles.chipText, active && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

// Inline search field used on both the feed and the History view. Filters live as
// you type; the ✕ clears and closes it.
function SearchBar({
  value,
  onChange,
  onClose,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onClose: () => void;
  placeholder?: string;
}) {
  const { colors, styles } = useThemedStyles();
  return (
    <View style={styles.searchBar}>
      <Ionicons name="search" size={16} color={colors.textFaint} style={styles.searchIcon} />
      <TextInput
        style={styles.searchInput}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder ?? 'Search'}
        placeholderTextColor={colors.textFaint}
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
      />
      <Pressable onPress={onClose} hitSlop={10} style={styles.searchClose}>
        <Ionicons name="close" size={18} color={colors.textMuted} />
      </Pressable>
    </View>
  );
}

// Dependency-free bottom fade: a stack of same-color layers of increasing height,
// each slightly opaque, so overlap builds up a gradient (opaque at the bottom,
// transparent toward the top). Signals "there's more to scroll" without pulling
// in a native gradient library. `pointerEvents=none` so it never eats scroll.
function ScrollFade({ height = 26, color }: { height?: number; color: string }) {
  const layers = 7;
  return (
    <View pointerEvents="none" style={[styles_scrollFade, { height }]}>
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

// ScrollFade is positioned absolutely inside its wrapper; the layout never varies
// by theme, only its color (passed in), so it can use a plain static style.
const styles_scrollFade = { position: 'absolute', left: 0, right: 0, bottom: 0 } as const;

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
  const { colors, styles } = useThemedStyles();
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
        <ExpoImage
          source={{ uri: resolveMediaUrl(card.imageUrl)! }}
          style={[styles.image, { height: imageHeight }]}
          contentFit="cover"
          // Cache in memory + on disk so a card's image is instant on revisit and
          // survives app restarts (prefetch below warms upcoming cards).
          cachePolicy="memory-disk"
          transition={180}
          recyclingKey={card.id}
        />
      ) : null}
      <View style={styles.cardBody}>
        <View style={styles.badges}>
          <View style={styles.badgeGroup}>
            <View style={[styles.badge, { backgroundColor: colors.catBg }]}>
              <Text style={[styles.badgeText, { color: colors.catText }]}>{card.category}</Text>
            </View>
          </View>
          <View style={styles.cardActions}>
            <Pressable style={styles.iconBtn} onPress={() => onShare(card)} hitSlop={8}>
              <Ionicons
                name={Platform.OS === 'android' ? 'share-social-outline' : 'share-outline'}
                size={19}
                color={colors.icon}
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
                color={saved ? colors.primary : colors.icon}
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
            indicatorStyle={colors.scrollIndicator}
            onContentSizeChange={onSummaryContentSize}
          >
            <Text style={[styles.summary, { fontSize: summarySize, lineHeight: summaryLineHeight }]}>
              {card.summary}
            </Text>
            <View style={styles.credit}>
              <Text style={styles.creditLabel}>Source:</Text>
              <Text style={styles.creditSource} numberOfLines={1}>
                {card.sourceName}
              </Text>
              {date ? <Text style={styles.creditSep}>|</Text> : null}
              {date ? <Text style={styles.creditDate}>{date}</Text> : null}
            </View>
          </ScrollView>
          {overflow ? <ScrollFade color={colors.bg} /> : null}
        </View>
        <Pressable style={styles.readCta} onPress={() => onOpen(card)}>
          <View style={styles.readCtaText}>
            <Text style={styles.readCtaKicker}>CONTINUE READING</Text>
            <Text style={styles.readCtaTitle} numberOfLines={1}>
              Read the full story on {card.sourceName}
            </Text>
          </View>
          <View style={styles.readCtaArrowWrap}>
            <Ionicons name="arrow-forward" size={20} color="#ffffff" />
          </View>
        </Pressable>
      </View>
    </View>
  );
}

// A single vertically-paged card list. Extracted so each tab can own its own
// FlatList instance — that's what lets the Feed keep its scroll position while
// you visit other tabs (the instance stays mounted, just hidden).
const CardList = forwardRef<FlatList<Card>, {
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
}>(function CardList({
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
}, ref) {
  const { colors } = useThemedStyles();
  return (
    <FlatList
      ref={ref}
      data={data}
      keyExtractor={(c) => c.id}
      pagingEnabled
      showsVerticalScrollIndicator={false}
      snapToInterval={feedHeight}
      decelerationRate="fast"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.textMuted}
          colors={[colors.primary]}
        />
      }
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
});

// Round avatar: photo if we have one, else an initial, else a guest glyph.
function Avatar({ user, size = 36 }: { user: AuthUser | null; size?: number }) {
  const { styles } = useThemedStyles();
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
  const { styles } = useThemedStyles();
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
  onClose,
  onNavigate,
  onAuth,
  onLogout,
  onDeleteAccount,
  onSettings,
}: {
  user: AuthUser | null;
  savedCount: number;
  onClose: () => void;
  onNavigate: (tab: Tab) => void;
  onAuth: (mode: 'login' | 'register') => void;
  onLogout: () => void;
  onDeleteAccount: () => void;
  onSettings: () => void;
}) {
  const { styles } = useThemedStyles();
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
        <MenuItem label="History" onPress={() => onNavigate('read')} />
        <View style={styles.menuDivider} />
        <MenuItem label="Settings" onPress={onSettings} />
        <View style={styles.menuDivider} />
        {user ? (
          <>
            <MenuItem label="Log out" danger onPress={onLogout} />
            <MenuItem label="Delete account" danger onPress={onDeleteAccount} />
          </>
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
  const { colors, styles } = useThemedStyles();
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
            placeholderTextColor={colors.textFaint}
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
          />
        ) : null}
        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={colors.textFaint}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
        />
        <TextInput
          style={styles.input}
          placeholder={isRegister ? 'Password (min 8 characters)' : 'Password'}
          placeholderTextColor={colors.textFaint}
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
            <ActivityIndicator color={colors.primaryText} />
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

// Light / Dark / System segmented control for the theme preference.
function ThemeSelector({ mode, onChange }: { mode: ThemeMode; onChange: (m: ThemeMode) => void }) {
  const { styles } = useThemedStyles();
  const opts: { key: ThemeMode; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { key: 'light', label: 'Light', icon: 'sunny-outline' },
    { key: 'dark', label: 'Dark', icon: 'moon-outline' },
    { key: 'system', label: 'System', icon: 'phone-portrait-outline' },
  ];
  return (
    <View style={styles.themeSeg}>
      {opts.map((o) => {
        const on = mode === o.key;
        return (
          <Pressable
            key={o.key}
            style={[styles.themeSegBtn, on && styles.themeSegBtnOn]}
            onPress={() => onChange(o.key)}
          >
            <Text style={[styles.themeSegText, on && styles.themeSegTextOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// A tappable settings row with a trailing chevron.
function SettingsRow({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors, styles } = useThemedStyles();
  return (
    <Pressable style={styles.settingsRow} onPress={onPress}>
      <Text style={styles.settingsRowText}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
    </Pressable>
  );
}

// Back header for a settings sub-screen.
function SettingsSubHeader({ title, onBack }: { title: string; onBack: () => void }) {
  const { colors, styles } = useThemedStyles();
  return (
    <Pressable style={styles.settingsBackRow} onPress={onBack} hitSlop={8}>
      <Ionicons name="chevron-back" size={20} color={colors.primary} />
      <Text style={styles.settingsBackTitle}>{title}</Text>
    </Pressable>
  );
}

const ABOUT_TEXT =
  'AIShorts distills the day’s AI news and learning into quick, ~60-word cards, so you can stay current in the time it takes to finish a coffee.\n\n' +
  'We scan sources across the AI world — model releases, tools, research, business, and policy — and summarize what matters, with a link to read the full story at the source.\n\n' +
  'Save the shorts you want to revisit, and your history keeps track of what you’ve already read.\n\n' +
  'AIShorts is an independent project and is not affiliated with the publications it links to.';

const TERMS_TEXT =
  'Terms & Privacy Policy\n\n' +
  'This is placeholder text. Replace it with your finalized Terms of Service and Privacy Policy before release.\n\n' +
  'Using the app. AIShorts provides brief summaries of publicly available AI news and links to the original sources. Summaries are provided “as is” for convenience and may contain errors; always refer to the linked source for the authoritative version.\n\n' +
  'Your data. Your saved shorts and reading history are stored on your device. If you create an account, we store your email (or Google profile basics) to sync your session. We do not sell your personal data.\n\n' +
  'Content. Article headlines, images, and excerpts belong to their respective publishers. AIShorts links to sources and does not claim ownership of third-party content.\n\n' +
  'Contact. Questions about these terms? Email support@aishorts.app.';

// Settings hub: appearance (theme), feedback, about, terms, and the advanced
// server-URL override. Sub-screens live in a single modal, switched via `view`.
function SettingsModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const { colors, styles } = useThemedStyles();
  const { mode, setMode } = useTheme();
  const [view, setView] = useState<'main' | 'server' | 'about' | 'terms'>('main');
  const [url, setUrl] = useState(getApiBase());
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const saveServer = async (value: string) => {
    setBusy(true);
    setServerError(null);
    try {
      await setApiBase(value);
      onSaved();
      setView('main');
    } catch (e) {
      // setApiBase rejects a non-HTTPS URL in release builds — surface the reason.
      setServerError(
        e instanceof Error && e.message ? e.message : 'Couldn’t save the server URL.',
      );
    } finally {
      setBusy(false);
    }
  };

  const sendFeedback = () => {
    const subject = encodeURIComponent('AIShorts feedback');
    const body = encodeURIComponent('\n\n—\nSent from the AIShorts app');
    Linking.openURL(`mailto:support@aishorts.app?subject=${subject}&body=${body}`).catch(() => {
      /* no mail client available */
    });
  };

  return (
    <View style={styles.modalOverlay}>
      <Pressable style={styles.modalBackdrop} onPress={onClose} />
      <View style={styles.modalCard}>
        <Pressable onPress={onClose} style={styles.modalClose} hitSlop={10}>
          <Text style={styles.modalCloseText}>✕</Text>
        </Pressable>

        {view === 'main' ? (
          <ScrollView showsVerticalScrollIndicator={false} style={styles.settingsScroll}>
            <Text style={styles.modalTitle}>Settings</Text>
            <Text style={styles.modalSub}>Personalize AIShorts and manage the app.</Text>

            <Text style={styles.settingsSection}>Appearance</Text>
            <Text style={styles.settingsLabel}>Theme</Text>
            <ThemeSelector mode={mode} onChange={setMode} />

            <Text style={styles.settingsSection}>General</Text>
            <SettingsRow label="Send feedback" onPress={sendFeedback} />
            <SettingsRow label="About us" onPress={() => setView('about')} />
            <SettingsRow label="Terms & Privacy Policy" onPress={() => setView('terms')} />

            <Text style={styles.settingsSection}>Advanced</Text>
            <SettingsRow label="Server settings" onPress={() => setView('server')} />
          </ScrollView>
        ) : view === 'server' ? (
          <>
            <SettingsSubHeader title="Server settings" onBack={() => setView('main')} />
            <Text style={styles.modalSub}>
              Point the app at your backend. Use the HTTPS tunnel to your Mac now, or a
              cloud URL later — no reinstall needed.
            </Text>

            <TextInput
              style={styles.input}
              placeholder="https://your-backend.example.com"
              placeholderTextColor={colors.textFaint}
              value={url}
              onChangeText={setUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              onSubmitEditing={() => saveServer(url)}
            />

            <Text style={styles.settingsHint}>Default: {DEFAULT_API_URL}</Text>

            {serverError ? <Text style={styles.modalError}>{serverError}</Text> : null}

            <Pressable
              style={[styles.primaryBtn, busy && styles.primaryBtnDisabled]}
              onPress={() => saveServer(url)}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color={colors.primaryText} />
              ) : (
                <Text style={styles.primaryBtnText}>Save & reload</Text>
              )}
            </Pressable>

            <Pressable onPress={() => saveServer('')} style={styles.switchRow} disabled={busy}>
              <Text style={styles.switchText}>Reset to default</Text>
            </Pressable>
          </>
        ) : (
          <>
            <SettingsSubHeader
              title={view === 'about' ? 'About us' : 'Terms & Privacy Policy'}
              onBack={() => setView('main')}
            />
            <ScrollView style={styles.settingsBodyScroll} showsVerticalScrollIndicator={false}>
              <Text style={styles.settingsBody}>{view === 'about' ? ABOUT_TEXT : TERMS_TEXT}</Text>
            </ScrollView>
          </>
        )}
      </View>
    </View>
  );
}

function Feed() {
  const insets = useSafeAreaInsets();
  const { colors, styles } = useThemedStyles();
  const { user, logout, deleteAccount } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register' | null>(null);
  const [tab, setTab] = useState<Tab>('feed');
  const [category, setCategory] = useState<string | undefined>();
  // Filter chips: the admin-managed list from the API, falling back to the
  // bundled defaults until it loads (or if the request fails).
  const [categories, setCategories] = useState<string[]>([...CATEGORIES]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cards, setCards] = useState<Card[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [bookmarks, setBookmarks] = useState<Card[]>([]);
  const [reads, setReads] = useState<Card[]>([]);
  const [feedHeight, setFeedHeight] = useState(0);

  const savedIds = useMemo(() => new Set(bookmarks.map((c) => c.id)), [bookmarks]);

  // Feed search hits the server so it finds cards across the whole catalog, not
  // just the pages already loaded into memory. `null` = no server results yet
  // (idle or in-flight); we fall back to a local filter of the loaded cards for
  // an instant result while the request is in flight.
  const [searchResults, setSearchResults] = useState<Card[] | null>(null);

  // Debounced full-catalog search on the feed tab. Scoped to the active category
  // chip so results match what the chip would show. History (reads) stays a
  // local filter below — that data lives only on-device.
  useEffect(() => {
    const q = query.trim();
    if (tab !== 'feed' || q.length < 2) {
      setSearchResults(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      apiSearch(q, category).then((res) => {
        if (!cancelled) setSearchResults(res);
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, tab, category]);

  // Live search results for the feed. Prefer server results (whole catalog);
  // until they arrive, show a local filter of the loaded cards so typing feels
  // instant. No query → the normal paginated feed.
  const feedData = useMemo(
    () =>
      query.trim()
        ? (searchResults ?? cards.filter((c) => matchesQuery(c, query)))
        : cards,
    [cards, query, searchResults],
  );
  const readData = useMemo(
    () => (query.trim() ? reads.filter((c) => matchesQuery(c, query)) : reads),
    [reads, query],
  );

  // Account deletion is irreversible, so gate it behind a two-step confirm
  // (Apple 5.1.1(v) / Google Play require an in-app deletion path). The server
  // hard-deletes the user + their bookmarks, events and devices; on success the
  // AuthProvider clears the local session and the UI drops back to the guest state.
  const confirmDeleteAccount = useCallback(() => {
    setMenuOpen(false);
    Alert.alert(
      'Delete account?',
      'This permanently deletes your account and all your data (saved shorts, history and devices). This can’t be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Are you sure?',
              'Your account will be permanently deleted immediately.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete account',
                  style: 'destructive',
                  onPress: () => {
                    deleteAccount().catch((e) => {
                      Alert.alert(
                        'Couldn’t delete account',
                        e instanceof Error && e.message
                          ? e.message
                          : 'Something went wrong. Please try again.',
                      );
                    });
                  },
                },
              ],
            );
          },
        },
      ],
    );
  }, [deleteAccount]);

  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setQuery('');
  }, []);

  // Search is contextual to the current tab; leaving a tab dismisses it.
  useEffect(() => {
    setSearchOpen(false);
    setQuery('');
  }, [tab]);

  // View tracking for the feed: scrolling past a card marks it read (it moves to
  // the Read tab immediately), but the card stays in the current session's feed
  // until the next refresh — so the list doesn't reshuffle under your finger.
  const feedCardsRef = useRef<Card[]>([]);
  const feedHeightRef = useRef(0);
  // The feed's FlatList, so a re-tap on the active chip can scroll it to the top.
  const feedListRef = useRef<FlatList<Card>>(null);
  // Latest vertical scroll offset, so the chip handler can tell "at top" (scroll)
  // from "already at top" (refresh) without reading it off a scroll event.
  const feedOffsetRef = useRef(0);
  // Highest card index reached so far (starts at the first card, index 0).
  const maxSeenRef = useRef(0);
  // Image URLs already handed to expo-image's prefetcher this session, so we
  // don't re-warm the same card twice. Cleared alongside the image cache on
  // refresh (see onRefresh).
  const prefetchedRef = useRef<Set<string>>(new Set());
  const onFeedScroll = useRef((e: NativeScrollEvent) => {
    feedOffsetRef.current = e.contentOffset.y;
    const h = feedHeightRef.current;
    if (h <= 0) return;
    const idx = Math.round(e.contentOffset.y / h); // card currently on screen
    // Warm the next few cards' images as the user moves through the feed, even
    // when they haven't advanced the high-water mark (e.g. scrolling back down).
    prefetchAhead(feedCardsRef.current, idx + 1, prefetchedRef.current);
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
      feedOffsetRef.current = 0;
      // Warm the images just after the (already-rendering) first card.
      prefetchAhead(res.cards, 1, prefetchedRef.current);
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
    // Pull the live (admin-managed) category list; keep defaults on failure.
    fetchCategories().then((cats) => {
      if (cats.length) setCategories(cats);
    });
  }, []);

  // Keep the ref the scroll callback reads in sync with the *displayed* feed, so
  // read-marking indices line up even while a search filter is applied.
  useEffect(() => {
    feedCardsRef.current = feedData;
  }, [feedData]);

  // A search filter rebuilds the list and resets its scroll offset to the top;
  // reset the high-water mark so we don't skip marking the new first cards.
  useEffect(() => {
    maxSeenRef.current = 0;
  }, [query]);

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
        // A refresh replaces the whole feed, so the old cards' images are gone
        // for good — drop them from expo-image's caches (memory + disk) so they
        // don't linger, and reset the prefetch dedup set before re-warming.
        await Promise.all([
          ExpoImage.clearMemoryCache(),
          ExpoImage.clearDiskCache(),
        ]).catch(() => {});
        prefetchedRef.current = new Set();
        setCards(res.cards);
        setNextCursor(res.nextCursor);
        maxSeenRef.current = 0;
        feedOffsetRef.current = 0;
        prefetchAhead(res.cards, 1, prefetchedRef.current);
      }
    } catch {
      /* keep existing */
    } finally {
      setRefreshing(false);
    }
  }, [tab, category]);

  // Category chip tap. First tap on a *different* chip switches category (the feed
  // reloads from the top). Tapping the chip that's already active scrolls the feed
  // to the top; tapping it again once already at the top pulls a refresh — the same
  // "tap the active tab to go up, tap again to refresh" gesture as native tab bars.
  const onCategoryPress = useCallback(
    (target: string | undefined) => {
      const isActive = target === undefined ? !category : category === target;
      if (!isActive) {
        setCategory(target);
        return;
      }
      // "At top" = showing the first card (offset within half a card of 0).
      const atTop = feedOffsetRef.current <= (feedHeightRef.current || 1) / 2;
      if (atTop) {
        onRefresh();
      } else {
        feedListRef.current?.scrollToOffset({ offset: 0, animated: true });
      }
    },
    [category, onRefresh],
  );

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
                onDeleteAccount={confirmDeleteAccount}
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
            {searchOpen ? (
              <SearchBar
                value={query}
                onChange={setQuery}
                onClose={closeSearch}
                placeholder="Search shorts"
              />
            ) : (
              <>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.chipRow}
                  contentContainerStyle={styles.chipRowContent}
                >
                  <Chip label="All" active={!category} onPress={() => onCategoryPress(undefined)} />
                  {categories.map((c) => (
                    <Chip
                      key={c}
                      label={c}
                      active={category === c}
                      onPress={() => onCategoryPress(c)}
                    />
                  ))}
                </ScrollView>
                {/* Right-edge gradient so chips fade into the header as they reach
                    the search button, instead of being sharply cut off. */}
                <View pointerEvents="none" style={styles.chipFade}>
                  {FADE_STEPS.map((op, i) => (
                    <View
                      key={i}
                      style={[styles.chipFadeStep, { backgroundColor: hexToRgba(colors.surface, op) }]}
                    />
                  ))}
                </View>
                <Pressable
                  style={({ pressed }) => [
                    styles.searchToggle,
                    styles.searchToggleFeed,
                    pressed && styles.searchTogglePressed,
                  ]}
                  onPress={openSearch}
                  hitSlop={8}
                >
                  <Ionicons name="search" size={18} color={colors.icon} />
                </Pressable>
              </>
            )}
          </View>
        ) : (
          <View style={styles.subHeader}>
            <Pressable style={styles.backBtn} onPress={() => setTab('feed')} hitSlop={8}>
              <Text style={styles.backBtnText}>← Feed</Text>
            </Pressable>
            {searchOpen && tab === 'read' ? (
              <SearchBar
                value={query}
                onChange={setQuery}
                onClose={closeSearch}
                placeholder="Search history"
              />
            ) : (
              <>
                <Text style={styles.subHeaderTitle}>{tab === 'saved' ? 'Saved' : 'History'}</Text>
                {tab === 'read' ? (
                  <Pressable
                    style={({ pressed }) => [
                      styles.searchToggle,
                      pressed && styles.searchTogglePressed,
                    ]}
                    onPress={openSearch}
                    hitSlop={8}
                  >
                    <Ionicons name="search" size={18} color={colors.icon} />
                  </Pressable>
                ) : null}
              </>
            )}
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
                  <ActivityIndicator color={colors.primary} />
                </View>
              ) : feedData.length === 0 ? (
                <View style={styles.center}>
                  <Text style={styles.empty}>
                    {query.trim() ? 'No shorts match your search.' : 'No cards. Pull to refresh.'}
                  </Text>
                </View>
              ) : (
                <CardList
                  ref={feedListRef}
                  data={feedData}
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
                {readData.length === 0 ? (
                  <View style={styles.center}>
                    <Text style={styles.empty}>
                      {query.trim()
                        ? 'No history matches your search.'
                        : 'Nothing here yet. Scroll through the feed or open a card and it lands in your history.'}
                    </Text>
                  </View>
                ) : (
                  <CardList
                    data={readData}
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

// Themed shell: owns the status-bar style and the pre-ready splash so both react
// to the active palette. Lives under ThemeProvider (see App).
function Root({ ready }: { ready: boolean }) {
  const { colors, styles } = useThemedStyles();
  return (
    <>
      <StatusBar style={colors.scheme === 'dark' ? 'light' : 'dark'} />
      {ready ? (
        <AuthProvider>
          <Feed />
        </AuthProvider>
      ) : (
        <View style={[styles.center, styles.root]}>
          <ActivityIndicator color={colors.primary} />
        </View>
      )}
    </>
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
      <ThemeProvider>
        <Root ready={ready} />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

// Palette-driven stylesheet. Built once per scheme (memoized in useThemedStyles),
// so all color values flow from `c` and a single palette swap re-themes the app.
function makeStyles(c: Palette) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    header: {
      paddingHorizontal: 16,
      paddingBottom: 8,
      backgroundColor: c.surface,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
      zIndex: 30, // keep the profile dropdown above the feed list
    },
    brandRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingTop: 6,
    },
    brandBlock: { flexDirection: 'row', alignItems: 'baseline', gap: 8, flex: 1 },
    brand: { fontSize: 22, fontWeight: '700', color: c.text, letterSpacing: -0.5 },
    tagline: { fontSize: 12, color: c.textMuted },
    // Avatar + profile menu
    avatarWrap: { position: 'relative', zIndex: 50 },
    avatarImg: { backgroundColor: c.surfaceMuted },
    avatarCircle: { alignItems: 'center', justifyContent: 'center', backgroundColor: c.primary },
    avatarGuest: { backgroundColor: c.surfaceMuted, borderWidth: 1, borderColor: c.border },
    avatarInitial: { color: c.primaryText, fontWeight: '700' },
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
      backgroundColor: c.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.border,
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
    menuName: { fontSize: 15, fontWeight: '700', color: c.text },
    menuEmail: { fontSize: 12, color: c.textMuted, marginTop: 2 },
    menuDivider: { height: 1, backgroundColor: c.borderMuted, marginVertical: 4 },
    menuItem: { paddingHorizontal: 14, paddingVertical: 11 },
    menuItemText: { fontSize: 15, color: c.textStrong, fontWeight: '600' },
    menuItemDanger: { color: c.danger },
    // Sub-header for Saved / History views
    subHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 },
    backBtn: {
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: 999,
      backgroundColor: c.surfaceAlt,
    },
    backBtnText: { fontSize: 13, color: c.textStrong, fontWeight: '600' },
    subHeaderTitle: { flex: 1, fontSize: 16, fontWeight: '700', color: c.text },
    filterRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 8,
      minHeight: 36,
      position: 'relative',
      zIndex: 30,
    },
    chipRow: { flex: 1 },
    // Extra right padding lets the last chip scroll fully clear of the fade +
    // search button (which are pinned over the row's right edge).
    chipRowContent: { alignItems: 'center', paddingRight: 52 },
    // Soft transparent→surface gradient sitting just left of the search button.
    chipFade: {
      position: 'absolute',
      right: 32,
      top: 0,
      bottom: 0,
      width: 40,
      flexDirection: 'row',
    },
    chipFadeStep: { flex: 1 },
    chip: {
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: 999,
      backgroundColor: c.surfaceAlt,
      marginRight: 6,
    },
    chipOn: { backgroundColor: c.primary },
    chipText: { fontSize: 13, color: c.textStrong, textTransform: 'capitalize' },
    chipTextOn: { color: c.primaryText },
    // Search
    // Borderless icon button (modern iOS/Material style): no visible ring — the
    // fill matches the header surface so it reads as the icon floating on the bar,
    // with the chip-row fade dissolving chips into it. Press state gives feedback.
    searchToggle: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: c.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    searchTogglePressed: { backgroundColor: c.surfaceMuted },
    // Feed variant: pinned to the row's right edge so chips scroll behind it.
    searchToggleFeed: { position: 'absolute', right: 0 },
    searchBar: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.surfaceMuted,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 999,
      paddingHorizontal: 12,
      height: 38,
    },
    searchIcon: { marginRight: 6 },
    searchInput: { flex: 1, fontSize: 14, color: c.text, padding: 0 },
    searchClose: { paddingLeft: 8 },
    feedArea: { flex: 1, position: 'relative' },
    tabLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    hidden: { display: 'none' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    empty: { color: c.textMuted, textAlign: 'center', fontSize: 15 },
    card: { paddingHorizontal: 16, paddingTop: 14 },
    // height is set responsively inline (per device) in CardView.
    image: { width: '100%', borderRadius: 14, backgroundColor: c.surfaceMuted, marginBottom: 10 },
    cardBody: { flex: 1, paddingBottom: 12 },
    badges: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    badgeGroup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    iconBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: c.surfaceMuted,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconBtnOn: {
      backgroundColor: c.scheme === 'dark' ? '#1d2b52' : '#eff4ff',
      borderColor: c.scheme === 'dark' ? '#2f4a86' : '#bfd3ff',
    },
    cardActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    badge: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: 6 },
    badgeText: { fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
    title: {
      // fontSize / lineHeight set responsively inline in CardView.
      fontWeight: '700',
      color: c.text,
      marginBottom: 8,
      letterSpacing: -0.3,
    },
    // Wrapper gives the fade an anchor at the bottom of the scroll region.
    summaryWrap: { flex: 1, position: 'relative' },
    summaryScroll: { flex: 1 },
    // Bottom padding so the last line clears the fade overlay and the CTA.
    summaryScrollContent: { paddingBottom: 22 },
    summary: { color: c.textStrong }, // fontSize / lineHeight set responsively inline
    // Source label + source name + article date — one baseline, cohesive type.
    credit: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 12 },
    creditLabel: { fontSize: 12, lineHeight: 16, color: c.textFaint, fontWeight: '500' },
    creditSource: { fontSize: 12, lineHeight: 16, fontWeight: '600', color: c.textMuted, flexShrink: 1 },
    creditSep: { fontSize: 12, lineHeight: 16, color: c.textFaint2 },
    creditDate: { fontSize: 12, lineHeight: 16, color: c.textFaint, fontWeight: '500' },
    // Full-width "read full article" call to action
    readCta: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: c.primary,
      borderRadius: 16,
      paddingVertical: 13,
      paddingHorizontal: 18,
      marginTop: 12,
      shadowColor: c.primary,
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
    // Modals (auth + settings)
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
      backgroundColor: c.overlay,
    },
    modalCard: {
      width: '100%',
      maxWidth: 400,
      maxHeight: '86%',
      backgroundColor: c.surface,
      borderRadius: 18,
      padding: 24,
      shadowColor: '#000',
      shadowOpacity: 0.2,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 12 },
      elevation: 16,
    },
    modalClose: { position: 'absolute', top: 14, right: 16, padding: 4, zIndex: 2 },
    modalCloseText: { fontSize: 18, color: c.textFaint, fontWeight: '600' },
    modalTitle: { fontSize: 22, fontWeight: '700', color: c.text, letterSpacing: -0.3 },
    modalSub: { fontSize: 14, color: c.textMuted, marginTop: 6, marginBottom: 18 },
    googleBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      paddingVertical: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: c.inputBorder,
      backgroundColor: c.surface,
    },
    googleG: {
      width: 20,
      height: 20,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#ffffff',
      borderWidth: 1,
      borderColor: c.border,
    },
    googleGText: { fontSize: 13, fontWeight: '800', color: '#4285F4' },
    googleBtnText: { fontSize: 15, fontWeight: '600', color: c.textStrong },
    orRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 16 },
    orLine: { flex: 1, height: 1, backgroundColor: c.border },
    orText: { fontSize: 12, color: c.textFaint },
    input: {
      borderWidth: 1,
      borderColor: c.inputBorder,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 15,
      color: c.text,
      marginBottom: 10,
      backgroundColor: c.inputBg,
    },
    modalError: { color: c.danger, fontSize: 13, marginBottom: 8, marginTop: 2 },
    primaryBtn: {
      backgroundColor: c.primary,
      borderRadius: 10,
      paddingVertical: 13,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 4,
      minHeight: 46,
    },
    primaryBtnDisabled: { opacity: 0.6 },
    primaryBtnText: { color: c.primaryText, fontSize: 15, fontWeight: '700' },
    switchRow: { alignItems: 'center', marginTop: 16 },
    switchText: { fontSize: 14, color: c.primary, fontWeight: '600' },
    settingsHint: { fontSize: 12, color: c.textFaint, marginTop: 10, marginBottom: 4 },
    // Settings hub
    settingsScroll: { marginRight: -4 },
    settingsSection: {
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      color: c.textFaint,
      marginTop: 18,
      marginBottom: 8,
    },
    settingsLabel: { fontSize: 14, fontWeight: '600', color: c.textStrong, marginBottom: 8 },
    settingsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 13,
      borderBottomWidth: 1,
      borderBottomColor: c.borderMuted,
    },
    settingsRowText: { fontSize: 15, color: c.textStrong, fontWeight: '600' },
    themeSeg: {
      flexDirection: 'row',
      backgroundColor: c.surfaceMuted,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: c.border,
      padding: 4,
      gap: 4,
    },
    themeSegBtn: {
      flex: 1,
      paddingVertical: 9,
      borderRadius: 9,
      alignItems: 'center',
      justifyContent: 'center',
    },
    themeSegBtnOn: { backgroundColor: c.primary },
    themeSegText: { fontSize: 14, fontWeight: '600', color: c.textMuted },
    themeSegTextOn: { color: c.primaryText },
    settingsBackRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 14, marginRight: 28 },
    settingsBackTitle: { fontSize: 18, fontWeight: '700', color: c.text },
    settingsBodyScroll: { maxHeight: 420 },
    settingsBody: { fontSize: 14, lineHeight: 21, color: c.textStrong },
  });
}
