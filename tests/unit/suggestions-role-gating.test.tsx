import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';

import { queryKeys } from '@/hooks/queryKeys';
import { useRefreshSuggestions, useSuggestions } from '@/hooks/useSuggestions';
import { SuggestionGenerationError, type TripSuggestion } from '@/domain/suggestions';

const USER = '11111111-1111-4111-8111-111111111111';

const mockEnsure = jest.fn(async (..._args: unknown[]) => [] as TripSuggestion[]);
const mockList = jest.fn(async (..._args: unknown[]) => [] as TripSuggestion[]);

jest.mock('@/repositories', () => ({
  dataSource: {
    suggestions: {
      ensure: (...args: unknown[]) => mockEnsure(...args),
      listByTrip: (...args: unknown[]) => mockList(...args),
    },
  },
}));

jest.mock('@/hooks/useTripData', () => ({ useItinerary: () => ({ data: [] }) }));

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { id: USER } }),
}));

let client: QueryClient;

function makeWrapper() {
  client = new QueryClient({
    // `mutations.gcTime` também zerado: sem isso a mutação de refresh deixa um
    // temporizador de coleta de cinco minutos vivo, e o processo do Jest não
    // encerra depois do último teste.
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } },
  });
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

/** Uma sugestão qualquer — só o que a contagem precisa. */
function suggestion(id: string): TripSuggestion {
  return {
    id,
    tripId: 'trip-1',
    title: id,
    category: 'lugares',
    description: 'Um lugar.',
    source: 'catalog',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

beforeEach(() => {
  mockEnsure.mockClear();
  mockList.mockClear();
  mockEnsure.mockImplementation(async () => []);
  mockList.mockImplementation(async () => []);
});

describe('suggestion role gating', () => {
  it('lets a viewer list shared suggestions without invoking generation', async () => {
    const { result } = renderHook(
      () => useSuggestions('trip-1', { resolved: true, canEdit: false }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.error).toBeNull();
    expect(mockList).toHaveBeenCalledWith('trip-1');
    expect(mockEnsure).not.toHaveBeenCalled();
  });

  it('waits until the role is resolved', async () => {
    renderHook(() => useSuggestions('trip-1', { resolved: false, canEdit: false }), {
      wrapper: makeWrapper(),
    });

    await Promise.resolve();
    expect(mockList).not.toHaveBeenCalled();
    expect(mockEnsure).not.toHaveBeenCalled();
  });

  it('lets owner/editor generation use ensure', async () => {
    const { result } = renderHook(
      () => useSuggestions('trip-1', { resolved: true, canEdit: true }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.error).toBeNull();
    expect(mockEnsure).toHaveBeenCalledWith('trip-1');
    expect(mockList).not.toHaveBeenCalled();
  });
});

/**
 * §24 do handoff — a marca d'água da viagem depois do claim.
 *
 * `suggestions_refreshed_at` mora na linha da VIAGEM e é o que decide se
 * "Atualizar sugestões" fica habilitado. Quem consome a janela é a Function,
 * então quem fica com a viagem desatualizada é justamente quem acabou de
 * gastá-la: sem invalidar, o botão continuaria aceso.
 */
describe('invalidação depois do claim', () => {
  it('uma geração que mudou a lista invalida a viagem e a coleção da Home', async () => {
    const wrapper = makeWrapper();
    mockEnsure.mockImplementation(async () => [suggestion('a'), suggestion('b'), suggestion('c')]);
    const invalidate = jest.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(
      () => useSuggestions('trip-1', { resolved: true, canEdit: true }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const chaves = invalidate.mock.calls.map((call) => JSON.stringify(call[0]?.queryKey));
    expect(chaves).toContain(JSON.stringify(queryKeys.trip('trip-1')));
    expect(chaves).toContain(JSON.stringify(queryKeys.trips(USER)));
  });

  it('uma falha de geração também invalida — a janela foi consumida assim mesmo', async () => {
    const wrapper = makeWrapper();
    mockEnsure.mockImplementation(async () => {
      throw new SuggestionGenerationError('AI_PROVIDER_FAILED', 'falhou');
    });
    const invalidate = jest.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(
      () => useSuggestions('trip-1', { resolved: true, canEdit: true }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));

    const chaves = invalidate.mock.calls.map((call) => JSON.stringify(call[0]?.queryKey));
    expect(chaves).toContain(JSON.stringify(queryKeys.trip('trip-1')));
  });

  it('uma lista já completa não invalida nada — não houve ida à Function', async () => {
    const wrapper = makeWrapper();
    const completa = [suggestion('a'), suggestion('b'), suggestion('c')];
    client.setQueryData(queryKeys.suggestions('trip-1'), completa);
    mockEnsure.mockImplementation(async () => completa);
    const invalidate = jest.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(
      () => useSuggestions('trip-1', { resolved: true, canEdit: true }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const chaves = invalidate.mock.calls.map((call) => JSON.stringify(call[0]?.queryKey));
    expect(chaves).not.toContain(JSON.stringify(queryKeys.trip('trip-1')));
  });

  it('o refresh explícito invalida mesmo quando falha', async () => {
    const wrapper = makeWrapper();
    mockEnsure.mockImplementation(async () => {
      throw new SuggestionGenerationError('REFRESH_LIMITED', 'já atualizou');
    });
    const invalidate = jest.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useRefreshSuggestions('trip-1'), { wrapper });
    result.current.mutate();
    await waitFor(() => expect(result.current.isError).toBe(true));

    const chaves = invalidate.mock.calls.map((call) => JSON.stringify(call[0]?.queryKey));
    expect(chaves).toContain(JSON.stringify(queryKeys.trip('trip-1')));
    expect(chaves).toContain(JSON.stringify(queryKeys.trips(USER)));
    expect(mockEnsure).toHaveBeenCalledWith('trip-1', { force: true });
  });
});
