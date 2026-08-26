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

export const SUGGESTION_FAILURE_CODES = [
  'CATALOG_UNAVAILABLE',
  'EDGE_FUNCTION_UNAVAILABLE',
  'PERMISSION_DENIED',
  'REFRESH_LIMITED',
  'AI_UNAVAILABLE',
  'AI_PROVIDER_FAILED',
  'INVALID_AI_RESPONSE',
  /**
   * A geração rodou, o que veio é válido, e ainda assim não deu três.
   *
   * Diferente de `INVALID_AI_RESPONSE`: ali o serviço respondeu qualquer coisa;
   * aqui ele respondeu sugestões legítimas, em número insuficiente. A distinção
   * importa porque o que veio É aproveitado — fica gravado e visível — e o que
   * a tela precisa dizer é "ainda faltam", não "deu erro".
   */
  'INCOMPLETE_GENERATION',
  'PERSISTENCE_FAILED',
] as const;

export type SuggestionFailureCode = (typeof SUGGESTION_FAILURE_CODES)[number];

/**
 * O que se sabe sobre UMA tentativa de completar as sugestões.
 *
 * POR QUE ISTO EXISTE
 *
 * No Android, a tela de Moscovo dizia "Sugestões indisponíveis / Ainda não
 * encontramos sugestões suficientes para este destino" — e não havia como
 * saber, do aparelho, se aquilo era 401, 403, 422, 429, rede, catálogo vazio
 * ou geração parcial. Todos esses caminhos chegavam ao mesmo texto. Corrigir
 * por hipótese, nesse estado, é chutar.
 *
 * SÓ NÚMEROS E RÓTULOS FECHADOS
 *
 * Nada aqui é conteúdo: não há título de sugestão, não há corpo de resposta,
 * não há cabeçalho, não há token. `httpStatus` é um inteiro, `code` é um dos
 * códigos declarados acima, e as contagens são contagens. É isto que permite
 * exibir o diagnóstico na tela em desenvolvimento sem vazar JWT, `service_role`
 * ou a chave do Gemini (§12 do handoff).
 */
export interface SuggestionAttemptDiagnostics {
  /** Status HTTP da Function, quando houve resposta HTTP. */
  httpStatus?: number;
  /** Como a chamada falhou na camada de transporte: offline, timeout, parse… */
  transport?: 'offline' | 'timeout' | 'http' | 'parse' | 'unsupported' | 'unconfigured';
  /** O código de negócio que o corpo trouxe (ex.: INSUFFICIENT_SUGGESTIONS). */
  responseCode?: string;
  /** Quantas sugestões a chamada precisava produzir. */
  minimumNeeded?: number;
  /** Quantas linhas o catálogo (`public.places`) rendeu nesta execução. */
  catalogCount?: number;
  /** Quantas linhas a IA rendeu nesta execução, já deduplicadas. */
  aiCount?: number;
  /** Quantas sugestões a viagem tem ao final. */
  totalCount?: number;
  /** A janela de 6h estava aberta quando a tentativa começou? */
  refreshWindowOpen?: boolean;
  /** A tentativa foi um "Atualizar sugestões" explícito? */
  forced?: boolean;
}

/**
 * A failed source is not the same thing as an empty destination catalog.
 *
 * `partialSuggestions` lets the UI keep showing valid catalog rows when only
 * the AI complement failed, while still explaining the failure instead of
 * silently pretending that generation merely found nothing.
 *
 * `diagnostics` carrega o que a tela precisa para DIZER o que aconteceu — e,
 * em desenvolvimento, para mostrar o status real em vez de um texto genérico.
 * É construído sanitizado: ver `SuggestionAttemptDiagnostics`.
 */
export class SuggestionGenerationError extends Error {
  readonly name = 'SuggestionGenerationError';

  constructor(
    readonly code: SuggestionFailureCode,
    message: string,
    readonly partialSuggestions: TripSuggestion[] = [],
    readonly cause?: unknown,
    readonly diagnostics: SuggestionAttemptDiagnostics = {},
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/* ------------------------------ estados da tela ---------------------------- */

/**
 * Os estados que a tela de sugestões precisa distinguir (§15 do handoff).
 *
 * Antes existiam dois: "tem sugestão" e "Sugestões indisponíveis". Oito
 * situações muito diferentes caíam na segunda — inclusive a janela de seis
 * horas, que não é falha nenhuma, e a falta de permissão, que "Tentar
 * novamente" nunca vai resolver. Um botão que não pode funcionar é pior do que
 * nenhum botão: ele ensina que o aplicativo está quebrado.
 */
export type SuggestionScreenTone = 'info' | 'warning' | 'error';

export interface SuggestionScreenState {
  /** Chave estável para teste e telemetria — não é texto de tela. */
  kind:
    | 'empty'
    | 'incomplete'
    | 'refresh_limited'
    | 'network'
    | 'permission'
    | 'unavailable'
    | 'failed';
  title: string;
  message: string;
  tone: SuggestionScreenTone;
  /** `false` quando repetir agora não tem como dar certo. */
  retryable: boolean;
}

const SCREEN_STATES: Record<SuggestionFailureCode, SuggestionScreenState> = {
  REFRESH_LIMITED: {
    kind: 'refresh_limited',
    title: 'Atualizado recentemente',
    message:
      'Gerar sugestões tem custo, então isso acontece no máximo uma vez a cada 6 horas por ' +
      'viagem. Você poderá atualizar as sugestões novamente mais tarde.',
    tone: 'info',
    retryable: false,
  },
  INCOMPLETE_GENERATION: {
    kind: 'incomplete',
    title: 'Ainda faltam sugestões',
    message:
      'Conseguimos apenas parte das sugestões para este destino. O que já veio fica salvo, e ' +
      'você pode tentar completar de novo mais tarde.',
    tone: 'warning',
    retryable: true,
  },
  PERMISSION_DENIED: {
    kind: 'permission',
    title: 'Sem permissão para gerar',
    message:
      'Só quem organiza ou edita esta viagem pode gerar sugestões. Peça a quem organiza para ' +
      'gerar, ou para mudar o seu papel.',
    tone: 'info',
    retryable: false,
  },
  AI_UNAVAILABLE: {
    kind: 'unavailable',
    title: 'Geração indisponível',
    message:
      'O serviço de sugestões não está disponível neste ambiente. As sugestões já salvas ' +
      'continuam aqui.',
    tone: 'warning',
    retryable: false,
  },
  EDGE_FUNCTION_UNAVAILABLE: {
    kind: 'unavailable',
    title: 'Serviço não publicado',
    message: 'O serviço de sugestões não respondeu para esta viagem. Tente novamente mais tarde.',
    tone: 'warning',
    retryable: true,
  },
  AI_PROVIDER_FAILED: {
    kind: 'failed',
    title: 'A geração falhou',
    message: 'O provedor de sugestões não conseguiu responder agora. Tente novamente.',
    tone: 'error',
    retryable: true,
  },
  INVALID_AI_RESPONSE: {
    kind: 'failed',
    title: 'Resposta inesperada',
    message: 'O serviço respondeu num formato que não reconhecemos. Tente novamente.',
    tone: 'error',
    retryable: true,
  },
  CATALOG_UNAVAILABLE: {
    kind: 'failed',
    title: 'Catálogo indisponível',
    message: 'Não foi possível consultar o catálogo de lugares. Verifique sua conexão.',
    tone: 'error',
    retryable: true,
  },
  PERSISTENCE_FAILED: {
    kind: 'failed',
    title: 'Não foi possível salvar',
    message: 'As sugestões chegaram, mas não conseguimos gravá-las. Tente novamente.',
    tone: 'error',
    retryable: true,
  },
};

/**
 * "Não deu para alcançar o serviço" não é a mesma coisa que "o serviço recusou".
 *
 * Sem conexão, o texto útil fala de conexão — e não de geração, de catálogo ou
 * de permissão. O código é o mesmo `AI_UNAVAILABLE` porque a origem é a mesma
 * camada; o que muda é o transporte, e é ele que a pessoa consegue agir.
 */
const NETWORK_STATE: SuggestionScreenState = {
  kind: 'network',
  title: 'Sem conexão com o serviço',
  message:
    'Não conseguimos alcançar o serviço de sugestões. Verifique sua conexão e tente novamente.',
  tone: 'error',
  retryable: true,
};

const EMPTY_STATE: SuggestionScreenState = {
  kind: 'empty',
  title: 'Ainda sem sugestões',
  message: 'O catálogo ainda não tem sugestões para este destino.',
  tone: 'info',
  retryable: true,
};

/**
 * Um erro que não é da geração — a própria leitura da coleção falhou.
 *
 * Não pode virar "Ainda sem sugestões": vazio e falha são coisas diferentes, e
 * confundi-las diz à pessoa que o destino não tem nada quando o que houve foi
 * a lista não ter chegado.
 */
const UNKNOWN_STATE: SuggestionScreenState = {
  kind: 'failed',
  title: 'Não foi possível carregar',
  message:
    'Não conseguimos carregar as sugestões desta viagem. Verifique sua conexão e tente novamente.',
  tone: 'error',
  retryable: true,
};

/** O estado de tela correspondente a uma falha — ou o vazio real, sem falha. */
export function suggestionScreenState(error: unknown): SuggestionScreenState {
  if (error === null || error === undefined) return EMPTY_STATE;
  if (!(error instanceof SuggestionGenerationError)) return UNKNOWN_STATE;

  const transport = error.diagnostics.transport;
  if (transport === 'offline' || transport === 'timeout') return NETWORK_STATE;

  return SCREEN_STATES[error.code] ?? SCREEN_STATES.AI_PROVIDER_FAILED;
}

/**
 * O diagnóstico em uma linha, para a tela mostrar em desenvolvimento.
 *
 * Só rótulos e números — ver `SuggestionAttemptDiagnostics`. Devolve `null`
 * quando não há nada de concreto a dizer, para a tela não pintar um rodapé
 * vazio.
 */
export function formatSuggestionDiagnostics(error: unknown): string | null {
  if (!(error instanceof SuggestionGenerationError)) return null;
  const d = error.diagnostics;

  const partes: string[] = [error.code];
  if (d.httpStatus !== undefined) partes.push(`HTTP ${d.httpStatus}`);
  if (d.transport && d.transport !== 'http') partes.push(d.transport);
  if (d.responseCode) partes.push(d.responseCode);
  if (d.minimumNeeded !== undefined) partes.push(`need=${d.minimumNeeded}`);
  if (d.catalogCount !== undefined) partes.push(`catalog=${d.catalogCount}`);
  if (d.aiCount !== undefined) partes.push(`ai=${d.aiCount}`);
  if (d.totalCount !== undefined) partes.push(`total=${d.totalCount}`);
  if (d.refreshWindowOpen !== undefined) partes.push(`window=${d.refreshWindowOpen ? 'open' : 'closed'}`);
  if (d.forced !== undefined) partes.push(`forced=${d.forced}`);

  return partes.length > 1 ? partes.join(' · ') : null;
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

/**
 * O que a Function devolve quando conseguiu gerar.
 *
 * `.min(1)` e não `.min(3)`: o mínimo de três é do TOTAL da viagem, catálogo
 * incluído (§22 do handoff). Um catálogo com duas entradas precisa de uma
 * sugestão da IA, e reprovar essa resposta por ter só uma jogaria fora
 * exatamente o que completava a lista. Quem confere o total é `ensure`.
 */
export const generatedSuggestionListSchema = z.object({
  suggestions: z.array(generatedSuggestionSchema).min(1).max(12),
});

/** O mesmo formato, aceitando a lista vazia que acompanha uma recusa parcial. */
export const partialSuggestionListSchema = z.object({
  suggestions: z.array(generatedSuggestionSchema).max(12),
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
