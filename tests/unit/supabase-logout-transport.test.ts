import {
  createSupabaseAuthStorage,
  createSupabaseFetch,
  runWithSupabaseLocalSignOutSession,
  SUPABASE_LOGOUT_REQUEST_BUDGET_MS,
} from '@/repositories/supabase/client';
import { GoTrueClient } from '@supabase/auth-js';

describe('Supabase logout transport deadline', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('aborts only a hanging Auth /logout request', async () => {
    jest.useFakeTimers();
    const underlying = jest.fn<Promise<Response>, [RequestInfo, RequestInit?]>(
      (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        }),
    );
    const wrapped = createSupabaseFetch(underlying as unknown as typeof fetch);

    const request = wrapped('https://project.supabase.co/auth/v1/logout?scope=local', {
      method: 'POST',
    });
    const captured = request.catch((error: Error) => error);

    await jest.advanceTimersByTimeAsync(SUPABASE_LOGOUT_REQUEST_BUDGET_MS);

    await expect(captured).resolves.toMatchObject({ message: 'aborted' });
    expect(underlying).toHaveBeenCalledTimes(1);
    expect(underlying.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it('passes non-logout requests through without installing an abort signal', async () => {
    const response = { ok: true } as Response;
    const underlying = jest.fn<Promise<Response>, [RequestInfo, RequestInit?]>(async () => response);
    const wrapped = createSupabaseFetch(underlying as unknown as typeof fetch);

    await expect(
      wrapped('https://project.supabase.co/rest/v1/trips', { method: 'GET' }),
    ).resolves.toBe(response);
    expect(underlying.mock.calls[0][1]?.signal).toBeUndefined();
  });

  it('makes the installed auth-js remove storage and emit SIGNED_OUT after abort', async () => {
    jest.useFakeTimers();
    const storageKey = 'sb-runtime-test-auth-token';
    const values = new Map<string, string>();
    values.set(
      storageKey,
      JSON.stringify({
        access_token: 'opaque-access-token',
        refresh_token: 'opaque-refresh-token',
        token_type: 'bearer',
        expires_in: 3_600,
        expires_at: Math.floor(Date.now() / 1_000) + 3_600,
        user: {
          id: 'runtime-user',
          aud: 'authenticated',
          role: 'authenticated',
          app_metadata: {},
          user_metadata: {},
          identities: [],
          created_at: new Date(0).toISOString(),
        },
      }),
    );
    const storage = {
      getItem: jest.fn(async (key: string) => values.get(key) ?? null),
      setItem: jest.fn(async (key: string, value: string) => {
        values.set(key, value);
      }),
      removeItem: jest.fn(async (key: string) => {
        values.delete(key);
      }),
    };
    const hangingFetch = jest.fn<Promise<Response>, [RequestInfo, RequestInit?]>(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        }),
    );
    const auth = new GoTrueClient({
      url: 'https://project.supabase.co/auth/v1',
      headers: { apikey: 'public-test-key' },
      storageKey,
      storage,
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      fetch: createSupabaseFetch(hangingFetch as unknown as typeof fetch),
    });
    await auth.initialize();
    const events: string[] = [];
    const { data } = auth.onAuthStateChange((event) => {
      if (event !== 'INITIAL_SESSION') events.push(event);
    });

    const logout = auth.signOut({ scope: 'local' });
    await jest.advanceTimersByTimeAsync(SUPABASE_LOGOUT_REQUEST_BUDGET_MS);
    const outcome = await logout;

    expect(outcome.error).toBeTruthy();
    expect(values.has(storageKey)).toBe(false);
    expect(storage.removeItem).toHaveBeenCalledWith(storageKey);
    expect(events).toContain('SIGNED_OUT');
    expect(hangingFetch).toHaveBeenCalledTimes(1);

    data.subscription.unsubscribe();
    auth.dispose();
  });

  it('bypasses a pending pre-logout refresh and rejects its late session commit', async () => {
    jest.useFakeTimers();
    const storageKey = 'sb-refresh-race-auth-token';
    const now = Math.floor(Date.now() / 1_000);
    const originalSession = {
      access_token: 'old-access-token',
      refresh_token: 'old-refresh-token',
      token_type: 'bearer',
      expires_in: 30,
      // Inside auth-js's 90-second proactive refresh margin.
      expires_at: now + 30,
      user: {
        id: 'runtime-user',
        aud: 'authenticated',
        role: 'authenticated',
        app_metadata: {},
        user_metadata: {},
        identities: [],
        created_at: new Date(0).toISOString(),
      },
    };
    const values = new Map<string, string>([[storageKey, JSON.stringify(originalSession)]]);
    const storage = {
      getItem: jest.fn(async (key: string) => values.get(key) ?? null),
      setItem: jest.fn(async (key: string, value: string) => {
        values.set(key, value);
      }),
      removeItem: jest.fn(async (key: string) => {
        values.delete(key);
      }),
    };

    let releaseRefresh!: (response: Response) => void;
    const fetcher = jest.fn<Promise<Response>, [RequestInfo, RequestInit?]>((input, init) => {
      const url = String(input);
      if (url.includes('/token?grant_type=refresh_token')) {
        return new Promise<Response>((resolve) => {
          releaseRefresh = resolve;
        });
      }
      if (url.includes('/logout')) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        });
      }
      throw new Error(`unexpected Auth request: ${url}`);
    });
    const auth = new GoTrueClient({
      url: 'https://project.supabase.co/auth/v1',
      headers: { apikey: 'public-test-key' },
      storageKey,
      storage: createSupabaseAuthStorage(storageKey, storage),
      persistSession: true,
      // Keep initialization deterministic; getSession below starts the exact
      // pre-logout refresh race under test.
      autoRefreshToken: false,
      detectSessionInUrl: false,
      fetch: createSupabaseFetch(fetcher as unknown as typeof fetch),
    });
    await auth.initialize();
    const events: string[] = [];
    // Let onAuthStateChange finish its own INITIAL_SESSION read without
    // accidentally becoming the refresh race we want to start explicitly.
    values.set(
      storageKey,
      JSON.stringify({ ...originalSession, expires_at: now + 3_600 }),
    );
    const { data } = auth.onAuthStateChange((event) => {
      if (event !== 'INITIAL_SESSION') events.push(event);
    });
    await jest.advanceTimersByTimeAsync(0);
    values.set(storageKey, JSON.stringify(originalSession));

    const staleRefresh = auth.getSession();
    await jest.advanceTimersByTimeAsync(0);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('/token?grant_type=refresh_token');

    // A second load would normally dedupe onto the pending refresh. The
    // logout-scoped storage view makes this load use the still-valid access
    // token, reach the bounded /logout request, and let auth-js remove state.
    const logout = runWithSupabaseLocalSignOutSession(() =>
      auth.signOut({ scope: 'local' }),
    );
    await jest.advanceTimersByTimeAsync(SUPABASE_LOGOUT_REQUEST_BUDGET_MS);
    const logoutOutcome = await logout;

    expect(logoutOutcome.error).toBeTruthy();
    expect(String(fetcher.mock.calls[1]?.[0])).toContain('/logout');
    expect(values.has(storageKey)).toBe(false);
    expect(events.filter((event) => event === 'SIGNED_OUT')).toHaveLength(1);

    // The old refresh finally returns rotated credentials. The installed
    // SDK's removal epoch/storage commit guard must discard them rather than
    // resurrecting the session that just left.
    const rotatedSession = {
      ...originalSession,
      access_token: 'late-access-token',
      refresh_token: 'late-refresh-token',
      expires_in: 3_600,
      expires_at: now + 3_600,
    };
    releaseRefresh({
      ok: true,
      status: 200,
      json: async () => rotatedSession,
    } as Response);
    const refreshOutcome = await staleRefresh;

    expect(refreshOutcome.data.session).toBeNull();
    expect(refreshOutcome.error).toBeTruthy();
    expect(values.has(storageKey)).toBe(false);
    expect(events).not.toContain('TOKEN_REFRESHED');

    data.subscription.unsubscribe();
    auth.dispose();
  });
});
