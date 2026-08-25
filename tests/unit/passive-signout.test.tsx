import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { queryKeys } from '@/hooks/queryKeys';
import { readAITripContext, writeAITripContext } from '@/lib/aiTripContext';
import { persistQueries, persistedQueryStorageKey } from '@/lib/queryPersistence';
import { readTripSelection, writeTripSelection } from '@/lib/tripSelectionStorage';
import { AuthProvider, useAuth } from '@/providers/AuthProvider';

/**
 * B.2 do handoff — a saída que o aplicativo não pediu.
 *
 * O `SIGNED_OUT` do SDK chega quando o token é revogado por fora, expira sem
 * renovação, ou a sessão é encerrada em outro aparelho. Antes disto o provider
 * derrubava a sessão em memória e parava aí: o cache persistido, a seleção de
 * viagem, o contexto da IA e as cópias locais de arquivo continuavam no disco
 * esperando por uma saída explícita que podia nunca acontecer.
 *
 * A limpeza é a mesma do botão "Sair", com a mesma regra de conta: tudo é
 * endereçado pelo dono, e uma limpeza atrasada de A não pode alcançar B.
 */

const A = {
  user: { id: 'uid-a', email: 'a@easytrip.app', createdAt: '', updatedAt: '' },
  accessToken: 'token-a',
};
const B = {
  user: { id: 'uid-b', email: 'b@easytrip.app', createdAt: '', updatedAt: '' },
  accessToken: 'token-b',
};

const mockListeners = new Set<(session: unknown) => void>();

const mockState = {
  restored: null as unknown,
  signOutFails: false,
  /** Segura `signOut` para intercalar a entrada de B no meio da saída de A. */
  gateSignOut: false,
  releaseSignOut: () => {},
};

const mockCalls = { signOut: 0, purgeLocalFiles: [] as string[] };

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
    signIn: async () => B,
    signUp: async () => ({ status: 'signed-in', session: B }),
    signOut: async () => {
      mockCalls.signOut += 1;
      if (mockState.gateSignOut) {
        await new Promise<void>((resolve) => {
          mockState.releaseSignOut = resolve;
        });
      }
      if (mockState.signOutFails) throw new Error('sessão continua de pé');
    },
    requestPasswordReset: async () => undefined,
    updatePassword: async () => undefined,
    redeemRecovery: async () => A,
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
  getInitialUrl: async () => null,
  subscribeToUrls: () => () => undefined,
  createRedirectUrl: (path: string) => `easytrip://${path}`,
}));

let client: QueryClient;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>
    <AuthProvider>{children}</AuthProvider>
  </QueryClientProvider>
);

const mount = async () => {
  const view = renderHook(() => useAuth(), { wrapper });
  await waitFor(() => expect(view.result.current.initializing).toBe(false));
  return view;
};

/** Como se o provedor avisasse por conta própria. */
const emit = async (session: unknown) => {
  await act(async () => {
    mockListeners.forEach((listener) => listener(session));
  });
};

/** O estado privado que uma conta deixa no aparelho enquanto usa o aplicativo. */
async function semearEstadoDe(userId: string, tripId: string) {
  client.setQueryData(queryKeys.trips(userId), [{ id: tripId, title: 'Paris' }]);
  await persistQueries(client, userId);
  await writeTripSelection(userId, tripId);
  await writeAITripContext(userId, tripId);
}

beforeEach(async () => {
  await AsyncStorage.clear();
  client = new QueryClient({
    // `gcTime: Infinity` de propósito: com `0`, o React Query recolhe uma
    // consulta sem observadores no primeiro tique seguinte, e o cache de B
    // sumiria sozinho no meio do cenário — dando por bom um teste que na
    // verdade não mediu a limpeza de A. Sem temporizador, o que apagar o cache
    // terá sido código do provider.
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: 0 } },
  });
  mockState.restored = null;
  mockState.signOutFails = false;
  mockState.gateSignOut = false;
  mockState.releaseSignOut = () => {};
  mockCalls.signOut = 0;
  mockCalls.purgeLocalFiles = [];
  mockListeners.clear();
});

afterEach(() => client.clear());

describe('SIGNED_OUT passivo limpa tudo o que era privado', () => {
  it('derruba a sessão, desmonta a árvore privada e apaga o estado da conta', async () => {
    mockState.restored = A;
    const view = await mount();
    await semearEstadoDe(A.user.id, 'trip-1');

    await emit(null);

    expect(view.result.current.session).toBeNull();
    expect(view.result.current.isAuthenticated).toBe(false);
    expect(view.result.current.profile).toBeNull();

    // Cache em memória e tudo o que estava endereçado à conta A.
    expect(client.getQueryData(queryKeys.trips(A.user.id))).toBeUndefined();
    await waitFor(async () =>
      expect(await AsyncStorage.getItem(`et:cache:${persistedQueryStorageKey(A.user.id)}`)).toBeNull(),
    );
    await waitFor(async () => expect(await readTripSelection(A.user.id)).toBeNull());
    await waitFor(async () => expect(await readAITripContext(A.user.id)).toBeNull());
    await waitFor(() => expect(mockCalls.purgeLocalFiles).toContain(A.user.id));
  });

  it('não chama o adaptador: quem saiu foi o provedor, não o aplicativo', async () => {
    mockState.restored = A;
    await mount();

    await emit(null);

    expect(mockCalls.signOut).toBe(0);
  });

  it('um SIGNED_IN atrasado da mesma conta não a ressuscita', async () => {
    mockState.restored = A;
    const view = await mount();

    await emit(null);
    await emit(A);

    expect(view.result.current.session).toBeNull();
  });

  it('mas uma troca legítima para outra conta continua valendo', async () => {
    mockState.restored = A;
    const view = await mount();

    await emit(null);
    await emit(B);

    expect(view.result.current.session?.user.id).toBe(B.user.id);
  });
});

describe('a limpeza de A não alcança B (§9, §10)', () => {
  it('a limpeza atrasada de A deixa o cache de B intacto', async () => {
    mockState.restored = A;
    mockState.gateSignOut = true;
    const view = await mount();
    await semearEstadoDe(A.user.id, 'trip-a');

    // A saída de A começa e fica pendurada no adaptador.
    let saida: Promise<void> | undefined;
    await act(async () => {
      saida = view.result.current.signOut();
    });

    // B entra neste aparelho antes de a saída de A terminar. É uma entrada
    // EXPLÍCITA: durante uma saída em curso o provider suspende os avisos
    // passivos do SDK de propósito, e só uma decisão da pessoa vale.
    await act(async () => {
      await view.result.current.signIn('b@easytrip.app', 'senha');
    });
    await semearEstadoDe(B.user.id, 'trip-b');
    expect(client.getQueryData(queryKeys.trips(B.user.id))).toBeDefined();

    // Só então a saída de A conclui e dispara a limpeza dela.
    await act(async () => {
      mockState.releaseSignOut();
      await saida;
    });

    /*
     * O que é de A sai; o que é de B fica. `queryClient.clear()` é a única
     * operação da limpeza que não é endereçada por conta, e por isso ela é
     * condicionada ao dono atual — sem essa condição, a saída de A zeraria o
     * cache em memória que B acabou de carregar.
     */
    expect(client.getQueryData(queryKeys.trips(B.user.id))).toBeDefined();
    await waitFor(async () => expect(await readTripSelection(A.user.id)).toBeNull());
    expect(await readTripSelection(B.user.id)).toBe('trip-b');
    expect(await readAITripContext(B.user.id)).toBe('trip-b');
    expect(mockCalls.purgeLocalFiles).not.toContain(B.user.id);
  });

  it('uma saída que falha e depois recebe o SIGNED_OUT tardio limpa A corretamente', async () => {
    mockState.restored = A;
    mockState.signOutFails = true;
    const view = await mount();
    await semearEstadoDe(A.user.id, 'trip-a');

    await act(async () => {
      await expect(view.result.current.signOut()).rejects.toThrow('sessão continua de pé');
    });

    // A falha não desloga ninguém: meia-saída seria pior do que a falha.
    expect(view.result.current.session).not.toBeNull();
    expect(mockCalls.purgeLocalFiles).toHaveLength(0);

    // O provedor conclui a revogação por conta própria mais tarde.
    await emit(null);

    expect(view.result.current.session).toBeNull();
    await waitFor(async () => expect(await readTripSelection(A.user.id)).toBeNull());
    await waitFor(() => expect(mockCalls.purgeLocalFiles).toContain(A.user.id));
  });
});
