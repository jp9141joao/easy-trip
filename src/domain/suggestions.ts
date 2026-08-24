/**
 * Sugestões da viagem (§39–§48).
 *
 * O QUE UMA SUGESTÃO PODE AFIRMAR
 *
 * Nada que mude sem avisar. Não há preço, não há horário de funcionamento, não
 * há avaliação, não há disponibilidade e não há promoção — nem vindas da IA nem
 * copiadas do catálogo para dentro da sugestão (§41). Um preço escrito por um
 * modelo é um chute; um preço copiado do catálogo envelhece no primeiro dia e
 * ninguém percebe.
 *
 * O que sobra é o que se sustenta: o que é o lugar, em que área fica, quanto
 * tempo costuma tomar, e por que ele foi sugerido para ESTA viagem. Quem quer
 * preço abre a ficha do lugar, onde o dado tem dono e data.
 *
 * `source` separa as duas origens, e a tela mostra "✨ Sugestão da IA" quando
 * `source === 'ai'`. Não é heurística de texto: é o campo.
 */

import { z } from 'zod';

import type { ISODateTime } from './types';

export const SUGGESTION_CATEGORIES = [
  'para_voce',
  'lugares',
  'atracoes',
  'gastronomia',
  'noite',
  'ar_livre',
] as const;
export type SuggestionCategory = (typeof SUGGESTION_CATEGORIES)[number];

export const SUGGESTION_CATEGORY_LABEL: Record<SuggestionCategory, string> = {
  para_voce: 'Para você',
  lugares: 'Lugares',
  atracoes: 'Atrações',
  gastronomia: 'Gastronomia',
  noite: 'Noite',
  ar_livre: 'Ao ar livre',
};

export const SUGGESTION_CATEGORY_EMOJI: Record<SuggestionCategory, string> = {
  para_voce: '✨',
  lugares: '📍',
  atracoes: '🎡',
  gastronomia: '🍽️',
  noite: '🌙',
  ar_livre: '🌳',
};

export type SuggestionSource = 'catalog' | 'ai';

export interface TripSuggestion {
  id: string;
  tripId: string;
  title: string;
  category: SuggestionCategory;
  description: string;
  placeName?: string;
  area?: string;
  latitude?: number;
  longitude?: number;
  estimatedDurationMinutes?: number;
  /** Por que esta sugestão, para esta viagem. É o que a torna uma sugestão. */
  reason?: string;
  source: SuggestionSource;
  /** Só quando `source === 'catalog'`: o lugar real de que ela saiu. */
  placeId?: string;
  createdBy?: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/** Quantas sugestões uma viagem precisa ter para a tela não abrir vazia (§41). */
export const MINIMUM_SUGGESTIONS = 3;

/**
 * O contrato da saída estruturada do modelo.
 *
 * Repare no que NÃO existe aqui: `url`, `price`, `rating`, `openingHours`,
 * `phone`. A ausência é a validação (§42). Um campo `url` permitiria ao modelo
 * devolver um link arbitrário — para um parceiro que não é parceiro, ou pior.
 * Sem o campo, não há como.
 *
 * As coordenadas são opcionais e vêm com limite de faixa. Sugestão sem
 * coordenada continua valendo: ela só não entra no mapa nem no cálculo de
 * distância quando virar item de roteiro (§47).
 */
export const generatedSuggestionSchema = z.object({
  title: z.string().trim().min(2).max(120),
  category: z.enum(SUGGESTION_CATEGORIES),
  description: z.string().trim().min(20).max(600),
  placeName: z.string().trim().max(140).optional(),
  area: z.string().trim().max(80).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  estimatedDurationMinutes: z.number().int().min(15).max(1440).optional(),
  reason: z.string().trim().max(300).optional(),
});
export type GeneratedSuggestion = z.infer<typeof generatedSuggestionSchema>;

export const generatedSuggestionListSchema = z.object({
  suggestions: z.array(generatedSuggestionSchema).min(1).max(12),
});

/**
 * Coordenada é par ou não é nada — a mesma regra do CHECK da 0012.
 *
 * O modelo às vezes devolve só a latitude. Meia coordenada entraria no mapa
 * como (48.86, 0): o meio do Atlântico, com um marcador numerado por cima.
 */
export function normalizeGeneratedSuggestion(suggestion: GeneratedSuggestion): GeneratedSuggestion {
  const hasPair =
    typeof suggestion.latitude === 'number' && typeof suggestion.longitude === 'number';
  if (hasPair) return suggestion;
  return { ...suggestion, latitude: undefined, longitude: undefined };
}

/* ------------------------------ deduplicação ------------------------------ */

/**
 * Normalização para comparar títulos: minúsculas, sem acento, sem pontuação,
 * sem os artigos e preposições que sobram em nome de lugar.
 *
 * "Museu do Louvre", "museu do louvre" e "Louvre" precisam colidir — porque o
 * usuário que já tem "Louvre" no roteiro não quer ver "Já existe um item
 * parecido" só quando o texto bate letra por letra (§46).
 */
export function normalizeTitle(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 0 && !STOPWORDS.has(word))
    .join(' ');
}

const STOPWORDS = new Set([
  'o', 'a', 'os', 'as', 'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'no', 'na',
  'museu', 'the', 'le', 'la', 'les',
]);

/**
 * Já existe algo parecido nesta lista?
 *
 * Duas condições: título normalizado igual, OU coordenadas a menos de 120 m. A
 * segunda pega o caso que a primeira não pega — "Torre Eiffel" e "Champ de
 * Mars" são nomes diferentes para a mesma parada do dia.
 *
 * 120 m é a distância em que dois pontos ainda são o mesmo lugar numa cidade
 * densa. Mais folgado do que isso passaria a acusar o café ao lado do museu.
 */
export function findSimilar<T extends { title: string; latitude?: number; longitude?: number }>(
  candidate: { title: string; latitude?: number; longitude?: number },
  existing: T[],
): T | undefined {
  const normalized = normalizeTitle(candidate.title);

  return existing.find((item) => {
    if (normalized && normalizeTitle(item.title) === normalized) return true;
    if (
      typeof candidate.latitude === 'number' &&
      typeof candidate.longitude === 'number' &&
      typeof item.latitude === 'number' &&
      typeof item.longitude === 'number'
    ) {
      return metersBetween(candidate, item) < 120;
    }
    return false;
  });
}

function metersBetween(
  a: { latitude?: number; longitude?: number },
  b: { latitude?: number; longitude?: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const lat1 = toRad(a.latitude ?? 0);
  const lat2 = toRad(b.latitude ?? 0);
  const dLat = lat2 - lat1;
  const dLon = toRad((b.longitude ?? 0) - (a.longitude ?? 0));
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "2–3h", "45 min". Faixa e não número exato: duração de passeio não é exata. */
export function formatDuration(minutes: number | undefined): string | undefined {
  if (!minutes) return undefined;
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  if (Number.isInteger(hours)) return `${hours}h`;
  return `${Math.floor(hours)}–${Math.ceil(hours)}h`;
}

/**
 * Intervalo mínimo entre dois refreshes do Gemini para a mesma viagem (§43).
 *
 * Seis horas. Curto o bastante para "Atualizar sugestões" responder de verdade
 * quando a pessoa muda de ideia sobre a viagem, longo o bastante para o botão
 * não virar um gerador de custo.
 */
export const SUGGESTIONS_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function canRefreshSuggestions(
  refreshedAt: ISODateTime | undefined,
  now: Date = new Date(),
): boolean {
  if (!refreshedAt) return true;
  const last = new Date(refreshedAt).getTime();
  if (Number.isNaN(last)) return true;
  return now.getTime() - last >= SUGGESTIONS_REFRESH_INTERVAL_MS;
}
