import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { enqueue } from '@/domain/offlineQueue';
import { useOfflineQueue } from '@/hooks/useOfflineQueue';
import { loadQueue, saveQueue } from '@/lib/offlineQueue';

type Session = { user: { id: string } } | null;
let mockSession: Session = { user: { id: 'alice' } };
const mockListeners = new Set<(session: Session) => void>();
const mockCreate = jest.fn<Promise<void>, [unknown]>();
const mockRestore = jest.fn(async () => mockSession);

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: mockSession?.user ?? null }),
}));
jest.mock('@/providers/ConnectivityProvider', () => ({
  useConnectivity: () => ({ isOnline: true }),
}));
jest.mock('@/repositories', () => ({
  authAdapter: {
    restore: () => mockRestore(),
    onAuthStateChange: (listener: (session: Session) => void) => {
      mockListeners.add(listener);
      return () => mockListeners.delete(listener);
    },
  },
  dataSource: { expenses: { create: (input: unknown) => mockCreate(input) } },
}));

const initialQueue = ['e1', 'e2'].reduce(
  (queue, targetId) => enqueue(queue, {
    id: targetId,
    targetId,
    userId: 'alice',
    tripId: 'trip',
    entity: 'expense',
    operation: 'create',
    payload: { tripId: 'trip', amount: 10 },
  }, '2026-01-01T00:00:00.000Z'),
  [] as Awaited<ReturnType<typeof loadQueue>>,
);

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { ...renderHook(() => useOfflineQueue(), { wrapper }), client };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  mockSession = { user: { id: 'alice' } };
  mockListeners.clear();
  mockCreate.mockReset();
  mockRestore.mockClear();
  await saveQueue('alice', initialQueue);
});

it.each([null, { user: { id: 'bento' } }])(
  'interrompe a fila em andamento quando o adaptador anuncia %j',
  async (nextSession) => {
    let release!: () => void;
    mockCreate.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const view = setup();
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));

    await act(async () => {
      mockSession = nextSession;
      for (const listener of mockListeners) listener(mockSession);
      release();
    });
    await waitFor(() => expect(mockListeners.size).toBe(0));

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(await loadQueue('alice')).toEqual([initialQueue[1]]);
    expect(await loadQueue('bento')).toEqual([]);
    view.unmount();
    view.client.clear();
  },
);

it('não inicia uma fila quando a sessão do adaptador já difere do usuário renderizado', async () => {
  mockRestore.mockResolvedValueOnce({ user: { id: 'bento' } });
  const view = setup();
  await waitFor(() => expect(mockRestore).toHaveBeenCalled());
  await waitFor(() => expect(mockListeners.size).toBe(0));
  expect(mockCreate).not.toHaveBeenCalled();
  expect(await loadQueue('alice')).toEqual(initialQueue);
  view.unmount();
  view.client.clear();
});
