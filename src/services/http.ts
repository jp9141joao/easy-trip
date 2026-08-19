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
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

export async function getJson<T>(url: string, timeoutMs = 12_000): Promise<T> {
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
    throw new ServiceError('offline', 'Não foi possível alcançar o serviço.');
  } finally {
    clearTimeout(timer);
  }
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
      throw new ServiceError('http', `Serviço respondeu ${response.status}`, response.status);
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ServiceError('timeout', 'O serviço demorou demais para responder.');
    }
    throw new ServiceError('offline', 'Não foi possível alcançar o serviço.');
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
