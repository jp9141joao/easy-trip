import { prefsStorage } from './storage';

/**
 * The old key stored a bare trip id for the whole device. With no owner in the
 * payload there is no safe way to decide which account it belongs to, so it is
 * deliberately ignored and removed during the first owner-scoped restore.
 */
export const LEGACY_TRIP_SELECTION_KEY = 'currentTripId';
const TRIP_SELECTION_KEY_PREFIX = 'currentTripId:v1:';
const ownerOperations = new Map<string, Promise<void>>();

function enqueueOwnerOperation(ownerId: string, operation: () => Promise<void>): Promise<void> {
  const previous = ownerOperations.get(ownerId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  ownerOperations.set(ownerId, current);
  void current.then(
    () => {
      if (ownerOperations.get(ownerId) === current) ownerOperations.delete(ownerId);
    },
    () => {
      if (ownerOperations.get(ownerId) === current) ownerOperations.delete(ownerId);
    },
  );
  return current;
}

export function tripSelectionStorageKey(ownerId: string): string {
  return `${TRIP_SELECTION_KEY_PREFIX}${ownerId}`;
}

export async function readTripSelection(ownerId: string): Promise<string | null> {
  await ownerOperations.get(ownerId)?.catch(() => undefined);
  return prefsStorage.get<string | null>(tripSelectionStorageKey(ownerId), null);
}

export async function writeTripSelection(ownerId: string, tripId: string): Promise<void> {
  await enqueueOwnerOperation(ownerId, () =>
    prefsStorage.set(tripSelectionStorageKey(ownerId), tripId),
  );
}

export async function clearTripSelection(ownerId: string): Promise<void> {
  await enqueueOwnerOperation(ownerId, () =>
    prefsStorage.remove(tripSelectionStorageKey(ownerId)),
  );
}

/** Bare legacy values are unowned and therefore unsafe to migrate. */
export async function discardLegacyTripSelection(): Promise<void> {
  await prefsStorage.remove(LEGACY_TRIP_SELECTION_KEY);
}
