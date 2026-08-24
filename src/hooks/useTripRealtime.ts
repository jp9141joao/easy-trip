import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { config } from '@/lib/config';
import { useAuth } from '@/providers/AuthProvider';
import { getSupabaseClient } from '@/repositories/supabase/client';
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
export function useTripRealtime(tripId?: string) {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  useEffect(() => {
    // Modo demonstração não tem servidor, e portanto não tem o que sincronizar:
    // o único aparelho que escreve é este.
    if (!config.hasSupabase || !tripId) return;

    const client = getSupabaseClient();
    const filter = `trip_id=eq.${tripId}`;

    const invalidations: Record<string, () => Promise<void>> = {
      itinerary_items: () =>
        queryClient.invalidateQueries({ queryKey: queryKeys.itinerary(tripId) }),
      checklist_items: () =>
        queryClient.invalidateQueries({ queryKey: queryKeys.checklist(tripId) }),
      expenses: () => queryClient.invalidateQueries({ queryKey: queryKeys.expenses(tripId) }),
      tickets: () =>
        queryClient.invalidateQueries({ queryKey: queryKeys.tripReservations(tripId) }),
      journal_entries: () => queryClient.invalidateQueries({ queryKey: queryKeys.journal(tripId) }),
      trip_members: () =>
        queryClient.invalidateQueries({ queryKey: queryKeys.tripMembers(tripId) }),
      trip_invites: () =>
        queryClient.invalidateQueries({ queryKey: queryKeys.tripInvites(tripId) }),
      trip_suggestions: () =>
        queryClient.invalidateQueries({ queryKey: queryKeys.suggestions(tripId) }),
    };

    const channel = client.channel(`trip:${tripId}`);

    for (const [table, invalidate] of Object.entries(invalidations)) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter },
        () => void invalidate(),
      );
    }

    void channel.subscribe();

    return () => {
      // `removeChannel` e não `unsubscribe`: o segundo fecha a inscrição mas
      // deixa o canal registrado no cliente, e trocar de viagem várias vezes
      // acumularia canais mortos que continuam contando para o limite de
      // conexões do projeto.
      void client.removeChannel(channel);
    };
  }, [tripId, queryClient]);

  /**
   * O sino é por PESSOA, não por viagem: o convite chega para uma viagem que o
   * convidado ainda não abriu — e não poderia abrir. Por isso este canal é
   * filtrado por `user_id` e vive enquanto a sessão viver.
   */
  useEffect(() => {
    const userId = user?.id;
    if (!config.hasSupabase || !userId) return;

    const client = getSupabaseClient();
    const channel = client
      .channel(`notifications:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.notifications(userId) });
          void queryClient.invalidateQueries({ queryKey: queryKeys.myInvites(userId) });
        },
      );

    void channel.subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [user?.id, queryClient]);
}
