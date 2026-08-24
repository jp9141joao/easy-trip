import type { ChecklistItem, Expense, ItineraryItem, Trip } from '@/domain/types';
import { buildTripContext } from '@/services/ai';

/**
 * A IA e a privacidade da viagem compartilhada — §15, o item marcado CRÍTICO.
 *
 * A IA de João não pode receber o diário privado de Maria, nem as despesas
 * privadas dela, nem o checklist privado dela. Este arquivo mede exatamente
 * isso, e mede a segunda camada de defesa: a RLS já não devolveria esses
 * registros ao aparelho, mas se um dia devolver, `buildTripContext` os corta
 * antes de virarem prompt — de onde não há como tirar depois.
 */
const paris: Trip = {
  id: 'trip-paris',
  userId: 'joao',
  destinationCity: 'Paris',
  destinationCountry: 'França',
  countryCode: 'FR',
  timezone: 'Europe/Paris',
  startDate: '2026-08-22',
  endDate: '2026-08-31',
  budgetTotal: 12000,
  budgetCurrency: 'BRL',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const despesa = (over: Partial<Expense>): Expense => ({
  id: Math.random().toString(36).slice(2),
  tripId: paris.id,
  userId: 'joao',
  category: 'alimentacao',
  amount: 100,
  currency: 'BRL',
  transactionDate: '2026-08-24',
  description: 'Despesa',
  createdAt: '2026-08-24T00:00:00.000Z',
  visibility: 'shared',
  ...over,
});

const roteiro = (over: Partial<ItineraryItem>): ItineraryItem => ({
  id: Math.random().toString(36).slice(2),
  tripId: paris.id,
  date: '2026-08-24',
  type: 'atracao',
  title: 'Atividade',
  completed: false,
  sortOrder: 0,
  visibility: 'shared',
  ...over,
});

const checklist = (over: Partial<ChecklistItem>): ChecklistItem => ({
  id: Math.random().toString(36).slice(2),
  tripId: paris.id,
  label: 'Item',
  category: 'documentos',
  completed: false,
  createdAt: '2026-08-01T00:00:00.000Z',
  visibility: 'shared',
  ...over,
});

const contexto = (registros: {
  expenses?: Expense[];
  itinerary?: ItineraryItem[];
  checklist?: ChecklistItem[];
  viewerId?: string;
  memberCount?: number;
}) =>
  buildTripContext({
    trip: paris,
    status: 'active',
    daysUntil: 0,
    totalSpent: 0,
    remainingBudget: paris.budgetTotal,
    expenses: registros.expenses ?? [],
    itinerary: registros.itinerary ?? [],
    checklist: registros.checklist ?? [],
    profile: null,
    viewerId: registros.viewerId,
    memberCount: registros.memberCount,
  });

describe('§15 — a IA nunca recebe o privado de outra pessoa', () => {
  it('despesa privada de Maria não entra no contexto de João', () => {
    const ctx = contexto({
      viewerId: 'joao',
      expenses: [
        despesa({ description: 'Farmácia da Maria', visibility: 'private', createdBy: 'maria' }),
        despesa({ description: 'Jantar do grupo', visibility: 'shared', createdBy: 'maria' }),
      ],
    });

    const serializado = JSON.stringify(ctx);
    expect(serializado).not.toContain('Farmácia da Maria');
    expect(serializado).toContain('Jantar do grupo');
    expect(ctx.expenses).toHaveLength(1);
  });

  it('item de roteiro privado de Maria não entra', () => {
    const ctx = contexto({
      viewerId: 'joao',
      itinerary: [
        roteiro({ title: 'Surpresa de aniversário', visibility: 'private', createdBy: 'maria' }),
        roteiro({ title: 'Louvre', visibility: 'shared', createdBy: 'maria' }),
      ],
    });

    expect(JSON.stringify(ctx)).not.toContain('Surpresa de aniversário');
    expect(ctx.itinerary.map((item) => item.title)).toEqual(['Louvre']);
  });

  it('checklist privado de Maria não entra', () => {
    const ctx = contexto({
      viewerId: 'joao',
      checklist: [
        checklist({ label: 'Remédio contínuo', visibility: 'private', createdBy: 'maria' }),
        checklist({ label: 'Passaporte', visibility: 'shared', createdBy: 'joao' }),
      ],
    });

    expect(JSON.stringify(ctx)).not.toContain('Remédio contínuo');
    expect(ctx.checklist.map((item) => item.label)).toEqual(['Passaporte']);
  });

  it('o privado do PRÓPRIO usuário entra — a IA dele responde sobre a vida dele', () => {
    const ctx = contexto({
      viewerId: 'joao',
      expenses: [despesa({ description: 'Presente secreto', visibility: 'private', createdBy: 'joao' })],
    });
    expect(ctx.expenses.map((e) => e.description)).toEqual(['Presente secreto']);
  });

  it('sem sessão conhecida, nada privado entra — o lado seguro do erro', () => {
    const ctx = contexto({
      expenses: [despesa({ description: 'Qualquer coisa', visibility: 'private', createdBy: 'joao' })],
    });
    expect(ctx.expenses).toHaveLength(0);
  });

  it('o diário nunca entra no contexto — nem compartilhado', () => {
    // `buildTripContext` não tem parâmetro de diário, e é essa ausência que
    // garante a regra: não há como uma tela passá-lo por engano.
    const ctx = contexto({ viewerId: 'joao' });
    expect(ctx).not.toHaveProperty('journal');
    expect(Object.keys(ctx)).not.toContain('journal');
  });
});

describe('§57 — "quanto eu gastei" e "quanto nós gastamos" são perguntas diferentes', () => {
  it('cada despesa diz se é compartilhada e se é da pessoa', () => {
    const ctx = contexto({
      viewerId: 'joao',
      memberCount: 2,
      expenses: [
        despesa({ description: 'Hotel', visibility: 'shared', createdBy: 'maria', paidBy: 'maria' }),
        despesa({ description: 'Táxi', visibility: 'shared', createdBy: 'joao', paidBy: 'joao' }),
      ],
    });

    const hotel = ctx.expenses.find((e) => e.description === 'Hotel')!;
    const taxi = ctx.expenses.find((e) => e.description === 'Táxi')!;

    expect(hotel.shared).toBe(true);
    expect(hotel.mine).toBe(false);
    expect(taxi.mine).toBe(true);
  });

  it('quem pagou conta como "minha", mesmo que outro tenha lançado', () => {
    const ctx = contexto({
      viewerId: 'joao',
      expenses: [
        despesa({ description: 'Ingressos', createdBy: 'maria', paidBy: 'joao', visibility: 'shared' }),
      ],
    });
    expect(ctx.expenses[0].mine).toBe(true);
  });

  it('o contexto informa quantos viajantes há', () => {
    expect(contexto({ viewerId: 'joao', memberCount: 3 }).collaboration).toEqual({
      memberCount: 3,
      isShared: true,
    });
    expect(contexto({ viewerId: 'joao', memberCount: 1 }).collaboration).toEqual({
      memberCount: 1,
      isShared: false,
    });
  });

  it('sem informação de membros, o campo simplesmente não vai', () => {
    expect(contexto({ viewerId: 'joao' }).collaboration).toBeUndefined();
  });
});
