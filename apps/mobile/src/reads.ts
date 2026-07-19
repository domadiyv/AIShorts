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
  const list = await getReads();
  const idx = list.findIndex((c) => c.id === card.id);
  if (idx >= 0) list.splice(idx, 1);
  list.unshift(card);
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
  return list;
}
