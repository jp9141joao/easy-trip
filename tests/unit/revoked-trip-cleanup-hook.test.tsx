import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';

import type { Trip } from '@/domain/types';
import { queryKeys } from '@/hooks/queryKeys';
import { useRevokedTripCleanup } from '@/hooks/useNotifications';

const mockListNotifications = jest.fn();
const mockListTrips = jest.fn();
const mockSetCurrentTripId = jest.fn();
let mockCurrentTripId: string | null = 'paris';

jest.mock('@/repositories', () => ({
  dataSource: {
    notifications: {
      list: (...args: unknown[]) => mockListNotifications(...args),
    },
    trips: {
      list: (...args: unknown[]) => mockListTrips(...args),
    },
  },
}));

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

jest.mock('@/providers/TripSelectionProvider', () => ({
  useTripSelection: () => ({
    currentTripId: mockCurrentTripId,
    setCurrentTripId: mockSetCurrentTripId,
    restoring: false,
  }),
}));

const asTrip = (id: string): Trip => ({ id } as Trip);
const removal = {
  id: 'notification-removal-paris',
  userId: 'user-1',
  type: 'trip_member_removed',
  title: 'Acesso removido',
  data: { tripId: 'paris' },
  createdAt: '2026-08-24T10:00:00.000Z',
};

function harness() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

beforeEach(() => {
  mockListNotifications.mockReset().mockResolvedValue([removal]);
  mockListTrips.mockReset();
  mockSetCurrentTripId.mockReset();
  mockCurrentTripId = 'paris';
});

describe('auditoria atual antes de reaplicar revogação', () => {
  it('preserva cache e seleção após reconvite, apesar da notificação histórica', async () => {
    mockListTrips.mockResolvedValue([asTrip('paris'), asTrip('toquio')]);
    const { client, wrapper } = harness();
    client.setQueryData(queryKeys.trips('user-1'), [asTrip('paris')]);
    client.setQueryData(queryKeys.itinerary('paris'), [{ id: 'still-authorized' }]);

    renderHook(() => useRevokedTripCleanup(), { wrapper });

    await waitFor(() => expect(mockListTrips).toHaveBeenCalledWith('user-1'));
    await waitFor(() =>
      expect(client.getQueryData<Trip[]>(queryKeys.trips('user-1'))?.map((trip) => trip.id)).toEqual([
        'paris',
        'toquio',
      ]),
    );
    expect(client.getQueryData(queryKeys.itinerary('paris'))).toEqual([
      { id: 'still-authorized' },
    ]);
    expect(mockSetCurrentTripId).not.toHaveBeenCalled();
    client.clear();
  });

  it('remove Home, detalhe e seleção quando o acesso continua revogado', async () => {
    mockListTrips.mockResolvedValue([asTrip('toquio')]);
    const { client, wrapper } = harness();
    client.setQueryData(queryKeys.trips('user-1'), [asTrip('paris'), asTrip('toquio')]);
    client.setQueryData(queryKeys.itinerary('paris'), [{ id: 'must-disappear' }]);

    renderHook(() => useRevokedTripCleanup(), { wrapper });

    await waitFor(() => expect(mockSetCurrentTripId).toHaveBeenCalledWith(null));
    expect(client.getQueryData<Trip[]>(queryKeys.trips('user-1'))?.map((trip) => trip.id)).toEqual([
      'toquio',
    ]);
    expect(client.getQueryData(queryKeys.itinerary('paris'))).toBeUndefined();
    client.clear();
  });
});
