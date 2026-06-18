import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Card } from './types';

// Store full card objects so the Saved tab works offline.
const KEY = 'aishorts.bookmarks.v1';

export async function getBookmarks(): Promise<Card[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Card[]) : [];
  } catch {
    return [];
  }
}

export async function toggleBookmark(card: Card): Promise<Card[]> {
  const list = await getBookmarks();
  const idx = list.findIndex((c) => c.id === card.id);
  if (idx >= 0) list.splice(idx, 1);
  else list.unshift(card);
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
  return list;
}
