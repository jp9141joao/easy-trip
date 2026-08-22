import { fireEvent, render as renderRaw } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';

import { AIComposer, TripContextCard, TripPickerSheet } from '@/components/ai';
import type { Trip } from '@/domain/types';

const metrics: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

// O seletor é um bottom sheet, que lê os insets do aparelho.
const render = (ui: ReactElement) =>
  renderRaw(<SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>);

/**
 * Escolha explícita da viagem que a IA analisa (§1).
 *
 * Antes o contexto era implícito: a tela usava a viagem ativa global e apenas
 * informava qual era. O que estes testes fixam é o contrato novo — a lista
 * mostrada é exatamente a que a tela recebeu (nada é buscado aqui, então não há
 * como uma viagem de outra conta aparecer), a escolha devolve um id, e sem
 * viagem escolhida não sai pergunta nenhuma.
 */

const trip = (overrides: Partial<Trip> = {}): Trip => ({
  id: 'trip-paris',
  userId: 'u1',
  destinationCity: 'Paris',
  destinationCountry: 'França',
  countryCode: 'FR',
  timezone: 'Europe/Paris',
  startDate: '2026-08-22',
  endDate: '2026-08-31',
  budgetTotal: 30000,
  budgetCurrency: 'BRL',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const toquio = trip({
  id: 'trip-toquio',
  destinationCity: 'Tóquio',
  destinationCountry: 'Japão',
  countryCode: 'JP',
  timezone: 'Asia/Tokyo',
  startDate: '2026-09-18',
  endDate: '2026-10-27',
});

describe('card de contexto', () => {
  it('convida à escolha quando não há viagem selecionada', () => {
    const view = render(<TripContextCard trip={null} onPress={jest.fn()} />);
    // O estado sem seleção precisa ser dizível, não só desenhável.
    expect(view.getByLabelText('Contexto da viagem. Nenhuma viagem selecionada.')).toBeTruthy();
    expect(view.getByText('Selecionar viagem')).toBeTruthy();
  });

  it('mostra qual viagem está em uso e oferece a troca', () => {
    const view = render(<TripContextCard trip={trip()} onPress={jest.fn()} />);
    expect(view.getByText('Paris')).toBeTruthy();
    expect(view.getByText('França · 22 – 31 de ago')).toBeTruthy();
    expect(view.getByText('Trocar viagem')).toBeTruthy();
  });

  it('abre o seletor ao toque', () => {
    const onPress = jest.fn();
    const view = render(<TripContextCard trip={trip()} onPress={onPress} />);
    fireEvent.press(view.getByLabelText(/Contexto ativo: Paris/));
    expect(onPress).toHaveBeenCalled();
  });
});

describe('seletor de viagem', () => {
  const abrir = (props: Partial<React.ComponentProps<typeof TripPickerSheet>> = {}) =>
    render(
      <TripPickerSheet
        visible
        trips={[trip(), toquio]}
        selectedTripId="trip-paris"
        onSelect={jest.fn()}
        onClose={jest.fn()}
        {...props}
      />,
    );

  it('lista apenas as viagens recebidas — as do usuário autenticado', () => {
    const view = abrir();
    expect(view.getByText('Paris')).toBeTruthy();
    expect(view.getByText('Tóquio')).toBeTruthy();
    // Nada além da lista entregue pela tela.
    expect(view.queryByText('Roma')).toBeNull();
  });

  it('mostra período, país e status de cada viagem', () => {
    const view = abrir();
    expect(view.getByText('França · 22 – 31 de ago')).toBeTruthy();
    expect(view.getByText('Japão · 18 de set – 27 de out')).toBeTruthy();
  });

  it('anuncia a seleção sem depender da borda azul', () => {
    const view = abrir();
    expect(view.getByLabelText(/Paris.*Viagem selecionada\./s)).toBeTruthy();
    expect(view.queryByLabelText(/Tóquio.*Viagem selecionada\./s)).toBeNull();
  });

  it('devolve o id escolhido', () => {
    const onSelect = jest.fn();
    const view = abrir({ onSelect });
    fireEvent.press(view.getByLabelText(/^Tóquio/));
    expect(onSelect).toHaveBeenCalledWith('trip-toquio');
  });

  it('não finge que existe viagem quando a conta está vazia', () => {
    const view = abrir({ trips: [], selectedTripId: null });
    expect(view.getByText('Você ainda não tem viagens')).toBeTruthy();
  });
});

describe('composer', () => {
  const montar = (props: Partial<React.ComponentProps<typeof AIComposer>> = {}) => {
    const onSubmit = jest.fn();
    const view = render(
      <AIComposer
        value="Quanto ainda posso gastar?"
        onChangeText={jest.fn()}
        onSubmit={onSubmit}
        paddingBottom={0}
        {...props}
      />,
    );
    return { view, onSubmit };
  };

  it('envia quando há viagem selecionada e texto digitado', () => {
    const { view, onSubmit } = montar();
    fireEvent.press(view.getByLabelText('Enviar mensagem'));
    expect(onSubmit).toHaveBeenCalledWith('Quanto ainda posso gastar?');
  });

  it('não deixa nenhuma pergunta sair sem viagem selecionada', () => {
    const { view, onSubmit } = montar({
      disabled: true,
      disabledHint: 'Selecione uma viagem para conversar com a IA',
    });

    fireEvent.press(view.getByLabelText('Enviar mensagem'));

    expect(onSubmit).not.toHaveBeenCalled();
    // O estado inativo é perceptível e explicado, não apenas mais claro.
    expect(view.getByLabelText('Enviar mensagem').props.accessibilityState.disabled).toBe(true);
    expect(view.getByLabelText('Mensagem para a Easy Trip IA').props.editable).toBe(false);
    expect(view.getByLabelText('Mensagem para a Easy Trip IA').props.accessibilityHint).toBe(
      'Selecione uma viagem para conversar com a IA',
    );
  });

  it('não envia texto em branco', () => {
    const { view, onSubmit } = montar({ value: '   ' });
    fireEvent.press(view.getByLabelText('Enviar mensagem'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('não deixa disparar uma segunda pergunta enquanto a primeira responde', () => {
    const { view, onSubmit } = montar({ pending: true });
    fireEvent.press(view.getByLabelText('Enviar mensagem'));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
