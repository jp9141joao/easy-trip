import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import type { AITripAction } from '@/domain/aiActions';
import type { Trip } from '@/domain/types';
import { AIActionBlockedError, useAIActionRunner } from '@/hooks/useAIActions';
import type { AIActionReport } from '@/services/aiActionExecutor';

const mockExecuteAIActions = jest.fn<Promise<AIActionReport>, unknown[]>();
const mockUndoAIActions = jest.fn();

jest.mock('@/services/aiActionExecutor', () => {
  const actual = jest.requireActual('@/services/aiActionExecutor');
  return {
    ...actual,
    executeAIActions: (...args: unknown[]) => mockExecuteAIActions(...args),
    undoAIActions: (...args: unknown[]) => mockUndoAIActions(...args),
  };
});

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

jest.mock('@/providers/ConnectivityProvider', () => ({
  useConnectivity: () => ({ isOffline: false }),
}));

const trip: Trip = {
  id: 'trip-1',
  userId: 'user-1',
  destinationCity: 'Paris',
  destinationCountry: 'França',
  countryCode: 'FR',
  timezone: 'Europe/Paris',
  startDate: '2026-08-22',
  endDate: '2026-08-31',
  budgetTotal: 30_000,
  budgetCurrency: 'BRL',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const action: AITripAction = {
  id: 'action-1',
  tripId: trip.id,
  type: 'itinerary.add',
  label: 'Adicionar ao roteiro',
  items: [{ title: 'Louvre', date: '2026-08-23', type: 'atracao' }],
};

const report: AIActionReport = {
  ok: true,
  partial: false,
  undoable: true,
  created: [{ kind: 'itinerary', id: 'item-1' }],
  outcomes: [
    {
      actionId: action.id,
      type: action.type,
      ok: true,
      succeeded: 1,
      failed: [],
      summary: '1 item adicionado ao roteiro',
    },
  ],
};

let queryClient: QueryClient;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

beforeEach(() => {
  mockExecuteAIActions.mockReset();
  mockUndoAIActions.mockReset();
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
});

afterEach(() => {
  queryClient.clear();
  jest.restoreAllMocks();
});

describe('trava da aplicação', () => {
  it('dois toques no mesmo frame executam a proposta uma vez', async () => {
    let finish!: (value: AIActionReport) => void;
    mockExecuteAIActions.mockImplementation(
      () => new Promise<AIActionReport>((resolve) => (finish = resolve)),
    );
    const view = renderHook(() => useAIActionRunner(trip), { wrapper });

    let first!: Promise<AIActionReport>;
    let second!: Promise<AIActionReport>;
    await act(async () => {
      first = view.result.current.run('message-1', [action]);
      second = view.result.current.run('message-1', [action]);
      await expect(second).rejects.toBeInstanceOf(AIActionBlockedError);
      expect(mockExecuteAIActions).toHaveBeenCalledTimes(1);
      finish(report);
      await expect(first).resolves.toBe(report);
    });

    expect(view.result.current.runningKey).toBeNull();
  });

  it('falha de refetch não transforma INSERT concluído em falha de aplicação', async () => {
    mockExecuteAIActions.mockResolvedValue(report);
    jest.spyOn(queryClient, 'invalidateQueries').mockRejectedValue(new Error('refetch falhou'));
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const view = renderHook(() => useAIActionRunner(trip), { wrapper });

    let received!: AIActionReport;
    await act(async () => {
      received = await view.result.current.run('message-1', [action]);
    });

    expect(received).toBe(report);
    // Sete queries: roteiro, checklist, gastos, viagem, viagens, metas e —
    // desde `journal.add` — o diário.
    expect(warning).toHaveBeenCalledWith('AI_ACTION_CACHE_INVALIDATION_FAILED', { failed: 7 });
  });
});
