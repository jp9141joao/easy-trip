/**
 * A seleção de viagem da aba de IA.
 *
 * Existe como hook — e não como três `useState` dentro da tela — porque o
 * contrato tem três regras que precisam ser verificáveis sem montar a aba
 * inteira:
 *
 *  1. **nunca lê `currentTripId`.** A viagem da Home e a viagem da IA são
 *     seleções independentes (ver `src/lib/aiTripContext.ts`);
 *  2. **só restaura o que ainda existe.** Uma viagem apagada, ou de outra
 *     conta, não vira contexto: a referência órfã sai e a tela volta a pedir
 *     uma escolha;
 *  3. **não atravessa contas.** Trocar de usuário zera a seleção em memória
 *     antes de qualquer leitura do disco.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { Trip } from '@/domain/types';
import { readAITripContext, writeAITripContext } from '@/lib/aiTripContext';

export interface AITripContextValue {
  /** A viagem escolhida para a IA, ou `null`. */
  tripId: string | null;
  select: (tripId: string) => void;
  /** True enquanto a escolha anterior ainda está sendo lida do disco. */
  restoring: boolean;
}

export function useAITripContext(
  userId: string | null,
  trips: Trip[],
  tripsLoaded: boolean,
): AITripContextValue {
  const [tripId, setTripId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(true);
  const owner = useRef<string | null>(null);

  // Restauração: uma vez por conta.
  useEffect(() => {
    if (owner.current === userId) return;
    owner.current = userId;
    // A troca de dono zera antes de ler: o contexto do USER_A não pode
    // aparecer, nem por um quadro, dentro da sessão do USER_B.
    setTripId(null);

    if (!userId) {
      setRestoring(false);
      return;
    }

    let active = true;
    setRestoring(true);
    void readAITripContext(userId).then((stored) => {
      if (!active || owner.current !== userId) return;
      setTripId(stored);
      setRestoring(false);
    });
    return () => {
      active = false;
    };
  }, [userId]);

  // Validação contra a lista real do usuário. Só depois de a lista ter
  // carregado — antes disso "não está na lista" significa "a lista ainda não
  // chegou", e derrubar a seleção aqui apagaria o contexto a cada abertura.
  useEffect(() => {
    if (restoring || !tripsLoaded || !tripId) return;
    if (trips.some((trip) => trip.id === tripId)) return;
    setTripId(null);
    if (userId) void writeAITripContext(userId, null);
  }, [restoring, tripsLoaded, tripId, trips, userId]);

  const select = useCallback(
    (next: string) => {
      setTripId(next);
      if (userId) void writeAITripContext(userId, next);
    },
    [userId],
  );

  return { tripId, select, restoring };
}
