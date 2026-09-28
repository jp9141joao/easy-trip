import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';

import { useTripPermissions } from '@/hooks/useCollaboration';
import { BackendCapabilityError } from '@/repositories/backendCapabilities';

const mockListMembers = jest.fn();
const mockGetTrip = jest.fn();

jest.mock('@/repositories', () => ({
  dataSource: {
    members: {
      listMembers: (...args: unknown[]) => mockListMembers(...args),
    },
    trips: {
      get: (...args: unknown[]) => mockGetTrip(...args),
    },
  },
}));

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

function wrapper({ children }: PropsWithChildren) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const member = (role: 'owner' | 'editor' | 'viewer', userId = 'user-1') => ({
  id: `${userId}:${role}`,
  tripId: 'trip-1',
  userId,
  role,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

/**
 * A viagem lida da rota. Só `userId` importa aqui: é dele que sai o
 * proprietário quando `trip_members` não responde por ele.
 */
const trip = (userId: string) => ({
  id: 'trip-1',
  userId,
  destinationCity: 'Paris',
  destinationCountry: 'França',
  countryCode: 'FR',
  timezone: 'Europe/Paris',
  startDate: '2026-08-22',
  endDate: '2026-08-31',
  budgetTotal: 30000,
  budgetCurrency: 'BRL',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

beforeEach(() => {
  mockListMembers.mockReset();
  mockGetTrip.mockReset();
  // Por padrão a viagem é de outra pessoa: cada teste que depende da
  // propriedade declara isso explicitamente.
  mockGetTrip.mockResolvedValue(trip('owner-1'));
});

describe('useTripPermissions', () => {
  it('keeps a solo trip owner fully editable', async () => {
    mockListMembers.mockResolvedValue([member('owner')]);

    const { result } = renderHook(() => useTripPermissions('trip-1'), { wrapper });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current).toMatchObject({
      role: 'owner',
      memberCount: 1,
      isShared: false,
      canEdit: true,
      canManageMembers: true,
    });
  });

  it('resolves an actual viewer as read-only', async () => {
    mockListMembers.mockResolvedValue([
      member('owner', 'owner-1'),
      member('viewer', 'user-1'),
    ]);

    const { result } = renderHook(() => useTripPermissions('trip-1'), { wrapper });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.role).toBe('viewer');
    expect(result.current.canEdit).toBe(false);
    expect(result.current.canManageMembers).toBe(false);
  });

  it('surfaces a missing collaboration schema instead of manufacturing viewer', async () => {
    const error = new BackendCapabilityError('MISSING_TRIP_MEMBERS', {
      code: 'PGRST205',
      message: "Could not find the table 'public.trip_members' in the schema cache",
    });
    mockListMembers.mockRejectedValue(error);

    const { result } = renderHook(() => useTripPermissions('trip-1'), { wrapper });

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe(error);
    expect(result.current.role).toBeUndefined();
    expect(result.current.role).not.toBe('viewer');
    expect(result.current.canEdit).toBe(false);
  });

  it('keeps an absent membership unresolved instead of assuming viewer', async () => {
    mockListMembers.mockResolvedValue([]);

    const { result } = renderHook(() => useTripPermissions('trip-1'), { wrapper });

    await waitFor(() => expect(result.current.status).toBe('unavailable'));
    expect(result.current.role).toBeUndefined();
    expect(result.current.role).not.toBe('viewer');
    expect(result.current.isResolved).toBe(false);
    expect(result.current.canEdit).toBe(false);
  });

  /*
   * O DEFEITO QUE ISTO MEDE: uma viagem antiga, criada antes de a colaboração
   * existir, não tinha linha própria em `trip_members`. O dono abria o Hub e
   * não via o lápis de editar — enquanto o Postgres, cujos helpers já caem de
   * volta em `trips.user_id`, teria aceitado a edição sem reclamar. A tela
   * escondia um controle que o servidor não recusaria.
   */
  it('treats the trip creator as owner when trip_members has no row for them', async () => {
    mockListMembers.mockResolvedValue([member('editor', 'convidado-1')]);
    mockGetTrip.mockResolvedValue(trip('user-1'));

    const { result } = renderHook(() => useTripPermissions('trip-1'), { wrapper });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.role).toBe('owner');
    expect(result.current.canEdit).toBe(true);
    expect(result.current.canManageMembers).toBe(true);
  });

  it('never lets trips.user_id outrank a role already in trip_members', async () => {
    // Depois de uma transferência (0014) quem criou a viagem é editor. A linha
    // de membro é a verdade; ler `trips.user_id` aqui devolveria a viagem a
    // quem acabou de entregá-la.
    mockListMembers.mockResolvedValue([
      member('owner', 'novo-dono'),
      member('editor', 'user-1'),
    ]);
    mockGetTrip.mockResolvedValue(trip('user-1'));

    const { result } = renderHook(() => useTripPermissions('trip-1'), { wrapper });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.role).toBe('editor');
    expect(result.current.canManageMembers).toBe(false);
  });

  it('does not offer "leave trip" while the member list is unknown', async () => {
    // Papel resolvido por `trips.user_id`, lista de membros indisponível: não
    // se sai de uma viagem cuja contagem de viajantes não se conhece.
    mockListMembers.mockRejectedValue(
      new BackendCapabilityError('MISSING_TRIP_MEMBERS', {
        code: 'PGRST205',
        message: "Could not find the table 'public.trip_members' in the schema cache",
      }),
    );
    mockGetTrip.mockResolvedValue(trip('user-1'));

    const { result } = renderHook(() => useTripPermissions('trip-1'), { wrapper });

    await waitFor(() => expect(result.current.role).toBe('owner'));
    expect(result.current.canLeave).toBe(false);
  });

  it('keeps a confirmed owner role during a failed background refresh', async () => {
    mockListMembers.mockResolvedValueOnce([member('owner')]);

    const { result } = renderHook(() => useTripPermissions('trip-1'), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    mockListMembers.mockRejectedValueOnce(new Error('temporary network failure'));
    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current).toMatchObject({
      status: 'ready',
      role: 'owner',
      canEdit: true,
    });
  });
});
