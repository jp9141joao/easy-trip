import {
  getDailyGoalStatus,
  getDailySpend,
  getExceededGoalDays,
  getSpendOnDate,
} from '@/domain/selectors';
import type { Expense, Trip } from '@/domain/types';

/**
 * A meta de gasto diário (§27–§36, §62, §63 do handoff).
 *
 * A REGRA QUE ESTA SUÍTE PROTEGE: a meta usa a MESMA aritmética da Carteira.
 *
 * Nada aqui recalcula câmbio nem inventa rateio. Uma despesa vale o que
 * `getExpenseValueInBudgetCurrency` diz que ela vale — o mesmo valor que entra
 * no saldo total mostrado dois cartões acima. Se a meta somasse um conjunto
 * diferente, os dois números da mesma tela discordariam e nenhum seria
 * explicável.
 */

const trip = (patch: Partial<Trip> = {}): Trip => ({
  id: 't1',
  userId: 'u1',
  destinationCity: 'Tóquio',
  destinationCountry: 'Japão',
  countryCode: 'JP',
  timezone: 'Asia/Tokyo',
  startDate: '2026-08-26',
  endDate: '2026-09-05',
  budgetTotal: 10000,
  budgetCurrency: 'BRL',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  ...patch,
});

let seq = 0;
const expense = (transactionDate: string, amount: number, patch: Partial<Expense> = {}): Expense => ({
  id: `e${(seq += 1)}`,
  tripId: 't1',
  userId: 'u1',
  category: 'alimentacao',
  amount,
  currency: 'BRL',
  transactionDate,
  description: 'Almoço',
  createdAt: '2026-08-27T12:00:00.000Z',
  visibility: 'shared',
  ...patch,
});

beforeEach(() => {
  seq = 0;
});

describe('o ciclo da meta diária (§62)', () => {
  const meta = trip({ dailySpendingGoal: 300 });

  it('soma o dia e reconhece que está dentro da meta', () => {
    const expenses = [expense('2026-08-27', 100), expense('2026-08-27', 120)];
    const status = getDailyGoalStatus(expenses, meta, '2026-08-27');

    expect(status.spent).toBe(220);
    expect(status.goal).toBe(300);
    expect(status.remaining).toBe(80);
    expect(status.over).toBe(0);
    expect(status.exceeded).toBe(false);
  });

  it('acusa o excesso, com o valor exato acima da meta', () => {
    const expenses = [expense('2026-08-27', 100), expense('2026-08-27', 120), expense('2026-08-27', 100)];
    const status = getDailyGoalStatus(expenses, meta, '2026-08-27');

    expect(status.spent).toBe(320);
    expect(status.over).toBe(20);
    expect(status.exceeded).toBe(true);
    // Negativo, nunca achatado em zero — esconder o excesso seria o defeito.
    expect(status.remaining).toBe(-20);
  });

  it('volta a ficar dentro da meta quando a despesa é reduzida (§36)', () => {
    // 100 + 120 + 100 = 320, estourado. Editando o último para 50: 270.
    const depois = [expense('2026-08-27', 100), expense('2026-08-27', 120), expense('2026-08-27', 50)];
    const status = getDailyGoalStatus(depois, meta, '2026-08-27');

    expect(status.spent).toBe(270);
    expect(status.exceeded).toBe(false);
    expect(getExceededGoalDays(depois, meta)).toEqual([]);
  });
});

describe('cada dia é independente (§63)', () => {
  const meta = trip({ dailySpendingGoal: 300 });
  const expenses = [
    expense('2026-08-27', 320),
    expense('2026-08-28', 100),
    expense('2026-08-29', 180),
  ];

  it('não mistura os totais de dias diferentes', () => {
    expect(getSpendOnDate(expenses, meta, '2026-08-27')).toBe(320);
    expect(getSpendOnDate(expenses, meta, '2026-08-28')).toBe(100);
    expect(getSpendOnDate(expenses, meta, '2026-08-29')).toBe(180);
  });

  it('estourar num dia não contamina o seguinte', () => {
    expect(getDailyGoalStatus(expenses, meta, '2026-08-27').exceeded).toBe(true);
    expect(getDailyGoalStatus(expenses, meta, '2026-08-28').exceeded).toBe(false);
    // 100 no dia 28 deixa 200 disponíveis — e não 200 menos o estouro do 27.
    expect(getDailyGoalStatus(expenses, meta, '2026-08-28').remaining).toBe(200);
  });

  it('lista só os dias que estouraram, do mais recente para o mais antigo', () => {
    const cheios = [...expenses, expense('2026-08-29', 200)]; // 29 vira 380
    const dias = getExceededGoalDays(cheios, meta);

    expect(dias.map((d) => d.date)).toEqual(['2026-08-29', '2026-08-27']);
    expect(dias.map((d) => d.over)).toEqual([80, 20]);
  });

  it('agrupa por data em ordem cronológica', () => {
    expect(getDailySpend(expenses, meta)).toEqual([
      { date: '2026-08-27', spent: 320 },
      { date: '2026-08-28', spent: 100 },
      { date: '2026-08-29', spent: 180 },
    ]);
  });

  it('um dia sem despesa vale zero, não vira linha inventada', () => {
    expect(getSpendOnDate(expenses, meta, '2026-08-30')).toBe(0);
    expect(getDailySpend(expenses, meta).map((d) => d.date)).not.toContain('2026-08-30');
  });
});

describe('viagem sem meta', () => {
  it('ainda soma o dia, mas não tem contra o que comparar', () => {
    const status = getDailyGoalStatus([expense('2026-08-27', 500)], trip(), '2026-08-27');

    expect(status.spent).toBe(500);
    expect(status.goal).toBeUndefined();
    expect(status.remaining).toBeUndefined();
    expect(status.exceeded).toBe(false);
  });

  it('meta zero é ausência de meta, não "não gaste nada"', () => {
    // Um campo esvaziado que virasse 0 faria o primeiro café estourar a meta de
    // quem tinha acabado de desistir do recurso.
    const status = getDailyGoalStatus([expense('2026-08-27', 1)], trip({ dailySpendingGoal: 0 }), '2026-08-27');

    expect(status.exceeded).toBe(false);
    expect(getExceededGoalDays([expense('2026-08-27', 1)], trip({ dailySpendingGoal: 0 }))).toEqual([]);
  });
});

describe('a semântica é a da Carteira (§31)', () => {
  const meta = trip({ dailySpendingGoal: 300 });

  it('usa o valor convertido e GRAVADO da despesa em outra moeda', () => {
    // 5.000 ienes convertidos e gravados como 190 reais no dia do lançamento.
    // A meta conta 190, não 5.000 — e não vai buscar cotação de hoje (§41).
    const expenses = [
      expense('2026-08-27', 5000, {
        currency: 'JPY',
        amountInBudgetCurrency: 190,
        exchangeRate: 0.038,
      }),
    ];

    expect(getSpendOnDate(expenses, meta, '2026-08-27')).toBe(190);
    expect(getDailyGoalStatus(expenses, meta, '2026-08-27').exceeded).toBe(false);
  });

  it('conta despesa privada e compartilhada igual — quem filtra é a RLS', () => {
    // A lista que chega já é a que a pessoa pode ver. Aplicar um segundo filtro
    // aqui criaria uma soma diferente da que o cartão de saldo mostra.
    const expenses = [
      expense('2026-08-27', 200, { visibility: 'shared' }),
      expense('2026-08-27', 150, { visibility: 'private' }),
    ];

    expect(getSpendOnDate(expenses, meta, '2026-08-27')).toBe(350);
    expect(getDailyGoalStatus(expenses, meta, '2026-08-27').over).toBe(50);
  });
});
