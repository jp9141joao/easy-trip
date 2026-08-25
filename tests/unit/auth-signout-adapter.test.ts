/**
 * Supabase logout adapter contract.
 *
 * These tests deliberately separate the provider response from the persisted
 * session. auth-js can return a remote error after successfully removing the
 * local session, so only AsyncStorage is the commit point. The inverse is also
 * covered: a nominal SDK result never becomes success while the session key is
 * still present.
 */

type Repositories = typeof import('@/repositories');

const mockAuth = {
  signOut: jest.fn(),
};

const mockIsLocalSessionRemoved = jest.fn();
const mockReleaseLogoutSessionRead = jest.fn();
const mockBeginLogoutSessionRead = jest.fn(() => mockReleaseLogoutSessionRead);

jest.mock('@/repositories/supabase/client', () => ({
  beginSupabaseLocalSignOutSession: () => mockBeginLogoutSessionRead(),
  getSupabaseClient: () => ({ auth: mockAuth }),
  isSupabaseLocalSessionRemoved: () => mockIsLocalSessionRemoved(),
  supabaseAuthStorageKey: () => 'sb-projeto-auth-token',
}));

function loadRepositories(): Repositories {
  let loaded!: Repositories;
  jest.isolateModules(() => {
    const previous = { ...process.env };
    Object.assign(process.env, {
      EXPO_PUBLIC_SUPABASE_URL: 'https://projeto.supabase.co',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_abc123',
    });
    loaded = require('@/repositories') as Repositories;
    process.env = previous;
  });
  return loaded;
}

const pending = () => new Promise<never>(() => {});

beforeEach(() => {
  mockAuth.signOut.mockReset();
  mockIsLocalSessionRemoved.mockReset();
  mockBeginLogoutSessionRead.mockClear();
  mockReleaseLogoutSessionRead.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('SupabaseAuthAdapter.signOut', () => {
  it('uses local scope and succeeds after the persisted session is gone', async () => {
    mockAuth.signOut.mockResolvedValue({ error: null });
    mockIsLocalSessionRemoved.mockResolvedValue(true);

    const { authAdapter } = loadRepositories();
    await expect(authAdapter.signOut()).resolves.toBeUndefined();

    expect(mockAuth.signOut).toHaveBeenCalledTimes(1);
    expect(mockAuth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('accepts a remote error when auth-js already removed the local session', async () => {
    mockAuth.signOut.mockResolvedValue({ error: { message: 'failed to fetch' } });
    mockIsLocalSessionRemoved.mockResolvedValue(true);

    const { authAdapter } = loadRepositories();
    await expect(authAdapter.signOut()).resolves.toBeUndefined();
  });

  it('does not trust a nominal SDK result while the session remains on disk', async () => {
    mockAuth.signOut.mockResolvedValue({ error: null });
    mockIsLocalSessionRemoved.mockResolvedValue(false);

    const { authAdapter } = loadRepositories();
    await expect(authAdapter.signOut()).rejects.toThrow(
      'Não foi possível sair da conta. Tente novamente.',
    );
    expect(mockAuth.signOut).toHaveBeenCalledTimes(1);
  });

  it('does not fake success when local session removal throws', async () => {
    mockAuth.signOut.mockRejectedValue(new Error('AsyncStorage remove failed'));
    mockIsLocalSessionRemoved.mockResolvedValue(false);

    const { authAdapter } = loadRepositories();
    await expect(authAdapter.signOut()).rejects.toThrow(
      'Não foi possível sair da conta. Tente novamente.',
    );
    expect(mockAuth.signOut).toHaveBeenCalledTimes(1);
  });

  it('does not fake success when persisted-session verification itself fails', async () => {
    mockAuth.signOut.mockResolvedValue({ error: null });
    mockIsLocalSessionRemoved.mockRejectedValue(new Error('AsyncStorage read failed'));

    const { authAdapter } = loadRepositories();
    await expect(authAdapter.signOut()).rejects.toThrow(
      'Não foi possível sair da conta. Tente novamente.',
    );
  });

  it('can finish when an SDK subscriber hangs after local removal', async () => {
    jest.useFakeTimers();
    mockAuth.signOut.mockReturnValue(pending());
    mockIsLocalSessionRemoved.mockResolvedValue(true);

    const { authAdapter } = loadRepositories();
    const signOut = authAdapter.signOut();

    await jest.advanceTimersByTimeAsync(2_100);
    await expect(signOut).resolves.toBeUndefined();
    expect(mockAuth.signOut).toHaveBeenCalledTimes(1);
    expect(mockBeginLogoutSessionRead).toHaveBeenCalledTimes(1);
    expect(mockReleaseLogoutSessionRead).toHaveBeenCalledTimes(1);
  });

  it('times out as a failure if the SDK hangs and the local session remains', async () => {
    jest.useFakeTimers();
    mockAuth.signOut.mockReturnValue(pending());
    mockIsLocalSessionRemoved.mockResolvedValue(false);

    const { authAdapter } = loadRepositories();
    const signOut = authAdapter.signOut();
    const captured = signOut.catch((error: Error) => error);

    await jest.advanceTimersByTimeAsync(2_100);
    await expect(captured).resolves.toBeInstanceOf(Error);
    expect(mockAuth.signOut).toHaveBeenCalledTimes(1);
  });
});
