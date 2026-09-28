import { fireEvent, render as renderRaw } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';

import { AIActionCard, AIActionResult, AIActionReviewSheet } from '@/components/ai';
import { parseAIActions } from '@/domain/aiActions';
import type { ChecklistItem, ItineraryItem, Trip } from '@/domain/types';
import type { AIActionReport } from '@/services/aiActionExecutor';

/**
 * Os três estados que o usuário vê, e as duas coisas que ele nunca pode ver:
 * um botão que aplica a mesma proposta duas vezes, e um "pronto" quando parte
 * da gravação falhou.
 */

const metrics: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const render = (ui: ReactElement) =>
  renderRaw(<SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>);

const paris: Trip = {
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
};

const roteiro = () =>
  parseAIActions(
    [
      {
        type: 'itinerary.add',
        label: 'Adicionar 2 itens ao roteiro',
        items: [
          { title: 'Museu do Louvre', date: '2026-08-23', startTime: '09:00', type: 'atracao' },
          { title: 'Torre Eiffel', date: '2026-08-23', startTime: '18:00', type: 'atracao' },
        ],
      },
    ],
    paris,
  );

describe('card de ação', () => {
  it('resume a proposta e oferece revisar ou implementar', () => {
    const onImplement = jest.fn();
    const onReview = jest.fn();
    const view = render(
      <AIActionCard
        actions={roteiro()}
        applied={false}
        pending={false}
        onReview={onReview}
        onImplement={onImplement}
      />,
    );

    expect(view.getByText('Adicionar 2 itens ao roteiro')).toBeTruthy();
    expect(view.getByText('• 2 itens de roteiro')).toBeTruthy();

    fireEvent.press(view.getByText('Implementar'));
    expect(onImplement).toHaveBeenCalledTimes(1);

    fireEvent.press(view.getByText('Revisar'));
    expect(onReview).toHaveBeenCalledTimes(1);
  });

  it('a action que o servidor devolveu chega à tela como card (caso do Android)', () => {
    /*
     * O ELO QUE NINGUÉM MEDIA.
     *
     * Havia teste para `parseAIActions` e teste para o `AIActionCard`, cada um
     * com seu fixture. Entre os dois ficava a pergunta que o aparelho fez:
     * "o servidor mandou 1 action e a tela mostrou zero card — onde ela
     * sumiu?". Este teste parte do CORPO da resposta HTTP, exatamente como ele
     * chega pela rede, e termina no texto renderizado.
     *
     * O `content` é a frase real que apareceu no Android prometendo proposta:
     * com action existindo ela é legítima, e o card tem de estar lá embaixo.
     */
    const corpoHttp = {
      content: 'A proposta está pronta para revisão e aplicação.',
      actions: [
        {
          type: 'itinerary.add',
          label: 'Adicionar 3 itens ao roteiro',
          items: [
            { title: 'Senso-ji', date: '2026-08-23', startTime: '09:00' },
            { title: 'Almoço em Asakusa', date: '2026-08-23', startTime: '12:30' },
            { title: 'Shibuya Crossing', date: '2026-08-23', startTime: '16:00' },
          ],
        },
      ],
    };

    // 1. o cliente valida o que veio pela rede
    const acoes = parseAIActions(corpoHttp.actions, paris);
    expect(acoes).toHaveLength(1);

    // 2. o que o estado da mensagem guardaria é o mesmo array
    const doEstado = acoes;
    expect(doEstado).toHaveLength(1);

    // 3. e a tela mostra o card — 1 no estado NUNCA pode virar 0 renderizado
    const view = render(
      <AIActionCard
        actions={doEstado}
        applied={false}
        pending={false}
        onReview={jest.fn()}
        onImplement={jest.fn()}
      />,
    );

    expect(view.getByText('Adicionar 3 itens ao roteiro')).toBeTruthy();
    expect(view.getByText('Implementar')).toBeTruthy();
  });

  it('o roteiro de São Paulo — data preenchida pelo servidor — chega à tela como card', () => {
    /*
     * NÍVEL 3 do caso 2026-08-28T02:24:35Z.
     *
     * O corpo HTTP aqui é o que a v13 devolve para a MESMA resposta do Gemini
     * que a v12 descartou: cinco atividades com título e sem `date`, com a
     * data-alvo (28/08) preenchida pelo servidor antes da validação. O que se
     * mede é o fim da linha — 1 action no corpo, 1 no estado, 1 card na tela.
     */
    const saoPaulo: Trip = {
      ...paris,
      id: 'trip-sp',
      destinationCity: 'São Paulo',
      destinationCountry: 'Brasil',
      countryCode: 'BR',
      timezone: 'America/Sao_Paulo',
      startDate: '2026-08-27',
      endDate: '2026-08-28',
    };

    const corpoHttp = {
      content: 'A proposta está pronta para revisão e aplicação.',
      actions: [
        {
          type: 'itinerary.add',
          label: 'Adicionar 5 itens ao roteiro',
          items: [
            { title: 'Café no Mercado Municipal', date: '2026-08-28', startTime: '09:00' },
            { title: 'MASP', date: '2026-08-28', startTime: '11:00' },
            { title: 'Almoço na Bela Vista', date: '2026-08-28', startTime: '13:00' },
            { title: 'Parque Ibirapuera', date: '2026-08-28', startTime: '16:00' },
            { title: 'Jantar na Vila Madalena', date: '2026-08-28', startTime: '20:00' },
          ],
        },
      ],
    };

    const acoes = parseAIActions(corpoHttp.actions, saoPaulo);
    expect(acoes).toHaveLength(1);
    expect(acoes[0].type === 'itinerary.add' && acoes[0].items).toHaveLength(5);

    const view = render(
      <AIActionCard
        actions={acoes}
        applied={false}
        pending={false}
        onReview={jest.fn()}
        onImplement={jest.fn()}
      />,
    );

    expect(view.getByText('Adicionar 5 itens ao roteiro')).toBeTruthy();
    expect(view.getByText('Implementar')).toBeTruthy();
  });

  it('não existe card quando a resposta não trouxe proposta (§17)', () => {
    const view = render(
      <AIActionCard
        actions={[]}
        applied={false}
        pending={false}
        onReview={jest.fn()}
        onImplement={jest.fn()}
      />,
    );

    expect(view.queryByText('Implementar')).toBeNull();
  });

  it('enquanto grava, o toque não dispara de novo', () => {
    const onImplement = jest.fn();
    const view = render(
      <AIActionCard
        actions={roteiro()}
        applied={false}
        pending
        onReview={jest.fn()}
        onImplement={onImplement}
      />,
    );

    // O botão está em loading; o rótulo muda e o toque não passa.
    expect(view.queryByText('Implementar')).toBeNull();
    const botao = view.getByLabelText('Adicionando…');
    fireEvent.press(botao);
    fireEvent.press(botao);
    expect(onImplement).not.toHaveBeenCalled();
  });

  it('depois de aplicada, não há mais botão de aplicar', () => {
    const view = render(
      <AIActionCard
        actions={roteiro()}
        applied
        pending={false}
        onReview={jest.fn()}
        onImplement={jest.fn()}
      />,
    );

    expect(view.getByText('Adicionado à viagem')).toBeTruthy();
    expect(view.queryByText('Implementar')).toBeNull();
    expect(view.queryByText('Revisar')).toBeNull();
  });
});

describe('folha de revisão', () => {
  const abrir = (
    itinerary: ItineraryItem[] = [],
    checklist: ChecklistItem[] = [],
    pending = false,
  ) => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    const view = render(
      <AIActionReviewSheet
        visible
        actions={roteiro()}
        trip={paris}
        itinerary={itinerary}
        checklist={checklist}
        pending={pending}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );
    return { view, onConfirm, onCancel };
  };

  it('anuncia que nada é gravado antes da confirmação', () => {
    const { view } = abrir();
    expect(view.getByText('Revisar antes de adicionar')).toBeTruthy();
    expect(view.getByText('Nada é gravado em Paris até você confirmar.')).toBeTruthy();
  });

  it('confirma com os itens marcados', () => {
    const { view, onConfirm } = abrir();

    expect(view.getByText('2 itens selecionados.')).toBeTruthy();
    fireEvent.press(view.getByText('Adicionar'));

    const [actions] = onConfirm.mock.calls[0];
    expect(actions).toHaveLength(1);
    expect(actions[0].items.map((item: { title: string }) => item.title)).toEqual([
      'Museu do Louvre',
      'Torre Eiffel',
    ]);
  });

  it('desmarcar um item o retira da confirmação', () => {
    const { view, onConfirm } = abrir();

    fireEvent.press(view.getByRole('checkbox', { name: /Museu do Louvre/ }));
    expect(view.getByText('1 item selecionado.')).toBeTruthy();
    fireEvent.press(view.getByText('Adicionar'));

    const [actions] = onConfirm.mock.calls[0];
    expect(actions[0].items.map((item: { title: string }) => item.title)).toEqual(['Torre Eiffel']);
  });

  it('cancelar não confirma nada', () => {
    const { view, onConfirm, onCancel } = abrir();

    fireEvent.press(view.getByText('Cancelar'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('item que já existe no roteiro chega desmarcado e explicado', () => {
    const existente: ItineraryItem[] = [
      {
        id: 'i1',
        tripId: paris.id,
        date: '2026-08-23',
        type: 'atracao',
        title: 'Visitar Museu do Louvre',
        completed: false,
        sortOrder: 0,
        visibility: 'shared',
      },
    ];

    const { view, onConfirm } = abrir(existente);

    expect(view.getByText('Possível duplicata de "Visitar Museu do Louvre"')).toBeTruthy();

    expect(view.getByText('1 item selecionado.')).toBeTruthy();
    fireEvent.press(view.getByText('Adicionar'));
    const [actions] = onConfirm.mock.calls[0];
    expect(actions[0].items.map((item: { title: string }) => item.title)).toEqual(['Torre Eiffel']);
  });

  it('não deixa confirmar quando nada está marcado', () => {
    const { view, onConfirm } = abrir();

    fireEvent.press(view.getByRole('checkbox', { name: /Museu do Louvre/ }));
    fireEvent.press(view.getByRole('checkbox', { name: /Torre Eiffel/ }));

    expect(view.getByText('Nenhum item selecionado.')).toBeTruthy();
    fireEvent.press(view.getByLabelText('Adicionar. Nenhum item selecionado.'));
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('resultado da execução', () => {
  const report = (overrides: Partial<AIActionReport> = {}): AIActionReport => ({
    outcomes: [
      {
        actionId: 'a1',
        type: 'itinerary.add',
        ok: true,
        succeeded: 4,
        failed: [],
        summary: '4 itens adicionados ao roteiro',
      },
    ],
    created: [{ kind: 'itinerary', id: 'i1' }],
    ok: true,
    partial: false,
    undoable: true,
    ...overrides,
  });

  it('diz o que entrou, e não "Sucesso!"', () => {
    const view = render(
      <AIActionResult report={report()} undoing={false} onUndo={jest.fn()} onDismiss={jest.fn()} />,
    );

    expect(view.getByText('4 itens adicionados ao roteiro')).toBeTruthy();
    expect(view.queryByText('Sucesso!')).toBeNull();
  });

  it('mostra a falha ao lado do que deu certo numa execução parcial', () => {
    const parcial = report({
      ok: false,
      partial: true,
      outcomes: [
        {
          actionId: 'a1',
          type: 'itinerary.add',
          ok: true,
          succeeded: 3,
          failed: [],
          summary: '3 itens adicionados ao roteiro',
        },
        {
          actionId: 'a2',
          type: 'expenses.add',
          ok: false,
          succeeded: 0,
          failed: [{ label: 'Ingresso', reason: 'Falha de rede ao gravar.' }],
          summary: 'Nenhuma despesa adicionada',
        },
      ],
    });

    const view = render(
      <AIActionResult report={parcial} undoing={false} onDismiss={jest.fn()} />,
    );

    expect(view.getByText('3 itens adicionados ao roteiro')).toBeTruthy();
    expect(view.getByText('Nenhuma despesa adicionada')).toBeTruthy();
    expect(view.getByText('Ingresso: Falha de rede ao gravar.')).toBeTruthy();
  });

  it('não oferece desfazer quando a execução alterou registro existente', () => {
    const view = render(
      <AIActionResult
        report={report({ undoable: false })}
        undoing={false}
        onDismiss={jest.fn()}
      />,
    );

    expect(view.queryByText('Desfazer')).toBeNull();
  });
});
