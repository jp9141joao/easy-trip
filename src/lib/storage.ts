/**
 * Storage layer (§19). Three clearly separated levels:
 *
 * - `jsonStorage`  — AsyncStorage: cache + locally-owned records.
 * - `secureStorage`— SecureStore: tokens and anything sensitive.
 * - `prefsStorage` — AsyncStorage under a distinct namespace: user preferences.
 *
 * They are never mixed: wiping the cache must not log the user out, and
 * logging out must not destroy device preferences.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const NS = {
  data: 'et:data:',
  cache: 'et:cache:',
  prefs: 'et:prefs:',
} as const;

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    // Corrupt payload — treat as empty rather than crashing the app.
    return fallback;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

export const jsonStorage = {
  get: <T>(key: string, fallback: T) => readJson<T>(NS.data + key, fallback),
  set: (key: string, value: unknown) => writeJson(NS.data + key, value),
  remove: (key: string) => AsyncStorage.removeItem(NS.data + key),
  async clearAll(): Promise<void> {
    const keys = await AsyncStorage.getAllKeys();
    const mine = keys.filter((k) => k.startsWith(NS.data));
    if (mine.length) await AsyncStorage.multiRemove(mine);
  },
};

export interface CacheEnvelope<T> {
  value: T;
  /** When this snapshot was captured — drives "Atualizado há 2h" labels (§62). */
  updatedAt: string;
}

export const cacheStorage = {
  async get<T>(key: string): Promise<CacheEnvelope<T> | null> {
    return readJson<CacheEnvelope<T> | null>(NS.cache + key, null);
  },
  async set<T>(key: string, value: T): Promise<CacheEnvelope<T>> {
    const envelope: CacheEnvelope<T> = { value, updatedAt: new Date().toISOString() };
    await writeJson(NS.cache + key, envelope);
    return envelope;
  },
  remove: (key: string) => AsyncStorage.removeItem(NS.cache + key),
  async clearAll(): Promise<void> {
    const keys = await AsyncStorage.getAllKeys();
    const mine = keys.filter((k) => k.startsWith(NS.cache));
    if (mine.length) await AsyncStorage.multiRemove(mine);
  },
};

export const prefsStorage = {
  get: <T>(key: string, fallback: T) => readJson<T>(NS.prefs + key, fallback),
  set: (key: string, value: unknown) => writeJson(NS.prefs + key, value),
  remove: (key: string) => AsyncStorage.removeItem(NS.prefs + key),
};

/**
 * SecureStore is unavailable on web; there we fall back to AsyncStorage so the
 * app still runs, which is acceptable because the only web target is the
 * developer preview — production auth runs on device.
 */
export const secureStorage = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS === 'web') return AsyncStorage.getItem('et:secure:' + key);
    return SecureStore.getItemAsync(key);
  },
  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
      await AsyncStorage.setItem('et:secure:' + key, value);
      return;
    }
    await SecureStore.setItemAsync(key, value);
  },
  async remove(key: string): Promise<void> {
    if (Platform.OS === 'web') {
      await AsyncStorage.removeItem('et:secure:' + key);
      return;
    }
    await SecureStore.deleteItemAsync(key);
  },
};
