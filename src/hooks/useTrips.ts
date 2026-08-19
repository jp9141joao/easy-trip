import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

import type { Trip } from '@/domain/types';
import { getTripStatus } from '@/domain/selectors';
import { todayISO } from '@/lib/date';
import { useAuth } from '@/providers/AuthProvider';
import { useTripSelection } from '@/providers/TripSelectionProvider';
import { dataSource } from '@/repositories';
import { queryKeys } from './queryKeys';

export function useTrips() {
  const { user } = useAuth();
  const userId = user?.id;

  return useQuery({
    queryKey: queryKeys.trips(userId ?? 'anonymous'),
    queryFn: () => dataSource.trips.list(userId!),
    enabled: Boolean(userId),
  });
}

export function useTrip(tripId?: string) {
  return useQuery({
    queryKey: queryKeys.trip(tripId ?? 'none'),
    queryFn: () => dataSource.trips.get(tripId!),
    enabled: Boolean(tripId),
  });
}

/**
 * Resolves the active trip.
 *
 * If the stored `currentTripId` no longer exists (deleted on another device, or
 * the account was wiped) we fall back to the most relevant trip instead of
 * leaving the app pointing at a ghost.
 */
export function useCurrentTrip() {
  const { currentTripId, setCurrentTripId, restoring } = useTripSelection();
  const tripsQuery = useTrips();
  const trips = useMemo(() => tripsQuery.data ?? [], [tripsQuery.data]);

  const resolved = useMemo(() => {
    if (trips.length === 0) return null;
    const selected = trips.find((trip) => trip.id === currentTripId);
    if (selected) return selected;
    return pickDefaultTrip(trips);
  }, [trips, currentTripId]);

  // Keep the persisted selection honest.
  useEffect(() => {
    if (tripsQuery.isLoading || restoring) return;
    if (resolved && resolved.id !== currentTripId) setCurrentTripId(resolved.id);
    if (!resolved && currentTripId) setCurrentTripId(null);
  }, [resolved, currentTripId, setCurrentTripId, tripsQuery.isLoading, restoring]);

  return {
    trip: resolved,
    trips,
    isLoading: tripsQuery.isLoading || restoring,
    isError: tripsQuery.isError,
    error: tripsQuery.error,
    refetch: tripsQuery.refetch,
    setCurrentTripId,
  };
}

/** Active trip first, then the nearest upcoming one, then the most recent. */
export function pickDefaultTrip(trips: Trip[], today: string = todayISO()): Trip | null {
  if (trips.length === 0) return null;

  const active = trips.find((trip) => getTripStatus(trip, today) === 'active');
  if (active) return active;

  const upcoming = trips
    .filter((trip) => getTripStatus(trip, today) === 'upcoming')
    .sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
  if (upcoming.length) return upcoming[0];

  return [...trips].sort((a, b) => (a.endDate > b.endDate ? -1 : 1))[0];
}

export function useCreateTrip() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { setCurrentTripId } = useTripSelection();

  return useMutation({
    mutationFn: (input: Omit<Trip, 'id' | 'userId' | 'createdAt' | 'updatedAt'>) =>
      dataSource.trips.create({ ...input, userId: user!.id }),
    onSuccess: async (trip) => {
      // A freshly created trip becomes the active one (§30).
      setCurrentTripId(trip.id);
      await queryClient.invalidateQueries({ queryKey: queryKeys.trips(user!.id) });
    },
  });
}

export function useUpdateTrip() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: ({ tripId, patch }: { tripId: string; patch: Partial<Trip> }) =>
      dataSource.trips.update(tripId, patch),
    onSuccess: async (trip) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.trips(user!.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.trip(trip.id) }),
      ]);
    },
  });
}

export function useDeleteTrip() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { currentTripId, setCurrentTripId } = useTripSelection();

  return useMutation({
    mutationFn: (tripId: string) => dataSource.trips.remove(tripId),
    onSuccess: async (_result, tripId) => {
      if (currentTripId === tripId) setCurrentTripId(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.trips(user!.id) });
    },
  });
}
