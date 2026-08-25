import {
  AI_ACTION_LIMITS,
  countActionItems,
  describeExpenseDescription,
  enforceAIActionPromiseCoherence,
  findChecklistDuplicate,
  findItineraryDuplicate,
  isWithinTrip,
  parseAIActions,
} from '@/domain/aiActions';
import type { ChecklistItem, ItineraryItem, Trip } from '@/domain/types';

/**
 * A porta de entrada das propostas da IA.
 *
 * Tudo que chega aqui veio pela rede e é, por definição, não confiável — mesmo
 * tendo passado pela validação da Edge Function, porque nada garante que a
 * resposta *veio* da Edge Function. O que estes testes fixam é que o resultado
 * de `parseAIActions` nunca contém nada além do que este código construiu.
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

const itineraryAction = (items: unknown[]) => ({
  type: 'itinerary.add',
  label: 'Adicionar ao roteiro',
  items,
});

const validItineraryItem = {
  title: 'Museu do Louvre',
  date: '2026-08-23',
  startTime: '09:00',
  type: 'atracao',
};

describe('parseAIActions — o que passa', () => {
  it('aceita uma proposta de roteiro bem formada e carimba a viagem', () => {
    const [action] = parseAIActions([itineraryAction([validItineraryItem])], paris);

    expect(action.type).toBe('itinerary.add');
    expect(action.tripId).toBe('trip-paris');
    expect(action.id).toEqual(expect.any(String));
    expect(countActionItems(action)).toBe(1);
  });

  it('preenche a moeda da despesa com a do orçamento quando ela não veio', () => {
    const [action] = parseAIActions(
      [
        {
          type: 'expenses.add',
          label: 'Adicionar despesas',
          items: [{ description: 'Ingresso', amount: 450, transactionDate: '2026-08-23' }],
        },
      ],
      paris,
    );

    expect(action).toMatchObject({ type: 'expenses.add' });
    if (action.type !== 'expenses.add') throw new Error('tipo inesperado');
    expect(action.items[0].currency).toBe('BRL');
  });

  it('trata a despesa como estimativa quando o modelo não afirma o contrário', () => {
    const [action] = parseAIActions(
      [
        {
          type: 'expenses.add',
          label: 'Adicionar despesas',
          items: [
            { description: 'Ingresso', amount: 450, transactionDate: '2026-08-23' },
            {
              description: 'Passagem aérea',
              amount: 3200,
              transactionDate: '2026-08-22',
              estimated: false,
            },
          ],
        },
      ],
      paris,
    );

    if (action.type !== 'expenses.add') throw new Error('tipo inesperado');
    // Sem afirmação, é chute. Com afirmação explícita, é valor informado (§19).
    expect(action.items[0].estimated).toBe(true);
    expect(action.items[1].estimated).toBe(false);
  });

  it('aproveita os itens válidos e descarta só o item inválido', () => {
    const [action] = parseAIActions(
      [
        itineraryAction([
          validItineraryItem,
          { title: 'Sem data' },
          { title: 'Torre Eiffel', date: '2026-08-24', startTime: '99:99' },
        ]),
      ],
      paris,
    );

    if (action.type !== 'itinerary.add') throw new Error('tipo inesperado');
    // "Sem data" cai por falta de data; a Torre Eiffel entra sem o horário
    // inválido, porque o horário é opcional e o resto do item é bom.
    expect(action.items.map((item) => item.title)).toEqual(['Museu do Louvre', 'Torre Eiffel']);
    expect(action.items[1].startTime).toBeUndefined();
  });
});

describe('parseAIActions — o que não passa', () => {
  it('descarta tipo de ação desconhecido', () => {
    expect(
      parseAIActions(
        [
          { type: 'trip.delete', label: 'Excluir viagem', items: [] },
          { type: 'account.delete', label: 'Excluir conta' },
          { type: 'profile.update', label: 'Virar admin', role: 'admin' },
          { type: 'sql.execute', label: 'drop table trips' },
        ],
        paris,
      ),
    ).toEqual([]);
  });

  it('descarta payload que não é lista', () => {
    expect(parseAIActions(undefined, paris)).toEqual([]);
    expect(parseAIActions(null, paris)).toEqual([]);
    expect(parseAIActions('itinerary.add', paris)).toEqual([]);
    expect(parseAIActions({ type: 'itinerary.add' }, paris)).toEqual([]);
  });

  it('recusa valores não finitos e negativos numa despesa', () => {
    const parsed = parseAIActions(
      [
        {
          type: 'expenses.add',
          label: 'Adicionar despesas',
          items: [
            { description: 'NaN', amount: Number.NaN, transactionDate: '2026-08-23' },
            { description: 'Infinito', amount: Number.POSITIVE_INFINITY, transactionDate: '2026-08-23' },
            { description: 'Negativa', amount: -100, transactionDate: '2026-08-23' },
            { description: 'Zero', amount: 0, transactionDate: '2026-08-23' },
            {
              description: 'Acima do teto',
              amount: AI_ACTION_LIMITS.maxAmount + 1,
              transactionDate: '2026-08-23',
            },
          ],
        },
      ],
      paris,
    );

    // Nenhum item sobreviveu, então a ação inteira não existe.
    expect(parsed).toEqual([]);
  });

  it('recusa datas inválidas', () => {
    expect(
      parseAIActions(
        [
          itineraryAction([
            { title: 'Trinta de fevereiro', date: '2026-02-30' },
            { title: 'Formato errado', date: '23/08/2026' },
            { title: 'Mês treze', date: '2026-13-01' },
          ]),
        ],
        paris,
      ),
    ).toEqual([]);
  });

  it('corta strings gigantescas em vez de deixá-las passar', () => {
    const [action] = parseAIActions(
      [itineraryAction([{ ...validItineraryItem, title: 'A'.repeat(50_000) }])],
      paris,
    );

    // O título excede o limite, então o item cai — e com ele a ação inteira.
    expect(action).toBeUndefined();
  });

  it('limita a quantidade de ações e de itens', () => {
    const manyItems = Array.from({ length: 500 }, (_, index) => ({
      title: `Item ${index}`,
      date: '2026-08-23',
    }));

    const actions = parseAIActions(
      [
        itineraryAction(manyItems),
        { type: 'checklist.add', label: 'Checklist', items: [{ label: 'Passaporte' }] },
        { type: 'expenses.add', label: 'Despesas', items: [{ description: 'Ingresso', amount: 10, transactionDate: '2026-08-23' }] },
        { type: 'budget.update', label: 'Orçamento', budgetTotal: 40000 },
        { type: 'goal.add', label: 'Meta', goal: { title: 'Juntar', targetValue: 2000 } },
        { type: 'goal.add', label: 'Outra meta', goal: { title: 'Mais', targetValue: 100 } },
      ],
      paris,
    );

    expect(actions.length).toBe(AI_ACTION_LIMITS.maxActions);
    expect(countActionItems(actions[0])).toBe(AI_ACTION_LIMITS.maxItemsPerAction);
  });

  it('mantém uma proposta por tipo', () => {
    const actions = parseAIActions(
      [itineraryAction([validItineraryItem]), itineraryAction([{ title: 'Outro', date: '2026-08-24' }])],
      paris,
    );

    expect(actions).toHaveLength(1);
    expect(countActionItems(actions[0])).toBe(1);
  });

  it('não deixa campo inesperado atravessar para a ação', () => {
    const [action] = parseAIActions(
      [
        {
          type: 'checklist.add',
          label: 'Checklist',
          serviceRole: 'sb_secret_abc',
          userId: 'outro-usuario',
          tripId: 'trip-de-outra-pessoa',
          items: [
            {
              label: 'Passaporte',
              href: 'javascript:alert(1)',
              sql: 'drop table trips',
              completed: true,
            },
          ],
        },
      ],
      paris,
    );

    if (action.type !== 'checklist.add') throw new Error('tipo inesperado');
    // O `tripId` é o carimbado pelo cliente, não o que veio no payload.
    expect(action.tripId).toBe('trip-paris');
    expect(Object.keys(action).sort()).toEqual(['id', 'items', 'label', 'tripId', 'type']);
    expect(Object.keys(action.items[0]).sort()).toEqual(['category', 'label']);
  });

  it('nunca aceita o tripId proposto no payload, mesmo sendo um id válido', () => {
    const [action] = parseAIActions(
      [{ ...itineraryAction([validItineraryItem]), tripId: 'trip-toquio' }],
      paris,
    );

    expect(action.tripId).toBe('trip-paris');
  });
});

/* ------------------------------ conferências ------------------------------ */

describe('datas e duplicatas', () => {
  it('reconhece data fora do período da viagem', () => {
    expect(isWithinTrip('2026-08-23', paris)).toBe(true);
    expect(isWithinTrip('2026-08-22', paris)).toBe(true);
    expect(isWithinTrip('2026-08-31', paris)).toBe(true);
    expect(isWithinTrip('2026-09-05', paris)).toBe(false);
    expect(isWithinTrip('2026-08-21', paris)).toBe(false);
    expect(isWithinTrip('não é data', paris)).toBe(false);
  });

  it('marca "Museu do Louvre" como duplicata de "Visitar Museu do Louvre" no mesmo dia', () => {
    const existing: ItineraryItem[] = [
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

    expect(
      findItineraryDuplicate({ title: 'Museu do Louvre', date: '2026-08-23', type: 'atracao' }, existing),
    ).toBeDefined();

    // Dia diferente não é duplicata: repetir um lugar em outro dia é comum.
    expect(
      findItineraryDuplicate({ title: 'Museu do Louvre', date: '2026-08-25', type: 'atracao' }, existing),
    ).toBeUndefined();

    // Contido, mas curto demais em relação ao existente: não marca.
    expect(
      findItineraryDuplicate({ title: 'Louvre', date: '2026-08-23', type: 'atracao' }, existing),
    ).toBeUndefined();
  });

  it('compara checklist ignorando acento e caixa', () => {
    const existing: ChecklistItem[] = [
      {
        id: 'c1',
        tripId: paris.id,
        label: 'Adaptador de tomada',
        category: 'mala',
        completed: false,
        visibility: 'shared',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ];

    expect(findChecklistDuplicate({ label: 'ADAPTADOR DE TOMADA', category: 'mala' }, existing)).toBeDefined();
    expect(findChecklistDuplicate({ label: 'Protetor solar', category: 'saude' }, existing)).toBeUndefined();
  });
});

describe('estimativa na descrição', () => {
  it('prefixa quando é estimativa e não prefixa quando é valor informado', () => {
    expect(
      describeExpenseDescription({
        description: 'Alimentação',
        category: 'alimentacao',
        amount: 150,
        currency: 'BRL',
        transactionDate: '2026-08-23',
        estimated: true,
      }),
    ).toBe('Estimativa — Alimentação');

    expect(
      describeExpenseDescription({
        description: 'Passagem aérea',
        category: 'transporte',
        amount: 3200,
        currency: 'BRL',
        transactionDate: '2026-08-22',
        estimated: false,
      }),
    ).toBe('Passagem aérea');
  });

  it('não prefixa duas vezes', () => {
    expect(
      describeExpenseDescription({
        description: 'Estimativa — Alimentação',
        category: 'alimentacao',
        amount: 150,
        currency: 'BRL',
        transactionDate: '2026-08-23',
        estimated: true,
      }),
    ).toBe('Estimativa — Alimentação');
  });
});

describe('coerência entre texto e action validada no cliente', () => {
  it.each([
    'Revise.',
    'Confirme no aplicativo.',
    'Clique em implementar.',
    'Adicione abaixo.',
    'Posso aplicar.',
    'Preparei a proposta abaixo.',
  ])('remove a promessa sem card: %s', (promise) => {
    const result = enforceAIActionPromiseCoherence(
      `Aqui está a informação que encontrei. ${promise}`,
      0,
    );

    expect(result.content).toBe('Aqui está a informação que encontrei.');
    expect(result.stripped).toBe(1);
  });

  it('mantém a promessa quando existe action validada na mesma resposta', () => {
    const content = 'Preparei a proposta abaixo. Revise e confirme no aplicativo.';
    expect(enforceAIActionPromiseCoherence(content, 1)).toEqual({ content, stripped: 0 });
  });

  it('não inventa proposta quando a resposta era somente uma promessa', () => {
    const result = enforceAIActionPromiseCoherence('Posso aplicar isso agora.', 0);
    expect(result.content).toMatch(/não consegui montar uma proposta aplicável/i);
  });
});
