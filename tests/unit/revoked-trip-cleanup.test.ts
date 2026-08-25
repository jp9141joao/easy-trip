import { QueryClient } from '@tanstack/react-query';

import type { AIConversation, Trip } from '@/domain/types';
import {
  purgeRevokedTripState,
  revokedTripsWithoutCurrentAccess,
} from '@/hooks/useNotifications';
import { queryKeys } from '@/hooks/queryKeys';

const asTrip = (id: string): Trip => ({ id } as Trip);

function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe('revogação e reconvite de viagem', () => {
  it('não reaplica uma remoção histórica quando o backend já prova o acesso atual', () => {
    expect(
      revokedTripsWithoutCurrentAccess(
        ['paris', 'paris', 'lisboa'],
        [asTrip('paris'), asTrip('toquio')],
      ),
    ).toEqual(['lisboa']);
  });

  it('remove a viagem da Home, limpa a seleção e apaga todos os caches privados conhecidos', () => {
    const client = newClient();
    const clearSelection = jest.fn();
    const conversation: AIConversation = {
      id: 'conversation-paris',
      userId: 'user-1',
      tripId: 'paris',
      createdAt: '2026-08-24T10:00:00.000Z',
      updatedAt: '2026-08-24T10:00:00.000Z',
    };

    client.setQueryData(queryKeys.trips('user-1'), [asTrip('paris'), asTrip('toquio')]);
    client.setQueryData(queryKeys.itinerary('paris'), [{ id: 'private-itinerary' }]);
    client.setQueryData(queryKeys.tripReservations('paris'), [{ id: 'private-ticket' }]);
    client.setQueryData(queryKeys.myRole('paris', 'user-1'), 'viewer');
    client.setQueryData(queryKeys.tripMemberNames('paris'), { 'former-user': 'Name' });
    client.setQueryData(queryKeys.reminders('paris', 'user-1'), [{ id: 'private-reminder' }]);
    client.setQueryData(queryKeys.aiConversation('user-1', 'paris'), conversation);
    client.setQueryData(queryKeys.aiMessages(conversation.id), [{ id: 'private-message' }]);
    client.setQueryData(queryKeys.itinerary('toquio'), [{ id: 'must-remain' }]);

    purgeRevokedTripState(client, 'user-1', ['paris'], {
      currentTripId: 'paris',
      clear: clearSelection,
    });

    expect(client.getQueryData<Trip[]>(queryKeys.trips('user-1'))?.map((trip) => trip.id)).toEqual([
      'toquio',
    ]);
    expect(clearSelection).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(queryKeys.itinerary('paris'))).toBeUndefined();
    expect(client.getQueryData(queryKeys.tripReservations('paris'))).toBeUndefined();
    expect(client.getQueryData(queryKeys.myRole('paris', 'user-1'))).toBeUndefined();
    expect(client.getQueryData(queryKeys.tripMemberNames('paris'))).toBeUndefined();
    expect(client.getQueryData(queryKeys.reminders('paris', 'user-1'))).toBeUndefined();
    expect(client.getQueryData(queryKeys.aiConversation('user-1', 'paris'))).toBeUndefined();
    expect(client.getQueryData(queryKeys.aiMessages(conversation.id))).toBeUndefined();
    expect(client.getQueryData(queryKeys.itinerary('toquio'))).toEqual([{ id: 'must-remain' }]);

    client.clear();
  });

  it('não limpa a seleção quando a revogação confirmada é de outra viagem', () => {
    const client = newClient();
    const clearSelection = jest.fn();

    purgeRevokedTripState(client, 'user-1', ['paris'], {
      currentTripId: 'toquio',
      clear: clearSelection,
    });

    expect(clearSelection).not.toHaveBeenCalled();
    client.clear();
  });
});
