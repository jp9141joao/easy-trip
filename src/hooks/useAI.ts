import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

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
 * The Easy Trip IA conversation for the active trip (§47).
 *
 * The assistant is handed the trip's *real* records — budget, expenses,
 * itinerary, checklist — so its answers are about this trip and not a generic
 * destination blurb.
 */
export function useAIConversation(trip: Trip | null) {
  const { user, session, profile } = useAuth();
  const queryClient = useQueryClient();

  const conversationQuery = useQuery({
    queryKey: queryKeys.aiConversation(user?.id ?? 'anonymous', trip?.id),
    queryFn: () => dataSource.ai.getOrCreateConversation(user!.id, trip?.id),
    enabled: Boolean(user),
  });

  const conversationId = conversationQuery.data?.id;

  const messagesQuery = useQuery({
    queryKey: queryKeys.aiMessages(conversationId ?? 'none'),
    queryFn: () => dataSource.ai.listMessages(conversationId!),
    enabled: Boolean(conversationId),
  });

  // Trip data feeding the model context.
  const { data: expenses = [] } = useExpenses(trip?.id);
  const { data: itinerary = [] } = useItinerary(trip?.id);
  const { data: checklist = [] } = useChecklist(trip?.id);
  const { data: places = [] } = usePlaces(trip ? { city: trip.destinationCity } : undefined);

  const send = useMutation({
    mutationFn: async (prompt: string) => {
      if (!conversationId) throw new Error('Conversa indisponível.');

      const history = messagesQuery.data ?? [];
      await dataSource.ai.addMessage({ conversationId, role: 'user', content: prompt });
      await queryClient.invalidateQueries({ queryKey: queryKeys.aiMessages(conversationId) });

      const context = trip
        ? buildTripContext({
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
          })
        : null;

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

  const clear = useMutation({
    mutationFn: () => dataSource.ai.clearConversation(conversationId!),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.aiMessages(conversationId!) }),
  });

  return {
    conversationId,
    messages: messagesQuery.data ?? [],
    isLoading: conversationQuery.isLoading || messagesQuery.isLoading,
    send,
    clear,
    /** `gemini` when the BFF is wired up, `local` otherwise — shown as a badge. */
    kind: aiService.kind,
  };
}
