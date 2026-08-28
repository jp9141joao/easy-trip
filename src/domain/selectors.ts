/**
 * Derived data (§96).
 *
 * Everything that can be computed from stored records is computed HERE and
 * nowhere else. No screen recalculates a budget, and no record stores a status,
 * a countdown or a total — that is what made the original prototype drift
 * (§100: budget mutable independently of expenses, random daysLeft, ...).
 *
 * These functions are pure and unit-tested in `tests/unit/selectors.test.ts`.
 */

import { daysBetween, todayISO } from '@/lib/date';
import type {
  ChecklistItem,
  Expense,
  Goal,
  ISODate,
  ItineraryItem,
  Trip,
  TripStatus,
} from './types';

/* -------------------------------------------------------------------------- */
/* Trip                                                                        */
/* -------------------------------------------------------------------------- */

export function getTripStatus(trip: Trip, today: string = todayISO()): TripStatus {
  if (today < trip.startDate) return 'upcoming';
  if (today <= trip.endDate) return 'active';
  return 'completed';
}

/**
 * Days until departure. Positive when the trip is ahead, 0 on the start day,
 * negative once it has begun. Callers render it through `getCountdownLabel`.
 */
export function getDaysUntilTrip(trip: Trip, today: string = todayISO()): number {
  return daysBetween(today, trip.startDate);
}

/** Total trip length in days, inclusive of both endpoints. */
export function getTripDurationDays(trip: Trip): number {
  return daysBetween(trip.startDate, trip.endDate) + 1;
}

/** Which day of the trip `today` is (1-based); null outside the trip. */
export function getCurrentTripDay(trip: Trip, today: string = todayISO()): number | null {
  if (getTripStatus(trip, today) !== 'active') return null;
  return daysBetween(trip.startDate, today) + 1;
}

/** Human countdown label (§32) — never a random number. */
export function getCountdownLabel(trip: Trip, today: string = todayISO()): string {
  const status = getTripStatus(trip, today);
  if (status === 'completed') return 'Concluída';
  if (status === 'active') return 'Em andamento';
  const days = getDaysUntilTrip(trip, today);
  if (days === 0) return 'Começa hoje';
  if (days === 1) return 'Falta 1 dia';
  return `Faltam ${days} dias`;
}

export const TRIP_STATUS_LABEL: Record<TripStatus, string> = {
  upcoming: 'Planejada',
  active: 'Em andamento',
  completed: 'Concluída',
};

/**
 * Rótulo temporal exibido ao lado do status no hero (§27, §31).
 *
 * `getCountdownLabel` devolve exatamente o mesmo texto do status quando a
 * viagem está em andamento ou concluída, o que fazia o hero desenhar dois chips
 * idênticos lado a lado. Aqui o rótulo só existe quando acrescenta alguma
 * informação que o status não dá:
 *
 * - planejada  → quanto falta para embarcar;
 * - em andamento → em que dia da viagem o usuário está;
 * - concluída  → nada, o status já diz tudo.
 */
export function getTripTimingLabel(trip: Trip, today: string = todayISO()): string | null {
  const status = getTripStatus(trip, today);

  if (status === 'upcoming') return getCountdownLabel(trip, today);

  if (status === 'active') {
    const day = getCurrentTripDay(trip, today);
    if (day === null) return null;
    return `Dia ${day} de ${getTripDurationDays(trip)}`;
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* Finance                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Value of an expense expressed in the trip's budget currency.
 *
 * When the expense was paid in another currency we use the rate captured at
 * registration time (§41) so history never silently re-prices. If no rate was
 * stored we fall back to the raw amount rather than inventing one — the UI
 * flags such rows via `hasUnconvertedExpenses`.
 */
export function getExpenseValueInBudgetCurrency(expense: Expense, trip: Trip): number {
  if (expense.currency === trip.budgetCurrency) return expense.amount;
  if (typeof expense.amountInBudgetCurrency === 'number') {
    return expense.amountInBudgetCurrency;
  }
  return expense.amount;
}

/** True when some expense could not be converted — surfaced honestly in the UI. */
export function hasUnconvertedExpenses(expenses: Expense[], trip: Trip): boolean {
  return expenses.some(
    (e) => e.currency !== trip.budgetCurrency && typeof e.amountInBudgetCurrency !== 'number',
  );
}

export function getTripTotalSpent(expenses: Expense[], trip: Trip): number {
  return round2(
    expenses.reduce((sum, expense) => sum + getExpenseValueInBudgetCurrency(expense, trip), 0),
  );
}

/**
 * Remaining budget. Deliberately allowed to go negative (§39) — clamping to
 * zero would hide overspending, which is one of the banned prototype bugs.
 */
export function getRemainingBudget(expenses: Expense[], trip: Trip): number {
  return round2(trip.budgetTotal - getTripTotalSpent(expenses, trip));
}

export function isOverBudget(expenses: Expense[], trip: Trip): boolean {
  return getRemainingBudget(expenses, trip) < 0;
}

/** Raw usage ratio — can exceed 1 when the budget is blown. */
export function getBudgetUsageRatio(expenses: Expense[], trip: Trip): number {
  if (trip.budgetTotal <= 0) return 0;
  return getTripTotalSpent(expenses, trip) / trip.budgetTotal;
}

/** Usage percent for progress bars, clamped to 0–100 for *display only*. */
export function getBudgetUsagePercent(expenses: Expense[], trip: Trip): number {
  return clampPercent(getBudgetUsageRatio(expenses, trip) * 100);
}

/* -------------------------------------------------------------------------- */
/* Meta de gasto diário (§27–§33)                                              */
/* -------------------------------------------------------------------------- */

export interface DailySpend {
  /** A data das despesas, `YYYY-MM-DD`. */
  date: ISODate;
  /** Somatório do dia, na moeda do orçamento da viagem. */
  spent: number;
}

export interface DailyGoalStatus {
  date: ISODate;
  spent: number;
  /** A meta vigente. `undefined` quando a viagem não tem meta definida. */
  goal?: number;
  /** `goal - spent`. Negativo quando estourou — nunca é achatado em zero. */
  remaining?: number;
  /** Quanto passou da meta. `0` quando está dentro dela. */
  over: number;
  /** `true` só quando existe meta E ela foi ultrapassada. */
  exceeded: boolean;
}

/**
 * QUAIS DESPESAS ENTRAM NA CONTA (§31)
 *
 * Exatamente as mesmas que já formam os totais da Carteira — nem uma a mais.
 *
 * A lista que chega aqui é a que `useExpenses(tripId)` devolveu, e o que ela
 * contém é decidido pela RLS: as despesas `shared` da viagem mais as `private`
 * de quem está lendo. Não há rateio, não há filtro por `paid_by` e não há uma
 * segunda semântica financeira: se a meta somasse um conjunto diferente do que
 * o cartão de saldo logo acima soma, os dois números da mesma tela discordariam
 * e nenhum dos dois seria explicável.
 *
 * A conversão é a mesma de `getTripTotalSpent`: cada despesa vale o que valia na
 * moeda do orçamento no dia em que foi registrada (§41). Uma despesa em iene
 * numa viagem orçada em real conta pelo valor convertido e gravado, não por uma
 * cotação de hoje.
 */
export function getDailySpend(expenses: Expense[], trip: Trip): DailySpend[] {
  const totals = new Map<ISODate, number>();

  for (const expense of expenses) {
    const value = getExpenseValueInBudgetCurrency(expense, trip);
    totals.set(expense.transactionDate, (totals.get(expense.transactionDate) ?? 0) + value);
  }

  return [...totals.entries()]
    .map(([date, spent]) => ({ date, spent: round2(spent) }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** O total gasto num dia específico. Zero quando não houve despesa nele. */
export function getSpendOnDate(expenses: Expense[], trip: Trip, date: ISODate): number {
  return round2(
    expenses
      .filter((expense) => expense.transactionDate === date)
      .reduce((sum, expense) => sum + getExpenseValueInBudgetCurrency(expense, trip), 0),
  );
}

/**
 * O estado de um dia diante da meta.
 *
 * Sem meta na viagem, devolve o gasto e `exceeded: false` — a tela ainda quer
 * mostrar quanto se gastou no dia, só não tem contra o que comparar.
 *
 * `goal <= 0` é tratado como ausência de meta, e não como "meta de zero": um
 * campo esvaziado que virasse `0` faria o primeiro café do dia estourar a meta,
 * e o alerta apareceria para quem tinha acabado de desistir de usar o recurso.
 * Remover a meta grava `undefined`, e este guarda protege contra o resto.
 */
export function getDailyGoalStatus(
  expenses: Expense[],
  trip: Trip,
  date: ISODate,
): DailyGoalStatus {
  const spent = getSpendOnDate(expenses, trip, date);
  const goal = trip.dailySpendingGoal;

  if (goal === undefined || goal <= 0) {
    return { date, spent, over: 0, exceeded: false };
  }

  const remaining = round2(goal - spent);
  return {
    date,
    spent,
    goal,
    remaining,
    over: remaining < 0 ? round2(-remaining) : 0,
    exceeded: remaining < 0,
  };
}

/**
 * Os dias que estouraram a meta, do mais recente para o mais antigo.
 *
 * Cada dia é independente (§63): gastar demais na terça não empurra nada para a
 * quarta, e a quarta não "compensa" a terça. É uma meta diária, não um
 * orçamento acumulado — quem quer o acumulado já tem o cartão de saldo.
 */
export function getExceededGoalDays(expenses: Expense[], trip: Trip): DailyGoalStatus[] {
  const goal = trip.dailySpendingGoal;
  if (goal === undefined || goal <= 0) return [];

  return getDailySpend(expenses, trip)
    .filter((day) => day.spent > goal)
    .map((day) => getDailyGoalStatus(expenses, trip, day.date))
    .sort((a, b) => (a.date > b.date ? -1 : 1));
}

export function getExpensesByCategory(
  expenses: Expense[],
  trip: Trip,
): { category: Expense['category']; total: number; ratio: number }[] {
  const totals = new Map<Expense['category'], number>();
  for (const expense of expenses) {
    const value = getExpenseValueInBudgetCurrency(expense, trip);
    totals.set(expense.category, (totals.get(expense.category) ?? 0) + value);
  }
  const grandTotal = getTripTotalSpent(expenses, trip);
  return [...totals.entries()]
    .map(([category, total]) => ({
      category,
      total: round2(total),
      ratio: grandTotal > 0 ? total / grandTotal : 0,
    }))
    .sort((a, b) => b.total - a.total);
}

/* -------------------------------------------------------------------------- */
/* Itinerary                                                                   */
/* -------------------------------------------------------------------------- */

/** Canonical ordering (§34): date → startTime → sortOrder. */
export function sortItinerary(items: ItineraryItem[]): ItineraryItem[] {
  return [...items].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const at = a.startTime ?? '99:99';
    const bt = b.startTime ?? '99:99';
    if (at !== bt) return at < bt ? -1 : 1;
    return a.sortOrder - b.sortOrder;
  });
}

export interface ItineraryDay {
  date: string;
  items: ItineraryItem[];
}

export function groupItineraryByDate(items: ItineraryItem[]): ItineraryDay[] {
  const groups = new Map<string, ItineraryItem[]>();
  for (const item of sortItinerary(items)) {
    const bucket = groups.get(item.date);
    if (bucket) bucket.push(item);
    else groups.set(item.date, [item]);
  }
  return [...groups.entries()].map(([date, dayItems]) => ({ date, items: dayItems }));
}

/** The next upcoming, not-yet-completed activities (§27). */
export function getNextActivities(
  items: ItineraryItem[],
  limit = 3,
  today: string = todayISO(),
): ItineraryItem[] {
  return sortItinerary(items)
    .filter((item) => !item.completed && item.date >= today)
    .slice(0, limit);
}

export function getItineraryProgress(items: ItineraryItem[]): Progress {
  return toProgress(items.filter((i) => i.completed).length, items.length);
}

/* -------------------------------------------------------------------------- */
/* Checklist & goals                                                           */
/* -------------------------------------------------------------------------- */

export interface Progress {
  completed: number;
  total: number;
  /** 0–100, clamped. */
  percent: number;
}

export function getChecklistProgress(items: ChecklistItem[]): Progress {
  return toProgress(items.filter((i) => i.completed).length, items.length);
}

/**
 * Goal progress. `percent` is clamped to 100 for the bar, while `ratio` keeps
 * the true value so "meta superada" can still be celebrated (§43).
 */
export function getGoalProgress(goal: Goal): { ratio: number; percent: number; reached: boolean } {
  if (goal.targetValue <= 0) return { ratio: 0, percent: 0, reached: false };
  const ratio = goal.currentValue / goal.targetValue;
  return { ratio, percent: clampPercent(ratio * 100), reached: ratio >= 1 };
}

export function isGoalComplete(goal: Goal): boolean {
  return goal.status === 'completed' || getGoalProgress(goal).reached;
}

/* -------------------------------------------------------------------------- */
/* Profile statistics (§60) — derived, never hardcoded                         */
/* -------------------------------------------------------------------------- */

export interface TravelStats {
  totalTrips: number;
  completedTrips: number;
  upcomingTrips: number;
  visitedCountries: number;
  countriesList: string[];
  completedGoals: number;
  totalGoals: number;
  daysTravelled: number;
  activitiesCompleted: number;
}

export function getVisitedCountries(trips: Trip[], today: string = todayISO()): string[] {
  const countries = new Set<string>();
  for (const trip of trips) {
    // Only count a country once the trip has actually started.
    if (getTripStatus(trip, today) !== 'upcoming') countries.add(trip.destinationCountry);
  }
  return [...countries].sort();
}

export function getTravelStats(
  trips: Trip[],
  goals: Goal[],
  itinerary: ItineraryItem[] = [],
  today: string = todayISO(),
): TravelStats {
  const completed = trips.filter((t) => getTripStatus(t, today) === 'completed');
  const countriesList = getVisitedCountries(trips, today);
  return {
    totalTrips: trips.length,
    completedTrips: completed.length,
    upcomingTrips: trips.filter((t) => getTripStatus(t, today) === 'upcoming').length,
    visitedCountries: countriesList.length,
    countriesList,
    completedGoals: goals.filter(isGoalComplete).length,
    totalGoals: goals.length,
    daysTravelled: completed.reduce((sum, trip) => sum + getTripDurationDays(trip), 0),
    activitiesCompleted: itinerary.filter((i) => i.completed).length,
  };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function toProgress(completed: number, total: number): Progress {
  return { completed, total, percent: total === 0 ? 0 : clampPercent((completed / total) * 100) };
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

/** Currency-safe rounding — avoids 0.1 + 0.2 drift accumulating over a trip. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
