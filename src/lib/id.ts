import * as Crypto from 'expo-crypto';

/**
 * Generates an RFC-4122 v4 UUID. Ids are produced client-side so that records
 * created offline keep a stable identity through the sync queue (§20).
 */
export function createId(): string {
  return Crypto.randomUUID();
}
