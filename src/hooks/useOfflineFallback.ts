import { useCallback } from 'react';

import {
  classifyFailure,
  type QueueableEntity,
  type QueueOperation,
} from '@/domain/offlineQueue';
import { createId } from '@/lib/id';
import { describeFailure } from '@/services/offlineSync';
import { useOfflineQueue } from './useOfflineQueue';

/**
 * Escrever agora; e, se não der por falta de rede, escrever depois (§33).
 *
 * A FILA NÃO É O CAMINHO PADRÃO — É O DESVIO
 *
 * Toda escrita tenta ir direto ao servidor primeiro. A fila só entra quando a
 * tentativa falha por algo que pode melhorar sozinho: sem sinal, tempo
 * esgotado, servidor fora do ar. É a mesma classificação que a drenagem usa
 * (`classifyFailure`), e usá-la nos dois lugares é o que impede a interface e a
 * fila de discordarem sobre o que é um erro.
 *
 * O que NÃO vai para a fila continua não indo: uma recusa por permissão, um
 * dado inválido, uma viagem que já não existe. Enfileirar isso adiaria um erro
 * que a pessoa precisa ver AGORA, enquanto ainda lembra o que estava fazendo —
 * e o adiaria para um momento em que ela não está olhando.
 *
 * POR QUE ISTO NÃO SE PARECE COM UM "MODO OFFLINE"
 *
 * Não existe um interruptor consultado antes de escrever. `useConnectivity`
 * sabe se há rede, mas "há rede" e "a escrita vai passar" não são a mesma
 * coisa: Wi-Fi de aeroporto com portal cativo responde a tudo e entrega nada.
 * Quem decide é a tentativa real, e é por isso que o desvio fica DEPOIS dela.
 */
export function useOfflineFallback(entity: QueueableEntity, tripId?: string) {
  const { enqueue } = useOfflineQueue();

  /**
   * `direct` é a escrita de verdade. `optimistic` é o que devolver quando ela
   * for adiada — para uma criação, a linha como ela ficará, com o id que já foi
   * escolhido. A tela mostra isso e não fica com um buraco esperando a rede.
   */
  return useCallback(
    async function write<T>(params: {
      operation: QueueOperation;
      targetId: string;
      payload: Record<string, unknown>;
      direct: () => Promise<T>;
      optimistic: T;
      baseUpdatedAt?: string;
    }): Promise<T> {
      try {
        return await params.direct();
      } catch (error) {
        if (classifyFailure(describeFailure(error), params.operation) !== 'retry') {
          throw error;
        }
        await enqueue({
          entity,
          operation: params.operation,
          targetId: params.targetId,
          tripId,
          payload: params.payload,
          baseUpdatedAt: params.baseUpdatedAt,
        });
        return params.optimistic;
      }
    },
    [enqueue, entity, tripId],
  );
}

/**
 * O id de uma linha que ainda não existe.
 *
 * Gerado no aparelho ANTES da tentativa, e não depois da falha: é o mesmo id
 * que vai no `insert`, então a criação que passou e a criação que foi adiada
 * produzem a mesma linha. Se o id fosse escolhido só ao enfileirar, um envio
 * cuja resposta se perdeu criaria uma linha com id do servidor e a fila
 * criaria outra com id do aparelho — duas despesas onde havia uma.
 */
export function newRowId(): string {
  return createId();
}
