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
import type { Card } from './src/types';

const DIFF_COLORS: Record<string, string> = {
  beginner: '#15803d',
  intermediate: '#b45309',
  advanced: '#b91c1c',
};

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
  const [tab, setTab] = useState<'feed' | 'saved'>('feed');
  const [category, setCategory] = useState<string | undefined>();
  const [difficulty, setDifficulty] = useState<string | undefined>();
  const [cards, setCards] = useState<Card[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [bookmarks, setBookmarks] = useState<Card[]>([]);
  const [feedHeight, setFeedHeight] = useState(0);

  const savedIds = useMemo(() => new Set(bookmarks.map((c) => c.id)), [bookmarks]);

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
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (tab === 'saved') {
        setBookmarks(await getBookmarks());
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
    WebBrowser.openBrowserAsync(card.sourceUrl).catch(() => {});
  }, []);

  const onFeedLayout = (e: LayoutChangeEvent) => setFeedHeight(e.nativeEvent.layout.height);

  const data = tab === 'feed' ? cards : bookmarks;

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
        </View>
        {tab === 'feed' && (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
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
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
              <Chip label="All levels" active={!difficulty} onPress={() => setDifficulty(undefined)} />
              {DIFFICULTIES.map((d) => (
                <Chip
                  key={d}
                  label={d}
                  active={difficulty === d}
                  onPress={() => setDifficulty(difficulty === d ? undefined : d)}
                />
              ))}
            </ScrollView>
          </>
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
  },
  brandRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingTop: 6 },
  brand: { fontSize: 22, fontWeight: '700', color: '#14161a', letterSpacing: -0.5 },
  tagline: { fontSize: 12, color: '#6b7280' },
  tabs: { flexDirection: 'row', gap: 8, marginTop: 10 },
  chipRow: { marginTop: 8 },
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
