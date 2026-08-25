/**
 * Minimal fetch wrapper with a timeout and typed failures.
 * Services use it so every network path has a predictable error shape that the
 * UI can turn into a useful message (§84).
 */

export type ServiceErrorKind = 'offline' | 'timeout' | 'http' | 'parse' | 'unsupported' | 'unconfigured';

export class ServiceError extends Error {
  constructor(
    readonly kind: ServiceErrorKind,
    message: string,
    readonly status?: number,
    /**
     * O corpo que o serviço mandou junto com a recusa, quando ele é JSON.
     *
     * Existe porque uma recusa pode carregar resultado parcial legítimo: a
     * Function de sugestões devolve 422 com as sugestões válidas que conseguiu
     * gerar quando não alcançou o mínimo pedido. Sem isto o chamador teria de
     * escolher entre confiar num 200 que mente ou jogar fora o que veio.
     */
    readonly payload?: unknown,
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

/**
 * Uma falha só merece nova tentativa se for transitória. Um 404 ou um corpo
 * malformado vão falhar igual na segunda vez — repetir só faz o usuário esperar
 * mais para ver o mesmo erro.
 */
function isTransient(error: ServiceError): boolean {
  if (error.kind === 'timeout' || error.kind === 'offline') return true;
  return error.kind === 'http' && error.status !== undefined && error.status >= 500;
}

async function fetchJsonOnce<T>(url: string, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new ServiceError('http', `Serviço respondeu ${response.status}`, response.status);
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ServiceError('timeout', 'O serviço demorou demais para responder.');
    }
    // React Native lança `TypeError: Network request failed` quando a requisição
    // não chega a sair do aparelho. Só esse caso é falta de conexão: tratar todo
    // erro inesperado como 'offline' manda o usuário conferir o wi-fi quando o
    // problema real é outro (um corpo malformado, por exemplo).
    const detail = error instanceof Error ? error.message : String(error);
    if (/network request failed|failed to fetch/i.test(detail)) {
      throw new ServiceError('offline', 'Não foi possível alcançar o serviço.');
    }
    throw new ServiceError('parse', `Resposta inesperada do serviço (${detail}).`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET com timeout curto por tentativa e repetição em falha transitória.
 *
 * O geocoder do Open-Meteo engasga de vez em quando: a conexão fica pendurada
 * sem nunca responder, e sozinha essa falha bloqueia a criação de viagem, que
 * depende dele para obter país, fuso e coordenadas (§12, §30). Medido, o host
 * responde em ~0,4s quando está saudável, então um travamento é sempre defeito
 * — não lentidão. Daí o formato: espera-se pouco por tentativa e tenta-se de
 * novo, em vez de uma única espera longa que termina em erro.
 *
 * GET é idempotente, então repetir é seguro; `postJson` não repete de propósito.
 */
export async function getJson<T>(
  url: string,
  { timeoutMs = 8_000, retries = 2, retryDelayMs = 400 }: {
    timeoutMs?: number;
    retries?: number;
    retryDelayMs?: number;
  } = {},
): Promise<T> {
  let lastError: ServiceError | undefined;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetchJsonOnce<T>(url, timeoutMs);
    } catch (error) {
      if (!(error instanceof ServiceError) || !isTransient(error)) throw error;
      lastError = error;
      if (attempt < retries) {
        // Recuo linear: o host costuma se recuperar na tentativa seguinte, e um
        // backoff exponencial só faria o usuário esperar mais por nada.
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
      }
    }
  }

  throw lastError ?? new ServiceError('offline', 'Não foi possível alcançar o serviço.');
}

export async function postJson<T>(
  url: string,
  body: unknown,
  options: { timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<T> {
  const { timeoutMs = 30_000, headers = {} } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      // Ler o corpo da recusa não pode virar uma segunda falha: um serviço que
      // responde 500 com HTML continua sendo um 500, não um erro de parse.
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        payload = undefined;
      }
      throw new ServiceError(
        'http',
        `Serviço respondeu ${response.status}`,
        response.status,
        payload,
      );
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ServiceError('timeout', 'O serviço demorou demais para responder.');
    }
    // React Native lança `TypeError: Network request failed` quando a requisição
    // não chega a sair do aparelho. Só esse caso é falta de conexão: tratar todo
    // erro inesperado como 'offline' manda o usuário conferir o wi-fi quando o
    // problema real é outro (um corpo malformado, por exemplo).
    const detail = error instanceof Error ? error.message : String(error);
    if (/network request failed|failed to fetch/i.test(detail)) {
      throw new ServiceError('offline', 'Não foi possível alcançar o serviço.');
    }
    throw new ServiceError('parse', `Resposta inesperada do serviço (${detail}).`);
  } finally {
    clearTimeout(timer);
  }
}

/** Turns a thrown error into a sentence a user can act on. */
export function describeError(error: unknown, fallback = 'Tente novamente em instantes.'): string {
  if (error instanceof ServiceError) {
    switch (error.kind) {
      case 'offline':
        return 'Verifique sua conexão e tente novamente.';
      case 'timeout':
        return 'O serviço demorou demais para responder. Tente novamente.';
      case 'unconfigured':
        return error.message;
      case 'unsupported':
        return error.message;
      default:
        return error.message;
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
