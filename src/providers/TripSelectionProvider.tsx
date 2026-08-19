import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { prefsStorage } from '@/lib/storage';

/**
 * The active trip (§11).
 *
 * This is the *only* trip state kept globally — a single id. Every module then
 * loads its own records by that `tripId`, which is what makes the Paris/Kyoto
 * mix-up (§100) structurally impossible: there is no second copy of a trip
 * anywhere to drift out of sync.
 */

const STORAGE_KEY = 'currentTripId';

interface TripSelectionValue {
  currentTripId: string | null;
  setCurrentTripId: (tripId: string | null) => void;
  /** True until the persisted selection has been read back. */
  restoring: boolean;
}

const TripSelectionContext = createContext<TripSelectionValue | null>(null);

export function TripSelectionProvider({ children }: { children: ReactNode }) {
  const [currentTripId, setCurrentTripIdState] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const stored = await prefsStorage.get<string | null>(STORAGE_KEY, null);
      if (active) {
        setCurrentTripIdState(stored);
        setRestoring(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const setCurrentTripId = useCallback((tripId: string | null) => {
    setCurrentTripIdState(tripId);
    if (tripId) void prefsStorage.set(STORAGE_KEY, tripId);
    else void prefsStorage.remove(STORAGE_KEY);
  }, []);

  const value = useMemo<TripSelectionValue>(
    () => ({ currentTripId, setCurrentTripId, restoring }),
    [currentTripId, setCurrentTripId, restoring],
  );

  return (
    <TripSelectionContext.Provider value={value}>{children}</TripSelectionContext.Provider>
  );
}

export function useTripSelection(): TripSelectionValue {
  const context = useContext(TripSelectionContext);
  if (!context) throw new Error('useTripSelection precisa estar dentro de <TripSelectionProvider>');
  return context;
}
