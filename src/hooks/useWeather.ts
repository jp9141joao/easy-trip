import { useQuery } from '@tanstack/react-query';

import type { Trip } from '@/domain/types';
import { weatherService } from '@/services/weather';
import { queryKeys } from './queryKeys';

/**
 * Weather for the active trip's destination (§62).
 *
 * Keyed on the trip's own coordinates, so the reading always belongs to the
 * trip in the header — never a hardcoded Paris.
 */
export function useTripWeather(trip: Trip | null) {
  const hasCoordinates = typeof trip?.latitude === 'number' && typeof trip?.longitude === 'number';

  return useQuery({
    queryKey: queryKeys.weather(trip?.latitude, trip?.longitude),
    queryFn: () =>
      weatherService.getCurrentWeather({
        city: trip!.destinationCity,
        latitude: trip!.latitude!,
        longitude: trip!.longitude!,
      }),
    enabled: hasCoordinates,
    // Weather is worth refetching, but not on every screen focus.
    staleTime: 15 * 60_000,
  });
}
