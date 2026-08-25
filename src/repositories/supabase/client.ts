import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SupportedStorage } from '@supabase/auth-js';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import 'react-native-url-polyfill/auto';

import { config } from '@/lib/config';

let client: SupabaseClient | null = null;

/**
 * `auth.signOut()` loads the current session before it removes it. auth-js
 * normally refreshes during that load when the access token is inside its
 * expiry margin. On a half-open mobile connection that `/token` request can
 * hang *before* the bounded `/logout` request is ever reached.
 *
 * While an explicit local logout is in progress, the storage facade presents
 * the same session with a comfortably-future `expires_at` **for that read
 * only**. Tokens and persisted bytes are never changed. This makes auth-js go
 * straight to `/logout`, after which its own `_removeSession()` still owns the
 * durable removal, refresh-race epoch and `SIGNED_OUT` notification.
 */
const LOCAL_SIGN_OUT_READ_EXPIRY_SECONDS = 5 * 60;
let localSignOutReadDepth = 0;

function sessionReadForLocalSignOut(raw: string): string {
  try {
    const stored = JSON.parse(raw) as Record<string, unknown>;
    if (
      !stored ||
      typeof stored !== 'object' ||
      typeof stored.access_token !== 'string' ||
      typeof stored.refresh_token !== 'string' ||
      typeof stored.expires_at !== 'number'
    ) {
      return raw;
    }

    return JSON.stringify({
      ...stored,
      expires_at: Math.max(
        stored.expires_at,
        Math.floor(Date.now() / 1_000) + LOCAL_SIGN_OUT_READ_EXPIRY_SECONDS,
      ),
    });
  } catch {
    // Let auth-js handle malformed storage exactly as it normally would.
    return raw;
  }
}

/**
 * Storage facade used by the singleton client. Exported only for the real
 * GoTrueClient regression test.
 */
export function createSupabaseAuthStorage(
  storageKey: string,
  storage: SupportedStorage = AsyncStorage,
): SupportedStorage {
  return {
    async getItem(key) {
      const raw = await storage.getItem(key);
      if (localSignOutReadDepth === 0 || key !== storageKey || raw === null) return raw;
      return sessionReadForLocalSignOut(raw);
    },
    setItem: (key, value) => storage.setItem(key, value),
    removeItem: (key) => storage.removeItem(key),
  };
}

/**
 * Scopes the read-only expiry projection to one public SDK signOut call.
 * Concurrent callers are counted, so one completion cannot disable another
 * operation still in progress.
 */
export function beginSupabaseLocalSignOutSession(): () => void {
  localSignOutReadDepth += 1;
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    localSignOutReadDepth -= 1;
  };
}

/** Convenience scope for operations whose promise is guaranteed to settle. */
export async function runWithSupabaseLocalSignOutSession<T>(
  operation: () => PromiseLike<T>,
): Promise<T> {
  const release = beginSupabaseLocalSignOutSession();
  try {
    return await operation();
  } finally {
    release();
  }
}

/**
 * A logout must not leave the React tree waiting on a mobile request forever.
 *
 * The installed auth-js removes the local session after the `/logout` request
 * finishes *or fails*. Giving only that endpoint a short abort budget keeps
 * the removal inside auth-js (including its refresh-race epoch) while making
 * the operation deterministic on a real device with a half-open connection.
 */
export const SUPABASE_LOGOUT_REQUEST_BUDGET_MS = 750;

type FetchInput = string | Request | URL;

function requestUrl(input: FetchInput): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function isSupabaseLogoutRequest(input: FetchInput): boolean {
  try {
    return new URL(requestUrl(input)).pathname.endsWith('/auth/v1/logout');
  } catch {
    return requestUrl(input).includes('/auth/v1/logout');
  }
}

/**
 * Adds a deadline only to Supabase Auth logout. All other Supabase traffic is
 * passed through unchanged.
 *
 * Exported for a focused transport test; callers should normally use the
 * memoized client below.
 */
export function createSupabaseFetch(
  fetcher: typeof fetch = (...args) => globalThis.fetch(...args),
): typeof fetch {
  return async (input, init) => {
    // React Native's `fetch` type omits the `URL` member present in the DOM
    // overload even though Supabase's cross-platform type includes it.
    const normalizedInput = input instanceof URL ? input.toString() : input;
    if (!isSupabaseLogoutRequest(input)) {
      return fetcher(normalizedInput as RequestInfo, init);
    }

    const controller = new AbortController();
    const upstreamSignal = init?.signal;
    const abortFromUpstream = () => controller.abort();

    if (upstreamSignal?.aborted) controller.abort();
    else upstreamSignal?.addEventListener('abort', abortFromUpstream, { once: true });

    const timer = setTimeout(() => controller.abort(), SUPABASE_LOGOUT_REQUEST_BUDGET_MS);
    try {
      return await fetcher(normalizedInput as RequestInfo, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
      upstreamSignal?.removeEventListener('abort', abortFromUpstream);
    }
  };
}

/**
 * A chave sob a qual o supabase-js guarda a sessão neste aparelho.
 *
 * O valor é exatamente o padrão que o `SupabaseClient` calcularia sozinho
 * (`sb-<ref>-auth-token`, com `<ref>` sendo o primeiro rótulo do host do
 * projeto). Passá-lo explicitamente não muda nada em disco — muda quem *sabe*
 * o nome da chave. Sem isso, a fachada de leitura e a verificação final teriam
 * de adivinhar um detalhe interno da biblioteca. Ambas usam exatamente essa
 * mesma chave, sem chamar uma segunda operação de sessão.
 */
export function supabaseAuthStorageKey(): string {
  const host = new URL(config.supabaseUrl).hostname;
  return `sb-${host.split('.')[0]}-auth-token`;
}

/**
 * Lazily-created Supabase client.
 *
 * Only the anon key reaches the device — authorisation is enforced by Row Level
 * Security on the server, so a leaked anon key grants nothing (§17, §93).
 */
export function getSupabaseClient(): SupabaseClient {
  if (!config.hasSupabase) {
    throw new Error(
      'Supabase não está configurado. Defina EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_ANON_KEY.',
    );
  }

  if (!client) {
    const storageKey = supabaseAuthStorageKey();
    client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        storage: createSupabaseAuthStorage(storageKey),
        storageKey,
        autoRefreshToken: true,
        persistSession: true,
        // React Native has no URL bar to parse a session out of.
        detectSessionInUrl: false,
      },
      global: { fetch: createSupabaseFetch() },
    });
  }

  return client;
}

/**
 * Confirms the auth-js source of truth directly in AsyncStorage.
 *
 * Do not use `auth.getSession()` for this check: it may refresh an expiring
 * token and therefore turn a local verification into another network wait (or
 * even reintroduce a session while logout is in flight).
 */
export async function isSupabaseLocalSessionRemoved(): Promise<boolean> {
  return (await AsyncStorage.getItem(supabaseAuthStorageKey())) === null;
}

/** Testes: derruba o cliente memoizado para o próximo `getSupabaseClient()`. */
export function resetSupabaseClientForTests(): void {
  client = null;
}
