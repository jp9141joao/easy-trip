import { useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { useTrip } from '@/hooks/useTrips';
import { useTripSelection } from '@/providers/TripSelectionProvider';
import { describeBackendCapability } from '@/repositories/backendCapabilities';

/**
 * Resolves the trip for a `/trip/[tripId]/...` route.
 *
 * Opening a trip route also makes it the active trip, so the dashboard, the AI
 * context and the utility screens all follow the trip the user is looking at
 * (§99, fluxo 3).
 */
export function useTripRoute() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const { currentTripId, setCurrentTripId } = useTripSelection();
  const query = useTrip(tripId);

  useEffect(() => {
    // O parâmetro da URL não prova acesso. Só uma viagem realmente devolvida
    // pela query pode virar a seleção ativa. Quando uma revogação remove o
    // cache enquanto esta rota ainda está montada, `query.data` some; usar só
    // `tripId` aqui regravaria imediatamente a seleção que o cleanup apagou.
    const accessibleTripId = query.data?.id;
    if (accessibleTripId && accessibleTripId !== currentTripId) {
      setCurrentTripId(accessibleTripId);
    }
  }, [query.data?.id, currentTripId, setCurrentTripId]);

  return {
    tripId: tripId!,
    trip: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    errorMessage:
      describeBackendCapability(query.error) ?? 'Verifique sua conexão e tente novamente.',
    /** True when the id no longer maps to a record (deleted trip). */
    notFound: !query.isLoading && !query.isError && query.data === null,
    refetch: query.refetch,
  };
}
