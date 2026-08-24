import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import type { TripSuggestion } from '@/domain/types';
import {
  MINIMUM_SUGGESTIONS,
  SUGGESTION_CATEGORIES,
  canRefreshSuggestions,
  findSimilar,
  type SuggestionCategory,
} from '@/domain/suggestions';
import { dataSource } from '@/repositories';
import { queryKeys } from './queryKeys';
import { useItinerary } from './useTripData';

/**
 * Sugestões da viagem (§39–§48).
 *
 * `ensure` — e não `list` — é o que a tela chama ao abrir. A diferença é que
 * `ensure` completa a lista quando ela está abaixo do mínimo, e não faz nada
 * quando já está cheia: abrir a tela dez vezes não gasta dez gerações (§43).
 *
 * `staleTime` alto porque sugestão não muda sozinha. Sem ele, cada volta à tela
 * dispararia `ensure` de novo — que não geraria nada, mas iria à rede para
 * descobrir isso.
 */
export function useSuggestions(tripId?: string) {
  return useQuery({
    queryKey: queryKeys.suggestions(tripId ?? 'none'),
    queryFn: () => dataSource.suggestions.ensure(tripId!),
    enabled: Boolean(tripId),
    staleTime: 30 * 60 * 1000,
  });
}

export function useRefreshSuggestions(tripId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => dataSource.suggestions.ensure(tripId, { force: true }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.suggestions(tripId), data);
    },
  });
}

export { canRefreshSuggestions };

/**
 * As sugestões separadas por categoria, sem as categorias vazias.
 *
 * Categoria vazia não vira aba: um filtro "Noite" que abre sem nada é pior do
 * que não ter o filtro — a pessoa conclui que a viagem não tem vida noturna,
 * quando o que houve é que ninguém sugeriu nada dessa categoria.
 */
export function useSuggestionsByCategory(suggestions: TripSuggestion[]) {
  return useMemo(() => {
    const groups = new Map<SuggestionCategory, TripSuggestion[]>();
    for (const category of SUGGESTION_CATEGORIES) {
      const items = suggestions.filter((s) => s.category === category);
      if (items.length > 0) groups.set(category, items);
    }
    return groups;
  }, [suggestions]);
}

/**
 * Esta sugestão já está no roteiro? (§46)
 *
 * A resposta alimenta a confirmação "Já existe um item parecido no seu
 * roteiro" — que oferece "Adicionar mesmo assim", e não bloqueia. Duplicar de
 * propósito é legítimo (dois dias no mesmo museu); duplicar sem perceber não é.
 */
export function useSuggestionDuplicate(tripId?: string) {
  const { data: itinerary = [] } = useItinerary(tripId);

  return useMemo(() => {
    const existing = itinerary.map((item) => ({
      id: item.id,
      title: item.placeName ?? item.title,
      latitude: item.latitude,
      longitude: item.longitude,
      date: item.date,
    }));

    return (suggestion: TripSuggestion) =>
      findSimilar(
        {
          title: suggestion.placeName ?? suggestion.title,
          latitude: suggestion.latitude,
          longitude: suggestion.longitude,
        },
        existing,
      );
  }, [itinerary]);
}

export { MINIMUM_SUGGESTIONS };
