import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, waitFor, type RenderResult } from '@testing-library/react-native';
import { Text, View } from 'react-native';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';

import SettingsScreen from '@/app/profile/settings';
import { ToastProvider } from '@/components/ui';
import { prefsStorage } from '@/lib/storage';
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

const mockListeners = new Set<(session: unknown) => void>();

const mockState = {
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
  signOut: 0,
  subscribed: 0,
  unsubscribed: 0,
  purgedFiles: [] as string[],
};

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
      return SESSION;
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
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));
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
  const { isAuthenticated, isAdmin } = useAuth();
  return (
    <View>
      <Text>{isAuthenticated ? 'rota privada' : 'rota pública'}</Text>
      {isAuthenticated && isAdmin ? <Text>painel admin</Text> : null}
      {isAuthenticated ? <SettingsScreen /> : null}
    </View>
  );
}

/** Espia o estado global que precisa sair junto com a conta. */
const probe = { currentTripId: null as string | null };

function Probe() {
  const { currentTripId } = useTripSelection();
  probe.currentTripId = currentTripId;
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

  await waitFor(() => expect(view.getByText('rota privada')).toBeTruthy());
  await waitFor(() => expect(probe.currentTripId).toBe('trip-paris'));
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
  mockState.gateSignOut = false;
  mockState.gatePurge = false;
  mockState.gateRestore = false;
  mockState.role = 'user';
  Object.assign(mockCalls, { signOut: 0, subscribed: 0, unsubscribed: 0, purgedFiles: [] });
  mockListeners.clear();
  probe.currentTripId = null;
  await prefsStorage.set('currentTripId', 'trip-paris');
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
  });

  it('não limpa nada pela metade quando a saída não aconteceu', async () => {
    mockState.signOutFails = true;
    const view = await mount();

    await confirmarSaida(view);

    expect(probe.currentTripId).toBe('trip-paris');
    expect(await prefsStorage.get('currentTripId', null)).toBe('trip-paris');
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
    expect(await prefsStorage.get('currentTripId', null)).toBeNull();

    expect(queryClient.getQueryData(['trips', 'uid-a'])).toBeUndefined();
    expect(mockCalls.purgedFiles).toEqual(['uid-a']);
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

    // E a limpeza continua acontecendo — ela é lenta, não é opcional.
    await act(async () => {
      mockState.releasePurge();
    });
    await waitFor(() => expect(mockCalls.purgedFiles).toEqual(['uid-a']));
    expect(view.getByText('rota pública')).toBeTruthy();
  });
});

describe('F. nada ressuscita a sessão que acabou de sair', () => {
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
    fireEvent.press(confirmar);
    fireEvent.press(confirmar);
    await act(async () => undefined);

    expect(mockCalls.signOut).toBe(1);
    expect(view.getByText('rota pública')).toBeTruthy();
  });
});
