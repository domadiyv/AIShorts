import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Card } from './types';

// Persist cards the user has opened ("Read full") so they drop out of the
// live feed and surface under the Read tab, most-recently-read first.
const KEY = 'aishorts.reads.v1';

export async function getReads(): Promise<Card[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Card[]) : [];
  } catch {
    return [];
  }
}

// Mark a card read (idempotent): move it to the front of the read list.
export async function markRead(card: Card): Promise<Card[]> {
  return markReadMany([card]);
}

// Batch version: used when scrolling past several cards at once. Each card is
// moved to the front (most-recently-read first); persisted in a single write.
export async function markReadMany(cards: Card[]): Promise<Card[]> {
  const list = await getReads();
  if (cards.length === 0) return list;
  for (const card of cards) {
    const idx = list.findIndex((c) => c.id === card.id);
    if (idx >= 0) list.splice(idx, 1);
    list.unshift(card);
  }
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
  return list;
}
