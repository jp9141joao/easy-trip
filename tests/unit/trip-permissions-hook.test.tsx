import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';

import { useTripPermissions } from '@/hooks/useCollaboration';
import { BackendCapabilityError } from '@/repositories/backendCapabilities';

const mockListMembers = jest.fn();

jest.mock('@/repositories', () => ({
  dataSource: {
    members: {
      listMembers: (...args: unknown[]) => mockListMembers(...args),
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

beforeEach(() => {
  mockListMembers.mockReset();
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
