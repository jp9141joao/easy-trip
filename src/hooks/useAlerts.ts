import { useMemo } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  ListChecks,
  PlaneTakeoff,
  TicketX,
  Wallet,
  type LucideIcon,
} from 'lucide-react-native';

import {
  getBudgetUsagePercent,
  getChecklistProgress,
  getDaysUntilTrip,
  getNextActivities,
  getTripStatus,
  isOverBudget,
} from '@/domain/selectors';
import { formatWeekdayDate, todayISO } from '@/lib/date';
import { useCurrentTrip } from './useTrips';
import { useChecklist, useExpenses, useItinerary, useTickets } from './useTripData';

export type AlertTone = 'brand' | 'warning' | 'error' | 'success' | 'neutral';

export interface DerivedAlert {
  id: string;
  title: string;
  message: string;
  tone: AlertTone;
  icon: LucideIcon;
  /** Route to open when the alert is tapped. */
  href?: string;
}

/**
 * The alert centre (§28).
 *
 * Every entry is *derived* from the active trip's real records — budget usage,
 * upcoming activities, checklist gaps. Nothing is invented, and when there is
 * nothing to report the list is genuinely empty.
 */
export function useAlerts(): DerivedAlert[] {
  const { trip } = useCurrentTrip();
  const { data: expenses = [] } = useExpenses(trip?.id);
  const { data: itinerary = [] } = useItinerary(trip?.id);
  const { data: checklist = [] } = useChecklist(trip?.id);
  const { data: tickets = [] } = useTickets(trip?.id);

  return useMemo(() => {
    if (!trip) return [];

    const alerts: DerivedAlert[] = [];
    const today = todayISO();
    const status = getTripStatus(trip, today);
    const daysUntil = getDaysUntilTrip(trip, today);

    /* Budget */
    if (isOverBudget(expenses, trip)) {
      alerts.push({
        id: 'budget-over',
        title: 'Orçamento excedido',
        message: `Seus gastos em ${trip.destinationCity} ultrapassaram o orçamento planejado.`,
        tone: 'error',
        icon: AlertTriangle,
        href: `/trip/${trip.id}/finance`,
      });
    } else {
      const usage = getBudgetUsagePercent(expenses, trip);
      if (usage >= 80) {
        alerts.push({
          id: 'budget-near',
          title: 'Orçamento perto do limite',
          message: `Você já usou ${Math.round(usage)}% do orçamento de ${trip.destinationCity}.`,
          tone: 'warning',
          icon: Wallet,
          href: `/trip/${trip.id}/finance`,
        });
      }
    }

    /* Trip approaching */
    if (status === 'upcoming' && daysUntil >= 0 && daysUntil <= 7) {
      alerts.push({
        id: 'trip-soon',
        title: daysUntil === 0 ? 'Sua viagem começa hoje' : `Faltam ${daysUntil} dias`,
        message: `${trip.destinationCity}, ${trip.destinationCountry} está chegando.`,
        tone: 'brand',
        icon: PlaneTakeoff,
        href: `/trip/${trip.id}`,
      });
    }

    /* Next activity */
    const [next] = getNextActivities(itinerary, 1, today);
    if (next && next.date === today) {
      alerts.push({
        id: `activity-${next.id}`,
        title: 'Atividade hoje',
        message: `${next.startTime ? `${next.startTime} — ` : ''}${next.title}`,
        tone: 'brand',
        icon: CalendarClock,
        href: `/trip/${trip.id}/itinerary`,
      });
    } else if (next && status !== 'completed') {
      alerts.push({
        id: `activity-${next.id}`,
        title: 'Próxima atividade',
        message: `${next.title} · ${formatWeekdayDate(next.date)}`,
        tone: 'neutral',
        icon: CalendarClock,
        href: `/trip/${trip.id}/itinerary`,
      });
    }

    /* Checklist */
    const progress = getChecklistProgress(checklist);
    const pending = progress.total - progress.completed;
    if (pending > 0 && status !== 'completed' && daysUntil <= 14) {
      alerts.push({
        id: 'checklist-pending',
        title: `${pending} ${pending === 1 ? 'item pendente' : 'itens pendentes'}`,
        message: 'Seu checklist ainda tem tarefas antes do embarque.',
        tone: pending > 4 ? 'warning' : 'neutral',
        icon: ListChecks,
        href: `/trip/${trip.id}/checklist`,
      });
    }

    /* Documents */
    if (tickets.length === 0 && status !== 'completed' && daysUntil <= 14) {
      alerts.push({
        id: 'tickets-missing',
        title: 'Nenhum documento salvo',
        message: 'Guarde passagens e reservas para acessá-las mesmo sem internet.',
        tone: 'warning',
        icon: TicketX,
        href: `/trip/${trip.id}/tickets`,
      });
    }

    return alerts;
  }, [trip, expenses, itinerary, checklist, tickets]);
}
