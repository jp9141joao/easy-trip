import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';

import { unreadCount } from '@/domain/notifications';
import { useAuth } from '@/providers/AuthProvider';
import { dataSource } from '@/repositories';
import { queryKeys } from './queryKeys';

/**
 * A Central de notificações (§7).
 *
 * `useAlerts` continua existindo e não é substituído. As duas fontes respondem
 * perguntas diferentes: aquela diz o que está acontecendo com a viagem agora
 * (recalculado, sem estado de lido), esta diz o que aconteceu (evento, com
 * instante e lido/não lido). O badge conta só esta — se contasse a outra, um
 * orçamento em 85% ficaria eternamente marcado como não lido.
 */
export function useNotifications() {
  const { user } = useAuth();

  return useQuery({
    queryKey: queryKeys.notifications(user?.id ?? 'anonymous'),
    queryFn: () => dataSource.notifications.list(user!.id),
    enabled: Boolean(user?.id),
  });
}

export function useUnreadNotificationCount(): number {
  const { data = [] } = useNotifications();
  return useMemo(() => unreadCount(data), [data]);
}

export function useNotificationMutations() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const key = queryKeys.notifications(user?.id ?? 'anonymous');
  const invalidate = () => queryClient.invalidateQueries({ queryKey: key });

  const markRead = useMutation({
    mutationFn: (id: string) => dataSource.notifications.markRead(id),
    // Tocar numa notificação tem de apagar o ponto na hora. A ida ao servidor
    // acontece atrás; se falhar, o rollback devolve o estado anterior.
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Awaited<ReturnType<typeof dataSource.notifications.list>>>(key);
      queryClient.setQueryData(key, (items: typeof previous) =>
        (items ?? []).map((item) =>
          item.id === id && !item.readAt ? { ...item, readAt: new Date().toISOString() } : item,
        ),
      );
      return { previous };
    },
    onError: (_error, _id, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: invalidate,
  });

  const markAllRead = useMutation({
    mutationFn: () => dataSource.notifications.markAllRead(user!.id),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => dataSource.notifications.remove(id),
    onSuccess: invalidate,
  });

  return { markRead, markAllRead, remove };
}

/**
 * Entrega os lembretes vencidos quando o aplicativo abre.
 *
 * ISTO NÃO É PUSH, e não finge ser (§33). Sem notificação do sistema
 * operacional, o lembrete aparece no primeiro momento em que a pessoa abre o
 * Easy Trip depois do horário — nunca antes, nunca com o aplicativo fechado. O
 * que está escrito na tela de lembretes diz exatamente isso.
 *
 * Roda uma vez por sessão. O `ref` existe porque este hook vive no layout raiz,
 * que re-renderiza a cada navegação: sem ele, cada troca de tela dispararia uma
 * chamada — e a função no Postgres, apesar de idempotente, não precisa ser
 * chamada trinta vezes para não fazer nada.
 */
export function useReminderDelivery() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const delivered = useRef<string | null>(null);

  useEffect(() => {
    const userId = user?.id;
    if (!userId || delivered.current === userId) return;
    delivered.current = userId;

    let cancelled = false;
    void dataSource.notifications
      .deliverDueReminders(userId)
      .then((count) => {
        if (cancelled || count === 0) return;
        return queryClient.invalidateQueries({ queryKey: queryKeys.notifications(userId) });
      })
      // Falhar aqui não pode impedir o aplicativo de abrir: a entrega tenta de
      // novo na próxima sessão, e o `sent_at` garante que nada se perca.
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [user?.id, queryClient]);
}

/**
 * Limpa o que sobrou de uma viagem à qual a pessoa perdeu acesso (§59).
 *
 * O cache persistido é escopado por conta (`queryPersistence`), o que resolve
 * "USER_A não reidrata dados de USER_B". O que ele não resolve sozinho é a
 * mudança de MEMBERSHIP dentro da mesma conta: quem foi removido de Paris
 * continuaria com o roteiro e as reservas de Paris em disco, e a Home os
 * mostraria por um instante na próxima abertura, antes de o refetch corrigir.
 *
 * "Por um instante" é tempo suficiente para alguém ler o que não deveria mais
 * ver. Então a notificação `trip_member_removed` — que é do próprio usuário e
 * chega pela Central — dispara a remoção de todas as chaves daquela viagem, do
 * cache em memória e do que for gravado depois.
 *
 * Não apaga a notificação: ela é o registro de que o acesso acabou, e a pessoa
 * tem o direito de lê-la.
 */
export function useRevokedTripCleanup() {
  const { data: notifications = [] } = useNotifications();
  const queryClient = useQueryClient();

  const revokedTripIds = useMemo(
    () =>
      notifications
        .filter((notification) => notification.type === 'trip_member_removed')
        .map((notification) => notification.data.tripId)
        .filter((tripId): tripId is string => Boolean(tripId))
        .join(','),
    [notifications],
  );

  useEffect(() => {
    if (!revokedTripIds) return;

    for (const tripId of revokedTripIds.split(',')) {
      // `removeQueries` e não `invalidateQueries`: invalidar pediria os dados
      // de novo, e o servidor recusaria — deixando a tela com o cache antigo e
      // um erro. Remover apaga.
      for (const key of [
        queryKeys.trip(tripId),
        queryKeys.itinerary(tripId),
        queryKeys.checklist(tripId),
        queryKeys.expenses(tripId),
        queryKeys.journal(tripId),
        queryKeys.journalMedia(tripId),
        queryKeys.tripReservations(tripId),
        queryKeys.suggestions(tripId),
        queryKeys.tripMembers(tripId),
        queryKeys.tripInvites(tripId),
      ]) {
        queryClient.removeQueries({ queryKey: key });
      }
    }
  }, [revokedTripIds, queryClient]);
}
