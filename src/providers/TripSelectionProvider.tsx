import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { prefsStorage } from '@/lib/storage';
import { useAuth } from './AuthProvider';

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

  /*
   * A seleção pertence à conta, não ao aparelho.
   *
   * `clearPrivateState()` já apaga a chave no disco durante a saída, mas o
   * valor também vive aqui, em estado React — e estado React não some porque
   * um `AsyncStorage.removeItem` rodou. Sem isto, sair da conta deixava
   * `currentTripId` apontando para a viagem da conta anterior até o aplicativo
   * ser reaberto: exatamente o P-06, só que em memória.
   *
   * O gatilho é a troca do dono da sessão, o que cobre os dois casos de uma
   * vez — sair (dono → `null`) e entrar com outra conta (dono → outro id).
   */
  const { user } = useAuth();
  const ownerId = user?.id ?? null;
  const previousOwner = useRef<string | null>(null);

  useEffect(() => {
    if (previousOwner.current !== null && previousOwner.current !== ownerId) {
      setCurrentTripIdState(null);
    }
    previousOwner.current = ownerId;
  }, [ownerId]);

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
