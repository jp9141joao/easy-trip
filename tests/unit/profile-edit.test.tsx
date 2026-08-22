import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { useUpdateProfile, useUploadAvatar } from '@/hooks/useProfile';
import { AuthProvider, useAuth } from '@/providers/AuthProvider';

/**
 * F5 — salvar o perfil e trocar a foto, com o AuthProvider acompanhando.
 *
 * O dublê aqui é o repositório, porque a pergunta é sobre o aplicativo: o que
 * exatamente é enviado, e como fica o estado compartilhado depois. Que a RLS
 * recusa o que precisa recusar é assunto do E2E, contra o banco de verdade.
 */

const SESSION_A = {
  user: { id: 'uid-a', email: 'ana@easytrip.app', createdAt: '', updatedAt: '' },
  accessToken: 't-a',
};
const SESSION_B = {
  user: { id: 'uid-b', email: 'bruno@easytrip.app', createdAt: '', updatedAt: '' },
  accessToken: 't-b',
};

const mockListeners = new Set<(session: unknown) => void>();

const mockDb: Record<string, Record<string, unknown>> = {
  'uid-a': {
    userId: 'uid-a',
    name: 'Ana',
    defaultCurrency: 'BRL',
    role: 'user',
    avatarPath: 'uid-a/avatar-antigo.jpg',
    avatarUrl: 'https://signed/antigo?token=1',
  },
  'uid-b': { userId: 'uid-b', name: 'Bruno', defaultCurrency: 'USD', role: 'user' },
};

const mockState = {
  restored: null as unknown,
  updateFails: false,
  avatarFails: false,
  /** Quando presente, o save só termina quando o teste mandar. */
  gate: null as null | Promise<void>,
};
const mockCalls = { update: [] as { userId: string; patch: Record<string, unknown> }[] };

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
    signOut: async () => undefined,
  },
  dataSource: {
    profile: {
      get: async (userId: string) => mockDb[userId] ?? null,
      update: async (userId: string, patch: Record<string, unknown>) => {
        mockCalls.update.push({ userId, patch });
        if (mockState.gate) await mockState.gate;
        if (mockState.updateFails) throw new Error('rede indisponível');
        mockDb[userId] = { ...mockDb[userId], ...patch };
        return mockDb[userId];
      },
      replaceAvatar: async (userId: string) => {
        if (mockState.avatarFails) throw new Error('upload falhou');
        mockDb[userId] = {
          ...mockDb[userId],
          avatarPath: `${userId}/avatar-novo.jpg`,
          avatarUrl: 'https://signed/novo?token=2',
        };
        return mockDb[userId];
      },
    },
    files: {
      isAvailableOffline: () => false,
      ensureOfflineCopy: async () => undefined,
      purgeLocalCopies: () => undefined,
    },
    purgeUserData: async () => undefined,
  },
}));

jest.mock('@/lib/deepLink', () => ({
  getInitialUrl: async () => null,
  subscribeToUrls: () => () => undefined,
  createRedirectUrl: (path: string) => `easytrip://${path}`,
}));

// `gcTime: 0` não é detalhe de performance: com o padrão de 5 minutos, cada
// mutação deixa um `setTimeout` agendado e o Jest fica preso ao terminar a
// suíte, esperando um temporizador que nunca importa para o teste.
const queryClient = new QueryClient({
  defaultOptions: { mutations: { gcTime: 0 }, queries: { gcTime: 0, retry: false } },
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>{children}</AuthProvider>
  </QueryClientProvider>
);

const mountScreen = async () => {
  const view = renderHook(
    () => ({ auth: useAuth(), save: useUpdateProfile(), avatar: useUploadAvatar() }),
    { wrapper },
  );
  await waitFor(() => expect(view.result.current.auth.initializing).toBe(false));
  return view;
};

const imagem = {
  uri: 'file:///tmp/nova.jpg',
  name: 'nova.jpg',
  mimeType: 'image/jpeg',
  size: 1024,
};

afterEach(() => {
  queryClient.clear();
});

beforeEach(() => {
  mockState.restored = SESSION_A;
  mockState.updateFails = false;
  mockState.avatarFails = false;
  mockState.gate = null;
  mockCalls.update = [];
  mockListeners.clear();
  mockDb['uid-a'] = {
    userId: 'uid-a',
    name: 'Ana',
    defaultCurrency: 'BRL',
    role: 'user',
    avatarPath: 'uid-a/avatar-antigo.jpg',
    avatarUrl: 'https://signed/antigo?token=1',
  };
  mockDb['uid-b'] = { userId: 'uid-b', name: 'Bruno', defaultCurrency: 'USD', role: 'user' };
});

describe('salvar o perfil', () => {
  it('carrega o perfil real da conta autenticada', async () => {
    const { result } = await mountScreen();
    expect(result.current.auth.profile).toMatchObject({ userId: 'uid-a', name: 'Ana' });
  });

  it('persiste nome, telefone, estilo e moeda', async () => {
    const { result } = await mountScreen();

    await act(async () => {
      await result.current.save.mutateAsync({
        name: 'Ana Beatriz',
        phone: '+55 11 90000-0000',
        travelStyle: 'aventura',
        defaultCurrency: 'EUR',
      });
    });

    expect(mockDb['uid-a']).toMatchObject({
      name: 'Ana Beatriz',
      phone: '+55 11 90000-0000',
      travelStyle: 'aventura',
      defaultCurrency: 'EUR',
    });
  });

  it('envia o id da sessão, e só a allowlist no corpo', async () => {
    const { result } = await mountScreen();

    await act(async () => {
      await result.current.save.mutateAsync({ name: 'Ana Beatriz' });
    });

    const [chamada] = mockCalls.update;
    expect(chamada.userId).toBe('uid-a');
    // Nem `role` (autorização), nem `userId` (identidade), nem `avatarUrl` —
    // este último era a URL assinada que voltava para a coluna do caminho.
    expect(Object.keys(chamada.patch)).toEqual(['name']);
  });

  it('nunca reenvia a URL assinada do avatar ao salvar o formulário', async () => {
    const { result } = await mountScreen();
    // O perfil em memória tem `avatarUrl` — é ele que a tela renderiza.
    expect(result.current.auth.profile?.avatarUrl).toBe('https://signed/antigo?token=1');

    await act(async () => {
      await result.current.save.mutateAsync({ name: 'Ana Beatriz' });
    });

    expect(mockCalls.update[0].patch).not.toHaveProperty('avatarUrl');
    expect(mockCalls.update[0].patch).not.toHaveProperty('avatarPath');
    // E o caminho gravado continua sendo um caminho, não uma URL.
    expect(mockDb['uid-a'].avatarPath).toBe('uid-a/avatar-antigo.jpg');
  });

  it('reflete o que foi salvo no AuthProvider, sem exigir novo login', async () => {
    const { result } = await mountScreen();

    await act(async () => {
      await result.current.save.mutateAsync({ name: 'Ana Beatriz' });
    });

    // O cabeçalho da Home lê daqui: é a mesma fonte que a tela de perfil.
    expect(result.current.auth.profile?.name).toBe('Ana Beatriz');
  });

  it('mantém o papel da conta intacto ao salvar', async () => {
    const { result } = await mountScreen();

    await act(async () => {
      await result.current.save.mutateAsync({ name: 'Ana Beatriz' });
    });

    expect(result.current.auth.profile?.role).toBe('user');
    expect(result.current.auth.isAdmin).toBe(false);
  });

  it('sinaliza o envio em andamento para a tela poder travar o botão', async () => {
    // Sem um portão, o dublê responde rápido demais para que o estado
    // intermediário — o que trava o botão e evita o duplo envio — seja
    // observável. Aqui o save fica preso até o teste soltar.
    let liberar = () => {};
    mockState.gate = new Promise<void>((resolve) => {
      liberar = resolve;
    });

    const { result } = await mountScreen();
    expect(result.current.save.isPending).toBe(false);

    act(() => {
      result.current.save.mutate({ name: 'Ana Beatriz' });
    });
    await waitFor(() => expect(result.current.save.isPending).toBe(true));

    await act(async () => {
      liberar();
    });
    await waitFor(() => expect(result.current.save.isSuccess).toBe(true));
    expect(result.current.save.isPending).toBe(false);
  });

  it('falha ao salvar não mente que salvou', async () => {
    mockState.updateFails = true;
    const { result } = await mountScreen();

    await act(async () => {
      await expect(result.current.save.mutateAsync({ name: 'Ana Beatriz' })).rejects.toThrow();
    });

    expect(result.current.auth.profile?.name).toBe('Ana');
    expect(result.current.save.isError).toBe(true);
  });
});

describe('e-mail', () => {
  it('vem da sessão do Auth, não do perfil', async () => {
    const { result } = await mountScreen();

    // A tela mostra `user.email`. `profiles` não guarda e-mail — uma segunda
    // cópia poderia divergir da identidade real depois de uma troca.
    expect(result.current.auth.user?.email).toBe('ana@easytrip.app');
    expect(result.current.auth.profile).not.toHaveProperty('email');
  });
});

describe('avatar', () => {
  it('troca a foto e atualiza a fonte compartilhada', async () => {
    const { result } = await mountScreen();

    await act(async () => {
      await result.current.avatar.mutateAsync(imagem);
    });

    expect(result.current.auth.profile?.avatarUrl).toBe('https://signed/novo?token=2');
    expect(result.current.auth.profile?.avatarPath).toBe('uid-a/avatar-novo.jpg');
  });

  it('falha no upload deixa a foto anterior de pé', async () => {
    mockState.avatarFails = true;
    const { result } = await mountScreen();

    await act(async () => {
      await expect(result.current.avatar.mutateAsync(imagem)).rejects.toThrow();
    });

    // O perfil não pode acabar apontando para um arquivo que não existe.
    expect(result.current.auth.profile?.avatarPath).toBe('uid-a/avatar-antigo.jpg');
    expect(result.current.auth.profile?.avatarUrl).toBe('https://signed/antigo?token=1');
  });

  it('conta sem foto simplesmente não tem URL — a tela cai no fallback', async () => {
    mockState.restored = SESSION_B;
    const { result } = await mountScreen();

    expect(result.current.auth.profile?.avatarUrl).toBeUndefined();
    expect(result.current.auth.profile?.name).toBe('Bruno');
  });
});

describe('troca de conta', () => {
  it('não mostra em nenhum momento o perfil da conta anterior', async () => {
    const { result } = await mountScreen();
    expect(result.current.auth.profile?.name).toBe('Ana');

    await act(async () => {
      await result.current.auth.signOut();
    });

    // Entre uma conta e outra o perfil precisa estar vazio, não "ainda o
    // anterior": nome e foto são dados privados.
    expect(result.current.auth.profile).toBeNull();

    await act(async () => {
      mockListeners.forEach((listener) => listener(SESSION_B));
    });

    await waitFor(() => expect(result.current.auth.profile?.name).toBe('Bruno'));
    expect(result.current.auth.profile?.avatarUrl).toBeUndefined();
    expect(result.current.auth.profile?.userId).toBe('uid-b');
  });
});
