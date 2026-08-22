import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import {
  getDaysUntilTrip,
  getRemainingBudget,
  getTripStatus,
  getTripTotalSpent,
} from '@/domain/selectors';
import type { Trip } from '@/domain/types';
import { useAuth } from '@/providers/AuthProvider';
import { dataSource } from '@/repositories';
import { aiService, buildTripContext } from '@/services/ai';
import { queryKeys } from './queryKeys';
import { useChecklist, useExpenses, useItinerary } from './useTripData';
import { usePlaces } from './useContent';

/**
 * A conversa da Easy Trip IA para a viagem escolhida (§47).
 *
 * O assistente recebe os registros *reais* daquela viagem — orçamento,
 * despesas, roteiro, checklist — para responder sobre ela e não sobre um
 * destino genérico.
 *
 * CONTEXTO É A VIAGEM RECEBIDA, PONTO
 *
 * O hook não busca viagem nenhuma: quem manda é o `trip` que a tela passa, e a
 * tela só passa objetos vindos da lista do próprio usuário (`useTrips`, que é
 * `list(userId)` sob RLS). Nunca existe um `tripId` solto virando contexto, e
 * como toda consulta de dados é chaveada por `trip.id`, não há como misturar
 * duas viagens: trocar a viagem troca a conversa, o contexto e o histórico de
 * uma vez só.
 *
 * Sem viagem selecionada não há conversa e `send` recusa — é isso que garante
 * que nenhuma pergunta saia sem contexto.
 */
export function useAIConversation(trip: Trip | null) {
  const { user, session, profile } = useAuth();
  const queryClient = useQueryClient();

  /**
   * Conversa aberta explicitamente por "Novo chat".
   *
   * Existe porque `getOrCreateConversation` sempre devolve a mais recente da
   * viagem, e uma conversa recém-criada precisa valer imediatamente — sem
   * depender de refetch e sem apagar a anterior.
   */
  const [openedConversationId, setOpenedConversationId] = useState<string | null>(null);

  // Trocar de viagem é trocar de conversa: a escolha manual não pode sobreviver
  // à troca, ou o chat de Tóquio continuaria escrevendo na thread de Paris.
  useEffect(() => {
    setOpenedConversationId(null);
  }, [trip?.id]);

  const conversationQuery = useQuery({
    queryKey: queryKeys.aiConversation(user?.id ?? 'anonymous', trip?.id),
    queryFn: () => dataSource.ai.getOrCreateConversation(user!.id, trip!.id),
    enabled: Boolean(user && trip),
  });

  const conversationId = openedConversationId ?? conversationQuery.data?.id;

  const messagesQuery = useQuery({
    queryKey: queryKeys.aiMessages(conversationId ?? 'none'),
    queryFn: () => dataSource.ai.listMessages(conversationId!),
    enabled: Boolean(conversationId),
  });

  // Dados da viagem que alimentam o contexto do modelo.
  const { data: expenses = [] } = useExpenses(trip?.id);
  const { data: itinerary = [] } = useItinerary(trip?.id);
  const { data: checklist = [] } = useChecklist(trip?.id);
  const { data: places = [] } = usePlaces(trip ? { city: trip.destinationCity } : undefined);

  const send = useMutation({
    mutationFn: async (prompt: string) => {
      if (!trip) throw new Error('Selecione uma viagem antes de perguntar.');
      if (!conversationId) throw new Error('Conversa indisponível.');

      const history = messagesQuery.data ?? [];
      await dataSource.ai.addMessage({ conversationId, role: 'user', content: prompt });
      await queryClient.invalidateQueries({ queryKey: queryKeys.aiMessages(conversationId) });

      const context = buildTripContext({
        trip,
        status: getTripStatus(trip),
        daysUntil: getDaysUntilTrip(trip),
        totalSpent: getTripTotalSpent(expenses, trip),
        remainingBudget: getRemainingBudget(expenses, trip),
        expenses,
        itinerary,
        checklist,
        profile,
        places,
      });

      const reply = await aiService.send({
        prompt,
        context,
        history,
        accessToken: session?.accessToken,
      });

      await dataSource.ai.addMessage({
        conversationId,
        role: 'assistant',
        content: reply.content,
      });
      return reply;
    },
    onSettled: () => {
      if (conversationId) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.aiMessages(conversationId) });
      }
    },
  });

  /**
   * "Novo chat": cria de fato outra conversa para a mesma viagem.
   *
   * As mensagens anteriores continuam no banco, na conversa anterior — este
   * botão abre uma thread nova, não apaga histórico.
   */
  const newChat = useMutation({
    mutationFn: async () => {
      if (!trip) throw new Error('Selecione uma viagem antes de iniciar um chat.');
      return dataSource.ai.createConversation(user!.id, trip.id);
    },
    onSuccess: (conversation) => {
      // A conversa nasce vazia; semear o cache evita o piscar do histórico
      // antigo enquanto a lista de mensagens ainda não voltou.
      queryClient.setQueryData(queryKeys.aiMessages(conversation.id), []);
      setOpenedConversationId(conversation.id);
      send.reset();
      void queryClient.invalidateQueries({
        queryKey: queryKeys.aiConversation(user!.id, trip!.id),
      });
    },
  });

  const clear = useMutation({
    mutationFn: () => dataSource.ai.clearConversation(conversationId!),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.aiMessages(conversationId!) }),
  });

  return {
    conversationId,
    messages: messagesQuery.data ?? [],
    isLoading: Boolean(trip) && (conversationQuery.isLoading || messagesQuery.isLoading),
    send,
    newChat,
    /**
     * Apaga as mensagens da conversa atual. Continua existindo porque é uma
     * operação do repositório, mas a tela não a oferece: "Novo chat" abre uma
     * thread nova em vez de destruir a anterior.
     */
    clear,
    /** `gemini` when the BFF is wired up, `local` otherwise — shown as a badge. */
    kind: aiService.kind,
  };
}
