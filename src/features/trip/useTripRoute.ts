import { useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { useTrip } from '@/hooks/useTrips';
import { useTripSelection } from '@/providers/TripSelectionProvider';

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
    if (tripId && tripId !== currentTripId) setCurrentTripId(tripId);
  }, [tripId, currentTripId, setCurrentTripId]);

  return {
    tripId: tripId!,
    trip: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    /** True when the id no longer maps to a record (deleted trip). */
    notFound: !query.isLoading && !query.isError && query.data === null,
    refetch: query.refetch,
  };
}
