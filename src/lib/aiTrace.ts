/**
 * Rastro do pedido à IA (§2, §5 do handoff).
 *
 * POR QUE ISTO EXISTE
 *
 * No aparelho apareceram dois sintomas — uma bolha praticamente vazia e "Não
 * foi possível obter uma resposta agora" — e nenhum dos dois dizia em que
 * ponto o fluxo quebrou. Sem isso, corrigir é adivinhar: "talvez fosse rede"
 * não é diagnóstico.
 *
 * O QUE ENTRA AQUI
 *
 * Números e rótulos fechados: status HTTP, código, fase, contagens, sim/não.
 * Nada de JWT, nada de chave do Gemini, nada de `service_role` e nada de texto
 * da conversa — o conteúdo é dado privado de viagem. `size` existe para
 * distinguir "veio vazio" de "veio grande", e é um comprimento, não o texto.
 *
 * Ligado só em desenvolvimento. Em produção `trace` não faz nada.
 */

/** As fases do fluxo, na ordem em que acontecem. */
export const AI_PHASES = [
  'USER_SEND',
  'AI_REQUEST_BEGIN',
  'AI_HTTP_STATUS',
  'AI_RESPONSE_RECEIVED',
  'AI_PARSE_BEGIN',
  'AI_PARSE_RESULT',
  'AI_ACTION_COUNT',
  'AI_REPAIR_TRIGGERED',
  'AI_REPAIR_RESULT',
  'AI_MESSAGE_COMMIT',
  'AI_ACTION_COMMIT',
  'AI_REQUEST_ERROR',
  'AI_REQUEST_END',
] as const;

export type AIPhase = (typeof AI_PHASES)[number];

/**
 * Em que etapa a falha aconteceu — é o que vai para a linha DEV da tela.
 *
 * `UPSTREAM` separa "o Gemini falhou" de "a nossa Function recusou". Sem essa
 * distinção, todo 502 aparecia como `TRANSPORT`, que é o rótulo de problema de
 * rede — e mandava procurar o defeito no lugar errado.
 */
export type AIFailureStage =
  | 'REQUEST'
  | 'TRANSPORT'
  | 'UPSTREAM'
  | 'PARSE'
  | 'ACTIONS'
  | 'COMMIT';

/** As fases que o servidor sabe rotular, tal como chegam no corpo da recusa. */
const SERVER_STAGES: readonly AIFailureStage[] = ['UPSTREAM'];

/**
 * O que o servidor disse sobre a própria falha.
 *
 * A Function devolve `{ error, code, stage }` junto do 502. Ler isso é o que
 * transforma `HTTP_502 · TRANSPORT` — que só diz "recusaram" — em
 * `GEMINI_UNAVAILABLE · UPSTREAM`, que diz o que aconteceu. Nada aqui é
 * confiado cegamente: só código em formato de rótulo e fase de lista fechada.
 */
export function readServerFailure(payload: unknown): {
  code?: string;
  stage?: AIFailureStage;
} {
  if (!payload || typeof payload !== 'object') return {};
  const record = payload as { code?: unknown; stage?: unknown };
  const code =
    typeof record.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(record.code)
      ? record.code
      : undefined;
  const stage = SERVER_STAGES.find((candidate) => candidate === record.stage);
  return { code, stage };
}

export interface AITraceFields {
  /** Status HTTP, quando houve resposta HTTP. */
  httpStatus?: number;
  /** Código fechado: RATE_LIMIT, TIMEOUT, OFFLINE, ACTION_PARSE_FAILED… */
  code?: string;
  /** `error.name`, que é um rótulo de classe e nunca conteúdo. */
  errorName?: string;
  stage?: AIFailureStage;
  /** Comprimento da resposta — distingue "vazio" de "grande". Não é o texto. */
  size?: number;
  actionCount?: number;
  itineraryItems?: number;
  repaired?: boolean;
  parsed?: boolean;
  /** Milissegundos decorridos desde o começo do pedido. */
  ms?: number;
}

type Listener = (phase: AIPhase, fields: AITraceFields) => void;

const listeners = new Set<Listener>();

/** Para o teste observar o rastro sem depender do console. */
export function onAITrace(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function devMode(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__;
}

export function aiTrace(phase: AIPhase, fields: AITraceFields = {}): void {
  for (const listener of listeners) listener(phase, fields);
  if (!devMode()) return;
  // Uma linha por fase, prefixada, para dar para filtrar no Metro.
  console.log(`AI_TRACE ${phase}`, JSON.stringify(fields));
}

/**
 * O que a tela mostra em DEV embaixo do erro genérico.
 *
 * Formato fixo — `DEV · HTTP 429 · RATE_LIMIT · REQUEST` —, porque o objetivo
 * é ser lido em voz alta de um aparelho na mão de alguém, não ser bonito.
 */
export function formatAIFailure(fields: AITraceFields): string {
  const partes = ['DEV'];
  partes.push(fields.httpStatus !== undefined ? `HTTP ${fields.httpStatus}` : 'HTTP —');
  partes.push(fields.code ?? fields.errorName ?? 'UNKNOWN');
  partes.push(fields.stage ?? 'REQUEST');
  return partes.join(' · ');
}

/**
 * O erro que carrega o diagnóstico até a tela.
 *
 * Sem isto, o `catch` do formulário só sabe que "algo falhou" — que foi
 * exatamente a situação que impediu de saber se o problema era 429, timeout ou
 * parser.
 */
export class AIRequestError extends Error {
  readonly name = 'AIRequestError';

  constructor(
    readonly fields: AITraceFields,
    message: string,
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
