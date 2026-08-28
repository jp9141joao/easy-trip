/**
 * Protocolo puro do envio de notificação push.
 *
 * Sem Deno, sem Supabase, sem `fetch`. É o que permite exercitar pelo Jest as
 * três coisas que, erradas, causam dano real:
 *
 *   1. quem pode mandar o aparelho de alguém tocar;
 *   2. o que o texto pode dizer na tela de bloqueio;
 *   3. o que fazer quando o serviço recusa um token.
 */

export const PUSH_SECRET_HEADER = 'x-easy-trip-push-secret';

export interface HeaderReader {
  get(name: string): string | null;
}

export type PushAuthorization =
  | { ok: true }
  | { ok: false; status: 403; reason: 'forbidden' }
  | { ok: false; status: 503; reason: 'misconfigured' };

/** A mesma comparação de `trip-daily-briefing`, pelo mesmo motivo. */
function credentialMatches(received: string, expected: string): boolean {
  const length = Math.max(received.length, expected.length);
  let mismatch = received.length ^ expected.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (received.charCodeAt(index) || 0) ^ (expected.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

function readBearerToken(value: string | null): string {
  return /^\s*Bearer\s+([^\s]+)\s*$/i.exec(value ?? '')?.[1] ?? '';
}

/**
 * Só o servidor manda push.
 *
 * Service role E um segredo dedicado, como no briefing diário. O segredo
 * separado permite revogar a autorização de envio sem trocar a service role do
 * projeto inteiro — e enviar notificação é exatamente o tipo de capacidade que
 * se quer poder desligar sozinha, sem derrubar o resto.
 *
 * Um JWT comum é 403 mesmo quando o segredo não está instalado: configuração
 * interna não é informação para quem não tem privilégio, e autorização nunca
 * pode virar 503 por acaso.
 */
export function authorizePush(
  headers: HeaderReader,
  serviceRoleKey: string | undefined,
  pushSecret: string | undefined,
): PushAuthorization {
  if (!serviceRoleKey?.trim()) return { ok: false, status: 503, reason: 'misconfigured' };

  if (!credentialMatches(readBearerToken(headers.get('authorization')), serviceRoleKey)) {
    return { ok: false, status: 403, reason: 'forbidden' };
  }
  if (!pushSecret?.trim()) return { ok: false, status: 503, reason: 'misconfigured' };

  return credentialMatches(headers.get(PUSH_SECRET_HEADER) ?? '', pushSecret)
    ? { ok: true }
    : { ok: false, status: 403, reason: 'forbidden' };
}

/* ------------------------------- o conteúdo ------------------------------- */

export interface PushRequest {
  userId: string;
  title: string;
  body?: string;
  /** Para onde levar ao tocar. Vira link profundo no cliente. */
  tripId?: string;
  notificationId?: string;
}

/**
 * O TEXTO APARECE NA TELA DE BLOQUEIO, E ESSA É A REGRA INTEIRA.
 *
 * Uma notificação é lida por quem estiver perto do telefone: o colega de
 * trabalho ao lado, quem senta atrás no ônibus, quem pegou o aparelho na mesa.
 * O que vale para a Central do aplicativo — atrás de uma sessão — não vale aqui.
 *
 * Então o conteúdo é cortado antes de sair:
 *
 *   · nada de valor em dinheiro. "Maria lançou R$ 4.200 em hospedagem" diz
 *     quanto a pessoa tem e no que gasta, para quem estiver olhando.
 *   · nada de e-mail, telefone ou documento.
 *   · nada de trecho de diário — é o conteúdo mais privado do produto (0009),
 *     e o que a policy protege no banco não pode vazar pela tela apagada.
 *
 * O que sobra é um convite a abrir o aplicativo, que é onde o dado mora e onde
 * há sessão para lê-lo.
 */
const SENSITIVE_PATTERNS: { pattern: RegExp; label: string }[] = [
  // Valores com símbolo de moeda ou separador decimal.
  { pattern: /(?:R\$|US\$|€|£|\$)\s?\d[\d.,]*/gi, label: '' },
  { pattern: /\b\d[\d.]*,\d{2}\b/g, label: '' },
  // E-mail.
  { pattern: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, label: '' },
  // Telefone com DDD, e sequências longas de dígitos (CPF, documento, cartão).
  { pattern: /\(?\d{2}\)?\s?\d{4,5}-?\d{4}\b/g, label: '' },
  { pattern: /\b\d{9,}\b/g, label: '' },
];

export const PUSH_TITLE_LIMIT = 60;
export const PUSH_BODY_LIMIT = 140;

/**
 * Devolve o texto seguro, e diz se precisou cortar algo.
 *
 * `redacted` não é decoração: quem chama usa isso para decidir o corpo. Um
 * texto que perdeu o número que era o assunto dele vira uma frase capenga —
 * melhor substituí-lo inteiro por um convite a abrir o aplicativo.
 */
export function sanitizePushText(value: string): { text: string; redacted: boolean } {
  let text = value;
  let redacted = false;

  for (const { pattern } of SENSITIVE_PATTERNS) {
    if (pattern.test(text)) {
      redacted = true;
      text = text.replace(pattern, '');
    }
    pattern.lastIndex = 0;
  }

  return { text: text.replace(/\s{2,}/g, ' ').trim(), redacted };
}

export interface ExpoMessage {
  to: string;
  title: string;
  body?: string;
  data: Record<string, unknown>;
  sound: 'default';
  channelId: 'default';
}

/**
 * Monta as mensagens de uma notificação para todos os aparelhos da pessoa.
 *
 * Uma mensagem por token: a mesma conta pode ter telefone e tablet, e o aviso
 * vale nos dois.
 */
export function buildMessages(request: PushRequest, tokens: string[]): ExpoMessage[] {
  const titulo = sanitizePushText(request.title);
  const corpo = request.body ? sanitizePushText(request.body) : null;

  return tokens.map((to) => ({
    to,
    title: titulo.redacted || !titulo.text ? 'Easy Trip' : truncate(titulo.text, PUSH_TITLE_LIMIT),
    body:
      corpo === null
        ? undefined
        : corpo.redacted || !corpo.text
          ? 'Você tem uma novidade na sua viagem. Toque para ver.'
          : truncate(corpo.text, PUSH_BODY_LIMIT),
    // O `data` NÃO passa pelo corte: ele não é exibido, é lido pelo aplicativo
    // já autenticado para saber para onde navegar. Mas também não carrega
    // conteúdo — só identificadores.
    data: {
      tripId: request.tripId,
      notificationId: request.notificationId,
    },
    sound: 'default',
    channelId: 'default',
  }));
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1).trimEnd()}…`;
}

/* ------------------------------ a resposta -------------------------------- */

export interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

export interface PushOutcome {
  delivered: number;
  failed: number;
  /** Tokens que o serviço disse não existirem mais. Devem ser desativados. */
  invalidTokens: string[];
}

/**
 * Lê os recibos do Expo e separa a falha passageira da definitiva.
 *
 * `DeviceNotRegistered` é a única que muda o banco: o aparelho desinstalou o
 * aplicativo, ou o token foi revogado. Continuar mandando para ele é gastar
 * requisição para sempre num endereço que não existe.
 *
 * As outras — `MessageRateExceeded`, erro de servidor — não desativam nada. Um
 * token desativado por engano é um aparelho que para de receber avisos em
 * silêncio, e ninguém descobre até alguém reclamar.
 */
export function readTickets(tokens: string[], tickets: ExpoTicket[]): PushOutcome {
  let delivered = 0;
  let failed = 0;
  const invalidTokens: string[] = [];

  tickets.forEach((ticket, index) => {
    if (ticket?.status === 'ok') {
      delivered += 1;
      return;
    }
    failed += 1;
    if (ticket?.details?.error === 'DeviceNotRegistered' && tokens[index]) {
      invalidTokens.push(tokens[index]);
    }
  });

  return { delivered, failed, invalidTokens };
}

export function isPushMethodAllowed(method: string): boolean {
  return method.toUpperCase() === 'POST';
}

/**
 * Valida o corpo do pedido.
 *
 * `userId` obrigatório: sem ele o envio não teria destinatário, e um padrão
 * qualquer aqui seria "mande para alguém".
 */
export function parsePushRequest(body: unknown): PushRequest | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.userId !== 'string' || !b.userId.trim()) return null;
  if (typeof b.title !== 'string' || !b.title.trim()) return null;
  return {
    userId: b.userId,
    title: b.title,
    body: typeof b.body === 'string' ? b.body : undefined,
    tripId: typeof b.tripId === 'string' ? b.tripId : undefined,
    notificationId: typeof b.notificationId === 'string' ? b.notificationId : undefined,
  };
}
