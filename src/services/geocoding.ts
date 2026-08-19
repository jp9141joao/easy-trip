/**
 * Destination lookup (§30).
 *
 * Resolving the city through Open-Meteo's geocoding API gives us country,
 * ISO country code, coordinates and the IANA timezone in one step. That is what
 * makes §12 structurally enforceable: a trip cannot exist with a destination
 * whose country and timezone were never established, so SOS, Clima and Fuso
 * always agree with the header.
 */

import { getJson } from './http';

export interface DestinationSuggestion {
  id: string;
  city: string;
  country: string;
  /** ISO 3166-1 alpha-2, uppercase. */
  countryCode: string;
  admin?: string;
  latitude: number;
  longitude: number;
  /** IANA timezone, e.g. `Asia/Tokyo`. */
  timezone: string;
}

interface GeocodingResponse {
  results?: {
    id: number;
    name: string;
    country?: string;
    country_code?: string;
    admin1?: string;
    latitude: number;
    longitude: number;
    timezone?: string;
  }[];
}

export async function searchDestinations(term: string): Promise<DestinationSuggestion[]> {
  const query = term.trim();
  if (query.length < 2) return [];

  // Medido, este host responde em ~0,4s quando está saudável, mas trava por
  // completo de vez em quando. Esperar 5s por tentativa já é dez vezes o normal:
  // além disso a conexão está pendurada, e tentar de novo resolve mais rápido do
  // que continuar esperando.
  const data = await getJson<GeocodingResponse>(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=8&language=pt&format=json`,
    { timeoutMs: 5_000, retries: 2 },
  );

  return (data.results ?? [])
    .filter((result) => result.country && result.country_code && result.timezone)
    .map((result) => ({
      id: String(result.id),
      city: result.name,
      country: result.country!,
      countryCode: result.country_code!.toUpperCase(),
      admin: result.admin1,
      latitude: result.latitude,
      longitude: result.longitude,
      timezone: result.timezone!,
    }));
}
