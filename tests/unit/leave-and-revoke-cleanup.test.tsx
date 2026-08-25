import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';

import type { Trip } from '@/domain/types';
import { queryKeys } from '@/hooks/queryKeys';
import { useMembershipMutations } from '@/hooks/useCollaboration';
import {
  REVOKED_TRIP_AUDIT_TIMEOUT_MS,
  useRevokedTripCleanup,
} from '@/hooks/useNotifications';
import { readAITripContext, writeAITripContext } from '@/lib/aiTripContext';
import {
  readMirror,
  setMirrorViewer,
  writeMirrorFromBytes,
} from '@/lib/fileMirror';

/**
 * B.4 do handoff — perder acesso a uma viagem.
 *
 * DUAS PORTAS, NÃO UMA
 *
 * "Ser removido" chega pela notificação `trip_member_removed`. "Sair por conta
 * própria" NÃO chega: `leave_trip` remove a própria linha de `trip_members`, e
 * a notificação é escrita para quem remove alguém. Depender só do evento
 * deixava quem saiu com o roteiro, as reservas e as cópias locais no aparelho
 * (§15).
 *
 * E a notificação é histórica, o acesso não é: uma remoção de ontem não pode
 * apagar de novo uma viagem para a qual a pessoa foi reconvidada hoje (§19).
 */

const USER = 'user-1';
const PARIS = 'paris';
const TOQUIO = 'toquio';

const mockListNotifications = jest.fn();
const mockListTrips = jest.fn();
const mockLeave = jest.fn();
const mockSetCurrentTripId = jest.fn();
let mockCurrentTripId: string | null = PARIS;

jest.mock('@/repositories', () => ({
  dataSource: {
    notifications: { list: (...args: unknown[]) => mockListNotifications(...args) },
    trips: { list: (...args: unknown[]) => mockListTrips(...args) },
    members: {
      leave: (...args: unknown[]) => mockLeave(...args),
      listMembers: async () => [],
      listInvites: async () => [],
      listPendingInvitesForUser: async () => [],
      memberNames: async () => ({}),
      invite: async () => undefined,
      setRole: async () => undefined,
      removeMember: async () => undefined,
      cancelInvite: async () => undefined,
      acceptInvite: async () => undefined,
      declineInvite: async () => undefined,
    },
  },
}));

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { id: USER } }),
}));

jest.mock('@/providers/TripSelectionProvider', () => ({
  useTripSelection: () => ({
    currentTripId: mockCurrentTripId,
    setCurrentTripId: mockSetCurrentTripId,
    restoring: false,
  }),
}));

const asTrip = (id: string): Trip => ({ id }) as Trip;

const removal = (tripId: string, id = `removal-${tripId}`) => ({
  id,
  userId: USER,
  type: 'trip_member_removed',
  title: 'Acesso removido',
  data: { tripId },
  createdAt: '2026-08-24T10:00:00.000Z',
});

/* eslint-disable @typescript-eslint/no-require-imports */
const resetFs = () => (require('expo-file-system') as { __reset: () => void }).__reset();

function harness() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: 0 } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

/** O que uma viagem deixa no aparelho enquanto a pessoa participa dela. */
function semear(client: QueryClient, tripId: string) {
  client.setQueryData(queryKeys.trips(USER), [asTrip(PARIS), asTrip(TOQUIO)]);
  client.setQueryData(queryKeys.trip(tripId), asTrip(tripId));
  client.setQueryData(queryKeys.itinerary(tripId), [{ id: `roteiro-${tripId}` }]);
  client.setQueryData(queryKeys.checklist(tripId), [{ id: `checklist-${tripId}` }]);
  client.setQueryData(queryKeys.expenses(tripId), [{ id: `despesa-${tripId}` }]);
  client.setQueryData(queryKeys.journal(tripId), [{ id: `diario-${tripId}` }]);
  client.setQueryData(queryKeys.tripReservations(tripId), [
    { id: `reserva-${tripId}`, filePath: `dono/${tripId}/bilhete.pdf` },
  ]);
  client.setQueryData(queryKeys.journalMedia(tripId), [
    { id: `midia-${tripId}`, filePath: `dono/entrada-${tripId}/foto.jpg` },
  ]);
  client.setQueryData(queryKeys.suggestions(tripId), [{ id: `sugestao-${tripId}` }]);
  client.setQueryData(queryKeys.tripMembers(tripId), [{ userId: USER }]);
  client.setQueryData(queryKeys.tripInvites(tripId), []);
}

const CHAVES_DA_VIAGEM = (tripId: string) => [
  queryKeys.trip(tripId),
  queryKeys.itinerary(tripId),
  queryKeys.checklist(tripId),
  queryKeys.expenses(tripId),
  queryKeys.journal(tripId),
  queryKeys.journalMedia(tripId),
  queryKeys.tripReservations(tripId),
  queryKeys.suggestions(tripId),
  queryKeys.tripMembers(tripId),
  queryKeys.tripInvites(tripId),
];

beforeEach(async () => {
  await AsyncStorage.clear();
  resetFs();
  setMirrorViewer(null);
  setMirrorViewer(USER);
  mockListNotifications.mockReset().mockResolvedValue([]);
  mockListTrips.mockReset().mockResolvedValue([asTrip(PARIS), asTrip(TOQUIO)]);
  mockLeave.mockReset().mockResolvedValue(undefined);
  mockSetCurrentTripId.mockReset();
  mockCurrentTripId = PARIS;
});

afterEach(() => setMirrorViewer(null));

describe('sair da viagem limpa sem esperar notificação (§15)', () => {
  it('purga cache, seleção, contexto de IA e cópias locais daquela viagem', async () => {
    const { client, wrapper } = harness();
    semear(client, PARIS);
    semear(client, TOQUIO);
    await writeAITripContext(USER, PARIS);
    await writeMirrorFromBytes('attachments', `dono/${PARIS}/bilhete.pdf`, new ArrayBuffer(8));
    await writeMirrorFromBytes('journal', `dono/entrada-${PARIS}/foto.jpg`, new ArrayBuffer(8));

    const { result } = renderHook(() => useMembershipMutations(PARIS), { wrapper });
    await act(async () => {
      await result.current.leave.mutateAsync();
    });

    expect(mockLeave).toHaveBeenCalledWith(PARIS);
    for (const chave of CHAVES_DA_VIAGEM(PARIS)) {
      expect(client.getQueryData(chave)).toBeUndefined();
    }
    expect(client.getQueryData<Trip[]>(queryKeys.trips(USER))?.map((t) => t.id)).toEqual([TOQUIO]);
    expect(mockSetCurrentTripId).toHaveBeenCalledWith(null);

    // As cópias locais daquela viagem saem; as das outras ficam.
    expect(readMirror('attachments', `dono/${PARIS}/bilhete.pdf`)).toBeUndefined();
    expect(readMirror('journal', `dono/entrada-${PARIS}/foto.jpg`)).toBeUndefined();
    await waitFor(async () => expect(await readAITripContext(USER)).toBeNull());

    // Tóquio não foi tocada.
    expect(client.getQueryData(queryKeys.itinerary(TOQUIO))).toBeDefined();
    client.clear();
  });

  it('uma saída que falha não apaga nada — a pessoa continua membro (§16)', async () => {
    mockLeave.mockRejectedValue(new Error('sem conexão'));
    const { client, wrapper } = harness();
    semear(client, PARIS);
    await writeMirrorFromBytes('attachments', `dono/${PARIS}/bilhete.pdf`, new ArrayBuffer(8));

    const { result } = renderHook(() => useMembershipMutations(PARIS), { wrapper });
    await act(async () => {
      await expect(result.current.leave.mutateAsync()).rejects.toThrow('sem conexão');
    });

    for (const chave of CHAVES_DA_VIAGEM(PARIS)) {
      expect(client.getQueryData(chave)).toBeDefined();
    }
    expect(mockSetCurrentTripId).not.toHaveBeenCalled();
    expect(readMirror('attachments', `dono/${PARIS}/bilhete.pdf`)).toBeDefined();
    client.clear();
  });

  it('não deixa o contexto da IA de outra viagem cair junto', async () => {
    const { client, wrapper } = harness();
    semear(client, PARIS);
    await writeAITripContext(USER, TOQUIO);

    const { result } = renderHook(() => useMembershipMutations(PARIS), { wrapper });
    await act(async () => {
      await result.current.leave.mutateAsync();
    });

    expect(await readAITripContext(USER)).toBe(TOQUIO);
    client.clear();
  });
});

describe('remoção: a auditoria de acesso não fica pendurada (§17)', () => {
  it('uma auditoria que nunca responde vira limpeza depois do prazo', async () => {
    jest.useFakeTimers();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockListNotifications.mockResolvedValue([removal(PARIS)]);
    mockListTrips.mockImplementation(() => new Promise(() => {}));

    const { client, wrapper } = harness();
    semear(client, PARIS);

    renderHook(() => useRevokedTripCleanup(), { wrapper });
    await waitFor(() => expect(mockListTrips).toHaveBeenCalled());

    // Antes do prazo, nada foi apagado: o acesso ainda pode ser confirmado.
    expect(client.getQueryData(queryKeys.itinerary(PARIS))).toBeDefined();

    await act(async () => {
      jest.advanceTimersByTime(REVOKED_TRIP_AUDIT_TIMEOUT_MS + 1);
    });

    // Sem prova de acesso, privacidade vence disponibilidade.
    await waitFor(() => expect(client.getQueryData(queryKeys.itinerary(PARIS))).toBeUndefined());
    warn.mockRestore();
    jest.useRealTimers();
    client.clear();
  });

  it('uma auditoria que falha limpa em vez de conservar dado possivelmente revogado', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockListNotifications.mockResolvedValue([removal(PARIS)]);
    mockListTrips.mockRejectedValue(new Error('sem conexão'));

    const { client, wrapper } = harness();
    semear(client, PARIS);

    renderHook(() => useRevokedTripCleanup(), { wrapper });

    await waitFor(() => expect(client.getQueryData(queryKeys.itinerary(PARIS))).toBeUndefined());
    warn.mockRestore();
    client.clear();
  });
});

describe('a notificação some no meio da verificação (§18)', () => {
  it('apagar a notificação não cancela a limpeza que ela disparou', async () => {
    let liberar: (trips: Trip[]) => void = () => {};
    mockListNotifications.mockResolvedValue([removal(PARIS)]);
    mockListTrips.mockImplementation(
      () =>
        new Promise<Trip[]>((resolve) => {
          liberar = resolve;
        }),
    );

    const { client, wrapper } = harness();
    semear(client, PARIS);

    renderHook(() => useRevokedTripCleanup(), { wrapper });
    await waitFor(() => expect(mockListTrips).toHaveBeenCalledTimes(1));

    /*
     * A pessoa toca na notificação e ela sai da Central. Antes, o efeito
     * reexecutava com `revokedTripIds` vazio, o `cleanup` do anterior marcava
     * `active = false` e a verificação em curso era abortada no meio — a
     * limpeza de segurança nunca acontecia.
     */
    mockListNotifications.mockResolvedValue([]);
    await act(async () => {
      await client.invalidateQueries({ queryKey: queryKeys.notifications(USER) });
    });

    // A auditoria conclui depois disso, e confirma que o acesso acabou.
    await act(async () => {
      liberar([asTrip(TOQUIO)]);
    });

    await waitFor(() => expect(client.getQueryData(queryKeys.itinerary(PARIS))).toBeUndefined());
    client.clear();
  });

  it('a mesma viagem não é auditada duas vezes', async () => {
    mockListNotifications.mockResolvedValue([removal(PARIS)]);
    const { client, wrapper } = harness();
    semear(client, PARIS);

    renderHook(() => useRevokedTripCleanup(), { wrapper });
    await waitFor(() => expect(mockListTrips).toHaveBeenCalledTimes(1));

    // Uma segunda notificação da MESMA viagem não gera nova auditoria.
    mockListNotifications.mockResolvedValue([removal(PARIS), removal(PARIS, 'removal-2')]);
    await act(async () => {
      await client.invalidateQueries({ queryKey: queryKeys.notifications(USER) });
    });

    expect(mockListTrips).toHaveBeenCalledTimes(1);
    client.clear();
  });
});

describe('reconvite: o acesso atual vence o evento histórico (§19)', () => {
  it('não apaga cache, seleção nem cópias locais de uma viagem reconvidada', async () => {
    mockListNotifications.mockResolvedValue([removal(PARIS)]);
    mockListTrips.mockResolvedValue([asTrip(PARIS), asTrip(TOQUIO)]);

    const { client, wrapper } = harness();
    semear(client, PARIS);
    await writeAITripContext(USER, PARIS);
    const espelho = await writeMirrorFromBytes(
      'attachments',
      `dono/${PARIS}/bilhete.pdf`,
      new ArrayBuffer(8),
    );

    renderHook(() => useRevokedTripCleanup(), { wrapper });

    await waitFor(() => expect(mockListTrips).toHaveBeenCalledWith(USER));
    await waitFor(() =>
      expect(client.getQueryData<Trip[]>(queryKeys.trips(USER))?.map((t) => t.id)).toEqual([
        PARIS,
        TOQUIO,
      ]),
    );

    expect(client.getQueryData(queryKeys.itinerary(PARIS))).toBeDefined();
    expect(mockSetCurrentTripId).not.toHaveBeenCalled();
    expect(readMirror('attachments', `dono/${PARIS}/bilhete.pdf`)).toBe(espelho);
    expect(await readAITripContext(USER)).toBe(PARIS);
    client.clear();
  });
});
