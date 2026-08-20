import {
  clampPercent,
  getBudgetUsagePercent,
  getChecklistProgress,
  getCountdownLabel,
  getCurrentTripDay,
  getDaysUntilTrip,
  getExpensesByCategory,
  getGoalProgress,
  getNextActivities,
  getRemainingBudget,
  getTravelStats,
  getTripDurationDays,
  getTripStatus,
  getTripTimingLabel,
  getTripTotalSpent,
  getVisitedCountries,
  hasUnconvertedExpenses,
  isOverBudget,
  sortItinerary,
  TRIP_STATUS_LABEL,
} from '@/domain/selectors';
import type {
  ChecklistItem,
  Expense,
  Goal,
  ItineraryItem,
  Trip,
} from '@/domain/types';

const trip = (overrides: Partial<Trip> = {}): Trip => ({
  id: 'trip-paris',
  userId: 'user-1',
  destinationCity: 'Paris',
  destinationCountry: 'França',
  countryCode: 'FR',
  timezone: 'Europe/Paris',
  startDate: '2026-09-10',
  endDate: '2026-09-20',
  budgetTotal: 1000,
  budgetCurrency: 'BRL',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const expense = (amount: number, overrides: Partial<Expense> = {}): Expense => ({
  id: `e-${amount}-${Math.random()}`,
  tripId: 'trip-paris',
  userId: 'user-1',
  category: 'alimentacao',
  amount,
  currency: 'BRL',
  transactionDate: '2026-09-12',
  description: 'Despesa',
  createdAt: '2026-09-12T10:00:00.000Z',
  ...overrides,
});

describe('trip status (§31)', () => {
  it('is upcoming before the start date', () => {
    expect(getTripStatus(trip(), '2026-09-01')).toBe('upcoming');
  });

  it('is active on the start and end dates (inclusive)', () => {
    expect(getTripStatus(trip(), '2026-09-10')).toBe('active');
    expect(getTripStatus(trip(), '2026-09-15')).toBe('active');
    expect(getTripStatus(trip(), '2026-09-20')).toBe('active');
  });

  it('is completed after the end date', () => {
    expect(getTripStatus(trip(), '2026-09-21')).toBe('completed');
  });
});

describe('days until trip (§32)', () => {
  it('counts real calendar days, never a random number', () => {
    expect(getDaysUntilTrip(trip(), '2026-08-17')).toBe(24);
    expect(getDaysUntilTrip(trip(), '2026-09-09')).toBe(1);
    expect(getDaysUntilTrip(trip(), '2026-09-10')).toBe(0);
  });

  it('produces the right label for each phase', () => {
    expect(getCountdownLabel(trip(), '2026-08-17')).toBe('Faltam 24 dias');
    expect(getCountdownLabel(trip(), '2026-09-09')).toBe('Falta 1 dia');
    expect(getCountdownLabel(trip(), '2026-09-10')).toBe('Em andamento');
    expect(getCountdownLabel(trip(), '2026-09-25')).toBe('Concluída');
  });

  it('computes duration inclusively and the current day', () => {
    expect(getTripDurationDays(trip())).toBe(11);
    expect(getCurrentTripDay(trip(), '2026-09-10')).toBe(1);
    expect(getCurrentTripDay(trip(), '2026-09-12')).toBe(3);
    expect(getCurrentTripDay(trip(), '2026-09-01')).toBeNull();
  });
});

describe('finance (§38, CA-03)', () => {
  it('sums expenses and derives the remaining budget', () => {
    const expenses = [expense(100), expense(200), expense(300)];
    const t = trip();
    expect(getTripTotalSpent(expenses, t)).toBe(600);
    expect(getRemainingBudget(expenses, t)).toBe(400);
    expect(isOverBudget(expenses, t)).toBe(false);
  });

  it('lets the balance go negative instead of hiding overspending (§39)', () => {
    const expenses = [expense(1250)];
    const t = trip();
    expect(getRemainingBudget(expenses, t)).toBe(-250);
    expect(isOverBudget(expenses, t)).toBe(true);
    // The bar clamps for display, but the number does not lie.
    expect(getBudgetUsagePercent(expenses, t)).toBe(100);
  });

  it('uses the stored conversion for foreign-currency expenses (§41)', () => {
    const expenses = [
      expense(50, { currency: 'EUR', amountInBudgetCurrency: 300, exchangeRate: 6 }),
      expense(100),
    ];
    const t = trip();
    expect(getTripTotalSpent(expenses, t)).toBe(400);
    expect(hasUnconvertedExpenses(expenses, t)).toBe(false);
  });

  it('flags expenses that could not be converted rather than inventing a rate', () => {
    const expenses = [expense(50, { currency: 'ARS' })];
    const t = trip();
    expect(hasUnconvertedExpenses(expenses, t)).toBe(true);
    // Falls back to the raw amount, and the UI shows "Cotação indisponível".
    expect(getTripTotalSpent(expenses, t)).toBe(50);
  });

  it('avoids floating point drift across many expenses', () => {
    const expenses = [expense(0.1), expense(0.2)];
    expect(getTripTotalSpent(expenses, trip())).toBe(0.3);
  });

  it('groups spending by category, largest first', () => {
    const expenses = [
      expense(100, { category: 'alimentacao' }),
      expense(300, { category: 'hospedagem' }),
      expense(50, { category: 'alimentacao' }),
    ];
    const rows = getExpensesByCategory(expenses, trip());
    expect(rows[0]).toMatchObject({ category: 'hospedagem', total: 300 });
    expect(rows[1]).toMatchObject({ category: 'alimentacao', total: 150 });
  });

  it('treats a zero budget as 0% rather than dividing by zero', () => {
    expect(getBudgetUsagePercent([expense(10)], trip({ budgetTotal: 0 }))).toBe(0);
  });
});

describe('itinerary (§34)', () => {
  const item = (overrides: Partial<ItineraryItem>): ItineraryItem => ({
    id: 'i-1',
    tripId: 'trip-paris',
    date: '2026-09-11',
    type: 'atividade',
    title: 'Atividade',
    completed: false,
    sortOrder: 0,
    ...overrides,
  });

  it('orders by date, then start time, then sort order', () => {
    const items = [
      item({ id: 'c', date: '2026-09-12', startTime: '09:00' }),
      item({ id: 'b', date: '2026-09-11', startTime: '18:00' }),
      item({ id: 'a', date: '2026-09-11', startTime: '08:00' }),
      item({ id: 'd', date: '2026-09-11', sortOrder: 5 }),
    ];
    expect(sortItinerary(items).map((i) => i.id)).toEqual(['a', 'b', 'd', 'c']);
  });

  it('returns only future, unfinished activities', () => {
    const items = [
      item({ id: 'past', date: '2026-09-01' }),
      item({ id: 'done', date: '2026-09-15', completed: true }),
      item({ id: 'next', date: '2026-09-15' }),
    ];
    expect(getNextActivities(items, 3, '2026-09-10').map((i) => i.id)).toEqual(['next']);
  });
});

describe('checklist and goals (§36, §43)', () => {
  const checklistItem = (completed: boolean): ChecklistItem => ({
    id: `c-${Math.random()}`,
    tripId: 'trip-paris',
    label: 'Item',
    category: 'documentos',
    completed,
    createdAt: '2026-01-01T00:00:00.000Z',
  });

  it('computes checklist progress', () => {
    const items = [checklistItem(true), checklistItem(false), checklistItem(true)];
    expect(getChecklistProgress(items)).toEqual({
      completed: 2,
      total: 3,
      percent: expect.closeTo(66.67, 1),
    });
  });

  it('returns zero progress for an empty checklist', () => {
    expect(getChecklistProgress([])).toEqual({ completed: 0, total: 0, percent: 0 });
  });

  const goal = (current: number, target: number): Goal => ({
    id: 'g-1',
    userId: 'user-1',
    type: 'economia',
    title: 'Economizar',
    targetValue: target,
    currentValue: current,
    unit: 'R$',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  it('caps the visual percent at 100 while keeping the true ratio', () => {
    const progress = getGoalProgress(goal(1500, 1000));
    expect(progress.percent).toBe(100);
    expect(progress.ratio).toBe(1.5);
    expect(progress.reached).toBe(true);
  });

  it('handles a zero target without dividing by zero', () => {
    expect(getGoalProgress(goal(10, 0))).toEqual({ ratio: 0, percent: 0, reached: false });
  });
});

describe('profile statistics (§60)', () => {
  it('derives stats instead of hardcoding them', () => {
    const trips = [
      trip({ id: 't1', destinationCountry: 'França', startDate: '2025-01-01', endDate: '2025-01-10' }),
      trip({ id: 't2', destinationCountry: 'Japão', startDate: '2025-06-01', endDate: '2025-06-05' }),
      trip({ id: 't3', destinationCountry: 'França', startDate: '2027-01-01', endDate: '2027-01-05' }),
    ];
    const stats = getTravelStats(trips, [], [], '2026-08-17');

    expect(stats.totalTrips).toBe(3);
    expect(stats.completedTrips).toBe(2);
    expect(stats.upcomingTrips).toBe(1);
    // A country is only counted once the trip has actually started.
    expect(stats.visitedCountries).toBe(2);
    expect(stats.countriesList).toEqual(['França', 'Japão']);
    expect(stats.daysTravelled).toBe(10 + 5);
  });

  it('excludes purely future trips from visited countries', () => {
    const future = trip({ destinationCountry: 'Itália', startDate: '2030-01-01', endDate: '2030-01-05' });
    expect(getVisitedCountries([future], '2026-08-17')).toEqual([]);
  });
});

describe('clampPercent', () => {
  it('keeps values inside 0–100 and survives NaN', () => {
    expect(clampPercent(-10)).toBe(0);
    expect(clampPercent(150)).toBe(100);
    expect(clampPercent(Number.NaN)).toBe(0);
  });
});

describe('hero timing label (§27, §31)', () => {
  const t = trip({ startDate: '2026-09-10', endDate: '2026-09-13' });

  it('counts down while the trip is still ahead', () => {
    expect(getTripTimingLabel(t, '2026-08-11')).toBe('Faltam 30 dias');
    expect(getTripTimingLabel(t, '2026-09-08')).toBe('Faltam 2 dias');
    expect(getTripTimingLabel(t, '2026-09-09')).toBe('Falta 1 dia');
  });

  it('treats the departure day as day 1, not as a countdown', () => {
    // No dia da partida a viagem já está em andamento (§36), então contar
    // "faltam 0 dias" seria errado. O ramo 'Começa hoje' de
    // `getCountdownLabel` é, por consequência, inalcançável: ele exige
    // status 'upcoming', que por definição só ocorre com today < startDate.
    expect(getTripStatus(t, '2026-09-10')).toBe('active');
    expect(getTripTimingLabel(t, '2026-09-10')).toBe('Dia 1 de 4');
  });

  it('says which day of the trip it is instead of repeating the status', () => {
    // `getCountdownLabel` devolve "Em andamento", exatamente o texto do status —
    // era isso que fazia o hero desenhar dois chips idênticos lado a lado.
    expect(getCountdownLabel(t, '2026-09-11')).toBe('Em andamento');
    expect(getTripTimingLabel(t, '2026-09-11')).toBe('Dia 2 de 4');
    expect(getTripTimingLabel(t, '2026-09-13')).toBe('Dia 4 de 4');
  });

  it('stays silent once the trip is over, since the status already says it', () => {
    expect(getCountdownLabel(t, '2026-09-20')).toBe('Concluída');
    expect(getTripTimingLabel(t, '2026-09-20')).toBeNull();
  });

  it('never repeats whatever the status chip is showing', () => {
    for (const today of ['2026-08-01', '2026-09-09', '2026-09-10', '2026-09-12', '2026-10-01']) {
      const label = getTripTimingLabel(t, today);
      if (label === null) continue;
      expect(label).not.toBe(TRIP_STATUS_LABEL[getTripStatus(t, today)]);
    }
  });
});
