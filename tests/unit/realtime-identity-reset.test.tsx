import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useState, type ReactNode } from 'react';

import { useNotificationRealtime, useTripRealtime } from '@/hooks/useTripRealtime';
import { CHANNEL_LINGER_MS, closeSharedRealtimeChannels } from '@/lib/realtimeChannel';
import { AuthProvider, useAuth } from '@/providers/AuthProvider';

/**
 * Realtime e troca de identidade (§8, D-04).
 *
 * A folga de `CHANNEL_LINGER_MS` foi feita para a NAVEGAÇÃO: Jornada →
 * Sugestões, remonte do Strict Mode, vaivém entre telas da mesma viagem. Quem
 * sai por ali volta em seguida, e derrubar a assinatura no caminho custaria uma
 * reconexão por toque.
 *
 * Sair da conta não é isso. Ali quem sai é a identidade, e não há volta: manter
 * o canal de A vivo por cinco segundos deixaria a assinatura da conta anterior
 * pendurada no mesmo cliente enquanto B entra. Basta um evento chegando nessa
 * janela para invalidar cache de B por conta de uma linha que pertence a A.
 *
 * O que este arquivo prova é a fronteira entre os dois casos: identidade cai
 * agora, tela continua com a folga. O provider roda de verdade — os dublês são
 * só o provedor de identidade e o cliente do Supabase.
 */

/* --------------------------------- dublês --------------------------------- */

/**
 * O mesmo dublê de canal de `realtime-subscriptions`: `channel(topico)`
 * devolve o objeto já registrado, `on` joga depois do `subscribe` e a remoção
 * só sai da lista do cliente quando o servidor confirma.
 */
class MockChannel {
  readonly bindings: { table: string; filter: string }[] = [];
  subscribeCount = 0;
  removed = false;

  constructor(readonly topic: string) {}

  on(type: string, filter: { table: string; filter: string }) {
    if (this.subscribeCount > 0) {
      throw new Error(
        `cannot add \`${type}\` callbacks for realtime:${this.topic} after \`subscribe()\`.`,
      );
    }
    this.bindings.push({ table: filter.table, filter: filter.filter });
    return this;
  }

  subscribe() {
    if (this.subscribeCount > 0) {
      throw new Error("tried to join multiple times. 'join' can only be called a single time");
    }
    this.subscribeCount += 1;
    return this;
  }
}

/** Quanto o servidor demora para confirmar a saída do canal. */
const REMOVAL_ACK_MS = 250;

let mockCreated: MockChannel[] = [];
let mockRegistered: MockChannel[] = [];
/** A ordem dos acontecimentos, que é metade do que está sendo testado. */
let mockSequence: string[] = [];

const mockRemoveChannel = jest.fn(
  (channel: MockChannel) =>
    new Promise<string>((resolve) => {
      channel.removed = true;
      mockSequence.push(`remove:${channel.topic}`);
      setTimeout(() => {
        mockRegistered = mockRegistered.filter((candidate) => candidate !== channel);
        resolve('ok');
      }, REMOVAL_ACK_MS);
    }),
);

jest.mock('@/lib/config', () => ({
  config: { hasSupabase: true, mode: 'production' },
  hasSupabase: true,
  hasBff: false,
  configIssues: [],
}));

jest.mock('@/repositories/supabase/client', () => ({
  getSupabaseClient: () => ({
    channel: (topic: string) => {
      const existing = mockRegistered.find((candidate) => candidate.topic === topic);
      if (existing) return existing;
      const channel = new MockChannel(topic);
      mockCreated.push(channel);
      mockRegistered.push(channel);
      mockSequence.push(`create:${topic}`);
      return channel;
    },
    removeChannel: mockRemoveChannel,
  }),
}));

const SESSION_A = {
  user: { id: 'uid-a', email: 'a@easytrip.app', createdAt: '', updatedAt: '' },
  accessToken: 'token-a',
};
const SESSION_B = {
  user: { id: 'uid-b', email: 'b@easytrip.app', createdAt: '', updatedAt: '' },
  accessToken: 'token-b',
};

const mockListeners = new Set<(session: unknown) => void>();
const mockState = {
  restored: null as unknown,
  signInReturns: SESSION_B as unknown,
};

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
    signIn: async () => mockState.signInReturns,
    signUp: async () => ({ status: 'confirmation-required', email: 'b@easytrip.app' }),
    signOut: async () => {},
    requestPasswordReset: async () => {},
    updatePassword: async () => {},
    redeemRecovery: async () => {
      throw new Error('sem link de recuperação neste teste');
    },
    deleteAccount: async () => {},
  },
  dataSource: {
    profile: {
      get: async (userId: string) => ({
        userId,
        name: 'Conta',
        defaultCurrency: 'BRL',
        role: 'user' as const,
      }),
      update: async (userId: string) => ({ userId, name: 'Conta', defaultCurrency: 'BRL' }),
    },
    files: {
      purgeLocalCopies: async () => undefined,
    },
    purgeUserData: async () => undefined,
  },
}));

jest.mock('@/lib/deepLink', () => ({
  getInitialUrl: async () => null,
  subscribeToUrls: () => () => undefined,
  createRedirectUrl: (path: string) => `easytrip://${path}`,
}));

/* --------------------------------- a árvore -------------------------------- */

/**
 * O que a raiz autenticada monta: o sino da pessoa e a viagem aberta. Como no
 * aplicativo, some inteira quando `isAuthenticated` cai.
 */
function TelaPrivada() {
  useNotificationRealtime();
  useTripRealtime('trip-a');
  return null;
}

function OutraTela({ tripId }: { tripId: string }) {
  useTripRealtime(tripId);
  return null;
}

/**
 * Abre e fecha uma segunda tela de viagem sem tocar na sessão — é o que o
 * `router.push` faz ao empilhar Sugestões sobre a Jornada, e o que precisa
 * continuar passando pela folga de cinco segundos.
 */
let abrirOutraTela: (tripId: string | null) => void = () => undefined;

function ArvoreAutenticada() {
  const { isAuthenticated } = useAuth();
  const [outra, setOutra] = useState<string | null>(null);
  abrirOutraTela = setOutra;
  if (!isAuthenticated) return null;
  return (
    <>
      <TelaPrivada />
      {outra ? <OutraTela tripId={outra} /> : null}
    </>
  );
}

let queryClient: QueryClient;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <ArvoreAutenticada />
      {children}
    </AuthProvider>
  </QueryClientProvider>
);

const montar = async () => {
  const view = renderHook(() => useAuth(), { wrapper });
  await waitFor(() => expect(view.result.current.initializing).toBe(false));
  return view;
};

/** Canais que continuam abertos no cliente. */
const vivos = () => mockCreated.filter((channel) => !channel.removed);
const topicos = (canais: MockChannel[]) => canais.map((channel) => channel.topic);
/** O assunto sem o número de instância — `notifications:uid-a#3` → `notifications:uid-a`. */
const assunto = (topic: string) => topic.split('#')[0];

beforeEach(() => {
  jest.useFakeTimers();
  mockCreated = [];
  mockRegistered = [];
  mockSequence = [];
  mockRemoveChannel.mockClear();
  mockListeners.clear();
  mockState.restored = null;
  mockState.signInReturns = SESSION_B;
  abrirOutraTela = () => undefined;
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  closeSharedRealtimeChannels();
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

/* ---------------------------------- logout --------------------------------- */

describe('sair da conta', () => {
  it('fecha os canais na hora, sem esperar a folga de 5 s', async () => {
    mockState.restored = SESSION_A;
    const view = await montar();

    await waitFor(() => expect(vivos()).toHaveLength(2));
    const antes = [...vivos()];
    expect(topicos(antes).map(assunto).sort()).toEqual(['notifications:uid-a', 'trip:trip-a']);

    await act(async () => {
      await view.result.current.signOut();
    });

    // Nenhum `advanceTimersByTime` acima: se a saída dependesse da folga, os
    // dois canais de A ainda estariam abertos aqui.
    expect(view.result.current.isAuthenticated).toBe(false);
    expect(mockRemoveChannel).toHaveBeenCalledTimes(2);
    for (const channel of antes) expect(channel.removed).toBe(true);
    expect(vivos()).toHaveLength(0);
  });

  it('a desmontagem da tela, depois, não reabre nem remove nada de novo', async () => {
    mockState.restored = SESSION_A;
    const view = await montar();
    await waitFor(() => expect(vivos()).toHaveLength(2));

    await act(async () => {
      await view.result.current.signOut();
    });
    mockRemoveChannel.mockClear();

    // A árvore privada já desmontou com o `isAuthenticated` falso: o cleanup do
    // React chega a um assunto que não existe mais no mapa e não faz nada.
    act(() => {
      jest.advanceTimersByTime(CHANNEL_LINGER_MS + REMOVAL_ACK_MS + 1);
    });

    expect(mockRemoveChannel).not.toHaveBeenCalled();
    expect(vivos()).toHaveLength(0);
    expect(mockRegistered).toHaveLength(0);
  });

  it('os canais caem antes da limpeza do cache da conta anterior', async () => {
    mockState.restored = SESSION_A;
    const view = await montar();
    await waitFor(() => expect(vivos()).toHaveLength(2));

    const limparDeVerdade = queryClient.clear.bind(queryClient);
    jest.spyOn(queryClient, 'clear').mockImplementation(() => {
      mockSequence.push('cache:clear');
      limparDeVerdade();
    });

    await act(async () => {
      await view.result.current.signOut();
    });

    const cache = mockSequence.indexOf('cache:clear');
    const remocoes = mockSequence
      .map((evento, indice) => (evento.startsWith('remove:') ? indice : -1))
      .filter((indice) => indice >= 0);
    expect(cache).toBeGreaterThan(-1);
    expect(remocoes).toHaveLength(2);
    // Coerente com D-04: a assinatura para de escrever no cache antes de o
    // cache ser esvaziado, e não o contrário.
    for (const remocao of remocoes) expect(remocao).toBeLessThan(cache);
  });

  it('expiração vinda do provedor fecha igual ao botão Sair', async () => {
    mockState.restored = SESSION_A;
    const view = await montar();
    await waitFor(() => expect(vivos()).toHaveLength(2));

    // Ninguém apertou nada: o token foi revogado por fora, ou a sessão terminou
    // em outro aparelho.
    await act(async () => {
      mockListeners.forEach((listener) => listener(null));
    });

    expect(view.result.current.isAuthenticated).toBe(false);
    expect(mockRemoveChannel).toHaveBeenCalledTimes(2);
    expect(vivos()).toHaveLength(0);
  });
});

/* ------------------------------- troca de conta ----------------------------- */

describe('trocar de conta', () => {
  it('A sai, B entra, e nunca há canal das duas identidades ao mesmo tempo', async () => {
    mockState.restored = SESSION_A;
    const view = await montar();
    await waitFor(() => expect(vivos()).toHaveLength(2));

    await act(async () => {
      await view.result.current.signOut();
    });
    await act(async () => {
      await view.result.current.signIn('b@easytrip.app', 'senha');
    });
    await waitFor(() => expect(vivos()).toHaveLength(2));

    expect(view.result.current.user?.id).toBe('uid-b');
    expect(topicos(vivos()).map(assunto).sort()).toEqual(['notifications:uid-b', 'trip:trip-a']);
    for (const channel of mockCreated.filter((c) => c.topic.includes('uid-a'))) {
      expect(channel.removed).toBe(true);
    }

    // A prova de isolamento é a ordem: tudo que era de A saiu ANTES de o
    // primeiro canal de B ser criado. Sem isso existiria uma janela de cinco
    // segundos com as duas assinaturas no mesmo cliente.
    const ultimaSaidaDeA = mockSequence.map((e) => e.startsWith('remove:') && e.includes('uid-a'))
      .lastIndexOf(true);
    const primeiraEntradaDeB = mockSequence.findIndex(
      (evento) => evento.startsWith('create:') && evento.includes('uid-b'),
    );
    expect(ultimaSaidaDeA).toBeGreaterThan(-1);
    expect(primeiraEntradaDeB).toBeGreaterThan(ultimaSaidaDeA);
  });

  it('o canal da viagem também é recriado — o novo objeto não é o de A', async () => {
    mockState.restored = SESSION_A;
    const view = await montar();
    await waitFor(() => expect(vivos()).toHaveLength(2));
    const viagemDeA = mockCreated.find((channel) => channel.topic.startsWith('trip:'))!;

    await act(async () => {
      await view.result.current.signOut();
    });
    await act(async () => {
      await view.result.current.signIn('b@easytrip.app', 'senha');
    });
    await waitFor(() => expect(vivos()).toHaveLength(2));

    const viagemDeB = vivos().find((channel) => channel.topic.startsWith('trip:'))!;
    expect(viagemDeA.removed).toBe(true);
    expect(viagemDeB).not.toBe(viagemDeA);
    expect(viagemDeB.topic).not.toBe(viagemDeA.topic);
    expect(viagemDeB.subscribeCount).toBe(1);
    expect(viagemDeB.bindings).toHaveLength(8);
  });

  it('uma troca anunciada pelo provedor, sem passar pelo botão Sair, isola igual', async () => {
    mockState.restored = SESSION_A;
    const view = await montar();
    await waitFor(() => expect(vivos()).toHaveLength(2));

    // O provedor pode anunciar outra identidade direto — a sessão trocou na
    // fonte da verdade, sem SIGNED_OUT no meio.
    await act(async () => {
      mockListeners.forEach((listener) => listener(SESSION_B));
    });
    await waitFor(() => expect(vivos()).toHaveLength(2));

    expect(view.result.current.user?.id).toBe('uid-b');
    expect(topicos(vivos()).map(assunto).sort()).toEqual(['notifications:uid-b', 'trip:trip-a']);
    for (const channel of mockCreated.filter((c) => c.topic.includes('uid-a'))) {
      expect(channel.removed).toBe(true);
    }
  });

  it('token renovado não é troca de identidade: o canal continua o mesmo', async () => {
    mockState.restored = SESSION_A;
    const view = await montar();
    await waitFor(() => expect(vivos()).toHaveLength(2));
    const antes = [...vivos()];

    // Acontece de hora em hora. Fechar aqui reconectaria o Realtime da conta
    // que está em uso, sem nada ter mudado.
    await act(async () => {
      mockListeners.forEach((listener) => listener({ ...SESSION_A, accessToken: 'renovado' }));
    });

    expect(view.result.current.session?.accessToken).toBe('renovado');
    expect(mockRemoveChannel).not.toHaveBeenCalled();
    expect(vivos()).toEqual(antes);
  });
});

/* ------------------------ a folga continua existindo ----------------------- */

describe('desmontagem normal, sem logout', () => {
  it('continua respeitando os 5 segundos', async () => {
    mockState.restored = SESSION_A;
    await montar();
    await waitFor(() => expect(vivos()).toHaveLength(2));

    act(() => abrirOutraTela('trip-b'));
    await waitFor(() => expect(vivos()).toHaveLength(3));
    act(() => abrirOutraTela(null));

    // Um instante antes de a folga acabar: ainda de pé, que é o que segura o
    // remonte do Strict Mode e o vaivém entre as telas da viagem.
    act(() => {
      jest.advanceTimersByTime(CHANNEL_LINGER_MS - 1);
    });
    expect(mockRemoveChannel).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(2);
    });
    expect(mockRemoveChannel).toHaveBeenCalledTimes(1);
    expect(topicos(vivos()).map(assunto).sort()).toEqual(['notifications:uid-a', 'trip:trip-a']);
  });

  it('voltar dentro da folga reaproveita o canal, como antes', async () => {
    mockState.restored = SESSION_A;
    await montar();
    await waitFor(() => expect(vivos()).toHaveLength(2));

    act(() => abrirOutraTela('trip-b'));
    await waitFor(() => expect(vivos()).toHaveLength(3));
    const viagemB = vivos().find((channel) => channel.topic.startsWith('trip:trip-b'))!;

    act(() => abrirOutraTela(null));
    act(() => {
      jest.advanceTimersByTime(CHANNEL_LINGER_MS - 1);
    });
    act(() => abrirOutraTela('trip-b'));

    expect(mockRemoveChannel).not.toHaveBeenCalled();
    expect(mockCreated.filter((channel) => channel.topic.startsWith('trip:trip-b'))).toEqual([
      viagemB,
    ]);
    expect(viagemB.subscribeCount).toBe(1);
  });

  it('sair de Sugestões com a Jornada montada não derruba a assinatura', async () => {
    mockState.restored = SESSION_A;
    await montar();
    await waitFor(() => expect(vivos()).toHaveLength(2));

    // Mesma viagem, mesma conta: o canal é um só e a Jornada continua nele.
    act(() => abrirOutraTela('trip-a'));
    expect(vivos()).toHaveLength(2);
    act(() => abrirOutraTela(null));
    act(() => {
      jest.advanceTimersByTime(CHANNEL_LINGER_MS + REMOVAL_ACK_MS + 1);
    });

    expect(mockRemoveChannel).not.toHaveBeenCalled();
    expect(vivos()).toHaveLength(2);
  });
});
