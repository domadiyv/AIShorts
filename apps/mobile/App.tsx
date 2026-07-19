import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { CATEGORIES, DIFFICULTIES } from './src/config';
import { fetchFeed, recordEvent } from './src/api';
import { getBookmarks, toggleBookmark } from './src/bookmarks';
import { getReads, markRead } from './src/reads';
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

function Feed() {
  const insets = useSafeAreaInsets();
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
  const readIds = useMemo(() => new Set(reads.map((c) => c.id)), [reads]);
  // Read cards drop out of the live feed and surface under the Read tab.
  const feedData = useMemo(() => cards.filter((c) => !readIds.has(c.id)), [cards, readIds]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchFeed({ category, difficulty });
      setCards(res.cards);
      setNextCursor(res.nextCursor);
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

  // Pull-to-refresh: re-fetch whichever list the active tab is showing.
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (tab === 'saved') {
        setBookmarks(await getBookmarks());
      } else if (tab === 'read') {
        setReads(await getReads());
      } else {
        const res = await fetchFeed({ category, difficulty });
        setCards(res.cards);
        setNextCursor(res.nextCursor);
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
      setCards((prev) => [...prev, ...res.cards]);
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

  const onFeedLayout = (e: LayoutChangeEvent) => setFeedHeight(e.nativeEvent.layout.height);

  const data = tab === 'feed' ? feedData : tab === 'saved' ? bookmarks : reads;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <Text style={styles.brand}>AIShorts</Text>
          <Text style={styles.tagline}>Today in AI, in 60 words</Text>
        </View>
        <View style={styles.tabs}>
          <Chip label="Feed" active={tab === 'feed'} onPress={() => setTab('feed')} />
          <Chip
            label={`Saved${bookmarks.length ? ` (${bookmarks.length})` : ''}`}
            active={tab === 'saved'}
            onPress={() => setTab('saved')}
          />
          <Chip
            label={`Read${reads.length ? ` (${reads.length})` : ''}`}
            active={tab === 'read'}
            onPress={() => setTab('read')}
          />
        </View>
        {tab === 'feed' && (
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
        )}
      </View>

      <View style={styles.feedArea} onLayout={onFeedLayout}>
        {loading && tab === 'feed' ? (
          <View style={styles.center}>
            <ActivityIndicator />
          </View>
        ) : data.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.empty}>
              {tab === 'saved'
                ? 'No saved shorts yet. Tap ☆ Save on a card.'
                : tab === 'read'
                  ? 'Nothing read yet. Open a card with “Read full →”.'
                  : 'No cards. Pull to refresh.'}
            </Text>
          </View>
        ) : feedHeight > 0 ? (
          <FlatList
            data={data}
            keyExtractor={(c) => c.id}
            pagingEnabled
            showsVerticalScrollIndicator={false}
            snapToInterval={feedHeight}
            decelerationRate="fast"
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            onEndReachedThreshold={0.5}
            onEndReached={loadMore}
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
        ) : null}
      </View>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Feed />
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
  brandRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingTop: 6 },
  brand: { fontSize: 22, fontWeight: '700', color: '#14161a', letterSpacing: -0.5 },
  tagline: { fontSize: 12, color: '#6b7280' },
  tabs: { flexDirection: 'row', gap: 8, marginTop: 10 },
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
  feedArea: { flex: 1 },
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
});
