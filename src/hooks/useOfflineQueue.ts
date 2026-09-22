import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';

import {
  discard as discardItem,
  enqueue as enqueueItem,
  retryAll as retryAllItems,
  retryNow as retryNowItem,
  summarize,
  type EnqueueInput,
  type OfflineQueue,
  type QueueSummary,
} from '@/domain/offlineQueue';
import { createId } from '@/lib/id';
import { clearQueue, loadQueue, saveQueue } from '@/lib/offlineQueue';
import { useAuth } from '@/providers/AuthProvider';
import { useConnectivity } from '@/providers/ConnectivityProvider';
import { authAdapter, dataSource } from '@/repositories';
import { drainQueue } from '@/services/offlineSync';
import { queryKeys } from './queryKeys';

/**
 * A fila offline, ligada à sessão e à conectividade (§33).
 *
 * A fila em si é `@tanstack/react-query` com o disco como fonte: a mesma chave
 * de consulta em toda tela, e uma invalidação depois de cada escrita. Isso é o
 * que faz o indicador de sincronização pendente aparecer no mesmo instante em
 * qualquer lugar do aplicativo, sem um provider a mais só para isso.
 *
 * QUANDO DRENA
 *
 * Quando a conexão volta, e uma vez ao abrir com conexão. Não há relógio
 * repetido: um `setInterval` tentando de minuto em minuto gastaria bateria para
 * descobrir o que a camada de rede já sabe dizer. O `nextAttemptAt` de cada
 * item cuida do resto — um item que falhou espera a vez dele mesmo que a
 * drenagem seja disparada antes.
 */

const QUEUE_KEY = (userId: string) => queryKeys.offlineQueue(userId);

export function useOfflineQueue() {
  const { user } = useAuth();
  const { isOnline } = useConnectivity();
  const queryClient = useQueryClient();
  const userId = user?.id;

  const query = useQuery({
    queryKey: QUEUE_KEY(userId ?? 'anonymous'),
    queryFn: () => loadQueue(userId!),
    enabled: Boolean(userId),
    // A fila muda por escrita, não por tempo. Refazer a leitura do disco em
    // foco de janela só produziria trabalho.
    staleTime: Infinity,
  });

  const queue: OfflineQueue = query.data ?? [];

  const write = useCallback(
    async (next: OfflineQueue) => {
      if (!userId) return;
      await saveQueue(userId, next);
      queryClient.setQueryData(QUEUE_KEY(userId), next);
    },
    [queryClient, userId],
  );

  /**
   * Uma drenagem por vez.
   *
   * `draining` é `useRef` e não estado: duas drenagens simultâneas enviariam a
   * mesma mutação duas vezes, e um re-render entre a checagem e a marcação
   * abriria exatamente essa janela se o guarda fosse estado.
   */
  const draining = useRef(new Set<string>());

  const drain = useCallback(async () => {
    if (!userId || draining.current.has(userId)) return;
    draining.current.add(userId);
    let sameSession = true;
    const unsubscribe = authAdapter.onAuthStateChange((session) => {
      // Uma drenagem cancelada não revive se a conta entrar novamente.
      if (session?.user.id !== userId) sameSession = false;
    });
    try {
      const session = await authAdapter.restore();
      if (!sameSession || session?.user.id !== userId) return;
      const atual = await loadQueue(userId);
      if (!sameSession || atual.length === 0) return;

      const resultado = await drainQueue(dataSource, atual, userId, {
        // Gravar a cada passo é o que dá durabilidade: um encerramento abrupto
        // no meio perde no máximo o resultado do item em curso, que será
        // reenviado e reconhecido como repetição.
        onProgress: (parcial) => saveQueue(userId, parcial),
        canSync: () => sameSession,
      });

      if (!sameSession) return;
      queryClient.setQueryData(QUEUE_KEY(userId), resultado.queue);

      // O que subiu mudou o servidor; as telas precisam reler. Só quando algo
      // de fato subiu — invalidar tudo a cada tentativa fracassada faria a
      // interface piscar sem motivo.
      if (resultado.succeeded > 0) {
        await queryClient.invalidateQueries();
      }
    } finally {
      unsubscribe();
      draining.current.delete(userId);
    }
  }, [queryClient, userId]);

  useEffect(() => {
    if (isOnline && userId) void drain();
  }, [drain, isOnline, userId]);

  const enqueue = useCallback(
    async (input: Omit<EnqueueInput, 'id' | 'userId'>) => {
      if (!userId) return;
      const atual = await loadQueue(userId);
      const next = enqueueItem(
        atual,
        { ...input, id: createId(), userId },
        new Date().toISOString(),
      );
      await write(next);
    },
    [userId, write],
  );

  const retry = useCallback(
    async (id: string) => {
      if (!userId) return;
      await write(retryNowItem(await loadQueue(userId), id, new Date().toISOString()));
      await drain();
    },
    [drain, userId, write],
  );

  const retryAll = useCallback(async () => {
    if (!userId) return;
    await write(retryAllItems(await loadQueue(userId), userId, new Date().toISOString()));
    await drain();
  }, [drain, userId, write]);

  const discard = useCallback(
    async (id: string) => {
      if (!userId) return;
      await write(discardItem(await loadQueue(userId), id));
    },
    [userId, write],
  );

  const summary: QueueSummary = summarize(queue, userId);

  return { queue, summary, enqueue, retry, retryAll, discard, drain, clear: () => userId && clearQueue(userId) };
}
