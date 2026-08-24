/**
 * Previsão por atividade do roteiro (§20, §21).
 *
 * DE ONDE VEM O NÚMERO
 *
 * Do Open-Meteo, o mesmo serviço que já alimenta a tela de clima — nunca do
 * Gemini. Um modelo de linguagem não sabe se vai chover às 16h em Paris; ele
 * sabe escrever uma frase que soa como se soubesse, e é exatamente por isso que
 * ele não é consultado aqui. O papel da IA no briefing (§37) é redigir o texto
 * a partir destes números, não produzi-los.
 *
 * O HORIZONTE É UM LIMITE REAL
 *
 * O Open-Meteo entrega previsão horária para os próximos 16 dias. Uma viagem
 * marcada para daqui a três meses não tem previsão — e a resposta certa para
 * isso é "Previsão disponível mais perto da data", não uma média climatológica
 * apresentada como previsão. `outOfHorizon` existe para a tela poder dizer isso
 * sem inventar.
 */

import { cacheStorage } from '@/lib/storage';
import { describeWeatherCode } from './weather';
import { getJson } from './http';

/** Dias de previsão horária que o Open-Meteo entrega. */
export const FORECAST_HORIZON_DAYS = 16;

export interface HourlyWeather {
  /** HH:mm no fuso do local — a API responde em hora local do ponto. */
  time: string;
  temperature: number;
  /** 0–100. Probabilidade, não certeza: é assim que a tela escreve. */
  precipitationProbability: number;
  code: number;
  description: string;
}

export interface ActivityForecast {
  date: string;
  hours: HourlyWeather[];
  /** A previsão para o horário pedido, quando existe. */
  at?: HourlyWeather;
  source: string;
  updatedAt: string;
  stale: boolean;
  /**
   * A data está além do que o serviço prevê. Quando `true`, `hours` está vazio
   * e a tela mostra "Previsão disponível mais perto da data" (§21).
   */
  outOfHorizon: boolean;
}

interface OpenMeteoHourly {
  hourly?: {
    time: string[];
    temperature_2m: number[];
    precipitation_probability: number[];
    weather_code: number[];
  };
}

const SOURCE = 'Open-Meteo';

/** Dias inteiros entre hoje e a data pedida, no calendário local. */
export function daysAhead(date: string, today: string): number {
  const target = Date.parse(`${date}T00:00:00Z`);
  const base = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(target) || Number.isNaN(base)) return Number.POSITIVE_INFINITY;
  return Math.round((target - base) / 86_400_000);
}

export function isWithinForecastHorizon(date: string, today: string): boolean {
  const ahead = daysAhead(date, today);
  return ahead >= 0 && ahead <= FORECAST_HORIZON_DAYS;
}

/**
 * Previsão horária de um ponto num dia.
 *
 * `startTime` (HH:mm) escolhe a hora mais próxima. Sem ele devolve o dia
 * inteiro, que é o que o briefing usa.
 *
 * O cache é por ponto arredondado e por dia. Arredondar a coordenada é o que
 * faz três atividades no mesmo bairro compartilharem uma requisição em vez de
 * fazerem três — a previsão horária não muda em 1 km.
 */
export async function getActivityForecast(params: {
  latitude: number;
  longitude: number;
  date: string;
  today: string;
  startTime?: string;
}): Promise<ActivityForecast> {
  const { latitude, longitude, date, today, startTime } = params;

  if (!isWithinForecastHorizon(date, today)) {
    return {
      date,
      hours: [],
      source: SOURCE,
      updatedAt: new Date().toISOString(),
      stale: false,
      outOfHorizon: true,
    };
  }

  const cacheKey = `forecast:${latitude.toFixed(2)},${longitude.toFixed(2)}:${date}`;

  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
      '&hourly=temperature_2m,precipitation_probability,weather_code' +
      `&timezone=auto&start_date=${date}&end_date=${date}`;

    const data = await getJson<OpenMeteoHourly>(url);
    const hours: HourlyWeather[] = (data.hourly?.time ?? []).map((stamp, index) => ({
      time: stamp.slice(11, 16),
      temperature: Math.round(data.hourly!.temperature_2m[index]),
      precipitationProbability: Math.round(data.hourly!.precipitation_probability?.[index] ?? 0),
      code: data.hourly!.weather_code[index],
      description: describeWeatherCode(data.hourly!.weather_code[index]),
    }));

    const forecast: ActivityForecast = {
      date,
      hours,
      at: pickHour(hours, startTime),
      source: SOURCE,
      updatedAt: new Date().toISOString(),
      stale: false,
      outOfHorizon: false,
    };

    await cacheStorage.set(cacheKey, { date, hours });
    return forecast;
  } catch (error) {
    // Sem rede: serve a última leitura boa, marcada como tal. `updatedAt` vem
    // do cache e não de agora — uma previsão de ontem apresentada com o
    // carimbo de hoje seria pior do que não ter previsão (§21).
    const cached = await cacheStorage.get<{ date: string; hours: HourlyWeather[] }>(cacheKey);
    if (cached) {
      return {
        date,
        hours: cached.value.hours,
        at: pickHour(cached.value.hours, startTime),
        source: SOURCE,
        updatedAt: cached.updatedAt,
        stale: true,
        outOfHorizon: false,
      };
    }
    throw error;
  }
}

/** A hora cheia mais próxima do horário da atividade. */
function pickHour(hours: HourlyWeather[], startTime?: string): HourlyWeather | undefined {
  if (hours.length === 0) return undefined;
  if (!startTime) return undefined;

  const target = toMinutes(startTime);
  if (target === null) return undefined;

  return hours.reduce((closest, hour) => {
    const current = toMinutes(hour.time);
    const best = toMinutes(closest.time);
    if (current === null || best === null) return closest;
    return Math.abs(current - target) < Math.abs(best - target) ? hour : closest;
  });
}

function toMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Acima disto a tela sugere levar guarda-chuva. */
export const RAIN_ADVICE_THRESHOLD = 40;

/**
 * O aviso de chuva do dia, ou nada.
 *
 * Devolve `undefined` quando não há por que avisar — e é isso que impede o card
 * de virar ruído. Um aviso que aparece todo dia deixa de ser lido no terceiro.
 */
export function rainAdvice(hours: HourlyWeather[]): string | undefined {
  const rainy = hours.filter((hour) => hour.precipitationProbability >= RAIN_ADVICE_THRESHOLD);
  if (rainy.length === 0) return undefined;

  const first = rainy[0];
  return `${first.precipitationProbability}% de chance de chuva a partir das ${first.time}. Talvez valha levar um guarda-chuva.`;
}
