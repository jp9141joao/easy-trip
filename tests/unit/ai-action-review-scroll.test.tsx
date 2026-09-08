import { fireEvent, render as renderRaw } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';

import { AIActionReviewSheet } from '@/components/ai';
import { parseAIActions } from '@/domain/aiActions';
import type { ItineraryItem, Trip } from '@/domain/types';

/**
 * A folha de revisão precisa caber um roteiro inteiro.
 *
 * O DEFEITO QUE ESTE ARQUIVO PRENDE
 *
 * A lista de itens tinha um `ScrollView` próprio, com `maxHeight: 420`, dentro
 * do `ScrollView` que a `BottomSheet` já monta. No Android o `ScrollView` de
 * fora fica com o gesto vertical — `nestedScrollEnabled` é `false` por padrão —
 * e o de dentro nunca o recebe. Como 420dp comportam cerca de três cartões, um
 * roteiro de dez itens virava um roteiro de três: os outros sete existiam na
 * árvore, estavam recortados na tela, e não havia gesto que os alcançasse.
 *
 * Um teste de unidade não arrasta o dedo. O que ele mede é a CAUSA, que é
 * estrutural e é verificável: quantas áreas roláveis a folha tem, e se alguma
 * delas fixa a altura em pixels. Enquanto a resposta for "uma, e nenhuma", o
 * gesto não tem com quem competir e a altura continua sendo a da tela.
 */

const metrics: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const render = (ui: ReactElement) =>
  renderRaw(<SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>);

const toquio: Trip = {
  id: 'trip-toquio',
  userId: 'u1',
  destinationCity: 'Tóquio',
  destinationCountry: 'Japão',
  countryCode: 'JP',
  timezone: 'Asia/Tokyo',
  startDate: '2026-08-22',
  endDate: '2026-08-31',
  budgetTotal: 30000,
  budgetCurrency: 'BRL',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

/** Títulos distintos o bastante para a conferência de duplicata não os juntar. */
const TITULOS = [
  'Chegada e Check-in no Hotel',
  'Visita ao Templo Senso-ji',
  'Almoço Tradicional em Asakusa',
  'Passeio de barco pelo Sumida',
  'Observatório de Shibuya Sky',
  'Jantar de ramen em Shinjuku',
  'Mercado externo de Tsukiji',
  'Palácio Imperial pela manhã',
  'Compras na rua Nakamise',
  'Karaokê em Ikebukuro',
];

const roteiroDe = (quantidade: number) =>
  parseAIActions(
    [
      {
        type: 'itinerary.add',
        label: `Adicionar ${quantidade} itens ao roteiro`,
        items: TITULOS.slice(0, quantidade).map((title, index) => ({
          title,
          date: '2026-08-23',
          startTime: `${String(8 + index).padStart(2, '0')}:00`,
          type: 'atracao',
        })),
      },
    ],
    toquio,
  );

const abrir = (quantidade: number, options: { itinerary?: ItineraryItem[]; isShared?: boolean } = {}) => {
  const onConfirm = jest.fn();
  const onCancel = jest.fn();
  const view = render(
    <AIActionReviewSheet
      visible
      actions={roteiroDe(quantidade)}
      trip={toquio}
      itinerary={options.itinerary ?? []}
      checklist={[]}
      pending={false}
      isShared={options.isShared ?? false}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />,
  );
  return { view, onConfirm, onCancel };
};

type Vista = ReturnType<typeof abrir>['view'];

/** As áreas roláveis verticais da folha. A horizontal, se existisse, não disputa o gesto. */
const areasRolaveis = (view: Vista) =>
  view.UNSAFE_queryAllByType(ScrollView).filter((node) => !node.props.horizontal);

describe('a folha de revisão rola', () => {
  it.each([1, 3, 5, 10])('com %i itens, existe exatamente uma área rolável', (quantidade) => {
    const { view } = abrir(quantidade);
    expect(areasRolaveis(view)).toHaveLength(1);
  });

  it('nenhuma área rolável fixa a altura em pixels', () => {
    const { view } = abrir(10);

    for (const scroll of areasRolaveis(view)) {
      const style = StyleSheet.flatten(scroll.props.style) ?? {};
      expect(style.height).toBeUndefined();
      expect(style.maxHeight).toBeUndefined();
    }
  });

  it.each([1, 3, 5, 10])('com %i itens, todos chegam à folha — inclusive o último', (quantidade) => {
    const { view } = abrir(quantidade);

    for (const title of TITULOS.slice(0, quantidade)) {
      expect(view.getByText(title)).toBeTruthy();
    }
    expect(view.getByText(TITULOS[quantidade - 1])).toBeTruthy();
  });

  it('o rodapé continua na folha com a lista cheia', () => {
    const { view } = abrir(10);

    expect(view.getByText('Cancelar')).toBeTruthy();
    expect(view.getByText('Adicionar 10 itens')).toBeTruthy();
  });

  it('a seleção continua mandando na contagem do botão', () => {
    const { view, onConfirm } = abrir(10);

    fireEvent.press(view.getByRole('checkbox', { name: new RegExp(TITULOS[0]) }));
    fireEvent.press(view.getByRole('checkbox', { name: new RegExp(TITULOS[9]) }));

    fireEvent.press(view.getByText('Adicionar 8 itens'));

    const [actions] = onConfirm.mock.calls[0];
    const enviados = actions[0].items.map((item: { title: string }) => item.title);
    expect(enviados).toHaveLength(8);
    expect(enviados).not.toContain(TITULOS[0]);
    expect(enviados).not.toContain(TITULOS[9]);
  });

  it('expandir um item não cria uma segunda área rolável nem esconde o resto', () => {
    const { view } = abrir(10);

    fireEvent.press(view.getByLabelText(new RegExp(`^Editar ${TITULOS[0]}`)));

    expect(areasRolaveis(view)).toHaveLength(1);
    expect(view.getByText(TITULOS[9])).toBeTruthy();
    expect(view.getByText('Adicionar 10 itens')).toBeTruthy();
  });

  it('duplicatas desmarcadas mantêm o aviso, a lista inteira e uma área rolável só', () => {
    const existente: ItineraryItem[] = [
      {
        id: 'i1',
        tripId: toquio.id,
        date: '2026-08-23',
        type: 'atracao',
        title: 'Visita ao Templo Senso-ji',
        completed: false,
        sortOrder: 0,
        visibility: 'shared',
      },
    ];

    const { view } = abrir(10, { itinerary: existente });

    expect(view.getByText(/Alguns itens vieram desmarcados/)).toBeTruthy();
    expect(view.getByText('Possível duplicata de "Visita ao Templo Senso-ji"')).toBeTruthy();
    expect(view.getByText(TITULOS[9])).toBeTruthy();
    expect(view.getByText('Adicionar 9 itens')).toBeTruthy();
    expect(areasRolaveis(view)).toHaveLength(1);
  });

  it('a visibilidade da viagem compartilhada também cabe na mesma área rolável', () => {
    const { view } = abrir(10, { isShared: true });

    expect(view.getByText(TITULOS[9])).toBeTruthy();
    expect(areasRolaveis(view)).toHaveLength(1);
    expect(view.getByText('Adicionar 10 itens')).toBeTruthy();
  });
});
