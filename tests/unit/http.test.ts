import { ServiceError, describeError, getJson } from '@/services/http';

/**
 * A falha de rede precisa chegar à UI com a causa preservada (§84): a tela de
 * criação de viagem transforma esse erro na mensagem que o usuário lê, e
 * "verifique sua conexão" para um serviço fora do ar manda depurar o problema
 * errado.
 *
 * A repetição existe porque o geocoder do Open-Meteo pendura a conexão de vez
 * em quando, e sozinha essa falha bloqueia a criação de viagem.
 */

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

function mockFetch(impl: () => Promise<unknown>) {
  const spy = jest.fn(impl);
  global.fetch = spy as unknown as typeof fetch;
  return spy;
}

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

function hang(): never {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  throw error;
}

/** Sem repetição nem espera, para testar só a classificação do erro. */
const once = { retries: 0 };

describe('getJson error mapping (§84)', () => {
  it('returns the parsed body when the service answers', async () => {
    mockFetch(async () => ok({ results: [1] }));

    await expect(getJson<{ results: number[] }>('https://example.test')).resolves.toEqual({
      results: [1],
    });
  });

  it('reports a failed request as offline only when the request never left the device', async () => {
    mockFetch(async () => {
      throw new TypeError('Network request failed');
    });

    await expect(getJson('https://example.test', once)).rejects.toMatchObject({ kind: 'offline' });
  });

  it('does not disguise a malformed body as a connectivity problem', async () => {
    mockFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON at position 0');
      },
    }));

    const error = await getJson('https://example.test', once).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ServiceError);
    expect((error as ServiceError).kind).toBe('parse');
    expect(describeError(error)).toContain('Unexpected token');
  });

  it('keeps the status code when the service answers with an error', async () => {
    mockFetch(async () => ({ ok: false, status: 404, json: async () => ({}) }));

    const error = await getJson('https://example.test', once).catch((e: unknown) => e);

    expect((error as ServiceError).kind).toBe('http');
    expect((error as ServiceError).status).toBe(404);
    expect(describeError(error)).toContain('404');
  });

  it('reports a slow service as a timeout rather than as offline', async () => {
    mockFetch(hang);

    const error = await getJson('https://example.test', once).catch((e: unknown) => e);

    expect((error as ServiceError).kind).toBe('timeout');
    expect(describeError(error)).toContain('demorou demais');
  });
});

describe('getJson retry on transient failure', () => {
  it('recovers when a hung connection succeeds on the next attempt', async () => {
    let calls = 0;
    const spy = mockFetch(async () => {
      calls += 1;
      if (calls === 1) hang();
      return ok({ results: ['Paris'] });
    });

    await expect(
      getJson<{ results: string[] }>('https://example.test', { retryDelayMs: 1 }),
    ).resolves.toEqual({ results: ['Paris'] });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('gives up after exhausting the attempts and reports the last cause', async () => {
    const spy = mockFetch(async () => hang());

    const error = await getJson('https://example.test', { retries: 2, retryDelayMs: 1 }).catch(
      (e: unknown) => e,
    );

    expect((error as ServiceError).kind).toBe('timeout');
    expect(spy).toHaveBeenCalledTimes(3); // tentativa inicial + 2 repetições
  });

  it('retries a 503 because the service may still come back', async () => {
    let calls = 0;
    const spy = mockFetch(async () => {
      calls += 1;
      if (calls === 1) return { ok: false, status: 503, json: async () => ({}) };
      return ok({ results: [] });
    });

    await expect(getJson('https://example.test', { retryDelayMs: 1 })).resolves.toEqual({
      results: [],
    });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 404, which would fail the same way again', async () => {
    const spy = mockFetch(async () => ({ ok: false, status: 404, json: async () => ({}) }));

    await expect(
      getJson('https://example.test', { retries: 2, retryDelayMs: 1 }),
    ).rejects.toMatchObject({ kind: 'http', status: 404 });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not retry a malformed body, which is not a transient failure', async () => {
    const spy = mockFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('bad json');
      },
    }));

    await expect(
      getJson('https://example.test', { retries: 2, retryDelayMs: 1 }),
    ).rejects.toMatchObject({ kind: 'parse' });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
