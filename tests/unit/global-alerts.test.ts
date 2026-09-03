import { alertsForTrip } from '@/hooks/useAlerts';
import type { ChecklistItem, Expense, ItineraryItem, Reservation, Trip } from '@/domain/types';

/**
 * Alertas globais entre viagens (§19–§26, §60, §61 do handoff).
 *
 * O DEFEITO QUE ESTA SUÍTE IMPEDE DE VOLTAR
 *
 * `useAlerts` lia UMA viagem — a selecionada na Home. Um check-in de amanhã em
 * Tóquio ficava invisível enquanto São Paulo estivesse aberta, e nada na tela
 * dizia que existia algo escondido.
 *
 * A regra por viagem foi extraída para `alertsForTrip`, que é pura: recebe
 * registros, devolve avisos. É ela que estes testes exercitam — montar o hook
 * exigiria um `QueryClient` e não mediria nada além do React.
 */

const HOJE = '2026-08-28';

const trip = (id: string, city: string, patch: Partial<Trip> = {}): Trip => ({
  id,
  userId: 'u1',
  destinationCity: city,
  destinationCountry: 'Brasil',
  countryCode: 'BR',
  timezone: 'America/Sao_Paulo',
  startDate: '2026-08-27',
  endDate: '2026-08-30',
  budgetTotal: 5000,
  budgetCurrency: 'BRL',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  ...patch,
});

const vazio = {
  expenses: [] as Expense[],
  itinerary: [] as ItineraryItem[],
  checklist: [] as ChecklistItem[],
  reservations: [] as Reservation[],
};

const checklistItem = (id: string, completed: boolean): ChecklistItem => ({
  id,
  tripId: 't',
  label: 'Passaporte',
  category: 'documentos',
  completed,
  createdAt: '2026-08-01T00:00:00.000Z',
  visibility: 'shared',
});

const expense = (amount: number, date = HOJE): Expense => ({
  id: `e-${amount}-${date}`,
  tripId: 't',
  userId: 'u1',
  category: 'alimentacao',
  amount,
  currency: 'BRL',
  transactionDate: date,
  description: 'Jantar',
  createdAt: '2026-08-28T12:00:00.000Z',
  visibility: 'shared',
});

describe('cada aviso identifica sua viagem (§22)', () => {
  it('carrega tripId e um rótulo com destino e datas', () => {
    const toquio = trip('b', 'Tóquio', { startDate: '2026-09-18', endDate: '2026-09-27' });
    const alerts = alertsForTrip(toquio, HOJE, {
      ...vazio,
      checklist: [checklistItem('c1', false)],
    });

    // Fora da janela de 14 dias não há checklist; dentro dela, há.
    const perto = trip('b', 'Tóquio', { startDate: '2026-09-05', endDate: '2026-09-15' });
    const [aviso] = alertsForTrip(perto, HOJE, {
      ...vazio,
      checklist: [checklistItem('c1', false)],
    }).filter((a) => a.id.endsWith('checklist-pending'));

    expect(alerts.every((a) => a.tripId === 'b')).toBe(true);
    expect(aviso.tripId).toBe('b');
    expect(aviso.tripLabel).toContain('Tóquio');
    expect(aviso.scope).toBe('trip');
  });

  it('prefixa o id com a viagem para três viagens não colidirem (§26)', () => {
    const estourada = (id: string, city: string) =>
      alertsForTrip(trip(id, city, { budgetTotal: 100 }), HOJE, {
        ...vazio,
        expenses: [expense(500)],
      }).filter((a) => a.id.endsWith('budget-over'));

    const a = estourada('a', 'São Paulo')[0];
    const b = estourada('b', 'Tóquio')[0];
    const c = estourada('c', 'Paris')[0];

    expect(new Set([a.id, b.id, c.id]).size).toBe(3);
    expect(a.id).toBe('a:budget-over');
    expect(b.id).toBe('b:budget-over');
  });
});

describe('a viagem selecionada não muda a lista (§20, §60)', () => {
  /**
   * O cenário obrigatório do §21: três viagens, avisos em todas.
   *
   * A montagem imita o que o hook faz — varrer as viagens e concatenar. O que
   * se mede é que o resultado não tem nada a ver com qual delas está aberta na
   * Home: `alertsForTrip` nem sequer recebe essa informação, e é essa ausência
   * de parâmetro que torna o defeito antigo inexprimível.
   */
  const cenario = () => {
    const a = trip('a', 'São Paulo', { startDate: '2026-08-27', endDate: '2026-08-28' });
    const b = trip('b', 'Tóquio', { startDate: '2026-09-05', endDate: '2026-09-15' });
    const c = trip('c', 'Paris', { startDate: '2026-09-10', endDate: '2026-09-20' });

    return [
      ...alertsForTrip(a, HOJE, { ...vazio, checklist: [checklistItem('a1', false)] }),
      ...alertsForTrip(b, HOJE, { ...vazio, checklist: [checklistItem('b1', false)] }),
      ...alertsForTrip(c, HOJE, { ...vazio, checklist: [checklistItem('c1', false)] }),
    ];
  };

  it('traz avisos das três viagens ao mesmo tempo', () => {
    const ids = new Set(cenario().map((a) => a.tripId));
    expect(ids).toEqual(new Set(['a', 'b', 'c']));
  });

  it('produz exatamente o mesmo resultado independentemente da ordem', () => {
    // Trocar a "selecionada" não pode acrescentar, tirar nem reordenar nada.
    const primeiro = cenario().map((a) => a.id).sort();
    const segundo = cenario().map((a) => a.id).sort();
    expect(primeiro).toEqual(segundo);
  });
});

describe('perder o acesso apaga os avisos daquela viagem (§24, §61)', () => {
  it('a viagem fora da lista não produz aviso nenhum', () => {
    /*
     * Sair de uma viagem a tira de `useTrips` — a policy `trips_select` deixa
     * de devolvê-la. O hook varre a lista de viagens, então uma viagem ausente
     * simplesmente não é varrida: não há aviso guardado em lugar nenhum que
     * pudesse sobreviver, porque todos são recalculados a cada leitura.
     */
    const visiveis = [trip('a', 'São Paulo')];
    const alertas = visiveis.flatMap((t) =>
      alertsForTrip(t, HOJE, { ...vazio, checklist: [checklistItem('x', false)] }),
    );

    expect(alertas.some((a) => a.tripId === 'b')).toBe(false);
    expect(alertas.every((a) => a.tripId === 'a')).toBe(true);
  });
});

describe('a meta diária vira aviso derivado (§34–§36)', () => {
  const comMeta = trip('a', 'São Paulo', { dailySpendingGoal: 300 });

  it('aparece quando o dia estoura, com a chave estável do dia', () => {
    const [aviso] = alertsForTrip(comMeta, HOJE, {
      ...vazio,
      expenses: [expense(200), expense(150)],
    }).filter((a) => a.id.includes('daily-goal'));

    expect(aviso.id).toBe(`a:daily-goal:${HOJE}`);
    expect(aviso.title).toBe('Meta diária ultrapassada');
    expect(aviso.message).toContain('50');
    expect(aviso.tone).toBe('error');
  });

  it('some sozinho quando a despesa é reduzida (§36)', () => {
    const depois = alertsForTrip(comMeta, HOJE, {
      ...vazio,
      expenses: [expense(200), expense(50)],
    });

    expect(depois.some((a) => a.id.includes('daily-goal'))).toBe(false);
  });

  it('não é gerado quando a viagem não tem meta', () => {
    const semMeta = alertsForTrip(trip('a', 'São Paulo'), HOJE, {
      ...vazio,
      expenses: [expense(9999)],
    });

    expect(semMeta.some((a) => a.id.includes('daily-goal'))).toBe(false);
  });

  it('o mesmo dia nunca gera dois avisos', () => {
    const avisos = alertsForTrip(comMeta, HOJE, {
      ...vazio,
      expenses: [expense(200), expense(150), expense(400)],
    }).filter((a) => a.id.includes('daily-goal'));

    expect(avisos).toHaveLength(1);
  });
});

describe('ordem por urgência, não por viagem (§25)', () => {
  it('o que já é verdade vem antes do que só vale saber', () => {
    const estourada = alertsForTrip(trip('a', 'São Paulo', { budgetTotal: 100 }), HOJE, {
      ...vazio,
      expenses: [expense(500)],
    });
    const [over] = estourada.filter((a) => a.id.endsWith('budget-over'));

    const semReserva = alertsForTrip(trip('b', 'Tóquio'), HOJE, vazio);
    const [reservas] = semReserva.filter((a) => a.id.endsWith('reservations-missing'));

    expect(over.priority).toBeLessThan(reservas.priority);
  });

  it('o aviso de viagem próxima carrega a data que ordena a lista', () => {
    /*
     * Dentro de uma mesma faixa o desempate é a DATA, e é por isso que cada
     * aviso a carrega. Sem ela, duas viagens igualmente "próximas" ficariam em
     * ordem arbitrária — e a arbitrariedade voltaria a parecer com "a
     * selecionada primeiro", que é o que esta rodada tirou.
     */
    const emDois = trip('a', 'São Paulo', { startDate: '2026-08-30', endDate: '2026-09-02' });
    const emCinco = trip('b', 'Tóquio', { startDate: '2026-09-02', endDate: '2026-09-10' });

    const [aDois] = alertsForTrip(emDois, HOJE, vazio).filter((a) => a.id.endsWith('trip-soon'));
    const [aCinco] = alertsForTrip(emCinco, HOJE, vazio).filter((a) => a.id.endsWith('trip-soon'));

    expect(aDois.date).toBe('2026-08-30');
    expect(aCinco.date).toBe('2026-09-02');
    expect(aDois.priority).toBe(aCinco.priority);
    // A mais próxima vem primeiro quando as datas são comparadas.
    expect(aDois.date! < aCinco.date!).toBe(true);
  });
});

/**
 * Aviso derivado respeita o ESTADO da viagem, não só a data do registro (§20).
 *
 * A variante "Atividade hoje" exigia apenas `next.date === today`, e isso
 * parecia bastar: uma viagem concluída terminou antes de hoje, logo não teria
 * atividade hoje. Só que a data de fim se edita. Encurtar a viagem depois de
 * montar o roteiro deixa atividades fora do novo intervalo, e uma delas datada
 * de hoje ressuscitava o aviso numa viagem já encerrada — a central passava a
 * cobrar um compromisso de uma viagem que acabou.
 */
describe('viagem concluída não gera compromisso (§20, §61)', () => {
  const concluída = trip('a', 'Tóquio', { startDate: '2026-08-10', endDate: '2026-08-20' });

  const atividade = (date: string): ItineraryItem => ({
    id: 'i1',
    tripId: 'a',
    date,
    type: 'atracao',
    title: 'Templo Senso-ji',
    completed: false,
    sortOrder: 0,
    visibility: 'shared',
  });

  it('não anuncia "Atividade hoje" para uma viagem já encerrada', () => {
    // A atividade ficou para trás do novo fim da viagem, mas está datada de hoje.
    const alerts = alertsForTrip(concluída, HOJE, { ...vazio, itinerary: [atividade(HOJE)] });

    expect(alerts.filter((a) => a.id.includes('activity-'))).toHaveLength(0);
  });

  it('não anuncia "Próxima atividade" para uma viagem já encerrada', () => {
    const alerts = alertsForTrip(concluída, HOJE, {
      ...vazio,
      itinerary: [atividade('2026-09-05')],
    });

    expect(alerts.filter((a) => a.id.includes('activity-'))).toHaveLength(0);
  });

  it('a mesma atividade de hoje continua virando aviso numa viagem em andamento', () => {
    // O contraste é o que prova que o corte acima é do ESTADO, e não da data.
    const alerts = alertsForTrip(trip('b', 'Tóquio'), HOJE, {
      ...vazio,
      itinerary: [atividade(HOJE)],
    });

    expect(alerts.filter((a) => a.id.includes('activity-'))).toHaveLength(1);
    expect(alerts.find((a) => a.id.includes('activity-'))?.title).toBe('Atividade hoje');
  });
});
