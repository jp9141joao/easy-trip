import { act, renderHook, waitFor } from '@testing-library/react-native';

import { usePushNotifications } from '@/hooks/usePushNotifications';
import {
  addNotificationResponseListener,
  configureForegroundBehavior,
  currentPushPermission,
  ensureAndroidChannel,
  getDeviceToken,
  isExpoGo,
  isRemotePushSupported,
  requestPushPermission,
} from '@/services/pushNotifications';
import {
  __resetNotificationsModule,
  getNotificationsModule,
} from '@/services/notificationsModule';

/**
 * Push remoto no Expo Go — a limitação do ambiente, e o que ela NÃO pode causar.
 *
 * O DEFEITO QUE ORIGINOU ESTE ARQUIVO
 *
 * Abrir o Easy Trip pelo Expo Go no Android punha um `console.error` na tela:
 *
 *   "expo-notifications: Android Push notifications (remote notifications)
 *    functionality provided by expo-notifications was removed from Expo Go
 *    with the release of SDK 53."
 *
 * E ele não vinha de nenhuma chamada nossa. O índice do `expo-notifications`
 * avalia `DevicePushTokenAutoRegistration.fx`, que assina um ouvinte de token no
 * escopo do módulo; dentro do Expo Go esse ouvinte imprime o erro. Ou seja: o
 * erro nasce do `import`. Como o Expo Router carrega todas as rotas ao abrir, um
 * import estático em qualquer tela bastava para sujar a Home.
 *
 * Por isso a asserção central deste arquivo não é sobre mensagens, e sim sobre
 * AVALIAÇÃO: no Expo Go o módulo `expo-notifications` não pode nem ser
 * carregado. A fábrica do dublê conta quantas vezes foi executada — se o
 * carregamento voltar a ser estático, `mockCarregouModulo` passa a ser chamado e
 * o teste cai.
 *
 * O que NÃO se testa aqui é a entrega em si: push real precisa de aparelho e
 * development build. O que se prende é o contorno — e que o contorno não desliga
 * nada em build de verdade.
 */

/* ------------------------------- os dublês -------------------------------- */

/** Qual ambiente o `expo-constants` reporta na próxima leitura. */
const mockAmbiente = { valor: 'bare' as 'bare' | 'standalone' | 'storeClient' };

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    // Getter, e não valor: cada teste escolhe o ambiente antes de ler.
    get executionEnvironment() {
      return mockAmbiente.valor;
    },
    expoConfig: { extra: { eas: { projectId: 'projeto-de-teste' } } },
    easConfig: undefined,
  },
  ExecutionEnvironment: { Bare: 'bare', Standalone: 'standalone', StoreClient: 'storeClient' },
}));

/** Quantas vezes o `expo-notifications` foi AVALIADO. No Expo Go: zero. */
const mockCarregouModulo = jest.fn();

const mockNotificacoes = {
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  getPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[abc]' })),
  addNotificationResponseReceivedListener: jest.fn((_ouvinte: (r: unknown) => void) => ({
    remove: jest.fn(),
  })),
  AndroidImportance: { DEFAULT: 3 },
  AndroidNotificationVisibility: { PRIVATE: 0 },
};

jest.mock('expo-notifications', () => {
  mockCarregouModulo();
  return mockNotificacoes;
});

jest.mock('expo-device', () => ({ isDevice: true, deviceName: 'Aparelho de teste' }));

/** Quem está na sessão agora. Trocar isto é entrar, sair ou trocar de conta. */
const mockSessao = { usuario: { id: 'uid-a' } as { id: string } | null };
jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: mockSessao.usuario }),
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: (rota: string) => mockPush(rota) }),
}));

const mockRegistrar = jest.fn(
  async (_token: string, _plataforma: string, _aparelho?: string) => undefined,
);
const mockDesregistrar = jest.fn(async (_token: string) => undefined);
jest.mock('@/repositories', () => ({
  dataSource: {
    pushTokens: {
      register: (token: string, plataforma: string, aparelho?: string) =>
        mockRegistrar(token, plataforma, aparelho),
      unregister: (token: string) => mockDesregistrar(token),
    },
  },
}));

/* ------------------------------- o cenário -------------------------------- */

function noExpoGo() {
  mockAmbiente.valor = 'storeClient';
}

function emBuildReal() {
  mockAmbiente.valor = 'bare';
}

beforeEach(() => {
  jest.clearAllMocks();
  __resetNotificationsModule();
  emBuildReal();
  mockSessao.usuario = { id: 'uid-a' };
  mockNotificacoes.getPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });
  mockNotificacoes.requestPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });
  mockNotificacoes.getExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[abc]' });
});

/* --------------------------------- Expo Go -------------------------------- */

describe('Expo Go', () => {
  beforeEach(noExpoGo);

  it('reconhece o ambiente pelo executionEnvironment, e não pela plataforma', () => {
    expect(isExpoGo()).toBe(true);
    expect(isRemotePushSupported()).toBe(false);
  });

  it('não carrega o expo-notifications — é o import que produzia o erro', () => {
    expect(getNotificationsModule()).toBeNull();
    expect(mockCarregouModulo).not.toHaveBeenCalled();
  });

  it('o serviço responde "indisponível" sem levantar', async () => {
    expect(() => configureForegroundBehavior()).not.toThrow();
    await expect(ensureAndroidChannel()).resolves.toBeUndefined();
    await expect(currentPushPermission()).resolves.toBe('unavailable');
    await expect(requestPushPermission()).resolves.toBe('unavailable');
    await expect(getDeviceToken('projeto-de-teste')).resolves.toBeNull();
    expect(addNotificationResponseListener(() => {})).toBeNull();
    expect(mockCarregouModulo).not.toHaveBeenCalled();
  });

  it('o hook termina em estado explícito, sem token e sem tocar no servidor', async () => {
    const { result, unmount } = renderHook(() => usePushNotifications());

    await waitFor(() => expect(result.current.permission).toBe('unavailable'));

    expect(result.current.supported).toBe(false);
    expect(result.current.unavailable).toBe(true);
    expect(result.current.enabled).toBe(false);
    expect(mockNotificacoes.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(mockNotificacoes.addNotificationResponseReceivedListener).not.toHaveBeenCalled();
    expect(mockRegistrar).not.toHaveBeenCalled();
    expect(mockCarregouModulo).not.toHaveBeenCalled();

    // Desmontar sem assinatura nenhuma também não pode levantar.
    expect(() => unmount()).not.toThrow();
  });

  it('ligar os avisos falha em silêncio — sem diálogo de permissão', async () => {
    const { result } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(result.current.permission).toBe('unavailable'));

    let resposta: boolean | undefined;
    await act(async () => {
      resposta = await result.current.enable();
    });

    expect(resposta).toBe(false);
    expect(mockNotificacoes.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(mockRegistrar).not.toHaveBeenCalled();
  });
});

/* --------------------- development build / build real --------------------- */

describe('development build', () => {
  it('carrega o expo-notifications e devolve sempre o mesmo módulo', () => {
    expect(isRemotePushSupported()).toBe(true);
    expect(getNotificationsModule()).toBe(mockNotificacoes);
    expect(getNotificationsModule()).toBe(mockNotificacoes);
  });

  it('quem já concedeu tem o aparelho registrado ao abrir', async () => {
    const { result } = renderHook(() => usePushNotifications());

    await waitFor(() => expect(result.current.enabled).toBe(true));

    expect(result.current.permission).toBe('granted');
    expect(result.current.supported).toBe(true);
    expect(mockNotificacoes.getExpoPushTokenAsync).toHaveBeenCalledWith({
      projectId: 'projeto-de-teste',
    });
    expect(mockRegistrar).toHaveBeenCalledWith(
      'ExponentPushToken[abc]',
      'ios',
      'Aparelho de teste',
    );
    expect(mockNotificacoes.setNotificationHandler).toHaveBeenCalled();
  });

  it('o toque na notificação continua levando à viagem', async () => {
    renderHook(() => usePushNotifications());
    await waitFor(() =>
      expect(mockNotificacoes.addNotificationResponseReceivedListener).toHaveBeenCalled(),
    );

    const ouvinte = mockNotificacoes.addNotificationResponseReceivedListener.mock.calls[0][0];
    act(() => {
      ouvinte({ notification: { request: { content: { data: { tripId: 't1' } } } } });
    });

    expect(mockPush).toHaveBeenCalledWith('/trip/t1');
  });

  it('permissão recusada: não registra nada, e a tela sabe disso', async () => {
    mockNotificacoes.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
    mockNotificacoes.requestPermissionsAsync.mockResolvedValue({
      granted: false,
      canAskAgain: false,
    });

    const { result } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(result.current.permission).toBe('denied'));

    let resposta: boolean | undefined;
    await act(async () => {
      resposta = await result.current.enable();
    });

    expect(resposta).toBe(false);
    expect(result.current.blocked).toBe(true);
    expect(mockNotificacoes.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(mockRegistrar).not.toHaveBeenCalled();
  });

  it('erro ao obter o token não derruba nada — só não há registro', async () => {
    mockNotificacoes.getExpoPushTokenAsync.mockRejectedValue(
      new Error('FirebaseApp is not initialized'),
    );

    const { result } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(result.current.permission).toBe('granted'));

    let resposta: boolean | undefined;
    await act(async () => {
      resposta = await result.current.enable();
    });

    expect(resposta).toBe(false);
    expect(result.current.enabled).toBe(false);
    expect(mockRegistrar).not.toHaveBeenCalled();
  });

  it('sair da conta desregistra o token daquela sessão', async () => {
    const { result, rerender } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(result.current.enabled).toBe(true));

    mockSessao.usuario = null;
    await act(async () => {
      rerender(undefined);
    });

    await waitFor(() => expect(mockDesregistrar).toHaveBeenCalledWith('ExponentPushToken[abc]'));
    expect(result.current.enabled).toBe(false);
  });
});
