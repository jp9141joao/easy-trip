import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { config } from '@/lib/config';
import { joinSharedRealtimeChannel } from '@/lib/realtimeChannel';
import { useAuth } from '@/providers/AuthProvider';
import { queryKeys } from './queryKeys';

/**
 * Realtime da viagem aberta (§8).
 *
 * O QUE ISTO ASSINA, E O QUE NÃO ASSINA
 *
 * Uma assinatura, filtrada por `trip_id`, para a viagem que está na tela — e
 * mais nada (§58). Assinar todas as viagens da conta significaria receber
 * evento de uma viagem que a pessoa não está olhando, gastando bateria e
 * invalidando cache que ninguém vai ler. Ao sair da tela, tudo é removido.
 *
 * UMA ASSINATURA POR VIAGEM, NÃO POR TELA
 *
 * Seis telas da viagem montam este hook, e a navegação empilha uma sobre a
 * outra: ao abrir Sugestões a partir da Jornada, as duas ficam montadas ao
 * mesmo tempo. Quem cuida disso é `joinSharedRealtimeChannel` — o canal é um
 * só, com contagem de referências, e as telas apenas entram e saem da lista de
 * ouvintes. Era a ausência disso que estourava "cannot add `postgres_changes`
 * callbacks ... after `subscribe()`" ao abrir Sugestões.
 *
 * POR QUE INVALIDAR EM VEZ DE APLICAR O PAYLOAD
 *
 * O evento do Postgres traz a linha crua, sem as URLs assinadas do Storage, sem
 * a visibilidade já resolvida, e — o que importa — sem passar pela mesma
 * transformação que o repositório aplica. Escrever essa linha direto no cache
 * criaria um segundo caminho de leitura, com formato ligeiramente diferente do
 * primeiro.
 *
 * Invalidar é mais lento e é certo: o React Query relê pelo caminho normal, com
 * RLS, mappers e tudo. E resolve de graça o problema do evento chegar em cima
 * de uma mutação otimista local — o refetch converge para o que o servidor
 * realmente tem, em vez de somar as duas versões.
 *
 * PRIVACIDADE
 *
 * O Realtime do Supabase avalia a RLS antes de entregar a linha, então uma
 * entrada de diário privada de outro membro não chega aqui. Ainda assim, o
 * único uso que se faz do evento é "invalide esta chave" — o conteúdo do
 * payload nunca é lido nem exibido. Mesmo que um dia vazasse, não teria por
 * onde aparecer na tela (§63).
 */

/** As tabelas da viagem que a tela precisa reler quando mudam. */
export const TRIP_REALTIME_TABLES = [
  'itinerary_items',
  'checklist_items',
  'expenses',
  'tickets',
  'journal_entries',
  'trip_members',
  'trip_invites',
  'trip_suggestions',
] as const;

type TripRealtimeTable = (typeof TRIP_REALTIME_TABLES)[number];

export function useTripRealtime(tripId?: string) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id;

  useEffect(() => {
    // Modo demonstração não tem servidor, e portanto não tem o que sincronizar:
    // o único aparelho que escreve é este.
    //
    // A conta entra na dependência, e não no nome do tópico: quem troca de
    // identidade derruba TODOS os canais na hora (ver `applySession`), e uma
    // tela que continuou montada precisa reentrar sob a conta nova em vez de
    // ficar com uma assinatura que já não existe. Sem sessão não há assinatura
    // — o Realtime lê pela RLS de quem está conectado.
    if (!config.hasSupabase || !tripId || !userId) return;

    const filter = `trip_id=eq.${tripId}`;

    const invalidations: Record<TripRealtimeTable, () => Promise<void>> = {
      itinerary_items: () =>
        queryClient.invalidateQueries({ queryKey: queryKeys.itinerary(tripId) }),
      checklist_items: () =>
        queryClient.invalidateQueries({ queryKey: queryKeys.checklist(tripId) }),
      expenses: () => queryClient.invalidateQueries({ queryKey: queryKeys.expenses(tripId) }),
      tickets: () =>
        queryClient.invalidateQueries({ queryKey: queryKeys.tripReservations(tripId) }),
      journal_entries: () => queryClient.invalidateQueries({ queryKey: queryKeys.journal(tripId) }),
      trip_members: async () => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.tripMembers(tripId) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.tripMemberNames(tripId) }),
        ]);
      },
      trip_invites: async () => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.tripInvites(tripId) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.tripMemberNames(tripId) }),
        ]);
      },
      trip_suggestions: () =>
        queryClient.invalidateQueries({ queryKey: queryKeys.suggestions(tripId) }),
    };

    return joinSharedRealtimeChannel(
      `trip:${tripId}`,
      TRIP_REALTIME_TABLES.map((table) => ({ table, filter })),
      (table) => void invalidations[table as TripRealtimeTable]?.(),
    );
  }, [tripId, userId, queryClient]);
}

/**
 * O sino é por PESSOA, não por viagem: o convite chega para uma viagem que o
 * convidado ainda não abriu — e não poderia abrir. Por isso este canal é
 * filtrado por `user_id` e fica montado uma única vez na raiz autenticada.
 *
 * Ele não vive em `useTripRealtime`: cada tela de viagem monta esse hook, o que
 * duplicava a assinatura de notificações e, na Home (onde ela mais importa),
 * não deixava assinatura nenhuma ativa.
 */
export function useNotificationRealtime() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  useEffect(() => {
    const userId = user?.id;
    if (!config.hasSupabase || !userId) return;

    return joinSharedRealtimeChannel(
      `notifications:${userId}`,
      [{ table: 'notifications', filter: `user_id=eq.${userId}` }],
      () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.notifications(userId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.myInvites(userId) });
      },
    );
  }, [user?.id, queryClient]);
}
