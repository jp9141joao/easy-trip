import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import type { TripSuggestion } from '@/domain/types';
import {
  MINIMUM_SUGGESTIONS,
  SUGGESTION_CATEGORIES,
  SuggestionGenerationError,
  canRefreshSuggestions,
  findSimilar,
  type SuggestionCategory,
} from '@/domain/suggestions';
import { useAuth } from '@/providers/AuthProvider';
import { BackendCapabilityError } from '@/repositories/backendCapabilities';
import { dataSource } from '@/repositories';
import { queryKeys } from './queryKeys';
import { useItinerary } from './useTripData';

/**
 * Depois de uma tentativa de geração, a marca d'água mudou (§24 do handoff).
 *
 * O estado da geração mora na linha da VIAGEM, não na coleção de sugestões — e
 * é ele que decide se "Atualizar sugestões" fica habilitado. Desde a 0017 são
 * três marcas, e uma tentativa mexe em pelo menos uma delas: a marca d'água de
 * seis horas quando entregou, o cooldown curto quando não entregou. Quem tem a
 * versão velha da viagem é justamente quem acabou de tentar: sem invalidar, o
 * botão continuaria aceso e o próximo toque só descobriria a recusa indo à
 * rede.
 *
 * Invalida as duas chaves porque a Home lista viagens pela coleção agregada, e
 * é dela que sai o cartão. Nenhuma delas é a chave das sugestões, então isto
 * não realimenta a consulta que o disparou — não há laço de refetch.
 */
async function invalidateAfterClaim(
  queryClient: QueryClient,
  tripId: string,
  userId: string | undefined,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.trip(tripId) }),
    userId
      ? queryClient.invalidateQueries({ queryKey: queryKeys.trips(userId) })
      : Promise.resolve(),
  ]);
}

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
export function useSuggestions(
  tripId?: string,
  access: { resolved: boolean; canEdit: boolean } = { resolved: true, canEdit: true },
) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id;
  const key = queryKeys.suggestions(tripId ?? 'none');

  const load = useCallback(async () => {
    // A viewer lists what already exists but never invokes generation or a
    // catalog upsert. Waiting for a resolved role also prevents an initial
    // `undefined` permission from accidentally taking either branch.
    if (!access.canEdit) return dataSource.suggestions.listByTrip(tripId!);

    // Só invalida a viagem quando esta ida pode ter consumido a janela: uma
    // lista já completa devolve o mesmo conteúdo sem tocar na Function, e
    // invalidar aí faria a Home refazer consulta a cada volta à tela.
    const antes = queryClient.getQueryData<TripSuggestion[]>(key);
    try {
      const data = await dataSource.suggestions.ensure(tripId!);
      if (!antes || data.length !== antes.length) {
        await invalidateAfterClaim(queryClient, tripId!, userId);
      }
      return data;
    } catch (error) {
      if (error instanceof SuggestionGenerationError) {
        await invalidateAfterClaim(queryClient, tripId!, userId);
      }
      throw error;
    }
  }, [access.canEdit, key, queryClient, tripId, userId]);

  return useQuery({
    queryKey: key,
    queryFn: load,
    enabled: Boolean(tripId) && access.resolved,
    staleTime: 30 * 60 * 1000,
    retry: shouldRetrySuggestions,
  });
}

/**
 * Repetir `ensure` só faz sentido quando a ida à rede não chegou a acontecer.
 *
 * O PADRÃO DO APLICATIVO NÃO SERVE AQUI. `AppProviders` repete toda consulta
 * até três vezes, e para uma leitura isso é acerto: a segunda tentativa pega o
 * que a primeira perdeu. `ensure` não é uma leitura — é uma leitura que pode
 * GERAR, e a geração reserva a tentativa no compare-and-set ANTES do Gemini
 * (0012, 0017). Depois da primeira tentativa a porta está fechada de um jeito
 * ou de outro — janela de seis horas se ela entregou, cooldown de minutos se
 * não — e as repetições nem chegam a chamar a Function: elas só reencontram a
 * lista abaixo do mínimo e levantam a mesma recusa.
 *
 * A 0017 encurtou a espera, e não a transformou em "pode repetir agora": três
 * tentativas em sequência continuariam sendo três esqueletos de 30 s para
 * chegar ao mesmo veredito.
 *
 * O preço disso era pago em tela. Cada tentativa carrega o orçamento de 30 s
 * do `postJson`, então uma falha de geração deixava o esqueleto no ar por até
 * um minuto e meio antes de mostrar qualquer coisa — e o que aparecia no fim
 * era o erro da ÚLTIMA tentativa, que já não descrevia o que de fato houve.
 *
 * Uma `SuggestionGenerationError` é sempre um veredito: a tentativa aconteceu
 * e o motivo já está classificado (§15). Ela sobe na hora. O que continua
 * merecendo repetição é o resto — a leitura da coleção que não chegou.
 */
export function shouldRetrySuggestions(failureCount: number, error: unknown): boolean {
  if (error instanceof SuggestionGenerationError) return false;
  if (error instanceof BackendCapabilityError) return false;
  return failureCount < 2;
}

export function useRefreshSuggestions(tripId: string) {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: () => dataSource.suggestions.ensure(tripId, { force: true }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.suggestions(tripId), data);
    },
    // `onSettled`, e não `onSuccess`: a tentativa é reservada ANTES do Gemini,
    // então uma geração que falha no provedor também deixou estado novo na
    // linha da viagem — o cooldown curto da 0017, no lugar da marca d'água.
    onSettled: () => invalidateAfterClaim(queryClient, tripId, user?.id),
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
