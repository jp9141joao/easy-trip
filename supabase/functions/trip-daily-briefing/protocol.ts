/**
 * Protocolo puro da execução agendada do briefing diário.
 *
 * Este módulo não importa Deno, Supabase ou providers externos. Assim os dois
 * contratos mais sensíveis da Function podem ser exercitados pelo Jest:
 *
 * 1. só o cron que apresenta a service role E o segredo dedicado passa;
 * 2. nenhum provider roda enquanto não existir ao menos um claim persistido.
 */

export const DAILY_BRIEFING_CRON_HEADER = 'x-easy-trip-cron-secret';

export interface HeaderReader {
  get(name: string): string | null;
}

export type DailyBriefingAuthorization =
  | { ok: true }
  | { ok: false; status: 403; reason: 'forbidden' }
  | { ok: false; status: 503; reason: 'misconfigured' };

/**
 * Compara credenciais sem parar no primeiro caractere diferente.
 *
 * JavaScript não oferece garantia formal de tempo constante, mas percorrer o
 * maior comprimento evita o vazamento óbvio de comparação por prefixo. O
 * segredo nunca é incluído no retorno nem em mensagens de erro.
 */
function credentialMatches(received: string, expected: string): boolean {
  const length = Math.max(received.length, expected.length);
  let mismatch = received.length ^ expected.length;

  for (let index = 0; index < length; index += 1) {
    const receivedCode = received.charCodeAt(index) || 0;
    const expectedCode = expected.charCodeAt(index) || 0;
    mismatch |= receivedCode ^ expectedCode;
  }

  return mismatch === 0;
}

function readBearerToken(value: string | null): string {
  const match = /^\s*Bearer\s+([^\s]+)\s*$/i.exec(value ?? '');
  return match?.[1] ?? '';
}

/**
 * O gateway valida que há um JWT válido (`verify_jwt = true`). Esta segunda
 * barreira diferencia o cron privilegiado de um JWT comum de usuário.
 *
 * Exigir também um segredo dedicado permite revogar a autorização do cron sem
 * trocar a service role do projeto inteiro.
 */
export function authorizeDailyBriefing(
  headers: HeaderReader,
  serviceRoleKey: string | undefined,
  cronSecret: string | undefined,
): DailyBriefingAuthorization {
  if (!serviceRoleKey?.trim()) {
    return { ok: false, status: 503, reason: 'misconfigured' };
  }

  const serviceRoleMatches = credentialMatches(
    readBearerToken(headers.get('authorization')),
    serviceRoleKey,
  );
  // Um JWT comum continua sendo 403 mesmo se o segredo do cron não tiver sido
  // instalado neste ambiente. Configuração interna não é informação para um
  // chamador sem privilégio — e auth nunca pode virar 503 por acaso.
  if (!serviceRoleMatches) return { ok: false, status: 403, reason: 'forbidden' };

  if (!cronSecret?.trim()) {
    return { ok: false, status: 503, reason: 'misconfigured' };
  }

  const cronSecretMatches = credentialMatches(
    headers.get(DAILY_BRIEFING_CRON_HEADER) ?? '',
    cronSecret,
  );

  return cronSecretMatches ? { ok: true } : { ok: false, status: 403, reason: 'forbidden' };
}

export function isDailyBriefingMethodAllowed(method: string): boolean {
  return method.toUpperCase() === 'POST';
}

export interface ClaimedBatch<TClaim, TResult> {
  claims: TClaim[];
  providerResult?: TResult;
}

/**
 * Faz todos os claims antes de liberar a etapa que chama providers.
 *
 * Um claim que devolve `null` significa que outra execução já ganhou a chave
 * idempotente. Se todos forem duplicados, `runProvider` não é chamado sequer
 * uma vez — inclusive para clima, que também é um provider externo.
 */
export async function runClaimedBatch<TCandidate, TClaim, TResult>(
  candidates: readonly TCandidate[],
  claim: (candidate: TCandidate) => Promise<TClaim | null>,
  runProvider: (claims: readonly TClaim[]) => Promise<TResult>,
): Promise<ClaimedBatch<TClaim, TResult>> {
  const claims: TClaim[] = [];

  for (const candidate of candidates) {
    const claimed = await claim(candidate);
    if (claimed !== null) claims.push(claimed);
  }

  if (claims.length === 0) return { claims };

  return {
    claims,
    providerResult: await runProvider(claims),
  };
}
