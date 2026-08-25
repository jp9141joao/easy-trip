import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { authAdapter } from '@/repositories';

import { readRecoveryMark } from '@/lib/recoveryState';
import { AuthProvider, useAuth } from '@/providers/AuthProvider';

/**
 * B.1 do handoff — a sessão que veio do link de recuperação de senha.
 *
 * O CONTRATO
 *
 * A sessão que o e-mail cria é uma sessão de VERDADE: o supabase-js a grava no
 * disco e a devolve na próxima abertura. O que a separa de uma entrada normal é
 * só a marca de recuperação — e enquanto essa marca valer, o aplicativo privado
 * não monta. Ela só cai quando a senha é trocada, ou quando a pessoa desiste e
 * a saída local é COMPROVADA.
 *
 * OS QUATRO DEFEITOS QUE ISTO PRENDE
 *
 *  A. a marca vivia só em `useState`, então reiniciar no meio do fluxo abria o
 *     aplicativo inteiro — "recebi um e-mail" virava um jeito de entrar sem
 *     saber a senha;
 *  B. a marca era escrita DEPOIS de `redeemRecovery` resolver, e o provedor
 *     anuncia a sessão antes disso: cabia a Home aparecer por alguns quadros;
 *  C. um link recusado deixava o estado ambíguo;
 *  D. `cancelPasswordReset` engolia a falha da remoção local e pintava a tela
 *     de login com um token ainda no aparelho.
 */

const SESSION = {
  user: { id: 'uid-a', email: 'a@easytrip.app', createdAt: '', updatedAt: '' },
  accessToken: 'token-a',
};

const mockListeners = new Set<(session: unknown) => void>();
const mockUrlListeners = new Set<(url: string) => void>();

const mockState = {
  restored: null as unknown,
  initialUrl: null as string | null,
  /** Segura `redeemRecovery` para observar a janela do defeito B. */
  gateRedeem: false,
  releaseRedeem: () => {},
  redeemFails: false,
  signOutFails: false,
};

const mockCalls = { signOut: 0, updatePassword: [] as string[], purgeLocalFiles: [] as string[] };

jest.mock('@/repositories', () => ({
  AuthError: class AuthError extends Error {},
  authAdapter: {
    kind: 'supabase',
    ownsDataDeletion: true,
    onAuthStateChange: (listener: (session: unknown) => void) => {
      mockListeners.add(listener);
      return () => mockListeners.delete(listener);
    },
    restore: async () => mockState.restored,
    signIn: async () => SESSION,
    signUp: async () => ({ status: 'signed-in', session: SESSION }),
    signOut: async () => {
      mockCalls.signOut += 1;
      if (mockState.signOutFails) throw new Error('a sessão continua no aparelho');
    },
    requestPasswordReset: async () => undefined,
    updatePassword: async (password: string) => {
      mockCalls.updatePassword.push(password);
    },
    redeemRecovery: async () => {
      if (mockState.gateRedeem) {
        await new Promise<void>((resolve) => {
          mockState.releaseRedeem = resolve;
        });
      }
      if (mockState.redeemFails) throw new Error('Este link de recuperação expirou.');
      return SESSION;
    },
    deleteAccount: async () => undefined,
  },
  dataSource: {
    profile: {
      get: async (userId: string) => ({ userId, name: 'Conta', defaultCurrency: 'BRL', role: 'user' }),
      update: async (userId: string) => ({ userId, name: 'Conta', defaultCurrency: 'BRL', role: 'user' }),
    },
    files: {
      isAvailableOffline: () => false,
      ensureOfflineCopy: async () => undefined,
      purgeLocalCopies: (userId: string) => {
        mockCalls.purgeLocalFiles.push(userId);
      },
    },
    purgeUserData: async () => undefined,
  },
}));

jest.mock('@/lib/deepLink', () => ({
  getInitialUrl: async () => mockState.initialUrl,
  subscribeToUrls: (listener: (url: string) => void) => {
    mockUrlListeners.add(listener);
    return () => mockUrlListeners.delete(listener);
  },
  createRedirectUrl: (path: string) => `easytrip://${path}`,
}));

const RECOVERY_URL = 'easytrip://redefinir-senha#access_token=abc&refresh_token=def&type=recovery';

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

beforeEach(async () => {
  await AsyncStorage.clear();
  mockState.restored = null;
  mockState.initialUrl = null;
  mockState.gateRedeem = false;
  mockState.releaseRedeem = () => {};
  mockState.redeemFails = false;
  mockState.signOutFails = false;
  mockCalls.signOut = 0;
  mockCalls.updatePassword = [];
  mockCalls.purgeLocalFiles = [];
  mockListeners.clear();
  mockUrlListeners.clear();
});

describe('A — a recuperação começa e a árvore privada não monta', () => {
  it('o link do e-mail deixa o aplicativo em recuperação, não autenticado', async () => {
    mockState.initialUrl = RECOVERY_URL;
    const view = await mount();

    await waitFor(() => expect(view.result.current.recoveryPending).toBe(true));
    expect(view.result.current.isAuthenticated).toBe(false);
    // Há sessão — ela só não serve para abrir o aplicativo.
    expect(view.result.current.session).not.toBeNull();
  });

  it('a marca fica no disco enquanto a recuperação estiver em curso', async () => {
    mockState.initialUrl = RECOVERY_URL;
    const view = await mount();

    await waitFor(() => expect(view.result.current.recoveryPending).toBe(true));
    await waitFor(async () => expect(await readRecoveryMark()).not.toBeNull());
    expect(await readRecoveryMark()).toMatchObject({ userId: SESSION.user.id });
  });
});

describe('B — evento de sessão antecipado não libera a Home', () => {
  it('um SIGNED_IN durante o resgate continua sendo recuperação', async () => {
    mockState.initialUrl = RECOVERY_URL;
    mockState.gateRedeem = true;

    const view = await mount();

    /*
     * A janela exata do defeito: `exchangeCodeForSession`/`setSession` ainda
     * não retornou, e o supabase-js já anunciou a sessão pelo listener. Antes,
     * a pendência só era marcada depois do retorno — e este evento entrava como
     * entrada normal.
     */
    await act(async () => {
      mockListeners.forEach((listener) => listener(SESSION));
    });

    expect(view.result.current.session).not.toBeNull();
    expect(view.result.current.recoveryPending).toBe(true);
    expect(view.result.current.isAuthenticated).toBe(false);

    await act(async () => {
      mockState.releaseRedeem();
    });
    expect(view.result.current.isAuthenticated).toBe(false);
  });
});

describe('C — reiniciar no meio da recuperação continua na troca de senha', () => {
  it('a marca em disco sobrevive à remontagem e a sessão restaurada não abre o aplicativo', async () => {
    mockState.initialUrl = RECOVERY_URL;
    const primeira = await mount();
    await waitFor(() => expect(primeira.result.current.recoveryPending).toBe(true));
    primeira.unmount();

    // O aplicativo reabre: sem link nenhum na URL, mas com a sessão do link
    // ainda gravada pelo supabase-js.
    mockState.initialUrl = null;
    mockState.restored = SESSION;
    const segunda = await mount();

    expect(segunda.result.current.recoveryPending).toBe(true);
    expect(segunda.result.current.isAuthenticated).toBe(false);
  });

  it('não abre a Home em nenhum quadro: já monta em recuperação', async () => {
    mockState.initialUrl = RECOVERY_URL;
    const primeira = await mount();
    await waitFor(() => expect(primeira.result.current.recoveryPending).toBe(true));
    primeira.unmount();

    mockState.initialUrl = null;
    mockState.restored = SESSION;

    const view = renderHook(() => useAuth(), { wrapper });
    const autenticadoEmAlgumQuadro: boolean[] = [];
    await waitFor(() => {
      autenticadoEmAlgumQuadro.push(view.result.current.isAuthenticated);
      expect(view.result.current.initializing).toBe(false);
    });
    autenticadoEmAlgumQuadro.push(view.result.current.isAuthenticated);

    expect(autenticadoEmAlgumQuadro).not.toContain(true);
  });

  it('marca sem sessão é descartada — não prende a próxima entrada', async () => {
    mockState.initialUrl = RECOVERY_URL;
    const primeira = await mount();
    await waitFor(() => expect(primeira.result.current.recoveryPending).toBe(true));
    primeira.unmount();

    // Reabre sem sessão guardada: não há senha a trocar.
    mockState.initialUrl = null;
    mockState.restored = null;
    const segunda = await mount();

    expect(segunda.result.current.recoveryPending).toBe(false);
    await waitFor(async () => expect(await readRecoveryMark()).toBeNull());
  });
});

describe('D — senha trocada encerra a recuperação', () => {
  it('libera o aplicativo e tira a marca do disco', async () => {
    mockState.initialUrl = RECOVERY_URL;
    const view = await mount();
    await waitFor(() => expect(view.result.current.recoveryPending).toBe(true));

    await act(async () => {
      await view.result.current.completePasswordReset('senha-nova-123');
    });

    expect(mockCalls.updatePassword).toEqual(['senha-nova-123']);
    expect(view.result.current.recoveryPending).toBe(false);
    expect(view.result.current.isAuthenticated).toBe(true);
    expect(await readRecoveryMark()).toBeNull();
  });

  it('uma troca de senha que falha não abre o aplicativo', async () => {
    mockState.initialUrl = RECOVERY_URL;
    const view = await mount();
    await waitFor(() => expect(view.result.current.recoveryPending).toBe(true));

    const falha = jest
      .spyOn(authAdapter, 'updatePassword')
      .mockRejectedValueOnce(new Error('senha fraca'));

    await act(async () => {
      await expect(view.result.current.completePasswordReset('123')).rejects.toThrow('senha fraca');
    });

    expect(view.result.current.recoveryPending).toBe(true);
    expect(view.result.current.isAuthenticated).toBe(false);
    expect(await readRecoveryMark()).not.toBeNull();
    falha.mockRestore();
  });
});

describe('E — cancelar encerra a sessão do link de verdade', () => {
  it('sai, limpa e tira a marca', async () => {
    mockState.initialUrl = RECOVERY_URL;
    const view = await mount();
    await waitFor(() => expect(view.result.current.recoveryPending).toBe(true));

    await act(async () => {
      await view.result.current.cancelPasswordReset();
    });

    expect(mockCalls.signOut).toBe(1);
    expect(view.result.current.session).toBeNull();
    expect(view.result.current.recoveryPending).toBe(false);
    expect(view.result.current.isAuthenticated).toBe(false);
    expect(mockCalls.purgeLocalFiles).toContain(SESSION.user.id);
    expect(await readRecoveryMark()).toBeNull();
  });
});

describe('F — a remoção local que falha NÃO vira logout de mentira', () => {
  it('propaga o erro e mantém a sessão e a marca', async () => {
    mockState.initialUrl = RECOVERY_URL;
    mockState.signOutFails = true;
    const view = await mount();
    await waitFor(() => expect(view.result.current.recoveryPending).toBe(true));

    await act(async () => {
      await expect(view.result.current.cancelPasswordReset()).rejects.toThrow(
        'a sessão continua no aparelho',
      );
    });

    /*
     * O token continua no disco. Zerar a tela aqui mostraria o login com uma
     * sessão viva por baixo — e a próxima abertura voltaria para a recuperação,
     * ou pior, abriria o aplicativo.
     */
    expect(view.result.current.session).not.toBeNull();
    expect(view.result.current.recoveryPending).toBe(true);
    expect(view.result.current.isAuthenticated).toBe(false);
    expect(await readRecoveryMark()).not.toBeNull();
    expect(mockCalls.purgeLocalFiles).toHaveLength(0);
  });
});

describe('link inválido', () => {
  it('mantém a recuperação com a explicação, sem formulário útil', async () => {
    mockState.initialUrl = RECOVERY_URL;
    mockState.redeemFails = true;
    const view = await mount();

    await waitFor(() => expect(view.result.current.recoveryError).not.toBeNull());
    expect(view.result.current.recoveryPending).toBe(true);
    expect(view.result.current.isAuthenticated).toBe(false);
  });

  it('um link que o próprio Supabase já marcou como expirado nem tenta resgatar', async () => {
    mockState.initialUrl =
      'easytrip://redefinir-senha#error=access_denied&error_code=otp_expired';
    const view = await mount();

    await waitFor(() => expect(view.result.current.recoveryPending).toBe(true));
    expect(view.result.current.recoveryError).toMatch(/expirou/i);
  });
});
