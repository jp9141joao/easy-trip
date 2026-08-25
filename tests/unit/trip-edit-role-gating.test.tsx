import { fireEvent, render } from '@testing-library/react-native';

import EditTripScreen from '@/app/trip/[tripId]/edit';
import type { Trip } from '@/domain/types';

const mockRouter = {
  replace: jest.fn(),
  back: jest.fn(),
};

jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));

const mockTrip: Trip = {
  id: 'trip-1',
  userId: 'owner-1',
  destinationCity: 'Paris',
  destinationCountry: 'França',
  countryCode: 'FR',
  timezone: 'Europe/Paris',
  startDate: '2026-09-01',
  endDate: '2026-09-08',
  budgetTotal: 1_000,
  budgetCurrency: 'BRL',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

jest.mock('@/features/trip/useTripRoute', () => ({
  useTripRoute: () => ({
    tripId: mockTrip.id,
    trip: mockTrip,
    isLoading: false,
    isError: false,
    notFound: false,
    errorMessage: '',
    refetch: jest.fn(),
  }),
}));

const mockPermissionState = {
  role: 'editor' as 'owner' | 'editor' | 'viewer' | undefined,
  status: 'ready' as 'idle' | 'loading' | 'error' | 'ready' | 'unavailable',
  error: null as unknown,
  refetch: jest.fn(),
};

jest.mock('@/hooks/useCollaboration', () => ({
  useTripPermissions: () => mockPermissionState,
}));

const mockUseUpdateTrip = jest.fn();
const mockUseDeleteTrip = jest.fn();

jest.mock('@/hooks/useTrips', () => ({
  useUpdateTrip: () => mockUseUpdateTrip(),
  useDeleteTrip: () => mockUseDeleteTrip(),
}));

beforeEach(() => {
  mockRouter.replace.mockClear();
  mockRouter.back.mockClear();
  mockUseUpdateTrip.mockClear();
  mockUseDeleteTrip.mockClear();
  mockPermissionState.status = 'ready';
  mockPermissionState.error = null;
  mockPermissionState.refetch.mockClear();
});

describe('trip edit deep-link role guard', () => {
  it.each(['editor', 'viewer'] as const)(
    'does not mount the edit/delete form for a %s',
    (role) => {
      mockPermissionState.role = role;

      const view = render(<EditTripScreen />);

      expect(view.getByText('Acesso negado')).toBeTruthy();
      expect(view.getByText('Apenas o proprietário pode editar ou excluir esta viagem.')).toBeTruthy();
      expect(view.queryByText('Salvar alterações')).toBeNull();
      expect(view.queryByText('Excluir viagem')).toBeNull();
      expect(mockUseUpdateTrip).not.toHaveBeenCalled();
      expect(mockUseDeleteTrip).not.toHaveBeenCalled();

      fireEvent.press(view.getByText('Voltar para a viagem'));
      expect(mockRouter.replace).toHaveBeenCalledWith('/trip/trip-1/itinerary');
    },
  );
});
