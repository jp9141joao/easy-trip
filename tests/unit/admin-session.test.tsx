import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { AuthProvider, useAuth } from '@/providers/AuthProvider';

/**
 * Ciclo de vida do papel dentro da sessão (§12, §13, §26, §27, §43, §44).
 *
 * A pergunta que estes testes respondem é sempre a mesma: em cada transição de
 * sessão, o aplicativo termina com o papel da conta que está autenticada *agora*
 * — nunca com o da anterior, nunca com um resto.
 */

const ACCOUNTS: Record<string, { id: string; role: 'user' | 'admin' }> = {
  'chefe@easytrip.app': { id: 'admin-1', role: 'admin' },
  'viajante@easytrip.app': { id: 'user-1', role: 'user' },
};

const mockState = {
  /** Sessão que `restore()` devolve — simula o app reaberto. */
  restored: null as null | { id: string },
  /** Falha proposital na leitura do perfil. */
  profileFails: false,
};

jest.mock('@/repositories', () => ({
  authAdapter: {
    ownsDataDeletion: false,
    // O provider passou a escutar o provedor de identidade (F4). O dublê
    // registra o ouvinte e devolve o cancelamento, como o adaptador real —
    // aqui as transições continuam vindo das chamadas explícitas do teste.
    onAuthStateChange: () => () => undefined,
    restore: async () =>
      mockState.restored
        ? { user: { id: mockState.restored.id, email: '', createdAt: '', updatedAt: '' } }
        : null,
    signIn: async (email: string) => ({
      user: { id: ACCOUNTS[email].id, email, createdAt: '', updatedAt: '' },
    }),
    signOut: async () => undefined,
  },
  dataSource: {
    kind: 'local',
    profile: {
      get: async (userId: string) => {
        if (mockState.profileFails) throw new Error('rede indisponível');
        const account = Object.values(ACCOUNTS).find((a) => a.id === userId);
        if (!account) return null;
        return { userId, name: 'Conta', defaultCurrency: 'BRL', role: account.role };
      },
    },
    files: {
      isAvailableOffline: () => false,
      ensureOfflineCopy: async () => undefined,
      purgeLocalCopies: () => undefined,
    },
  },
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>
    <AuthProvider>{children}</AuthProvider>
  </QueryClientProvider>
);

const mount = async () => {
  const view = renderHook(() => useAuth(), { wrapper });
  await waitFor(() => expect(view.result.current.initializing).toBe(false));
  return view;
};

beforeEach(() => {
  mockState.restored = null;
  mockState.profileFails = false;
});

describe('role across the session', () => {
  it('resolves the role from the profile at sign-in, not from auth alone', async () => {
    const { result } = await mount();
    expect(result.current.isAdmin).toBe(false);

    await act(async () => {
      await result.current.signIn('chefe@easytrip.app', 'x');
    });

    expect(result.current.role).toBe('admin');
    expect(result.current.isAdmin).toBe(true);
  });

  it('restores an administrator when the app is reopened, with no new login', async () => {
    // O app foi fechado com a sessão do admin salva (§13, §43).
    mockState.restored = { id: 'admin-1' };

    const { result } = await mount();

    // Nenhum signIn foi chamado — o papel veio da restauração.
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.isAdmin).toBe(true);
  });

  it('restores a normal account without granting anything', async () => {
    mockState.restored = { id: 'user-1' };

    const { result } = await mount();

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.isAdmin).toBe(false);
  });

  it('leaves no trace of the admin role after logout', async () => {
    const { result } = await mount();
    await act(async () => {
      await result.current.signIn('chefe@easytrip.app', 'x');
    });
    expect(result.current.isAdmin).toBe(true);

    await act(async () => {
      await result.current.signOut();
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.profile).toBeNull();
    expect(result.current.role).toBe('user');
    expect(result.current.isAdmin).toBe(false);
  });

  it('switches admin → user → admin without restarting the app', async () => {
    const { result } = await mount();

    await act(async () => {
      await result.current.signIn('chefe@easytrip.app', 'x');
    });
    expect(result.current.isAdmin).toBe(true);

    // O caso que o §27 pede explicitamente: a conta comum não pode herdar nada.
    await act(async () => {
      await result.current.signOut();
      await result.current.signIn('viajante@easytrip.app', 'x');
    });
    expect(result.current.isAdmin).toBe(false);

    await act(async () => {
      await result.current.signOut();
      await result.current.signIn('chefe@easytrip.app', 'x');
    });
    expect(result.current.isAdmin).toBe(true);
  });

  it('never grants admin when the profile fails to load', async () => {
    mockState.profileFails = true;

    const { result } = await mount();
    await act(async () => {
      await result.current.signIn('chefe@easytrip.app', 'x');
    });

    // A conta é de administrador, mas o perfil não pôde ser lido. A sessão
    // continua de pé — o aplicativo funciona — e o privilégio não é presumido
    // (§29). Sem o try/catch em `loadProfile`, o signIn lançaria aqui.
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.profile).toBeNull();
    expect(result.current.isAdmin).toBe(false);
  });

  it('never grants admin when the account has no profile row yet', async () => {
    mockState.restored = { id: 'orfao' };

    // Auth existe, profile não (§28). Não pode quebrar nem virar privilégio.
    const { result } = await mount();

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.profile).toBeNull();
    expect(result.current.isAdmin).toBe(false);
  });
});
