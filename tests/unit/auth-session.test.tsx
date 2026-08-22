import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { prefsStorage } from '@/lib/storage';
import { AuthProvider, useAuth } from '@/providers/AuthProvider';

/**
 * F4 — o ciclo de vida da sessão.
 *
 * A fronteira dublada aqui é só o provedor de identidade (o adaptador) e o
 * sistema de deep link. Tudo que está sendo testado — quando a sessão vale,
 * de quem é o perfil carregado, o que sobra depois do logout — é código de
 * verdade rodando.
 */

const SESSION_A = {
  user: { id: 'uid-a', email: 'a@easytrip.app', createdAt: '', updatedAt: '' },
  accessToken: 'token-a',
};
const SESSION_B = {
  user: { id: 'uid-b', email: 'b@easytrip.app', createdAt: '', updatedAt: '' },
  accessToken: 'token-b',
};

const mockListeners = new Set<(session: unknown) => void>();
const mockUrlListeners = new Set<(url: string) => void>();

const mockState = {
  restored: null as unknown,
  /** Resolve manualmente para observar a janela de restauração. */
  gateRestore: false,
  releaseRestore: () => {},
  signInFails: false,
  signUpOutcome: { status: 'signed-in', session: SESSION_A } as unknown,
  profileFails: false,
  initialUrl: null as string | null,
  redeemFails: false,
};

const mockCalls = {
  restore: 0,
  signIn: [] as { email: string; password: string }[],
  signUp: [] as { email: string; password: string; name: string }[],
  signOut: 0,
  reset: [] as { email: string; redirectTo?: string }[],
  updatePassword: [] as string[],
  deleteAccount: 0,
  purge: [] as string[],
  purgeLocalFiles: [] as string[],
  profileGet: [] as string[],
  profileUpsert: [] as { userId: string }[],
  unsubscribed: 0,
};

const mockProfile = (userId: string) => ({
  userId,
  name: 'Conta',
  defaultCurrency: 'BRL',
  role: 'user' as const,
});

jest.mock('@/repositories', () => ({
  AuthError: class AuthError extends Error {},
  authAdapter: {
    kind: 'supabase',
    ownsDataDeletion: true,
    onAuthStateChange: (listener: (session: unknown) => void) => {
      mockListeners.add(listener);
      return () => {
        mockCalls.unsubscribed += 1;
        mockListeners.delete(listener);
      };
    },
    restore: async () => {
      mockCalls.restore += 1;
      if (mockState.gateRestore) {
        await new Promise<void>((resolve) => {
          mockState.releaseRestore = resolve;
        });
      }
      return mockState.restored;
    },
    signIn: async (email: string, password: string) => {
      mockCalls.signIn.push({ email, password });
      if (mockState.signInFails) throw new Error('credenciais inválidas');
      return SESSION_A;
    },
    signUp: async (email: string, password: string, name: string) => {
      mockCalls.signUp.push({ email, password, name });
      return mockState.signUpOutcome;
    },
    signOut: async () => {
      mockCalls.signOut += 1;
    },
    requestPasswordReset: async (email: string, redirectTo?: string) => {
      mockCalls.reset.push({ email, redirectTo });
    },
    updatePassword: async (password: string) => {
      mockCalls.updatePassword.push(password);
    },
    redeemRecovery: async () => {
      if (mockState.redeemFails) throw new Error('link expirado');
      return SESSION_A;
    },
    deleteAccount: async () => {
      mockCalls.deleteAccount += 1;
    },
  },
  dataSource: {
    profile: {
      get: async (userId: string) => {
        mockCalls.profileGet.push(userId);
        if (mockState.profileFails) throw new Error('rede indisponível');
        return mockProfile(userId);
      },
      update: async (userId: string, patch: Record<string, unknown>) => {
        mockCalls.profileUpsert.push({ userId, ...patch });
        return mockProfile(userId);
      },
    },
    // A F8 acrescentou o expurgo das cópias locais dos documentos (D-04): sair
    // da conta não pode deixar o cartão de embarque abrindo no aparelho.
    files: {
      isAvailableOffline: () => false,
      ensureOfflineCopy: async () => undefined,
      purgeLocalCopies: (userId: string) => {
        mockCalls.purgeLocalFiles.push(userId);
      },
    },
    purgeUserData: async (userId: string) => {
      mockCalls.purge.push(userId);
    },
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

/** Como se o provedor avisasse por conta própria (token revogado, outro aparelho). */
const emit = async (session: unknown) => {
  await act(async () => {
    mockListeners.forEach((listener) => listener(session));
  });
};

beforeEach(() => {
  mockState.restored = null;
  mockState.gateRestore = false;
  mockState.signInFails = false;
  mockState.signUpOutcome = { status: 'signed-in', session: SESSION_A };
  mockState.profileFails = false;
  mockState.initialUrl = null;
  mockState.redeemFails = false;
  Object.assign(mockCalls, {
    restore: 0,
    signIn: [],
    signUp: [],
    signOut: 0,
    reset: [],
    updatePassword: [],
    deleteAccount: 0,
    purge: [],
    purgeLocalFiles: [],
    profileGet: [],
    profileUpsert: [],
    unsubscribed: 0,
  });
  mockListeners.clear();
  mockUrlListeners.clear();
});

describe('restauração da sessão', () => {
  it('A: enquanto restaura, não afirma que existe sessão', async () => {
    mockState.gateRestore = true;
    mockState.restored = SESSION_A;

    const view = renderHook(() => useAuth(), { wrapper });

    // A janela que importa: já há uma sessão guardada, mas o aplicativo ainda
    // não sabe disso. Se `isAuthenticated` fosse `true` aqui por otimismo, ou o
    // splash saísse antes, a tela errada apareceria por um quadro.
    expect(view.result.current.initializing).toBe(true);
    expect(view.result.current.isAuthenticated).toBe(false);

    await act(async () => {
      mockState.releaseRestore();
    });
    await waitFor(() => expect(view.result.current.initializing).toBe(false));
    expect(view.result.current.isAuthenticated).toBe(true);
  });

  it('B: sem sessão guardada, a conta está deslogada', async () => {
    const { result } = await mount();

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
    expect(result.current.profile).toBeNull();
    expect(result.current.role).toBe('user');
  });

  it('C: com sessão guardada, entra autenticado e com o perfil da conta', async () => {
    mockState.restored = SESSION_A;
    const { result } = await mount();

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user?.id).toBe('uid-a');
    expect(result.current.profile?.userId).toBe('uid-a');
  });
});

describe('avisos do provedor', () => {
  it('D: um SIGNED_IN vindo de fora atualiza o estado', async () => {
    const { result } = await mount();
    expect(result.current.isAuthenticated).toBe(false);

    await emit(SESSION_A);

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user?.id).toBe('uid-a');
    await waitFor(() => expect(result.current.profile?.userId).toBe('uid-a'));
  });

  it('E: um SIGNED_OUT vindo de fora limpa usuário, sessão e perfil', async () => {
    mockState.restored = SESSION_A;
    const { result } = await mount();

    // É o caso do token revogado no servidor: ninguém apertou "sair" no
    // aplicativo, e mesmo assim ele não pode continuar aberto.
    await emit(null);

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.session).toBeNull();
    expect(result.current.user).toBeNull();
    expect(result.current.profile).toBeNull();
  });

  it('não recarrega o perfil quando só o token foi renovado', async () => {
    mockState.restored = SESSION_A;
    const { result } = await mount();
    const antes = mockCalls.profileGet.length;

    // Mesma conta, token novo — é o que acontece de hora em hora.
    await emit({ ...SESSION_A, accessToken: 'token-a-renovado' });

    expect(mockCalls.profileGet.length).toBe(antes);
    expect(result.current.session?.accessToken).toBe('token-a-renovado');
  });

  it('N: cancela a inscrição ao desmontar', async () => {
    const view = await mount();
    expect(mockCalls.unsubscribed).toBe(0);

    view.unmount();

    expect(mockCalls.unsubscribed).toBe(1);
    expect(mockListeners.size).toBe(0);
  });
});

describe('entrar', () => {
  it('F: envia e-mail e senha ao provedor de identidade', async () => {
    const { result } = await mount();

    await act(async () => {
      await result.current.signIn('a@easytrip.app', 'senha-secreta');
    });

    expect(mockCalls.signIn).toEqual([{ email: 'a@easytrip.app', password: 'senha-secreta' }]);
    expect(result.current.isAuthenticated).toBe(true);
  });

  it('G: erro de login não autentica ninguém', async () => {
    mockState.signInFails = true;
    const { result } = await mount();

    await act(async () => {
      await expect(result.current.signIn('a@easytrip.app', 'errada')).rejects.toThrow();
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.session).toBeNull();
    expect(result.current.profile).toBeNull();
  });
});

describe('cadastrar', () => {
  it('H: cadastro que exige confirmação não entra no aplicativo', async () => {
    mockState.signUpOutcome = { status: 'confirmation-required', email: 'novo@easytrip.app' };
    const { result } = await mount();

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.signUp({
        name: 'Nova',
        email: 'novo@easytrip.app',
        password: 'senha12345',
        defaultCurrency: 'BRL',
      });
    });

    expect(outcome).toEqual({ status: 'confirmation-required', email: 'novo@easytrip.app' });
    expect(result.current.isAuthenticated).toBe(false);
    // Sem sessão a RLS recusaria a escrita; tentar mesmo assim só produziria um
    // erro confuso numa tela que acabou de dar certo.
    expect(mockCalls.profileUpsert).toHaveLength(0);
  });

  it('I: cadastro que já devolve sessão entra e completa o perfil', async () => {
    const { result } = await mount();

    await act(async () => {
      await result.current.signUp({
        name: 'Nova',
        email: 'novo@easytrip.app',
        password: 'senha12345',
        defaultCurrency: 'BRL',
      });
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(mockCalls.profileUpsert).toEqual([
      expect.objectContaining({ userId: 'uid-a', name: 'Nova' }),
    ]);
    // O perfil é criado pelo gatilho do banco; o cliente só completa o que o
    // formulário coletou — e nunca manda `role`.
    expect(mockCalls.profileUpsert[0]).not.toHaveProperty('role');
  });
});

describe('sair', () => {
  it('J: limpa sessão, perfil e a viagem selecionada no aparelho', async () => {
    mockState.restored = SESSION_A;
    await prefsStorage.set('currentTripId', 'trip-da-conta-anterior');
    const { result } = await mount();

    await act(async () => {
      await result.current.signOut();
    });

    expect(mockCalls.signOut).toBe(1);
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.profile).toBeNull();
    expect(result.current.role).toBe('user');
    // P-06: sem isto, a próxima conta a entrar neste aparelho abriria apontando
    // para a viagem da conta anterior.
    expect(await prefsStorage.get('currentTripId', null)).toBeNull();
  });
});

describe('perfil', () => {
  it('K: carrega o perfil do UID autenticado, e de nenhum outro', async () => {
    mockState.restored = SESSION_A;
    const { result } = await mount();

    expect(mockCalls.profileGet).toEqual(['uid-a']);
    expect(result.current.profile?.userId).toBe('uid-a');

    await emit(SESSION_B);
    await waitFor(() => expect(result.current.profile?.userId).toBe('uid-b'));

    // Cada leitura foi feita para a conta que estava autenticada no momento.
    expect(mockCalls.profileGet).toEqual(['uid-a', 'uid-b']);
  });

  it('L: falha ao carregar o perfil não troca a conta nem concede privilégio', async () => {
    mockState.restored = SESSION_A;
    mockState.profileFails = true;
    const { result } = await mount();

    expect(result.current.user?.id).toBe('uid-a');
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.profile).toBeNull();
    // Ausência de informação não é permissão.
    expect(result.current.role).toBe('user');
    expect(result.current.isAdmin).toBe(false);
  });
});

describe('recuperação de senha', () => {
  it('M: pede a redefinição com o endereço de retorno do aplicativo', async () => {
    const { result } = await mount();

    await act(async () => {
      await result.current.requestPasswordReset('a@easytrip.app');
    });

    expect(mockCalls.reset).toEqual([
      { email: 'a@easytrip.app', redirectTo: 'easytrip://redefinir-senha' },
    ]);
  });

  it('a sessão do link de recuperação não abre o aplicativo', async () => {
    mockState.initialUrl =
      'easytrip://redefinir-senha#access_token=abc&refresh_token=def&type=recovery';
    const { result } = await mount();

    await waitFor(() => expect(result.current.recoveryPending).toBe(true));

    // Existe sessão — mas ela serve para trocar a senha, e só. Valendo como
    // sessão comum, o link do e-mail viraria uma forma de entrar sem a senha.
    expect(result.current.session).not.toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('trocar a senha com sucesso libera o aplicativo', async () => {
    mockState.initialUrl =
      'easytrip://redefinir-senha#access_token=abc&refresh_token=def&type=recovery';
    const { result } = await mount();
    await waitFor(() => expect(result.current.recoveryPending).toBe(true));

    await act(async () => {
      await result.current.completePasswordReset('novaSenha123');
    });

    expect(mockCalls.updatePassword).toEqual(['novaSenha123']);
    expect(result.current.recoveryPending).toBe(false);
    expect(result.current.isAuthenticated).toBe(true);
  });

  it('desistir da recuperação encerra a sessão do link', async () => {
    mockState.initialUrl =
      'easytrip://redefinir-senha#access_token=abc&refresh_token=def&type=recovery';
    const { result } = await mount();
    await waitFor(() => expect(result.current.recoveryPending).toBe(true));

    await act(async () => {
      await result.current.cancelPasswordReset();
    });

    expect(mockCalls.signOut).toBe(1);
    expect(result.current.session).toBeNull();
    expect(result.current.recoveryPending).toBe(false);
  });

  it('link inválido explica o problema em vez de abrir o formulário', async () => {
    mockState.initialUrl =
      'easytrip://redefinir-senha#error=access_denied&error_code=otp_expired';
    const { result } = await mount();

    await waitFor(() => expect(result.current.recoveryPending).toBe(true));
    expect(result.current.recoveryError).toMatch(/expirou/i);
    expect(result.current.session).toBeNull();
  });
});

describe('excluir a conta', () => {
  it('não apaga os dados pelo cliente quando o servidor já faz isso', async () => {
    mockState.restored = SESSION_A;
    const { result } = await mount();

    await act(async () => {
      await result.current.deleteAccount();
    });

    // `ownsDataDeletion: true` — quem apaga é a Edge Function, em ordem e com
    // verificação (P-02). Apagar aqui antes deixaria, numa falha dela, uma
    // conta viva e sem nenhum dado.
    expect(mockCalls.purge).toHaveLength(0);
    expect(mockCalls.deleteAccount).toBe(1);
    expect(result.current.isAuthenticated).toBe(false);
  });
});
