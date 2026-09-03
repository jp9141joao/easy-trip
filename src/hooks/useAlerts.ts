import { useQueries } from '@tanstack/react-query';
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
  getDailyGoalStatus,
  getDaysUntilTrip,
  getNextActivities,
  getTripStatus,
  isOverBudget,
} from '@/domain/selectors';
import type {
  ChecklistItem,
  Expense,
  ISODate,
  ItineraryItem,
  Reservation,
  Trip,
} from '@/domain/types';
import { formatDateRange, formatWeekdayDate, todayISO } from '@/lib/date';
import { formatMoney } from '@/lib/currency';
import { dataSource } from '@/repositories';
import { queryKeys } from './queryKeys';
import { useTrips } from './useTrips';

export type AlertTone = 'brand' | 'warning' | 'error' | 'success' | 'neutral';

/**
 * A quem o aviso pertence.
 *
 * `trip`    — nasce de registros de UMA viagem e mostra de qual (§22);
 * `account` — é da conta e não tem viagem para citar (§23).
 *
 * A distinção existe para a tela não ser obrigada a inventar um rótulo de
 * viagem para algo que não tem uma. Hoje todo alerta derivado é `trip`; o campo
 * está aqui porque a primeira notificação de conta que virar alerta derivado vai
 * precisar dele, e descobrir isso na hora custaria mudar o tipo em cascata.
 */
export type AlertScope = 'trip' | 'account';

export interface DerivedAlert {
  /**
   * Estável e único: `${tripId}:${kind}`.
   *
   * O `tripId` no prefixo é o que impede colisão agora que a lista é global
   * (§26). Antes, com uma viagem só, `'budget-over'` bastava; com três viagens
   * estouradas, três avisos disputariam a mesma chave de lista e o React
   * mostraria um só.
   */
  id: string;
  title: string;
  message: string;
  tone: AlertTone;
  icon: LucideIcon;
  /** Route to open when the alert is tapped. */
  href?: string;
  scope: AlertScope;
  /** De qual viagem o aviso veio. Ausente em aviso de conta. */
  tripId?: string;
  /** "Tóquio · 18–27 set" — como a tela identifica a origem (§22). */
  tripLabel?: string;
  /** Faixa de urgência. Menor vem primeiro. Ver `PRIORITY`. */
  priority: number;
  /** A data a que o aviso se refere, quando há uma. Desempata dentro da faixa. */
  date?: ISODate;
}

/**
 * As quatro faixas de urgência (§25).
 *
 * A ordem é por QUANTO TEMPO A PESSOA TEM para agir, não por gravidade
 * abstrata e não pela viagem que está selecionada na Home. Um check-in que
 * fecha hoje em Tóquio importa mais do que um checklist pendente para uma
 * viagem que só começa em três semanas — mesmo que a viagem aberta seja a
 * segunda.
 */
const PRIORITY = {
  /** Já aconteceu e continua verdade: orçamento estourado, meta do dia furada. */
  urgent: 0,
  /** É hoje. */
  today: 1,
  /** Está chegando — dias, não semanas. */
  soon: 2,
  /** Vale saber, não tem prazo. */
  info: 3,
} as const;

/**
 * A central de avisos (§19–§26).
 *
 * O QUE MUDOU, E POR QUÊ
 *
 * Isto lia UMA viagem: a selecionada na Home, via `useCurrentTrip`. O efeito era
 * que um check-in de amanhã em Tóquio ficava invisível enquanto a pessoa
 * estivesse com São Paulo aberta — e ela não tinha como saber que existia algo
 * para ver, porque nem o ponto no sino aparecia.
 *
 * `selectedTrip` continua decidindo o que a Home DESTACA e em que viagem se
 * entra ao tocar no cartão (§20). Ela deixou de decidir o que a pessoa fica
 * sabendo. São duas perguntas diferentes, e uma resposta só estava servindo às
 * duas.
 *
 * PRIVACIDADE — GLOBAL NÃO É IRRESTRITO (§24)
 *
 * A lista de viagens vem de `useTrips`, que é a consulta com a policy
 * `trips_select` da 0008 atrás: ela devolve as viagens de que a pessoa é
 * membro, e nada além. Sair de uma viagem a tira dessa lista, e com ela somem
 * os avisos daquela viagem na atualização seguinte — não há caminho pelo qual um
 * aviso sobreviva à perda do acesso, porque não há aviso guardado em lugar
 * nenhum: todos são recalculados a cada leitura.
 *
 * O mesmo vale para as despesas e o roteiro de cada viagem: cada consulta passa
 * pela RLS da própria tabela, então uma despesa privada de outro membro nunca
 * entra na conta que gera o aviso.
 *
 * CUSTO (§48)
 *
 * São quatro consultas por viagem relevante, e não uma por registro — o N+1 que
 * importa evitar. As chaves são as MESMAS que as telas da viagem já usam
 * (`queryKeys.expenses(tripId)` e companhia), então abrir a Carteira depois de
 * ver o aviso não vai à rede de novo: o cache já está quente, e vice-versa.
 *
 * Viagem concluída fica de fora. Todas as regras abaixo já exigiam
 * `status !== 'completed'` ou uma janela de dias; consultar quatro tabelas de
 * uma viagem do ano passado seria rede gasta para produzir zero avisos.
 */
export function useAlerts(): DerivedAlert[] {
  const { data: trips = [] } = useTrips();

  const today = todayISO();

  const relevantes = useMemo(
    () => trips.filter((trip) => getTripStatus(trip, today) !== 'completed'),
    [trips, today],
  );

  const expenses = useQueries({
    queries: relevantes.map((trip) => ({
      queryKey: queryKeys.expenses(trip.id),
      queryFn: () => dataSource.expenses.listByTrip(trip.id),
    })),
  });
  const itineraries = useQueries({
    queries: relevantes.map((trip) => ({
      queryKey: queryKeys.itinerary(trip.id),
      queryFn: () => dataSource.itinerary.listByTrip(trip.id),
    })),
  });
  const checklists = useQueries({
    queries: relevantes.map((trip) => ({
      queryKey: queryKeys.checklist(trip.id),
      queryFn: () => dataSource.checklist.listByTrip(trip.id),
    })),
  });
  const reservations = useQueries({
    queries: relevantes.map((trip) => ({
      queryKey: queryKeys.tripReservations(trip.id),
      queryFn: () => dataSource.travelReservations.listByTrip(trip.id),
    })),
  });

  /*
   * `useQueries` devolve um array novo a cada render mesmo quando nada mudou.
   * Depender dele direto refaria a lista inteira em toda renderização da Home;
   * depender dos DADOS mantém o memo honesto — ele só reexecuta quando alguma
   * consulta realmente trouxe outra coisa.
   */
  const expenseData = expenses.map((query) => query.data);
  const itineraryData = itineraries.map((query) => query.data);
  const checklistData = checklists.map((query) => query.data);
  const reservationData = reservations.map((query) => query.data);

  /*
   * As assinaturas dos dados, em texto.
   *
   * O `useMemo` precisa reagir ao CONTEÚDO das consultas, e os arrays acima são
   * novos a cada render. Extraídas para constantes porque o lint exige
   * dependências estaticamente verificáveis — e porque a intenção fica dita:
   * "recalcule quando algum destes conjuntos mudar de verdade".
   */
  const expenseKey = JSON.stringify(expenseData);
  const itineraryKey = JSON.stringify(itineraryData);
  const checklistKey = JSON.stringify(checklistData);
  const reservationKey = JSON.stringify(reservationData);

  return useMemo(() => {
    const alerts: DerivedAlert[] = [];

    relevantes.forEach((trip, index) => {
      alerts.push(
        ...alertsForTrip(trip, today, {
          expenses: (expenseData[index] as Expense[] | undefined) ?? [],
          itinerary: (itineraryData[index] as ItineraryItem[] | undefined) ?? [],
          checklist: (checklistData[index] as ChecklistItem[] | undefined) ?? [],
          reservations: (reservationData[index] as Reservation[] | undefined) ?? [],
        }),
      );
    });

    return sortAlerts(dedupe(alerts));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relevantes, today, expenseKey, itineraryKey, checklistKey, reservationKey]);
}

/* ------------------------------ identificação ----------------------------- */

/**
 * Como o aviso diz de onde veio: "Tóquio · 18–27 set" (§22).
 *
 * Cidade e não país, porque é a cidade que nomeia a viagem em todo o resto do
 * aplicativo — o cartão da Home, o hero, o título da aba. As datas entram
 * porque duas viagens para a mesma cidade em meses diferentes existem, e sem
 * elas os dois avisos seriam indistinguíveis.
 */
function tripLabel(trip: Trip): string {
  return `${trip.destinationCity} · ${formatDateRange(trip.startDate, trip.endDate)}`;
}

/* ------------------------------- as regras -------------------------------- */

interface TripRecords {
  expenses: Expense[];
  itinerary: ItineraryItem[];
  checklist: ChecklistItem[];
  reservations: Reservation[];
}

/**
 * Os avisos de UMA viagem.
 *
 * Extraído do hook para ser função pura: recebe registros, devolve avisos, sem
 * React no meio. É o que permite testar as regras — inclusive a da meta diária,
 * que aparece e some conforme a despesa muda — sem montar tela nenhuma.
 */
export function alertsForTrip(trip: Trip, today: ISODate, records: TripRecords): DerivedAlert[] {
  const alerts: DerivedAlert[] = [];
  const status = getTripStatus(trip, today);
  const daysUntil = getDaysUntilTrip(trip, today);
  const label = tripLabel(trip);

  const push = (alert: Omit<DerivedAlert, 'scope' | 'tripId' | 'tripLabel' | 'id'> & { kind: string }) => {
    const { kind, ...rest } = alert;
    alerts.push({ ...rest, id: `${trip.id}:${kind}`, scope: 'trip', tripId: trip.id, tripLabel: label });
  };

  /* Orçamento total */
  if (isOverBudget(records.expenses, trip)) {
    push({
      kind: 'budget-over',
      title: 'Orçamento excedido',
      message: `Seus gastos em ${trip.destinationCity} ultrapassaram o orçamento planejado.`,
      tone: 'error',
      icon: AlertTriangle,
      href: `/trip/${trip.id}/finance`,
      priority: PRIORITY.urgent,
    });
  } else {
    const usage = getBudgetUsagePercent(records.expenses, trip);
    if (usage >= 80) {
      push({
        kind: 'budget-near',
        title: 'Orçamento perto do limite',
        message: `Você já usou ${Math.round(usage)}% do orçamento de ${trip.destinationCity}.`,
        tone: 'warning',
        icon: Wallet,
        href: `/trip/${trip.id}/finance`,
        priority: PRIORITY.info,
      });
    }
  }

  /*
   * Meta diária estourada (§34–§36).
   *
   * DERIVADO, E NÃO UMA LINHA NO BANCO — de propósito.
   *
   * Gravar uma notificação quando a meta estoura criaria duas obrigações que
   * ninguém cumpriria bem: não gravar de novo a cada render, e APAGAR quando a
   * pessoa corrigisse a despesa. Como aviso derivado, as duas saem de graça:
   * a chave `${tripId}:daily-goal:${data}` é estável, então o mesmo dia nunca
   * gera dois avisos; e no instante em que a despesa é editada para baixo a
   * condição deixa de ser verdadeira e o aviso simplesmente não é mais
   * produzido (§36).
   *
   * Só o DIA DE HOJE vira aviso. Um dia passado que estourou é história — está
   * na Carteira, na lista por data, e não há o que fazer a respeito. Um aviso
   * por dia estourado encheria a central de coisas sobre as quais não se pode
   * agir, que é como um badge deixa de ser lido.
   */
  const goalToday = getDailyGoalStatus(records.expenses, trip, today);
  if (goalToday.exceeded && goalToday.goal !== undefined) {
    push({
      kind: `daily-goal:${today}`,
      title: 'Meta diária ultrapassada',
      message:
        `Hoje em ${trip.destinationCity}: ${formatMoney(goalToday.spent, trip.budgetCurrency)} ` +
        `de ${formatMoney(goalToday.goal, trip.budgetCurrency)} — ` +
        `${formatMoney(goalToday.over, trip.budgetCurrency)} acima da meta.`,
      tone: 'error',
      icon: Wallet,
      href: `/trip/${trip.id}/finance`,
      priority: PRIORITY.urgent,
      date: today,
    });
  }

  /* A viagem se aproxima */
  if (status === 'upcoming' && daysUntil >= 0 && daysUntil <= 7) {
    push({
      kind: 'trip-soon',
      title: daysUntil === 0 ? 'Sua viagem começa hoje' : `Faltam ${daysUntil} dias`,
      message: `${trip.destinationCity}, ${trip.destinationCountry} está chegando.`,
      tone: 'brand',
      icon: PlaneTakeoff,
      href: `/trip/${trip.id}`,
      priority: daysUntil === 0 ? PRIORITY.today : PRIORITY.soon,
      date: trip.startDate,
    });
  }

  /*
   * Próxima atividade
   *
   * As DUAS variantes exigem `status !== 'completed'` (§20). A de hoje exigia
   * só `next.date === today`, o que parecia bastar — uma viagem concluída
   * terminou ANTES de hoje, então ela não teria atividade hoje. Só que a data
   * de fim se edita: encurtar a viagem depois de montar o roteiro deixa para
   * trás atividades fora do novo intervalo, e uma delas datada de hoje voltava
   * a virar "Atividade hoje" numa viagem já encerrada. O aviso derivado
   * respeita o estado da viagem, e não só a data do registro.
   */
  const [next] = getNextActivities(records.itinerary, 1, today);
  if (next && next.date === today && status !== 'completed') {
    push({
      kind: `activity-${next.id}`,
      title: 'Atividade hoje',
      message: `${next.startTime ? `${next.startTime} — ` : ''}${next.title}`,
      tone: 'brand',
      icon: CalendarClock,
      href: `/trip/${trip.id}/itinerary`,
      priority: PRIORITY.today,
      date: next.date,
    });
  } else if (next && status !== 'completed') {
    push({
      kind: `activity-${next.id}`,
      title: 'Próxima atividade',
      message: `${next.title} · ${formatWeekdayDate(next.date)}`,
      tone: 'neutral',
      icon: CalendarClock,
      href: `/trip/${trip.id}/itinerary`,
      priority: PRIORITY.soon,
      date: next.date,
    });
  }

  /* Checklist */
  const progress = getChecklistProgress(records.checklist);
  const pending = progress.total - progress.completed;
  if (pending > 0 && status !== 'completed' && daysUntil <= 14) {
    push({
      kind: 'checklist-pending',
      title: `${pending} ${pending === 1 ? 'item pendente' : 'itens pendentes'}`,
      message: 'Seu checklist ainda tem tarefas antes do embarque.',
      tone: pending > 4 ? 'warning' : 'neutral',
      icon: ListChecks,
      href: `/trip/${trip.id}/checklist`,
      priority: PRIORITY.soon,
      date: trip.startDate,
    });
  }

  /* Documentos */
  if (records.reservations.length === 0 && status !== 'completed' && daysUntil <= 14) {
    push({
      kind: 'reservations-missing',
      title: 'Nenhuma reserva salva',
      message: 'Guarde voos, hospedagens e ingressos para acessá-los mesmo sem internet.',
      tone: 'warning',
      icon: TicketX,
      href: `/trip/${trip.id}/reservations`,
      priority: PRIORITY.info,
      date: trip.startDate,
    });
  }

  return alerts;
}

/* ------------------------------ ordem e dedupe ---------------------------- */

/**
 * Um aviso por chave (§26).
 *
 * As chaves já nascem únicas por construção — `${tripId}:${kind}` —, e este
 * filtro é a rede embaixo: se um dia duas regras produzirem o mesmo `kind` para
 * a mesma viagem, a lista mostra um em vez de duas linhas idênticas com a mesma
 * `key` de React.
 *
 * Não há dedupe CONTRA as notificações persistidas, e é deliberado: a central
 * mantém as duas listas separadas porque elas respondem a perguntas diferentes
 * — o que aconteceu e tem estado de lido, e o que está acontecendo agora e some
 * sozinho. Cruzá-las exigiria decidir qual das duas apagar, e apagar a
 * persistida quebraria o badge.
 */
function dedupe(alerts: DerivedAlert[]): DerivedAlert[] {
  const seen = new Set<string>();
  return alerts.filter((alert) => {
    if (seen.has(alert.id)) return false;
    seen.add(alert.id);
    return true;
  });
}

/**
 * Faixa de urgência, depois data, depois a chave.
 *
 * A viagem NÃO entra na ordenação (§25). Ordenar pela selecionada devolveria
 * pela porta dos fundos o defeito que este arquivo acabou de consertar: a lista
 * mudaria de ordem ao trocar o cartão da Home, e o topo deixaria de ser o mais
 * urgente para ser o mais próximo do dedo.
 *
 * A chave no fim é o desempate estável — sem ela, dois avisos de mesma faixa e
 * mesma data trocariam de lugar entre renderizações.
 */
function sortAlerts(alerts: DerivedAlert[]): DerivedAlert[] {
  return [...alerts].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.date && b.date && a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.date && !b.date) return -1;
    if (!a.date && b.date) return 1;
    return a.id < b.id ? -1 : 1;
  });
}
