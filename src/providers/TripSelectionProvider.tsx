import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  clearTripSelection,
  discardLegacyTripSelection,
  readTripSelection,
  writeTripSelection,
} from '@/lib/tripSelectionStorage';
import { useAuth } from './AuthProvider';

/**
 * The active trip (§11).
 *
 * This is the *only* trip state kept globally — a single id. Every module then
 * loads its own records by that `tripId`, which is what makes the Paris/Kyoto
 * mix-up (§100) structurally impossible: there is no second copy of a trip
 * anywhere to drift out of sync.
 */

interface TripSelectionValue {
  currentTripId: string | null;
  setCurrentTripId: (tripId: string | null) => void;
  /** True until the persisted selection has been read back. */
  restoring: boolean;
}

const TripSelectionContext = createContext<TripSelectionValue | null>(null);

export function TripSelectionProvider({ children }: { children: ReactNode }) {
  const restoreGeneration = useRef(0);

  /*
   * A seleção pertence à conta, não ao aparelho.
   *
   * Disco e memória usam o mesmo dono. Não existe leitura global no bootstrap:
   * primeiro o Auth descobre a conta, só então esta conta lê sua própria chave.
   * Isso fecha o caso `null → B` em que a antiga chave global ainda continha a
   * viagem de A.
   */
  const { user } = useAuth();
  const ownerId = user?.id ?? null;

  const [currentTripId, setCurrentTripIdState] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(ownerId !== null);

  /*
   * A troca de dono zera a seleção NO PRÓPRIO RENDER em que é percebida.
   *
   * É o padrão do React para "ajustar estado quando uma entrada muda": o render
   * é descartado e refeito com o estado já zerado antes de chegar aos filhos.
   * Assim nenhuma tela de B chega a ver, nem por um commit, a viagem de A — o
   * que zerar dentro do efeito permitia — e o efeito abaixo fica só com a
   * leitura assíncrona do disco.
   */
  const [selectionOwnerId, setSelectionOwnerId] = useState(ownerId);
  if (selectionOwnerId !== ownerId) {
    setSelectionOwnerId(ownerId);
    setCurrentTripIdState(null);
    setRestoring(ownerId !== null);
  }

  /*
   * O dono vigente para quem chega atrasado — callbacks e leituras assíncronas.
   * Gravado num efeito de layout, e não durante o render: roda antes dos
   * efeitos passivos e de qualquer evento do commit novo, e o render continua
   * puro.
   */
  const activeOwnerId = useRef<string | null>(ownerId);
  useLayoutEffect(() => {
    activeOwnerId.current = ownerId;
  }, [ownerId]);

  useEffect(() => {
    let active = true;
    const bornAt = restoreGeneration.current + 1;
    restoreGeneration.current = bornAt;

    if (!ownerId) {
      return () => {
        active = false;
      };
    }

    (async () => {
      const stored = await readTripSelection(ownerId);
      // The legacy bare string has no owner and is never applied. Removing it
      // is safe because current versions never write that global key.
      void discardLegacyTripSelection().catch(() => undefined);
      if (
        active &&
        bornAt === restoreGeneration.current &&
        activeOwnerId.current === ownerId
      ) {
        setCurrentTripIdState(stored);
        setRestoring(false);
      }
    })().catch(() => {
      if (
        active &&
        bornAt === restoreGeneration.current &&
        activeOwnerId.current === ownerId
      ) {
        setCurrentTripIdState(null);
        setRestoring(false);
      }
    });

    return () => {
      active = false;
    };
  }, [ownerId]);

  const setCurrentTripId = useCallback(
    (tripId: string | null) => {
      // A callback captured by A must not write into B after an async screen
      // transition. The key is owner-scoped, and the in-memory write is fenced
      // by the same owner.
      if (!ownerId || activeOwnerId.current !== ownerId) return;
      setCurrentTripIdState(tripId);
      if (tripId) void writeTripSelection(ownerId, tripId);
      else void clearTripSelection(ownerId);
    },
    [ownerId],
  );

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
