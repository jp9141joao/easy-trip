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

/* ========================================================================== */
/* journal.add na mesma folha — o sexto tipo não pode quebrar o quinto        */
/* ========================================================================== */

const DIARIO = {
  type: 'journal.add',
  label: 'Adicionar ao diário',
  journal: {
    entryDate: '2026-08-23',
    content: 'Está previsto abrir o dia em Asakusa e terminar vendo Shibuya do alto.',
    placeName: 'Asakusa',
  },
};

const DESPESAS = {
  type: 'expenses.add',
  label: 'Adicionar às despesas',
  items: [
    { description: 'Transporte do aeroporto', transactionDate: '2026-08-22', amount: 150, category: 'transporte' },
    { description: 'Alimentação do dia', transactionDate: '2026-08-23', amount: 200, category: 'alimentacao' },
    { description: 'Ingressos', transactionDate: '2026-08-23', amount: 90, category: 'lazer' },
  ],
};

/** Antes da viagem: o dia 23 ainda é plano. */
const ANTES_DA_VIAGEM = '2026-08-01';

const abrirCom = (raw: unknown[], today = ANTES_DA_VIAGEM) => {
  const onConfirm = jest.fn();
  const onCancel = jest.fn();
  const view = render(
    <AIActionReviewSheet
      visible
      actions={parseAIActions(raw, toquio, today)}
      trip={toquio}
      itinerary={[]}
      checklist={[]}
      pending={false}
      isShared
      onCancel={onCancel}
      onConfirm={onConfirm}
    />,
  );
  return { view, onConfirm, onCancel };
};

describe('a folha revisa uma entrada de diário', () => {
  it('mostra data, texto e visibilidade — e o rodapé conta o item', () => {
    const { view } = abrirCom([DIARIO]);

    // O texto inteiro fica à vista SEM abrir a edição: confirmar sem ter lido
    // o que será escrito no diário da pessoa seria o pior tipo de confirmação
    // às cegas.
    expect(view.getByText(DIARIO.journal.content)).toBeTruthy();
    expect(view.getByText(/Visibilidade: Somente eu/)).toBeTruthy();
    expect(view.getByText(/A IA não lê o seu diário/)).toBeTruthy();
    expect(view.getByText('Adicionar 1 item')).toBeTruthy();
    expect(view.getByText('Cancelar')).toBeTruthy();
  });

  it('uma data que ainda não chegou é anunciada como plano, não como lembrança', () => {
    const { view } = abrirCom([DIARIO]);
    expect(view.getByText(/Este dia ainda não aconteceu/)).toBeTruthy();
  });

  it('uma data já vivida não ganha o aviso de plano', () => {
    const { view } = abrirCom([DIARIO], '2026-09-30');
    expect(view.queryByText(/Este dia ainda não aconteceu/)).toBeNull();
  });

  it('NÃO existe seletor de visibilidade para o diário, nem em viagem compartilhada', () => {
    /*
     * Roteiro, checklist e despesa oferecem a escolha quando a viagem tem mais
     * de um viajante. O diário não: ele nasce privado e assim é gravado.
     * Oferecer o seletor transformaria "publicar o próprio diário" num toque no
     * fim de uma folha longa, sobre um texto que a IA acabou de escrever.
     */
    const { view } = abrirCom([DIARIO]);
    expect(view.queryByText(/Visibilidade dos itens de roteiro/)).toBeNull();
    expect(view.queryByText(/Visibilidade das despesas/)).toBeNull();
    // A folha DECLARA a visibilidade em vez de perguntá-la.
    expect(view.getByText(/Visibilidade: Somente eu/)).toBeTruthy();
  });

  it('desmarcar a entrada zera o botão — e cancelar não confirma nada', () => {
    const { view, onConfirm, onCancel } = abrirCom([DIARIO]);

    fireEvent.press(view.getByRole('checkbox', { name: /Está previsto|agosto|Asakusa/ }));
    expect(view.getByText('Nada selecionado')).toBeTruthy();

    fireEvent.press(view.getByText('Cancelar'));
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('confirmar devolve a entrada — e só ela', () => {
    const { view, onConfirm } = abrirCom([DIARIO]);

    fireEvent.press(view.getByText('Adicionar 1 item'));

    const [actions] = onConfirm.mock.calls[0];
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe('journal.add');
    expect(actions[0].journal.entryDate).toBe('2026-08-23');
    expect(actions[0].journal.planned).toBe(true);
  });

  it('diário + roteiro + despesas na MESMA folha, com uma área rolável só', () => {
    const { view } = abrirCom([
      { type: 'itinerary.add', label: 'Roteiro', items: [{ title: TITULOS[0], date: '2026-08-23' }] },
      DESPESAS,
      DIARIO,
    ]);

    expect(areasRolaveis(view)).toHaveLength(1);
    expect(view.getByText(TITULOS[0])).toBeTruthy();
    expect(view.getByText('Transporte do aeroporto')).toBeTruthy();
    expect(view.getByText(DIARIO.journal.content)).toBeTruthy();
    // 1 roteiro + 3 despesas + 1 diário.
    expect(view.getByText('Adicionar 5 itens')).toBeTruthy();
  });

  it('com despesas na folha, a estimativa é dita antes de qualquer confirmação', () => {
    const { view } = abrirCom([DESPESAS]);
    expect(view.getByText(/Valores marcados como estimativa/)).toBeTruthy();
    expect(view.getByText(/Total estimado/)).toBeTruthy();
  });
});
