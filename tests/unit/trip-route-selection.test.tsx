import { renderHook } from '@testing-library/react-native';

import type { Trip } from '@/domain/types';
import { useTripRoute } from '@/features/trip/useTripRoute';

const mockSetCurrentTripId = jest.fn();
let mockCurrentTripId: string | null = null;
let mockTrip: Trip | null | undefined;

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ tripId: 'paris' }),
}));

jest.mock('@/hooks/useTrips', () => ({
  useTrip: () => ({
    data: mockTrip,
    isLoading: mockTrip === undefined,
    isError: false,
    error: null,
    refetch: jest.fn(),
  }),
}));

jest.mock('@/providers/TripSelectionProvider', () => ({
  useTripSelection: () => ({
    currentTripId: mockCurrentTripId,
    setCurrentTripId: mockSetCurrentTripId,
    restoring: false,
  }),
}));

const paris = { id: 'paris' } as Trip;

beforeEach(() => {
  mockSetCurrentTripId.mockReset();
  mockCurrentTripId = null;
  mockTrip = undefined;
});

describe('seleção derivada da rota', () => {
  it('seleciona somente depois que a query comprova acesso à viagem', () => {
    const view = renderHook(() => useTripRoute());
    expect(mockSetCurrentTripId).not.toHaveBeenCalled();

    mockTrip = paris;
    view.rerender(undefined);
    expect(mockSetCurrentTripId).toHaveBeenCalledWith('paris');
  });

  it('não regrava o parâmetro revogado depois que o cleanup remove os dados', () => {
    mockTrip = paris;
    const view = renderHook(() => useTripRoute());
    expect(mockSetCurrentTripId).toHaveBeenCalledWith('paris');

    mockSetCurrentTripId.mockClear();
    mockTrip = undefined;
    mockCurrentTripId = null;
    view.rerender(undefined);

    expect(mockSetCurrentTripId).not.toHaveBeenCalled();
  });

  it('não seleciona id inexistente devolvido como null', () => {
    mockTrip = null;
    renderHook(() => useTripRoute());
    expect(mockSetCurrentTripId).not.toHaveBeenCalled();
  });
});
