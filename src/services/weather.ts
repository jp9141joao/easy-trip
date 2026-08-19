/**
 * Weather (§62, CA-07).
 *
 * Backed by Open-Meteo, which needs no API key — so the app shows genuinely
 * current weather rather than a hardcoded "Paris, 18°C". Every reading carries
 * its `source` and `updatedAt`, and the UI shows "Atualizado há 2h" when it is
 * serving the cached copy. Nothing here is ever labelled "tempo real" unless it
 * was actually just fetched.
 */

import { cacheStorage } from '@/lib/storage';
import { getJson, ServiceError } from './http';

export interface WeatherNow {
  temperature: number;
  apparentTemperature: number;
  humidity: number;
  windSpeed: number;
  code: number;
  description: string;
  isDay: boolean;
}

export interface WeatherDay {
  date: string;
  min: number;
  max: number;
  code: number;
  description: string;
}

export interface WeatherReading {
  city: string;
  now: WeatherNow;
  forecast: WeatherDay[];
  /** Where the numbers came from — shown in the UI. */
  source: string;
  /** When this reading was captured. */
  updatedAt: string;
  /** True when served from cache because the network was unavailable. */
  stale: boolean;
}

export interface WeatherQuery {
  city: string;
  latitude: number;
  longitude: number;
}

export interface WeatherService {
  getCurrentWeather(query: WeatherQuery): Promise<WeatherReading>;
}

/** WMO weather interpretation codes → pt-BR. */
const WMO: Record<number, string> = {
  0: 'Céu limpo',
  1: 'Predominantemente limpo',
  2: 'Parcialmente nublado',
  3: 'Nublado',
  45: 'Névoa',
  48: 'Névoa com geada',
  51: 'Garoa fraca',
  53: 'Garoa moderada',
  55: 'Garoa intensa',
  56: 'Garoa congelante',
  57: 'Garoa congelante intensa',
  61: 'Chuva fraca',
  63: 'Chuva moderada',
  65: 'Chuva forte',
  66: 'Chuva congelante',
  67: 'Chuva congelante forte',
  71: 'Neve fraca',
  73: 'Neve moderada',
  75: 'Neve forte',
  77: 'Grãos de neve',
  80: 'Pancadas de chuva',
  81: 'Pancadas de chuva moderadas',
  82: 'Pancadas de chuva fortes',
  85: 'Pancadas de neve',
  86: 'Pancadas de neve fortes',
  95: 'Tempestade',
  96: 'Tempestade com granizo',
  99: 'Tempestade com granizo forte',
};

export function describeWeatherCode(code: number): string {
  return WMO[code] ?? 'Condição indisponível';
}

interface OpenMeteoResponse {
  current?: {
    temperature_2m: number;
    relative_humidity_2m: number;
    apparent_temperature: number;
    weather_code: number;
    wind_speed_10m: number;
    is_day?: number;
  };
  daily?: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
  };
}

const SOURCE = 'Open-Meteo';

class OpenMeteoWeatherService implements WeatherService {
  async getCurrentWeather(query: WeatherQuery): Promise<WeatherReading> {
    const cacheKey = `weather:${query.latitude.toFixed(2)},${query.longitude.toFixed(2)}`;

    try {
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${query.latitude}&longitude=${query.longitude}` +
        '&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,is_day' +
        '&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=5';

      const data = await getJson<OpenMeteoResponse>(url);
      if (!data.current) throw new ServiceError('parse', 'Resposta de clima incompleta.');

      const reading: WeatherReading = {
        city: query.city,
        now: {
          temperature: Math.round(data.current.temperature_2m),
          apparentTemperature: Math.round(data.current.apparent_temperature),
          humidity: Math.round(data.current.relative_humidity_2m),
          windSpeed: Math.round(data.current.wind_speed_10m),
          code: data.current.weather_code,
          description: describeWeatherCode(data.current.weather_code),
          isDay: data.current.is_day !== 0,
        },
        forecast: (data.daily?.time ?? []).map((date, index) => ({
          date,
          min: Math.round(data.daily!.temperature_2m_min[index]),
          max: Math.round(data.daily!.temperature_2m_max[index]),
          code: data.daily!.weather_code[index],
          description: describeWeatherCode(data.daily!.weather_code[index]),
        })),
        source: SOURCE,
        updatedAt: new Date().toISOString(),
        stale: false,
      };

      await cacheStorage.set(cacheKey, reading);
      return reading;
    } catch (error) {
      // Offline: serve the last good reading, clearly marked as stale (§20).
      const cached = await cacheStorage.get<WeatherReading>(cacheKey);
      if (cached) return { ...cached.value, updatedAt: cached.updatedAt, stale: true };
      throw error;
    }
  }
}

export const weatherService: WeatherService = new OpenMeteoWeatherService();
