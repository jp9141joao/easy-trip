import { parseMoneyInput } from '@/lib/currency';
import {
  BackendCapabilityError,
  describeBackendCapability,
  isBackendAuthorizationError,
  isBackendCapabilityError,
} from '@/repositories/backendCapabilities';
import { supabaseDataSource } from '@/repositories/supabase/SupabaseDataSource';

/**
 * Salvar a meta diária — o caminho de gravação inteiro.
 *
 * O DEFEITO MEDIDO
 *
 * "BRL 500,00 → Salvar" respondia "Não foi possível salvar a meta diária." A
 * causa não estava no valor nem no formulário: o projeto remoto não tem a coluna
 * `trips.daily_spending_goal` (migration 0013, nunca publicada), e o PostgREST
 * recusa o `update` com `42703 column trips.daily_spending_goal does not exist`.
 *
 * `trips.update` classificava isso como erro comum, e a tela traduzia o erro
 * comum na única frase que sabia dizer. O código do backend — a única
 * informação capaz de apontar a migration — morria no `unwrap`.
 *
 * O que estes testes fixam, então, são duas coisas diferentes:
 *
 *   1. O payload está CORRETO (número, moeda do orçamento, `null` para remover).
 *      Publicada a 0013, isto grava. Não havia nada a consertar aqui, e é
 *      justamente por isso que precisa de teste: para que a próxima
 *      investigação não recomece pelo parser.
 *   2. A ausência da coluna é RECONHECÍVEL e chega à tela dizendo o que é, em
 *      vez de se disfarçar de falha genérica ou de falta de permissão.
 */

const mockSingle = jest.fn();
const mockSelect = jest.fn(() => ({ single: mockSingle }));
const mockEq = jest.fn(() => ({ select: mockSelect }));
const mockUpdate = jest.fn((_payload: Record<string, unknown>) => ({ eq: mockEq }));
const mockFrom = jest.fn((_relation: string) => ({ update: mockUpdate }));

jest.mock('@/repositories/supabase/client', () => ({
  getSupabaseClient: () => ({ from: mockFrom }),
}));

/** A linha que o PostgREST devolveria num servidor com a 0013 aplicada. */
const row = (goal: string | null) => ({
  id: 'trip-1',
  user_id: 'user-1',
  destination_city: 'Tóquio',
  destination_country: 'Japão',
  country_code: 'JP',
  timezone: 'Asia/Tokyo',
  start_date: '2026-10-01',
  end_date: '2026-10-10',
  budget_total: '9000.00',
  budget_currency: 'BRL',
  daily_spending_goal: goal,
  created_at: '2026-09-01T10:00:00.000Z',
  updated_at: '2026-09-01T10:00:00.000Z',
});

const payload = () => mockUpdate.mock.calls[0][0];

beforeEach(() => {
  mockSingle.mockReset();
  mockSelect.mockClear();
  mockEq.mockClear();
  mockUpdate.mockClear();
  mockFrom.mockClear();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

/* ----------------------------- o parser monetário -------------------------- */

describe('a entrada monetária brasileira da meta diária', () => {
  /*
   * `Number('500,00')` é `NaN`, e é por isso que a tela não usa `Number`. O
   * `MoneyField` chama `parseMoneyInput`, que decide quem é separador de milhar
   * pela POSIÇÃO: o último separador é o decimal.
   */
  it.each([
    ['500,00', 500],
    ['1.000,00', 1000],
    ['1.500,50', 1500.5],
    ['500', 500],
    ['0,01', 0.01],
    ['1.234.567,89', 1234567.89],
  ])('lê %s como %p', (digitado, esperado) => {
    expect(parseMoneyInput(digitado)).toBe(esperado);
  });

  it('não produz NaN para campo vazio nem para texto inválido', () => {
    expect(parseMoneyInput('')).toBeNull();
    expect(parseMoneyInput('   ')).toBeNull();
    expect(parseMoneyInput('abc')).toBeNull();
    // O que sobrevive ao filtro nunca é `NaN`: ou é número, ou é `null`.
    for (const entrada of ['', 'abc', 'R$', '--', ',', '.']) {
      const lido = parseMoneyInput(entrada);
      expect(lido === null || Number.isFinite(lido)).toBe(true);
    }
  });

  it('o valor negativo chega negativo, para a tela poder recusá-lo', () => {
    // `DailyGoalCard` recusa `<= 0` antes de chamar o repositório, e o CHECK
    // `trips_daily_spending_goal_positive` (0013) recusaria de novo no banco.
    expect(parseMoneyInput('-50')).toBe(-50);
  });
});

/* --------------------------- o payload da gravação ------------------------- */

describe('o payload que a meta diária envia', () => {
  it('grava 500 como número na coluna daily_spending_goal', async () => {
    mockSingle.mockResolvedValue({ data: row('500.00'), error: null });

    const salva = await supabaseDataSource.trips.update('trip-1', { dailySpendingGoal: 500 });

    expect(mockFrom).toHaveBeenCalledWith('trips');
    expect(payload()).toMatchObject({ daily_spending_goal: 500 });
    expect(typeof payload().daily_spending_goal).toBe('number');
    // A leitura desfaz a string do `numeric` do PostgREST.
    expect(salva.dailySpendingGoal).toBe(500);
  });

  it('grava 1000 quando a pessoa digitou 1.000,00', async () => {
    mockSingle.mockResolvedValue({ data: row('1000.00'), error: null });

    const digitado = parseMoneyInput('1.000,00');
    await supabaseDataSource.trips.update('trip-1', { dailySpendingGoal: digitado! });

    expect(payload().daily_spending_goal).toBe(1000);
  });

  it('editar de 500 para 750 envia 750, e não um incremento', async () => {
    mockSingle.mockResolvedValue({ data: row('750.00'), error: null });

    const salva = await supabaseDataSource.trips.update('trip-1', { dailySpendingGoal: 750 });

    expect(payload().daily_spending_goal).toBe(750);
    expect(salva.dailySpendingGoal).toBe(750);
  });

  it('remover a meta grava null — e não "não mexer"', async () => {
    mockSingle.mockResolvedValue({ data: row(null), error: null });

    const salva = await supabaseDataSource.trips.update('trip-1', {
      dailySpendingGoal: undefined,
    });

    // `prune` descarta `undefined`; é o `in` de `fromTrip` que distingue "veio
    // vazio de propósito" de "não veio no patch".
    expect(payload()).toHaveProperty('daily_spending_goal', null);
    expect(salva.dailySpendingGoal).toBeUndefined();
  });

  it('um patch sem a meta não toca a coluna', async () => {
    mockSingle.mockResolvedValue({ data: row('500.00'), error: null });

    await supabaseDataSource.trips.update('trip-1', { budgetTotal: 12000 });

    expect(payload()).not.toHaveProperty('daily_spending_goal');
    expect(payload()).toMatchObject({ budget_total: 12000 });
  });

  it('não converte de moeda: a meta vai na moeda do orçamento', async () => {
    // O conversor da Carteira pode estar em BRL → JPY; a meta é da viagem e
    // acompanha `budget_currency`. Nada no payload menciona outra moeda.
    mockSingle.mockResolvedValue({ data: row('500.00'), error: null });

    await supabaseDataSource.trips.update('trip-1', { dailySpendingGoal: 500 });

    expect(payload().daily_spending_goal).toBe(500);
    expect(payload()).not.toHaveProperty('budget_currency');
  });
});

/* ------------------------ o servidor sem a migration ---------------------- */

describe('o servidor sem a coluna da 0013', () => {
  /** A resposta real do projeto remoto, verificada por leitura em 2026-09-09. */
  const colunaAusente = {
    code: '42703',
    message: 'column trips.daily_spending_goal does not exist',
    details: null,
    hint: null,
  };

  it('reconhece a ausência da coluna em vez de devolver falha genérica', async () => {
    mockSingle.mockResolvedValue({ data: null, error: colunaAusente });

    const erro = await supabaseDataSource.trips
      .update('trip-1', { dailySpendingGoal: 500 })
      .then(() => null)
      .catch((caught: unknown) => caught);

    expect(isBackendCapabilityError(erro)).toBe(true);
    expect((erro as BackendCapabilityError).code).toBe('MISSING_TRIP_GOAL_SCHEMA');
    // O diagnóstico do PostgREST sobrevive à classificação.
    expect((erro as BackendCapabilityError).backend?.code).toBe('42703');
  });

  it('a tela recebe uma frase que diz o que aconteceu', async () => {
    mockSingle.mockResolvedValue({ data: null, error: colunaAusente });

    const erro = await supabaseDataSource.trips
      .update('trip-1', { dailySpendingGoal: 500 })
      .then(() => null)
      .catch((caught: unknown) => caught);

    const mensagem = describeBackendCapability(erro);
    expect(mensagem).toBeDefined();
    expect(mensagem).toContain('não foi salvo');
    // Nem token, nem chave, nem nome de coluna na mensagem de produção.
    expect(mensagem).not.toContain('daily_spending_goal');
    expect(mensagem).not.toMatch(/apikey|authorization|bearer/i);
  });

  it('coluna ausente NÃO é interpretada como falta de permissão', async () => {
    mockSingle.mockResolvedValue({ data: null, error: colunaAusente });

    const erro = await supabaseDataSource.trips
      .update('trip-1', { dailySpendingGoal: 500 })
      .then(() => null)
      .catch((caught: unknown) => caught);

    // Confundir as duas mandaria procurar o problema no papel do membro.
    expect(isBackendAuthorizationError(erro)).toBe(false);
  });

  it('nada é persistido quando o backend recusa', async () => {
    mockSingle.mockResolvedValue({ data: null, error: colunaAusente });

    await expect(
      supabaseDataSource.trips.update('trip-1', { dailySpendingGoal: 500 }),
    ).rejects.toBeDefined();

    // A promise rejeita, então `useUpdateTrip.onSuccess` não roda e o cache não
    // é invalidado: a Carteira não passa a mostrar um valor que o banco não tem.
    expect(mockSingle).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------ RLS e papéis ------------------------------ */

describe('a recusa por RLS continua sendo recusa por RLS', () => {
  /*
   * `trips_update` (0008) exige `is_trip_owner`. Editor e viewer não gravam a
   * meta — e a resposta que recebem tem de continuar dizendo "permissão", nunca
   * "o servidor está atrasado".
   */
  it('42501 não vira capacidade ausente', async () => {
    mockSingle.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'new row violates row-level security policy for table "trips"' },
    });

    const erro = await supabaseDataSource.trips
      .update('trip-1', { dailySpendingGoal: 500 })
      .then(() => null)
      .catch((caught: unknown) => caught);

    expect(isBackendCapabilityError(erro)).toBe(false);
    expect(describeBackendCapability(erro)).toBeUndefined();
  });

  it('o update que a RLS filtra não devolve viagem alterada', async () => {
    // Com a policy barrando a linha, o `select` pós-update volta vazio e o
    // PostgREST responde 406 no `.single()`. O importante é que rejeite.
    mockSingle.mockResolvedValue({
      data: null,
      error: {
        code: 'PGRST116',
        message: 'JSON object requested, multiple (or no) rows returned',
      },
    });

    await expect(
      supabaseDataSource.trips.update('trip-1', { dailySpendingGoal: 500 }),
    ).rejects.toBeDefined();
  });
});
