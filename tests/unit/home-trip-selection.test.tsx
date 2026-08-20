import { fireEvent, render } from '@testing-library/react-native';

import { TripChip } from '@/components/cards/TripChip';
import type { Trip } from '@/domain/types';

const mockPush = jest.fn();
const mockSetCurrentTripId = jest.fn();

jest.mock('expo-router', () => ({ useRouter: () => ({ push: (path: string) => mockPush(path) }) }));
jest.mock('@/hooks/useTrips', () => ({
  useCurrentTrip: () => ({ setCurrentTripId: (id: string) => mockSetCurrentTripId(id) }),
}));

/**
 * Selecionar e abrir são ações diferentes no card da Home (§2, §4, §6).
 *
 * Uma regra só cobre os três casos pedidos, sem detector de gesto: toque em
 * viagem não selecionada seleciona; toque em viagem já selecionada abre. O
 * duplo toque cai fora dela — o segundo toque simplesmente encontra o card já
 * selecionado.
 */

const trip = (overrides: Partial<Trip> = {}): Trip => ({
  id: 'trip-roma',
  userId: 'u1',
  destinationCity: 'Roma',
  destinationCountry: 'Itália',
  countryCode: 'IT',
  timezone: 'Europe/Rome',
  startDate: '2030-08-20',
  endDate: '2030-08-23',
  budgetTotal: 200,
  budgetCurrency: 'BRL',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

beforeEach(() => {
  mockPush.mockClear();
  mockSetCurrentTripId.mockClear();
});

describe('home trip card', () => {
  it('only selects on the first tap of an unselected trip', () => {
    const view = render(<TripChip trip={trip()} active={false} />);

    fireEvent.press(view.getByLabelText('Roma. Não selecionada.'));

    expect(mockSetCurrentTripId).toHaveBeenCalledWith('trip-roma');
    // O ponto central: o primeiro toque não pode abrir a viagem.
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('opens the trip when it is already the selected one', () => {
    const view = render(<TripChip trip={trip()} active />);

    fireEvent.press(view.getByLabelText('Roma. Viagem selecionada.'));

    expect(mockPush).toHaveBeenCalledWith('/trip/trip-roma');
    expect(mockSetCurrentTripId).not.toHaveBeenCalled();
  });

  it('turns a double tap into select-then-open with no gesture timer', () => {
    // Primeiro toque: ainda não selecionada.
    const view = render(<TripChip trip={trip()} active={false} />);
    fireEvent.press(view.getByLabelText('Roma. Não selecionada.'));
    expect(mockPush).not.toHaveBeenCalled();

    // Segundo toque: o estado já mudou, então o card se comporta como selecionado.
    view.rerender(<TripChip trip={trip()} active />);
    fireEvent.press(view.getByLabelText('Roma. Viagem selecionada.'));

    expect(mockSetCurrentTripId).toHaveBeenCalledWith('trip-roma');
    expect(mockPush).toHaveBeenCalledWith('/trip/trip-roma');
  });

  it('announces selection without relying on the blue border', () => {
    const selected = render(<TripChip trip={trip()} active />);
    const node = selected.getByLabelText('Roma. Viagem selecionada.');

    expect(node.props.accessibilityState.selected).toBe(true);
    expect(node.props.accessibilityHint).toBe('Toque para abrir a viagem');

    const idle = render(<TripChip trip={trip({ id: 'x' })} active={false} />);
    expect(idle.getByLabelText('Roma. Não selecionada.').props.accessibilityHint).toBe(
      'Toque para selecionar esta viagem',
    );
  });
});
