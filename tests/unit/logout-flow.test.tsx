import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, waitFor, type RenderResult } from '@testing-library/react-native';
import { useEffect } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';

import SettingsScreen from '@/app/profile/settings';
import { ToastProvider } from '@/components/ui';
import { persistedQueryStorageKey } from '@/lib/queryPersistence';
import { cacheStorage, prefsStorage } from '@/lib/storage';
import {
  LEGACY_TRIP_SELECTION_KEY,
  tripSelectionStorageKey,
} from '@/lib/tripSelectionStorage';
import { AuthProvider, useAuth } from '@/providers/AuthProvider';
import { TripSelectionProvider, useTripSelection } from '@/providers/TripSelectionProvider';
import { ThemeProvider } from '@/theme';

/**
 * Sair da conta, do toque até a rota pública — numa execução só.
 *
 * O defeito que originou estes testes: confirmar "Sair" encerrava a sessão no
 * armazenamento, mas a interface continuava mostrando a conta logada; só ao
 * fechar e reabrir o aplicativo é que a saída aparecia. A causa era a saída
 * inteira estar pendurada atrás de uma ida à rede sem teto, e a interface não
 * ter nem sinal de espera nem tratamento de falha.
 *
 * Por isso o que se monta aqui é a corrente inteira — tela real, provedor real,
 * seleção de viagem real, cache real. Dublado é só o provedor de identidade,
 * que é a fronteira de rede. A afirmação central de todos os cenários é a
 * mesma: **nada é remontado**. A mesma árvore que estava logada passa a estar
 * deslogada.
 */

const metrics: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const SESSION = {
  user: { id: 'uid-a', email: 'a@easytrip.app', createdAt: '', updatedAt: '' },
  accessToken: 'token-a',
};

const SESSION_B = {
  user: { id: 'uid-b', email: 'b@easytrip.app', createdAt: '', updatedAt: '' },
  accessToken: 'token-b',
};

const mockListeners = new Set<(session: unknown) => void>();

const mockState = {
  restoredSession: SESSION as typeof SESSION | null,
  signOutFails: false,
  /** Segura o `signOut` para observar a janela em que ele ainda não voltou. */
  gateSignOut: false,
  releaseSignOut: () => {},
  /** Segura a limpeza de arquivos locais — o "e se ela demorar?" do aparelho. */
  gatePurge: false,
  releasePurge: () => {},
  /** Segura a restauração inicial, para fazê-la voltar **depois** do logout. */
  gateRestore: false,
  releaseRestore: () => {},
  /** Perfil devolvido por `profile.get` — muda para exercitar o caso admin. */
  role: 'user' as 'user' | 'admin',
};

const mockCalls = {
  signIn: 0,
  signOut: 0,
  subscribed: 0,
  unsubscribed: 0,
  purgedFiles: [] as string[],
};

const mockRouter = { push: jest.fn(), replace: jest.fn() };

jest.mock('@/repositories', () => ({
  AuthError: class AuthError extends Error {},
  authAdapter: {
    kind: 'supabase',
    ownsDataDeletion: true,
    onAuthStateChange: (listener: (session: unknown) => void) => {
      mockCalls.subscribed += 1;
      mockListeners.add(listener);
      return () => {
        mockCalls.unsubscribed += 1;
        mockListeners.delete(listener);
      };
    },
    restore: async () => {
      if (mockState.gateRestore) {
        await new Promise<void>((resolve) => {
          mockState.releaseRestore = resolve;
        });
      }
      return mockState.restoredSession;
    },
    signIn: async () => {
      mockCalls.signIn += 1;
      // auth-js emits SIGNED_IN before the public promise resolves. During an
      // account switch the direct return below is the authoritative opening
      // of B's generation; this early duplicate may safely be ignored.
      mockListeners.forEach((listener) => listener(SESSION_B));
      return SESSION_B;
    },
    signOut: async () => {
      mockCalls.signOut += 1;
      if (mockState.gateSignOut) {
        await new Promise<void>((resolve) => {
          mockState.releaseSignOut = resolve;
        });
      }
      // O adaptador Supabase lança quando a sessão local sobrevive à tentativa.
      if (mockState.signOutFails) throw new Error('Não foi possível sair da conta. Tente novamente.');
      mockListeners.forEach((listener) => listener(null));
    },
    deleteAccount: async () => undefined,
  },
  dataSource: {
    kind: 'supabase',
    profile: {
      get: async (userId: string) => ({
        userId,
        name: 'Conta',
        defaultCurrency: 'BRL',
        role: mockState.role,
      }),
    },
    files: {
      purgeLocalCopies: async (userId: string) => {
        if (mockState.gatePurge) {
          await new Promise<void>((resolve) => {
            mockState.releasePurge = resolve;
          });
        }
        mockCalls.purgedFiles.push(userId);
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

jest.mock('@/providers/ConnectivityProvider', () => ({
  useConnectivity: () => ({ status: 'online' }),
}));
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));
jest.mock('@/services/ai', () => ({ aiService: { kind: 'gemini' } }));
jest.mock('@/services/emergency', () => ({ EMERGENCY_COVERAGE: 30 }));

/**
 * O guarda de rota do `app/_layout.tsx` em miniatura.
 *
 * Lá é `Stack.Protected guard={isAuthenticated}`: a rota privada *sai* do
 * navegador quando a sessão cai. Aqui a pergunta é a mesma, feita à mesma
 * fonte — o que se mede é se `isAuthenticated` vira `false` na hora, que é de
 * onde a navegação de verdade tira a decisão.
 */
function Gate() {
  const { isAuthenticated, isAdmin, user } = useAuth();
  return (
    <View>
      <Text>{isAuthenticated ? 'rota privada' : 'rota pública'}</Text>
      <Text testID="session-owner">{user?.id ?? 'sem sessão'}</Text>
      {isAuthenticated && isAdmin ? <Text>painel admin</Text> : null}
      {isAuthenticated ? <SettingsScreen /> : null}
    </View>
  );
}

/** Espia o estado global que precisa sair junto com a conta. */
const probe = {
  currentTripId: null as string | null,
  setCurrentTripId: null as null | ((tripId: string | null) => void),
  restoring: false,
};
const authProbe = {
  signIn: null as null | ((email: string, password: string) => Promise<void>),
};

function Probe() {
  const { currentTripId, setCurrentTripId, restoring } = useTripSelection();
  const { signIn } = useAuth();
  // Publicado depois de cada commit, e não durante o render: o render precisa
  // ser puro, e o que o teste lê é o estado já confirmado na árvore.
  useEffect(() => {
    probe.currentTripId = currentTripId;
    probe.setCurrentTripId = setCurrentTripId;
    probe.restoring = restoring;
    authProbe.signIn = signIn;
  });
  return null;
}

let queryClient: QueryClient;

const mount = async (): Promise<RenderResult> => {
  // `gcTime: Infinity` não é preciosismo: com o padrão de 5 minutos, uma query
  // que sobrevive ao cenário (os de falha, em que nada é limpo) deixa um timer
  // de 300s aberto, e o `jest` só encerra quando ele vence.
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  // Um dado privado já em cache, para o teste poder cobrar a limpeza.
  queryClient.setQueryData(['trips', 'uid-a'], [{ id: 'trip-paris' }]);

  const view = render(
    <SafeAreaProvider initialMetrics={metrics}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <ToastProvider>
            <AuthProvider>
              <TripSelectionProvider>
                <Probe />
                <Gate />
              </TripSelectionProvider>
            </AuthProvider>
          </ToastProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );

  await waitFor(() => expect(view.getByText('rota privada')).toBeTruthy(), { timeout: 3_000 });
  await waitFor(() => expect(probe.currentTripId).toBe('trip-paris'), { timeout: 3_000 });
  return view;
};

/** Toca em "Sair da conta" e confirma no diálogo. */
const confirmarSaida = async (view: RenderResult) => {
  fireEvent.press(view.getByLabelText('Sair da conta'));
  await act(async () => undefined);
  expect(view.getByText('Sair da conta?')).toBeTruthy();
  fireEvent.press(view.getByLabelText('Sair'));
  await act(async () => undefined);
};

beforeEach(async () => {
  mockState.signOutFails = false;
  mockState.restoredSession = SESSION;
  mockState.gateSignOut = false;
  mockState.gatePurge = false;
  mockState.gateRestore = false;
  mockState.role = 'user';
  Object.assign(mockCalls, {
    signIn: 0,
    signOut: 0,
    subscribed: 0,
    unsubscribed: 0,
    purgedFiles: [],
  });
  mockListeners.clear();
  mockRouter.push.mockClear();
  mockRouter.replace.mockClear();
  probe.currentTripId = null;
  probe.setCurrentTripId = null;
  probe.restoring = false;
  authProbe.signIn = null;
  await prefsStorage.set(tripSelectionStorageKey('uid-a'), 'trip-paris');
  await prefsStorage.remove(tripSelectionStorageKey('uid-b'));
  await prefsStorage.remove(LEGACY_TRIP_SELECTION_KEY);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('A. saída bem-sucedida', () => {
  it('deixa a rota protegida na mesma execução, sem remontar o aplicativo', async () => {
    const view = await mount();

    await confirmarSaida(view);

    expect(mockCalls.signOut).toBe(1);
    // O ponto do defeito: aqui, agora, sem fechar e reabrir nada.
    expect(view.getByText('rota pública')).toBeTruthy();
    expect(view.queryByText('rota privada')).toBeNull();
    // A tela de Configurações saiu junto com a rota — e com ela o diálogo.
    expect(view.queryByText('Sair da conta?')).toBeNull();
    expect(mockRouter.replace).toHaveBeenCalledWith('/(auth)/login');
  });

  it('mostra espera e bloqueia o toque duplo enquanto a saída não volta', async () => {
    mockState.gateSignOut = true;
    const view = await mount();

    fireEvent.press(view.getByLabelText('Sair da conta'));
    await act(async () => undefined);
    fireEvent.press(view.getByLabelText('Sair'));
    await act(async () => undefined);

    // A janela em que o defeito aparecia: a chamada saiu, a resposta não
    // voltou. Antes, nesse intervalo, a tela não dava sinal nenhum — e um
    // segundo toque disparava outra saída por cima da primeira.
    const confirmar = view.getByLabelText('Sair');
    expect(confirmar.props.accessibilityState).toMatchObject({ disabled: true, busy: true });
    expect(view.getByText('rota privada')).toBeTruthy();
    expect(mockCalls.signOut).toBe(1);

    await act(async () => {
      mockState.releaseSignOut();
    });
    await waitFor(() => expect(view.getByText('rota pública')).toBeTruthy());
    expect(mockCalls.signOut).toBe(1);
  });

  it('não transforma uma falha do fallback de navegação em falso logout', async () => {
    mockRouter.replace.mockImplementationOnce(() => {
      throw new Error('navigator is reconciling protected screens');
    });
    const view = await mount();

    await confirmarSaida(view);

    expect(view.getByText('rota pública')).toBeTruthy();
    expect(view.queryByText('Não foi possível sair da conta. Tente novamente.')).toBeNull();
    expect(mockCalls.signOut).toBe(1);
  });
});

describe('B. saída que falha', () => {
  it('preserva a sessão, explica o erro e não leva ninguém para o login', async () => {
    mockState.signOutFails = true;
    const view = await mount();

    await confirmarSaida(view);

    expect(mockCalls.signOut).toBe(1);
    // Fingir que saiu seria pior que a falha: a conta continua aberta, e a
    // tela diz isso.
    expect(view.getByText('rota privada')).toBeTruthy();
    expect(view.getByText('Não foi possível sair da conta. Tente novamente.')).toBeTruthy();
    // O diálogo continua de pé para uma segunda tentativa.
    expect(view.getByText('Sair da conta?')).toBeTruthy();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('não limpa nada pela metade quando a saída não aconteceu', async () => {
    mockState.signOutFails = true;
    const view = await mount();

    await confirmarSaida(view);

    expect(probe.currentTripId).toBe('trip-paris');
    expect(await prefsStorage.get(tripSelectionStorageKey('uid-a'), null)).toBe('trip-paris');
    expect(queryClient.getQueryData(['trips', 'uid-a'])).toBeDefined();
    expect(mockCalls.purgedFiles).toEqual([]);
  });

  it('deixa tentar de novo, e a segunda tentativa funciona', async () => {
    mockState.signOutFails = true;
    const view = await mount();
    await confirmarSaida(view);

    mockState.signOutFails = false;
    fireEvent.press(view.getByLabelText('Sair'));
    await act(async () => undefined);

    expect(mockCalls.signOut).toBe(2);
    expect(view.getByText('rota pública')).toBeTruthy();
  });
});

describe('C. o que é da conta sai com a conta', () => {
  it('zera viagem selecionada, cache privado e cópias locais', async () => {
    const view = await mount();

    await confirmarSaida(view);

    // Em memória e em disco: sem os dois, a próxima conta a entrar neste
    // aparelho abriria apontando para a viagem da anterior (P-06).
    expect(probe.currentTripId).toBeNull();
    expect(await prefsStorage.get(tripSelectionStorageKey('uid-a'), null)).toBeNull();

    expect(queryClient.getQueryData(['trips', 'uid-a'])).toBeUndefined();
    expect(mockCalls.purgedFiles).toEqual(['uid-a']);
  });

  it('cleanup lento de A não apaga seleção nem cache gravados por B', async () => {
    let releaseCleanup!: () => void;
    let confirmCleanupFinished!: () => void;
    const cleanupGate = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    const cleanupFinished = new Promise<void>((resolve) => {
      confirmCleanupFinished = resolve;
    });
    await cacheStorage.set(persistedQueryStorageKey('uid-a'), {
      version: 1,
      userId: 'uid-a',
      queries: [{ key: ['trips', 'uid-a'], data: [{ id: 'trip-paris' }] }],
    });
    const originalRemove = cacheStorage.remove.bind(cacheStorage);
    jest.spyOn(cacheStorage, 'remove').mockImplementation(async (key) => {
      if (key === persistedQueryStorageKey('uid-a')) await cleanupGate;
      await originalRemove(key);
      if (key === persistedQueryStorageKey('uid-a')) confirmCleanupFinished();
    });

    const view = await mount();
    await confirmarSaida(view);
    expect(view.getByText('rota pública')).toBeTruthy();

    // A limpeza de A está parada antes das remoções em disco. B entra e grava
    // estado novo enquanto essa promise antiga continua viva.
    await act(async () => {
      await authProbe.signIn?.('b@easytrip.app', 'senha-segura');
    });
    await waitFor(() => {
      expect(view.getByTestId('session-owner').props.children).toBe('uid-b');
      expect(probe.restoring).toBe(false);
    });

    act(() => {
      probe.setCurrentTripId?.('trip-de-b');
      queryClient.setQueryData(['trips', 'uid-b'], [{ id: 'trip-de-b' }]);
    });
    await cacheStorage.set(persistedQueryStorageKey('uid-b'), {
      version: 1,
      userId: 'uid-b',
      queries: [{ key: ['trips', 'uid-b'], data: [{ id: 'trip-de-b' }] }],
    });
    await waitFor(async () => {
      expect(await prefsStorage.get(tripSelectionStorageKey('uid-b'), null)).toBe(
        'trip-de-b',
      );
    });

    await act(async () => {
      releaseCleanup();
      await cleanupFinished;
    });

    expect(await cacheStorage.get(persistedQueryStorageKey('uid-a'))).toBeNull();
    expect(queryClient.getQueryData(['trips', 'uid-b'])).toEqual([{ id: 'trip-de-b' }]);
    expect(await prefsStorage.get(tripSelectionStorageKey('uid-b'), null)).toBe('trip-de-b');
    expect(await cacheStorage.get(persistedQueryStorageKey('uid-b'))).toMatchObject({
      value: { userId: 'uid-b' },
    });
  });
});

describe('D. uma fonte de verdade para a sessão', () => {
  it('mantém um único ouvinte, e o devolve ao desmontar', async () => {
    const view = await mount();

    expect(mockCalls.subscribed).toBe(1);
    expect(mockListeners.size).toBe(1);

    await confirmarSaida(view);

    // O aviso `SIGNED_OUT` do provedor chega ao mesmo ouvinte que já existia:
    // sair não registra um segundo, e não deixa o antigo para trás.
    expect(mockCalls.subscribed).toBe(1);
    expect(mockListeners.size).toBe(1);

    view.unmount();
    expect(mockCalls.unsubscribed).toBe(1);
    expect(mockListeners.size).toBe(0);
  });

  it('o aviso do provedor e a chamada direta concordam', async () => {
    const view = await mount();

    // O adaptador emite `SIGNED_OUT` durante o próprio `signOut`. Se provider e
    // aviso fossem estados independentes, um deles ficaria para trás — o que é
    // exatamente o sintoma relatado.
    await confirmarSaida(view);
    expect(view.getByText('rota pública')).toBeTruthy();

    // E um `SIGNED_OUT` repetido não pode ressuscitar nada nem quebrar.
    await act(async () => {
      mockListeners.forEach((listener) => listener(null));
    });
    expect(view.getByText('rota pública')).toBeTruthy();
  });
});

/*
 * ------------------------------------------------------------------------
 * Os cenários que o teste em aparelho expôs, e que a rodada anterior não
 * cobria. Todos partem do mesmo relato: "confirmei Sair e continuei dentro
 * do app; só saiu depois de fechar e reabrir".
 * ------------------------------------------------------------------------
 */

describe('E. a limpeza é lenta, a saída não é', () => {
  it('desmonta a área privada mesmo com a limpeza de arquivos pendurada', async () => {
    // O `signOut` do provedor resolveu; o que demora é a limpeza local. Se a
    // interface esperasse por ela, a pessoa continuaria vendo a conta aberta —
    // que é a forma exata do defeito, só que com outra causa.
    mockState.gatePurge = true;
    const view = await mount();

    fireEvent.press(view.getByLabelText('Sair da conta'));
    await act(async () => undefined);
    fireEvent.press(view.getByLabelText('Sair'));
    await act(async () => undefined);

    // Aqui, agora: a sessão caiu antes de a limpeza terminar.
    expect(view.getByText('rota pública')).toBeTruthy();
    expect(mockCalls.purgedFiles).toEqual([]);
    expect(mockRouter.replace).toHaveBeenCalledWith('/(auth)/login');

    // E a limpeza continua acontecendo — ela é lenta, não é opcional.
    await act(async () => {
      mockState.releasePurge();
    });
    await waitFor(() => expect(mockCalls.purgedFiles).toEqual(['uid-a']));
    expect(view.getByText('rota pública')).toBeTruthy();
  });
});

describe('F. nada ressuscita a sessão que acabou de sair', () => {
  it('bootstrap sem dono não entrega a B a seleção global antiga de A', async () => {
    mockState.restoredSession = null;
    await prefsStorage.set(LEGACY_TRIP_SELECTION_KEY, 'trip-legado-de-a');
    await prefsStorage.set(tripSelectionStorageKey('uid-a'), 'trip-scoped-de-a');
    await prefsStorage.remove(tripSelectionStorageKey('uid-b'));

    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const view = render(
      <SafeAreaProvider initialMetrics={metrics}>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <ToastProvider>
              <AuthProvider>
                <TripSelectionProvider>
                  <Probe />
                  <Gate />
                </TripSelectionProvider>
              </AuthProvider>
            </ToastProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>,
    );

    await waitFor(() => expect(view.getByText('rota pública')).toBeTruthy());
    expect(probe.currentTripId).toBeNull();

    await act(async () => {
      mockListeners.forEach((listener) => listener(SESSION_B));
    });
    await waitFor(() => {
      expect(view.getByTestId('session-owner').props.children).toBe('uid-b');
      expect(probe.restoring).toBe(false);
    });

    expect(probe.currentTripId).toBeNull();
    expect(await prefsStorage.get(tripSelectionStorageKey('uid-a'), null)).toBe(
      'trip-scoped-de-a',
    );
    expect(await prefsStorage.get(LEGACY_TRIP_SELECTION_KEY, null)).toBeNull();
  });

  it('aceita uma troca passiva legítima de A para B quando B não saiu', async () => {
    const view = await mount();
    expect(view.getByTestId('session-owner').props.children).toBe('uid-a');

    // O Auth também é fonte de verdade para trocas legítimas vindas de fora
    // deste provider. B nunca saiu, portanto não pode ser confundida com um
    // refresh tardio da identidade tombstonada.
    await act(async () => {
      mockListeners.forEach((listener) => listener(SESSION_B));
    });

    await waitFor(() => {
      expect(view.getByTestId('session-owner').props.children).toBe('uid-b');
    });
  });

  it('uma restauração antiga que volta depois do logout é descartada', async () => {
    /*
     * A corrida: `restore()` foi pedido na montagem e ainda não voltou quando o
     * logout acontece. A resposta traz a sessão **antiga** — aplicá-la
     * colocaria a pessoa de volta na conta da qual ela pediu para sair.
     */
    mockState.gateRestore = true;

    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const view = render(
      <SafeAreaProvider initialMetrics={metrics}>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <ToastProvider>
              <AuthProvider>
                <TripSelectionProvider>
                  <Probe />
                  <Gate />
                </TripSelectionProvider>
              </AuthProvider>
            </ToastProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>,
    );

    // A sessão entra pelo aviso do provedor (token restaurado por fora), com a
    // restauração ainda pendurada.
    await act(async () => {
      mockListeners.forEach((listener) => listener(SESSION));
    });
    await waitFor(() => expect(view.getByText('rota privada')).toBeTruthy());

    await confirmarSaida(view);
    expect(view.getByText('rota pública')).toBeTruthy();

    // Só agora a restauração volta, trazendo a sessão vencida.
    await act(async () => {
      mockState.releaseRestore();
    });
    await act(async () => undefined);

    expect(view.getByText('rota pública')).toBeTruthy();
    expect(view.queryByText('rota privada')).toBeNull();
  });

  it('um aviso tardio do provedor com a sessão antiga não reautentica', async () => {
    // O supabase-js pode ter uma renovação de token em voo quando a saída
    // acontece. Ela volta emitindo a sessão antiga, e nenhum evento de fundo
    // pode desfazer uma decisão que a pessoa tomou.
    const view = await mount();
    await confirmarSaida(view);
    expect(view.getByText('rota pública')).toBeTruthy();

    await act(async () => {
      mockListeners.forEach((listener) => listener(SESSION));
    });

    expect(view.getByText('rota pública')).toBeTruthy();
  });

  it('aceita a entrada explícita de B, mas rejeita um SIGNED_IN tardio de A', async () => {
    const view = await mount();
    await confirmarSaida(view);
    expect(view.getByTestId('session-owner').props.children).toBe('sem sessão');

    await act(async () => {
      await authProbe.signIn?.('b@easytrip.app', 'senha-segura');
    });

    expect(mockCalls.signIn).toBe(1);
    expect(view.getByText('rota privada')).toBeTruthy();
    expect(view.getByTestId('session-owner').props.children).toBe('uid-b');

    // Uma renovação de A que começou antes da saída volta depois de B. O
    // booleano "aceitar eventos" já está aberto, mas apenas para a identidade
    // que abriu esta geração: B.
    await act(async () => {
      mockListeners.forEach((listener) => listener(SESSION));
    });

    expect(view.getByTestId('session-owner').props.children).toBe('uid-b');
    expect(view.getByText('rota privada')).toBeTruthy();
  });

  it('uma restauração tardia da viagem selecionada não volta após o logout', async () => {
    let releaseSelection!: (tripId: string | null) => void;
    const originalGet = prefsStorage.get.bind(prefsStorage);
    jest.spyOn(prefsStorage, 'get').mockImplementation(
      (<T,>(key: string, fallback: T) => {
        if (key !== tripSelectionStorageKey('uid-a')) return originalGet(key, fallback);
        return new Promise<T>((resolve) => {
          releaseSelection = (tripId) => resolve(tripId as T);
        });
      }) as typeof prefsStorage.get,
    );

    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const view = render(
      <SafeAreaProvider initialMetrics={metrics}>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <ToastProvider>
              <AuthProvider>
                <TripSelectionProvider>
                  <Probe />
                  <Gate />
                </TripSelectionProvider>
              </AuthProvider>
            </ToastProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>,
    );

    await waitFor(() => expect(view.getByText('rota privada')).toBeTruthy());
    await confirmarSaida(view);
    expect(view.getByText('rota pública')).toBeTruthy();

    await act(async () => {
      releaseSelection('trip-stale-from-a');
    });

    expect(probe.currentTripId).toBeNull();
  });
});

describe('G. o privilégio sai junto', () => {
  it('a conta admin perde o painel no mesmo instante', async () => {
    mockState.role = 'admin';
    const view = await mount();
    await waitFor(() => expect(view.getByText('painel admin')).toBeTruthy());

    await confirmarSaida(view);

    // `role` é derivada de `profile`, não guardada à parte: zerar o perfil zera
    // a permissão, e não sobra cópia para esquecer de limpar (§26).
    expect(view.queryByText('painel admin')).toBeNull();
    expect(view.getByText('rota pública')).toBeTruthy();
  });

  it('nem um aviso tardio devolve o painel', async () => {
    mockState.role = 'admin';
    const view = await mount();
    await waitFor(() => expect(view.getByText('painel admin')).toBeTruthy());
    await confirmarSaida(view);

    await act(async () => {
      mockListeners.forEach((listener) => listener(SESSION));
    });

    expect(view.queryByText('painel admin')).toBeNull();
  });
});

describe('H. toque duplo', () => {
  it('dois toques no botão de confirmar produzem uma saída só', async () => {
    const view = await mount();

    fireEvent.press(view.getByLabelText('Sair da conta'));
    await act(async () => undefined);

    const confirmar = view.getByLabelText('Sair');
    // The second synthetic press can land after the target becomes disabled
    // and bubble to Overlay's propagation guard; provide the native-event
    // shape while still issuing both presses in the same turn.
    const pressEvent = { stopPropagation: jest.fn() };
    fireEvent.press(confirmar, pressEvent);
    fireEvent.press(confirmar, pressEvent);
    await act(async () => undefined);

    expect(mockCalls.signOut).toBe(1);
    expect(view.getByText('rota pública')).toBeTruthy();
  });
});
