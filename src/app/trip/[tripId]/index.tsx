import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * The Trip Hub opens on Roteiro, which §33 defines as the default section.
 * Keeping it a redirect means `/trip/:id` and `/trip/:id/itinerary` never
 * render two different versions of the same screen.
 */
export default function TripHubScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  return <Redirect href={`/trip/${tripId}/itinerary`} />;
}
