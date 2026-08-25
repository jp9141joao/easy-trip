import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { useNotificationRealtime, useTripRealtime } from '@/hooks/useTripRealtime';

interface FakeChannel {
  name: string;
  on: jest.Mock;
  subscribe: jest.Mock;
}

const mockChannels: FakeChannel[] = [];
const mockRemoveChannel = jest.fn(async () => undefined);

jest.mock('@/lib/config', () => ({ config: { hasSupabase: true } }));
jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'user-a' } }),
}));
jest.mock('@/repositories/supabase/client', () => ({
  getSupabaseClient: () => ({
    channel: (name: string) => {
      const channel: FakeChannel = {
        name,
        on: jest.fn(),
        subscribe: jest.fn(),
      };
      channel.on.mockReturnValue(channel);
      mockChannels.push(channel);
      return channel;
    },
    removeChannel: mockRemoveChannel,
  }),
}));

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {children}
    </QueryClientProvider>
  );
}

beforeEach(() => {
  mockChannels.splice(0);
  mockRemoveChannel.mockClear();
});

describe('assinaturas Realtime', () => {
  it('mantém um canal de notificações por usuário, filtrado pelo UID', () => {
    const hook = renderHook(() => useNotificationRealtime(), { wrapper });

    expect(mockChannels).toHaveLength(1);
    expect(mockChannels[0].name).toBe('notifications:user-a');
    expect(mockChannels[0].on).toHaveBeenCalledWith(
      'postgres_changes',
      expect.objectContaining({ table: 'notifications', filter: 'user_id=eq.user-a' }),
      expect.any(Function),
    );
    expect(mockChannels[0].subscribe).toHaveBeenCalledTimes(1);

    hook.unmount();
    expect(mockRemoveChannel).toHaveBeenCalledWith(mockChannels[0]);
  });

  it('o canal da viagem é filtrado e não duplica o canal global do sino', () => {
    const hook = renderHook(() => useTripRealtime('trip-a'), { wrapper });

    expect(mockChannels).toHaveLength(1);
    expect(mockChannels[0].name).toBe('trip:trip-a');
    expect(mockChannels[0].on).toHaveBeenCalledTimes(8);
    for (const call of mockChannels[0].on.mock.calls) {
      expect(call[1]).toEqual(expect.objectContaining({ filter: 'trip_id=eq.trip-a' }));
    }

    hook.unmount();
    expect(mockRemoveChannel).toHaveBeenCalledWith(mockChannels[0]);
  });
});
