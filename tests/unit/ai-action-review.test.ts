import {
  buildReviewGroups,
  countSelected,
  editItem,
  reviewToActions,
  selectAll,
  toggleGroup,
  toggleItem,
} from '@/domain/aiActionReview';
import { parseAIActions } from '@/domain/aiActions';
import type { ChecklistItem, ItineraryItem, Trip } from '@/domain/types';

/**
 * A revisão é o consentimento (§11, §25).
 *
 * O que estes testes protegem é a promessa central da funcionalidade: o que o
 * executor recebe é exatamente o que a pessoa deixou marcado — nem um item a
 * mais. Um bug aqui não seria um bug de tela: seria a IA gravando algo que
 * ninguém autorizou.
 */

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

const existingItinerary: ItineraryItem[] = [
  {
    id: 'i1',
    tripId: paris.id,
    date: '2026-08-23',
    type: 'atracao',
    title: 'Visitar Museu do Louvre',
    completed: false,
    sortOrder: 0,
  },
];

const existingChecklist: ChecklistItem[] = [
  {
    id: 'c1',
    tripId: paris.id,
    label: 'Adaptador de tomada',
    category: 'mala',
    completed: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

const ctx = { trip: paris, itinerary: existingItinerary, checklist: existingChecklist };

const propostaComposta = () =>
  parseAIActions(
    [
      {
        type: 'itinerary.add',
        label: 'Adicionar ao roteiro',
        items: [
          { title: 'Museu do Louvre', date: '2026-08-23', startTime: '09:00', type: 'atracao' },
          { title: 'Torre Eiffel', date: '2026-08-23', startTime: '18:00', type: 'atracao' },
          { title: 'Versalhes', date: '2026-09-05', type: 'atracao' },
        ],
      },
      {
        type: 'checklist.add',
        label: 'Adicionar ao checklist',
        items: [
          { label: 'Adaptador de tomada', category: 'mala' },
          { label: 'Protetor solar', category: 'saude' },
        ],
      },
      {
        type: 'expenses.add',
        label: 'Adicionar despesas',
        items: [
          { description: 'Almoço', category: 'alimentacao', amount: 60, transactionDate: '2026-08-23' },
          { description: 'Jantar', category: 'alimentacao', amount: 60, transactionDate: '2026-08-23' },
        ],
      },
    ],
    paris,
  );

describe('estado inicial da revisão', () => {
  it('desmarca duplicata e data fora do período, e deixa o resto marcado', () => {
    const groups = buildReviewGroups(propostaComposta(), ctx);

    const roteiro = groups[0];
    expect(roteiro.items.map((item) => item.included)).toEqual([false, true, false]);
    expect(roteiro.items[0].warnings[0].kind).toBe('duplicate');
    expect(roteiro.items[2].warnings[0].kind).toBe('outsideTrip');

    const checklist = groups[1];
    expect(checklist.items.map((item) => item.included)).toEqual([false, true]);
    expect(checklist.items[0].warnings[0].message).toContain('Adaptador de tomada');
  });

  it('não deduplica despesas: dois valores iguais no mesmo dia são normais', () => {
    const groups = buildReviewGroups(propostaComposta(), ctx);
    const despesas = groups[2];

    expect(despesas.items.map((item) => item.included)).toEqual([true, true]);
    expect(despesas.items.flatMap((item) => item.warnings)).toEqual([]);
  });

  it('conta apenas o que está marcado', () => {
    // 1 de roteiro + 1 de checklist + 2 de despesa.
    expect(countSelected(buildReviewGroups(propostaComposta(), ctx))).toBe(4);
  });
});

describe('o que sai da revisão', () => {
  it('leva apenas os itens marcados, preservando id e viagem', () => {
    const actions = reviewToActions(buildReviewGroups(propostaComposta(), ctx));
    const original = propostaComposta();

    const roteiro = actions.find((action) => action.type === 'itinerary.add');
    if (roteiro?.type !== 'itinerary.add') throw new Error('roteiro ausente');
    expect(roteiro.items.map((item) => item.title)).toEqual(['Torre Eiffel']);
    expect(roteiro.tripId).toBe(paris.id);
    expect(roteiro.label).toBe(original[0].label);
  });

  it('marcar "selecionar todos" recupera as duplicatas que a pessoa aceitou manter', () => {
    let groups = buildReviewGroups(propostaComposta(), ctx);
    groups = selectAll(groups, groups[1].actionId);

    const checklist = reviewToActions(groups).find((action) => action.type === 'checklist.add');
    if (checklist?.type !== 'checklist.add') throw new Error('checklist ausente');
    expect(checklist.items.map((item) => item.label)).toEqual([
      'Adaptador de tomada',
      'Protetor solar',
    ]);
  });

  it('desligar o bloco remove a ação inteira da lista', () => {
    let groups = buildReviewGroups(propostaComposta(), ctx);
    groups = toggleGroup(groups, groups[2].actionId);

    expect(reviewToActions(groups).map((action) => action.type)).toEqual([
      'itinerary.add',
      'checklist.add',
    ]);
  });

  it('desmarcar o último item de um bloco desliga o bloco', () => {
    let groups = buildReviewGroups(propostaComposta(), ctx);
    const despesas = groups[2];
    groups = toggleItem(groups, despesas.items[0].key);
    groups = toggleItem(groups, despesas.items[1].key);

    expect(groups[2].enabled).toBe(false);
    expect(reviewToActions(groups).some((action) => action.type === 'expenses.add')).toBe(false);
  });

  it('"adicione só os dois primeiros" resolve-se marcando localmente, sem nova proposta', () => {
    let groups = buildReviewGroups(propostaComposta(), ctx);
    // Aceita o Louvre (que veio desmarcado como possível duplicata) e mantém a
    // Torre Eiffel; Versalhes, fora do período, continua fora.
    groups = toggleItem(groups, groups[0].items[0].key);

    const roteiro = reviewToActions(groups).find((action) => action.type === 'itinerary.add');
    if (roteiro?.type !== 'itinerary.add') throw new Error('roteiro ausente');
    expect(roteiro.items.map((item) => item.title)).toEqual(['Museu do Louvre', 'Torre Eiffel']);
  });

  it('edições da revisão chegam à ação final', () => {
    let groups = buildReviewGroups(propostaComposta(), ctx);
    groups = editItem(groups, groups[0].items[1].key, {
      title: 'Torre Eiffel — jantar no topo',
      startTime: '20:00',
    });

    const roteiro = reviewToActions(groups).find((action) => action.type === 'itinerary.add');
    if (roteiro?.type !== 'itinerary.add') throw new Error('roteiro ausente');
    expect(roteiro.items[0]).toMatchObject({
      title: 'Torre Eiffel — jantar no topo',
      startTime: '20:00',
    });
  });

  it('cancelar não produz ação nenhuma — a lista só existe quando se confirma', () => {
    // Cancelar é, no modelo desta camada, simplesmente nunca chamar
    // `reviewToActions`. O que se garante aqui é que montar a revisão não tem
    // efeito colateral: nada é derivado dela até a confirmação.
    const groups = buildReviewGroups(propostaComposta(), ctx);
    expect(groups.every((group) => group.items.length > 0)).toBe(true);
    expect(reviewToActions([])).toEqual([]);
  });
});
