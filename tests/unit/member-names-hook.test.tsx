import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';

import { useMemberNames, useTripMembers } from '@/hooks/useCollaboration';

const mockListMembers = jest.fn();
const mockMemberNames = jest.fn();

jest.mock('@/repositories', () => ({
  dataSource: {
    members: {
      listMembers: (...args: unknown[]) => mockListMembers(...args),
      memberNames: (...args: unknown[]) => mockMemberNames(...args),
    },
  },
}));

function wrapper({ children }: PropsWithChildren) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mockListMembers.mockReset();
  mockMemberNames.mockReset();
});

describe('mapa de nomes históricos', () => {
  it('preserva o nome do ex-autor sem recolocá-lo na lista ativa', async () => {
    mockMemberNames.mockResolvedValue({
      'owner-1': 'Ana',
      'former-1': 'Bruno',
    });
    mockListMembers.mockResolvedValue([
      {
        id: 'member-owner',
        tripId: 'trip-1',
        userId: 'owner-1',
        role: 'owner',
        name: 'Ana',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    const { result } = renderHook(
      () => ({ names: useMemberNames('trip-1'), members: useTripMembers('trip-1') }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.names['former-1']).toBe('Bruno'));
    await waitFor(() => expect(result.current.members.data).toHaveLength(1));

    expect(result.current.names).toEqual({ 'owner-1': 'Ana', 'former-1': 'Bruno' });
    expect(result.current.members.data?.map((member) => member.userId)).toEqual(['owner-1']);
    expect(mockMemberNames).toHaveBeenCalledWith('trip-1');
    expect(mockListMembers).toHaveBeenCalledWith('trip-1');
  });
});
