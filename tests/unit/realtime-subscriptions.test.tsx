import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { queryKeys } from '@/hooks/queryKeys';
import { useNotificationRealtime, useTripRealtime } from '@/hooks/useTripRealtime';
import { CHANNEL_LINGER_MS, closeSharedRealtimeChannels } from '@/lib/realtimeChannel';

/**
 * O ciclo de vida do canal Realtime (§8).
 *
 * O DEFEITO: "cannot add `postgres_changes` callbacks for realtime:trip:<id>
 * after `subscribe()`" ao abrir Sugestões a partir da Jornada.
 *
 * O dublê aqui não é um objeto complacente — ele repete os dois invariantes do
 * `@supabase/realtime-js` que produziam o erro no aparelho:
 *
 * 1. `client.channel(topico)` NÃO cria canal novo quando já existe um com
 *    aquele tópico: devolve o mesmo objeto;
 * 2. `channel.on('postgres_changes', ...)` joga se o canal já foi inscrito, e
 *    `subscribe()` joga se o canal já entrou uma vez.
 *
 * E a remoção é assíncrona, como a de verdade: o canal só sai da lista do
 * cliente depois que o servidor confirma a saída. Sem isso, o remonte imediato
 * passaria no teste e continuaria quebrando no Android.
 */

class MockChannel {
  readonly bindings: { table: string; filter: string }[] = [];
  private readonly handlers: { table: string; run: () => void }[] = [];
  subscribeCount = 0;
  removed = false;

  constructor(readonly topic: string) {}

  on(type: string, filter: { table: string; filter: string }, run: () => void) {
    if (this.subscribeCount > 0) {
      throw new Error(
        `cannot add \`${type}\` callbacks for realtime:${this.topic} after \`subscribe()\`.`,
      );
    }
    this.bindings.push({ table: filter.table, filter: filter.filter });
    this.handlers.push({ table: filter.table, run });
    return this;
  }

  subscribe() {
    if (this.subscribeCount > 0) {
      throw new Error("tried to join multiple times. 'join' can only be called a single time");
    }
    this.subscribeCount += 1;
    return this;
  }

  /** Um evento do Postgres chegando do servidor. */
  emit(table: string) {
    for (const handler of this.handlers) if (handler.table === table) handler.run();
  }
}

/** Quanto o servidor demora para confirmar a saída do canal. */
const REMOVAL_ACK_MS = 250;

let mockCreated: MockChannel[] = [];
let mockRegistered: MockChannel[] = [];

const mockRemoveChannel = jest.fn(
  (channel: MockChannel) =>
    new Promise<string>((resolve) => {
      channel.removed = true;
      setTimeout(() => {
        mockRegistered = mockRegistered.filter((candidate) => candidate !== channel);
        resolve('ok');
      }, REMOVAL_ACK_MS);
    }),
);

jest.mock('@/lib/config', () => ({ config: { hasSupabase: true } }));
jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'user-a' } }),
}));
jest.mock('@/repositories/supabase/client', () => ({
  getSupabaseClient: () => ({
    channel: (topic: string) => {
      const existing = mockRegistered.find((candidate) => candidate.topic === topic);
      if (existing) return existing;
      const channel = new MockChannel(topic);
      mockCreated.push(channel);
      mockRegistered.push(channel);
      return channel;
    },
    removeChannel: mockRemoveChannel,
  }),
}));

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

/** Deixa a folga de saída passar, e com ela a confirmação do servidor. */
const passarAFolga = () =>
  act(() => {
    jest.advanceTimersByTime(CHANNEL_LINGER_MS + REMOVAL_ACK_MS + 1);
  });

const trip = () => mockCreated.filter((channel) => channel.topic.startsWith('trip:'));

beforeEach(() => {
  jest.useFakeTimers();
  mockCreated = [];
  mockRegistered = [];
  mockRemoveChannel.mockClear();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  closeSharedRealtimeChannels();
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

/* ---------------------------- ordem e assinatura --------------------------- */

describe('a ordem que o Supabase exige', () => {
  it('registra os oito bindings ANTES de assinar, e assina uma vez só', () => {
    renderHook(() => useTripRealtime('trip-a'), { wrapper });

    expect(trip()).toHaveLength(1);
    const channel = trip()[0];
    // O dublê joga se um `.on` chegar depois do `subscribe`; chegar aqui com
    // os oito registrados já prova a ordem.
    expect(channel.bindings).toHaveLength(8);
    expect(channel.subscribeCount).toBe(1);
    for (const binding of channel.bindings) {
      expect(binding.filter).toBe('trip_id=eq.trip-a');
    }
  });

  it('o canal do sino é por pessoa, filtrado pelo UID', () => {
    renderHook(() => useNotificationRealtime(), { wrapper });

    const canal = mockCreated.filter((channel) => channel.topic.startsWith('notifications:user-a'));
    expect(canal).toHaveLength(1);
    expect(canal[0].bindings).toEqual([
      { table: 'notifications', filter: 'user_id=eq.user-a' },
    ]);
    expect(canal[0].subscribeCount).toBe(1);
  });
});

/* ------------------------- duas telas, uma viagem -------------------------- */

describe('Jornada e Sugestões ao mesmo tempo (o defeito relatado)', () => {
  it('a segunda tela não estoura, e não abre um segundo canal', () => {
    const jornada = renderHook(() => useTripRealtime('trip-a'), { wrapper });

    // `router.push` empilha Sugestões SOBRE a Jornada: a de baixo continua
    // montada. Era exatamente aqui que o `.on()` caía no canal já inscrito.
    expect(() => renderHook(() => useTripRealtime('trip-a'), { wrapper })).not.toThrow();

    expect(trip()).toHaveLength(1);
    expect(trip()[0].subscribeCount).toBe(1);
    jornada.unmount();
  });

  it('sair de Sugestões não desliga o Realtime da Jornada', () => {
    const jornada = renderHook(() => useTripRealtime('trip-a'), { wrapper });
    const sugestoes = renderHook(() => useTripRealtime('trip-a'), { wrapper });

    sugestoes.unmount();
    passarAFolga();
    expect(mockRemoveChannel).not.toHaveBeenCalled();

    jornada.unmount();
    passarAFolga();
    expect(mockRemoveChannel).toHaveBeenCalledTimes(1);
    expect(mockRemoveChannel).toHaveBeenCalledWith(trip()[0]);
  });

  it('o evento chega às duas telas montadas', () => {
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
    const jornada = renderHook(() => useTripRealtime('trip-a'), { wrapper });
    const sugestoes = renderHook(() => useTripRealtime('trip-a'), { wrapper });

    act(() => trip()[0].emit('trip_suggestions'));

    const chamadas = invalidate.mock.calls.filter(
      ([arg]) => JSON.stringify(arg?.queryKey) === JSON.stringify(queryKeys.suggestions('trip-a')),
    );
    expect(chamadas).toHaveLength(2);

    sugestoes.unmount();
    jornada.unmount();
  });
});

/* --------------------------------- remonte --------------------------------- */

describe('abrir, voltar e abrir de novo', () => {
  it('dentro da folga, reaproveita o canal em vez de recriá-lo', () => {
    renderHook(() => useTripRealtime('trip-a'), { wrapper }).unmount();
    expect(() => renderHook(() => useTripRealtime('trip-a'), { wrapper })).not.toThrow();

    expect(trip()).toHaveLength(1);
    expect(trip()[0].subscribeCount).toBe(1);
    expect(mockRemoveChannel).not.toHaveBeenCalled();
  });

  it('depois da folga, o canal antigo sai e o novo é OUTRO objeto', () => {
    renderHook(() => useTripRealtime('trip-a'), { wrapper }).unmount();
    passarAFolga();
    expect(mockRemoveChannel).toHaveBeenCalledTimes(1);

    renderHook(() => useTripRealtime('trip-a'), { wrapper });

    expect(trip()).toHaveLength(2);
    expect(trip()[0]).not.toBe(trip()[1]);
    expect(trip()[1].subscribeCount).toBe(1);
    expect(trip()[1].bindings).toHaveLength(8);
  });

  it('remonta enquanto a saída do canal antigo ainda está em voo', () => {
    /*
     * O caso mais duro, e o motivo do número de instância no tópico: entre o
     * `removeChannel` e a confirmação do servidor, o canal antigo continua na
     * lista do cliente. Pedir o mesmo tópico aí devolveria justamente ele — já
     * inscrito, e portanto fechado para novos `.on()`. É a mesma sequência que
     * o Strict Mode produz em desenvolvimento (monta, limpa, monta).
     */
    renderHook(() => useTripRealtime('trip-a'), { wrapper }).unmount();
    act(() => {
      jest.advanceTimersByTime(CHANNEL_LINGER_MS + 1);
    });
    expect(mockRemoveChannel).toHaveBeenCalledTimes(1);
    expect(mockRegistered).toHaveLength(1); // a confirmação ainda não chegou

    expect(() => renderHook(() => useTripRealtime('trip-a'), { wrapper })).not.toThrow();

    expect(trip()).toHaveLength(2);
    expect(trip()[1]).not.toBe(trip()[0]);
    expect(trip()[1].topic).not.toBe(trip()[0].topic);
    expect(trip()[1].bindings).toHaveLength(8);
    expect(trip()[1].subscribeCount).toBe(1);
  });
});

/* ------------------------------ troca de viagem ---------------------------- */

describe('trocar de viagem', () => {
  it('A sai, B entra, e os filtros não se misturam', () => {
    const hook = renderHook(({ id }: { id: string }) => useTripRealtime(id), {
      wrapper,
      initialProps: { id: 'trip-a' },
    });

    hook.rerender({ id: 'trip-b' });
    passarAFolga();

    expect(trip()).toHaveLength(2);
    expect(trip()[0].topic).toContain('trip:trip-a');
    expect(trip()[1].topic).toContain('trip:trip-b');
    expect(mockRemoveChannel).toHaveBeenCalledWith(trip()[0]);
    for (const binding of trip()[1].bindings) {
      expect(binding.filter).toBe('trip_id=eq.trip-b');
    }

    hook.unmount();
  });

  it('sem viagem não há canal — o modo demonstração não tem servidor', () => {
    renderHook(() => useTripRealtime(undefined), { wrapper });
    expect(trip()).toHaveLength(0);
  });
});
