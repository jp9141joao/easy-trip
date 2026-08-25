import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';

import { useReminderDelivery } from '@/hooks/useNotifications';
import { BackendCapabilityError } from '@/repositories/backendCapabilities';

const mockDeliverDueReminders = jest.fn();

jest.mock('@/repositories', () => ({
  dataSource: {
    notifications: {
      deliverDueReminders: (...args: unknown[]) => mockDeliverDueReminders(...args),
    },
  },
}));

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

function makeHarness() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { wrapper, invalidate };
}

beforeEach(() => {
  mockDeliverDueReminders.mockReset();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('keeps a missing delivery RPC as a sanitized capability failure, not zero deliveries', async () => {
  mockDeliverDueReminders.mockRejectedValue(
    new BackendCapabilityError('MISSING_NOTIFICATIONS', {
      code: 'PGRST202',
      message: 'missing expected reminder delivery function',
    }),
  );
  const { wrapper, invalidate } = makeHarness();

  renderHook(() => useReminderDelivery(), { wrapper });

  await waitFor(() =>
    expect(console.warn).toHaveBeenCalledWith('REMINDER_DELIVERY_FAILED', {
      capability: 'MISSING_NOTIFICATIONS',
    }),
  );
  expect(mockDeliverDueReminders).toHaveBeenCalledWith('user-1');
  expect(invalidate).not.toHaveBeenCalled();
});
