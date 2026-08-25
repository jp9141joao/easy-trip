import { render } from '@testing-library/react-native';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';

import JournalScreen from '@/app/trip/[tripId]/journal';
import { ToastProvider } from '@/components/ui';
import type { JournalEntry, Trip } from '@/domain/types';

const mockRouter = { replace: jest.fn(), push: jest.fn(), back: jest.fn(), canGoBack: () => true };
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
  budgetTotal: 1000,
  budgetCurrency: 'BRL',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const mockState = {
  role: 'owner' as 'owner' | 'editor' | 'viewer',
  entries: [] as JournalEntry[],
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

jest.mock('@/features/trip/TripScaffold', () => {
  const { View } = jest.requireActual('react-native');
  return {
    TripHero: () => null,
    TripTabs: () => null,
    TripScreenShell: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
  };
});

jest.mock('@/features/trip/RoteiroModules', () => ({ RoteiroModules: () => null }));
jest.mock('@/hooks/useTripRealtime', () => ({ useTripRealtime: () => undefined }));

const mockMutations = {
  create: { mutateAsync: jest.fn(), isPending: false },
  update: { mutateAsync: jest.fn(), isPending: false },
  remove: { mutateAsync: jest.fn(), isPending: false },
};

jest.mock('@/hooks/useTripData', () => ({
  useJournal: () => ({ data: mockState.entries, isLoading: false }),
  useJournalMedia: () => ({ data: [] }),
  useJournalMutations: () => mockMutations,
}));

jest.mock('@/hooks/useCollaboration', () => ({
  useTripPermissions: () => ({
    role: mockState.role,
    canEdit: mockState.role === 'owner' || mockState.role === 'editor',
    isShared: true,
    isResolved: true,
    isLoading: false,
    status: 'ready',
  }),
}));

const metrics: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const entry: JournalEntry = {
  id: 'entry-1',
  tripId: mockTrip.id,
  userId: 'owner-1',
  createdBy: 'owner-1',
  entryDate: '2026-09-02',
  content: 'Um dia inesquecível em Paris.',
  visibility: 'shared',
  createdAt: '2026-09-02T20:00:00.000Z',
  updatedAt: '2026-09-02T20:00:00.000Z',
};

function renderScreen() {
  return render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ToastProvider>
        <JournalScreen />
      </ToastProvider>
    </SafeAreaProvider>,
  );
}

describe('journal role gating', () => {
  it('lets an editor create the first record', () => {
    mockState.role = 'editor';
    mockState.entries = [];
    expect(renderScreen().getByText('Criar primeira entrada')).toBeTruthy();
  });

  it('does not offer private or shared writes to a viewer', () => {
    mockState.role = 'viewer';
    mockState.entries = [entry];
    const view = renderScreen();

    expect(view.getByText(entry.content)).toBeTruthy();
    expect(view.queryByLabelText(/Editar registro/)).toBeNull();
    expect(view.queryByLabelText(/Excluir registro/)).toBeNull();
    expect(view.queryByLabelText('Registro')).toBeNull();
    expect(view.getByText(/somente de visualização/)).toBeTruthy();
  });
});
