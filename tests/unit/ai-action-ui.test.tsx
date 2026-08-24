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

    fireEvent.press(view.getByText('Adicionar 2 itens'));

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
    fireEvent.press(view.getByText('Adicionar 1 item'));

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

    fireEvent.press(view.getByText('Adicionar 1 item'));
    const [actions] = onConfirm.mock.calls[0];
    expect(actions[0].items.map((item: { title: string }) => item.title)).toEqual(['Torre Eiffel']);
  });

  it('não deixa confirmar quando nada está marcado', () => {
    const { view, onConfirm } = abrir();

    fireEvent.press(view.getByRole('checkbox', { name: /Museu do Louvre/ }));
    fireEvent.press(view.getByRole('checkbox', { name: /Torre Eiffel/ }));

    fireEvent.press(view.getByLabelText('Nada selecionado'));
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
