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

import { useCallback, useEffect, useState } from 'react';

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
  const [owner, setOwner] = useState<string | null>(null);
  /** Uma referência órfã a apagar do disco — nova identidade a cada pedido. */
  const [orphanCleanup, setOrphanCleanup] = useState<{ userId: string } | null>(null);

  // A troca de dono zera NO PRÓPRIO RENDER em que é percebida, antes de ler:
  // o contexto do USER_A não pode aparecer, nem por um quadro, dentro da
  // sessão do USER_B. É o padrão do React para ajustar estado quando uma
  // entrada muda — o render é refeito com o estado zerado antes do commit.
  if (owner !== userId) {
    setOwner(userId);
    setTripId(null);
    setRestoring(userId !== null);
  }

  // Validação contra a lista real do usuário. Só depois de a lista ter
  // carregado — antes disso "não está na lista" significa "a lista ainda não
  // chegou", e derrubar a seleção aqui apagaria o contexto a cada abertura.
  // A seleção cai no mesmo render; apagar a preferência do disco é efeito
  // externo, e fica para o efeito abaixo.
  const orphan =
    owner === userId &&
    !restoring &&
    tripsLoaded &&
    tripId !== null &&
    !trips.some((trip) => trip.id === tripId);
  if (orphan) {
    setTripId(null);
    if (userId) setOrphanCleanup({ userId });
  }

  useEffect(() => {
    if (orphanCleanup) void writeAITripContext(orphanCleanup.userId, null);
  }, [orphanCleanup]);

  // Restauração: uma vez por conta. `active` cai quando a conta muda (ou a
  // tela desmonta), e uma leitura atrasada da conta anterior é descartada.
  useEffect(() => {
    if (!userId) return;

    let active = true;
    void readAITripContext(userId).then((stored) => {
      if (!active) return;
      setTripId(stored);
      setRestoring(false);
    });
    return () => {
      active = false;
    };
  }, [userId]);

  const select = useCallback(
    (next: string) => {
      setTripId(next);
      if (userId) void writeAITripContext(userId, next);
    },
    [userId],
  );

  return { tripId, select, restoring };
}
