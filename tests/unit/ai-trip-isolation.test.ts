import type { ChecklistItem, Expense, ItineraryItem, Trip } from '@/domain/types';
import { buildTripContext } from '@/services/ai';

/**
 * O contexto enviado ao modelo é o da viagem escolhida, e só dele (§1, §7).
 *
 * Trocar Paris → Tóquio no seletor precisa trocar tudo que sobe para o Gemini,
 * não só o cabeçalho. Este teste monta o contexto duas vezes com registros de
 * viagens diferentes e verifica que nada da primeira sobrevive na segunda —
 * nem destino, nem gasto, nem item de roteiro, nem orçamento.
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

const toquio: Trip = {
  ...paris,
  id: 'trip-toquio',
  destinationCity: 'Tóquio',
  destinationCountry: 'Japão',
  countryCode: 'JP',
  timezone: 'Asia/Tokyo',
  startDate: '2026-09-18',
  endDate: '2026-10-27',
  budgetTotal: 45000,
};

const despesaParis: Expense = {
  id: 'e1',
  tripId: 'trip-paris',
  userId: 'u1',
  category: 'alimentacao',
  description: 'Jantar no Les Antiquaires',
  amount: 400,
  currency: 'BRL',
  transactionDate: '2026-08-23',
  createdAt: '2026-08-23T00:00:00.000Z',
};

const roteiroParis: ItineraryItem = {
  id: 'i1',
  tripId: 'trip-paris',
  date: '2026-08-23',
  type: 'atracao',
  title: 'Museu do Louvre',
  completed: false,
  sortOrder: 0,
};

const checklistToquio: ChecklistItem = {
  id: 'c1',
  tripId: 'trip-toquio',
  label: 'Comprar JR Pass',
  category: 'documentos',
  completed: false,
  createdAt: '2026-08-01T00:00:00.000Z',
};

const contexto = (
  trip: Trip,
  registros: {
    expenses?: Expense[];
    itinerary?: ItineraryItem[];
    checklist?: ChecklistItem[];
  } = {},
) =>
  buildTripContext({
    trip,
    status: 'upcoming',
    daysUntil: 10,
    totalSpent: 0,
    remainingBudget: trip.budgetTotal,
    expenses: registros.expenses ?? [],
    itinerary: registros.itinerary ?? [],
    checklist: registros.checklist ?? [],
    profile: null,
  });

describe('contexto da IA por viagem', () => {
  it('descreve exatamente a viagem recebida', () => {
    const ctx = contexto(paris);
    expect(ctx.trip.destinationCity).toBe('Paris');
    expect(ctx.trip.destinationCountry).toBe('França');
    expect(ctx.trip.budgetTotal).toBe(30000);
    expect(ctx.trip.timezone).toBe('Europe/Paris');
  });

  it('não carrega nada de Paris depois da troca para Tóquio', () => {
    const antes = contexto(paris, { expenses: [despesaParis], itinerary: [roteiroParis] });
    const depois = contexto(toquio, { checklist: [checklistToquio] });

    const serializado = JSON.stringify(depois);
    expect(serializado).not.toContain('Paris');
    expect(serializado).not.toContain('França');
    expect(serializado).not.toContain('Les Antiquaires');
    expect(serializado).not.toContain('Louvre');

    // E o contexto anterior seguiu íntegro — nenhum dos dois foi mutado.
    expect(antes.expenses).toHaveLength(1);
    expect(depois.expenses).toHaveLength(0);
    expect(depois.checklist[0].label).toBe('Comprar JR Pass');
    expect(depois.trip.budgetTotal).toBe(45000);
  });

  it('não tem por onde receber uma segunda viagem', () => {
    // O contexto é construído a partir de UM `trip`: não existe campo de lista,
    // então "mandar todas as viagens para o Gemini" não é sequer expressável.
    const ctx = contexto(paris);
    expect(Array.isArray((ctx as unknown as { trips?: unknown }).trips)).toBe(false);
    expect(Object.keys(ctx.trip)).not.toContain('id');
  });
});
