import { parseAIActions, type AITripAction } from '@/domain/aiActions';
import type { Trip } from '@/domain/types';
import { localDataSource } from '@/repositories/local/LocalDataSource';
import { BackendCapabilityError } from '@/repositories/backendCapabilities';
import type { DataSource } from '@/repositories/types';
import {
  buildAIActionErrorDiagnostic,
  executeAIActions,
  undoAIActions,
} from '@/services/aiActionExecutor';

/**
 * A gravação propriamente dita.
 *
 * Duas coisas são medidas aqui e não em outro lugar: **o que entra no banco** e
 * **o que o usuário é informado que entrou**. A segunda importa tanto quanto a
 * primeira — um executor que grava metade e devolve "ok" é pior do que um que
 * falha inteiro, porque a pessoa fecha a tela confiando (§24).
 *
 * Roda contra o `LocalDataSource` real, que é o mesmo caminho de código do modo
 * demonstração (§29): as ações da IA persistem pelo adaptador local sem nenhum
 * desvio de "se for local, finge que salvou".
 */

const db = localDataSource;
const USER_A = 'user-exec-a';
const USER_B = 'user-exec-b';

let paris: Trip;
let toquio: Trip;

beforeEach(async () => {
  await db.purgeUserData(USER_A);
  await db.purgeUserData(USER_B);

  paris = await db.trips.create({
    userId: USER_A,
    destinationCity: 'Paris',
    destinationCountry: 'França',
    countryCode: 'FR',
    timezone: 'Europe/Paris',
    startDate: '2026-08-22',
    endDate: '2026-08-31',
    budgetTotal: 30000,
    budgetCurrency: 'BRL',
  });

  toquio = await db.trips.create({
    userId: USER_B,
    destinationCity: 'Tóquio',
    destinationCountry: 'Japão',
    countryCode: 'JP',
    timezone: 'Asia/Tokyo',
    startDate: '2026-09-18',
    endDate: '2026-09-27',
    budgetTotal: 45000,
    budgetCurrency: 'BRL',
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

const ctx = (trip: Trip, userId: string) => ({ trip, userId, source: db });

describe('roteiro', () => {
  it('grava os itens propostos e o roteiro real passa a contê-los', async () => {
    const actions = parseAIActions(
      [
        {
          type: 'itinerary.add',
          label: 'Adicionar ao roteiro',
          items: [
            { title: 'Museu do Louvre', date: '2026-08-23', startTime: '09:00', type: 'atracao' },
            { title: 'Almoço', date: '2026-08-23', startTime: '12:30', type: 'refeicao' },
            { title: 'Torre Eiffel', date: '2026-08-23', startTime: '18:00', type: 'atracao' },
          ],
        },
      ],
      paris,
    );

    const report = await executeAIActions(actions, ctx(paris, USER_A));

    expect(report.ok).toBe(true);
    expect(report.outcomes[0].summary).toBe('3 itens adicionados ao roteiro');

    const itinerary = await db.itinerary.listByTrip(paris.id);
    expect(itinerary.map((item) => item.title).sort()).toEqual([
      'Almoço',
      'Museu do Louvre',
      'Torre Eiffel',
    ]);
    // Ordem dentro do dia é sequencial e não colide com o que já existia.
    expect(itinerary.map((item) => item.sortOrder).sort()).toEqual([0, 1, 2]);
    expect(itinerary.every((item) => item.completed === false)).toBe(true);
  });

  it('continua a numeração depois do que o usuário já tinha naquele dia', async () => {
    await db.itinerary.create({
      tripId: paris.id,
      date: '2026-08-23',
      type: 'hospedagem',
      title: 'Check-in no hotel',
      completed: false,
      sortOrder: 0,
    });

    const actions = parseAIActions(
      [
        {
          type: 'itinerary.add',
          label: 'Adicionar ao roteiro',
          items: [{ title: 'Museu do Louvre', date: '2026-08-23', type: 'atracao' }],
        },
      ],
      paris,
    );

    await executeAIActions(actions, ctx(paris, USER_A));
    const items = await db.itinerary.listByTrip(paris.id);
    expect(items.find((item) => item.title === 'Museu do Louvre')?.sortOrder).toBe(1);
  });

  it('mantém `visibility` no payload preparado para o schema migrado', async () => {
    const create = jest.fn(db.itinerary.create);
    const source: DataSource = { ...db, itinerary: { ...db.itinerary, create } };
    const actions = parseAIActions(
      [
        {
          type: 'itinerary.add',
          label: 'Adicionar ao roteiro',
          items: [
            {
              title: 'Museu do Louvre',
              date: '2026-08-23',
              type: 'atracao',
              placeName: 'Rue de Rivoli',
            },
          ],
        },
      ],
      paris,
    );

    await executeAIActions(actions, { trip: paris, userId: USER_A, source });

    // `visibility` é da 0009. Retirá-la para acomodar produção ainda em
    // 0007 esconderia a incompatibilidade e quebraria privacidade depois do
    // go-live correto. O payload novo é o contrato que deve permanecer.
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        tripId: paris.id,
        title: 'Museu do Louvre',
        placeName: 'Rue de Rivoli',
        visibility: 'shared',
      }),
    );
  });
});

describe('checklist', () => {
  it('grava os itens marcados', async () => {
    const actions = parseAIActions(
      [
        {
          type: 'checklist.add',
          label: 'Adicionar ao checklist',
          items: [
            { label: 'Protetor solar', category: 'saude' },
            { label: 'Adaptador de tomada', category: 'mala' },
          ],
        },
      ],
      paris,
    );

    const report = await executeAIActions(actions, ctx(paris, USER_A));
    expect(report.outcomes[0].summary).toBe('2 itens adicionados ao checklist');

    const checklist = await db.checklist.listByTrip(paris.id);
    expect(checklist.map((item) => item.label).sort()).toEqual([
      'Adaptador de tomada',
      'Protetor solar',
    ]);
    expect(checklist.every((item) => item.completed === false)).toBe(true);
  });
});

describe('despesas', () => {
  it('grava valor informado sem prefixo e estimativa com prefixo', async () => {
    const actions = parseAIActions(
      [
        {
          type: 'expenses.add',
          label: 'Adicionar despesas',
          items: [
            {
              description: 'Passagem aérea',
              category: 'transporte',
              amount: 3200,
              currency: 'BRL',
              transactionDate: '2026-08-22',
              estimated: false,
            },
            {
              description: 'Alimentação',
              category: 'alimentacao',
              amount: 150,
              currency: 'BRL',
              transactionDate: '2026-08-23',
            },
          ],
        },
      ],
      paris,
    );

    const report = await executeAIActions(actions, ctx(paris, USER_A));
    expect(report.ok).toBe(true);

    const expenses = await db.expenses.listByTrip(paris.id);
    const descriptions = expenses.map((expense) => expense.description).sort();
    expect(descriptions).toEqual(['Estimativa — Alimentação', 'Passagem aérea']);

    // O orçamento reage pela lógica que já existia: as despesas estão na moeda
    // do orçamento, então entram convertidas 1:1.
    const total = expenses.reduce(
      (sum, expense) => sum + (expense.amountInBudgetCurrency ?? 0),
      0,
    );
    expect(total).toBe(3350);
  });

  it('o resumo informa o total efetivamente adicionado', async () => {
    const actions = parseAIActions(
      [
        {
          type: 'expenses.add',
          label: 'Adicionar despesas',
          items: [
            { description: 'Ingresso', amount: 450, currency: 'BRL', transactionDate: '2026-08-23' },
            { description: 'Transporte', amount: 80, currency: 'BRL', transactionDate: '2026-08-23' },
            { description: 'Alimentação', amount: 150, currency: 'BRL', transactionDate: '2026-08-23' },
          ],
        },
      ],
      paris,
    );

    const report = await executeAIActions(actions, ctx(paris, USER_A));
    expect(report.outcomes[0].summary).toBe('R$ 680,00 em despesas adicionadas');
  });
});

describe('orçamento e meta', () => {
  it('atualiza o orçamento da viagem e não oferece desfazer', async () => {
    const actions = parseAIActions(
      [{ type: 'budget.update', label: 'Atualizar orçamento', budgetTotal: 12000 }],
      paris,
    );

    const report = await executeAIActions(actions, ctx(paris, USER_A));

    expect((await db.trips.get(paris.id))?.budgetTotal).toBe(12000);
    expect(report.outcomes[0].summary).toBe('Orçamento atualizado para R$ 12.000,00');
    // Alterar um registro existente não vem com "Desfazer" (§23).
    expect(report.undoable).toBe(false);
  });

  it('cria a meta já vinculada à viagem da conversa', async () => {
    const actions = parseAIActions(
      [
        {
          type: 'goal.add',
          label: 'Criar meta',
          goal: { title: 'Juntar para Paris', targetValue: 2000, unit: 'BRL', goalType: 'economia' },
        },
      ],
      paris,
    );

    await executeAIActions(actions, ctx(paris, USER_A));
    const goals = await db.goals.list(USER_A);

    expect(goals).toHaveLength(1);
    expect(goals[0]).toMatchObject({
      tripId: paris.id,
      userId: USER_A,
      title: 'Juntar para Paris',
      targetValue: 2000,
      currentValue: 0,
      status: 'active',
    });
  });
});

describe('ação composta', () => {
  it('grava roteiro, despesas e checklist e relata cada bloco', async () => {
    const actions = parseAIActions(
      [
        {
          type: 'itinerary.add',
          label: 'Roteiro',
          items: [
            { title: 'Saída do hotel', date: '2026-08-24', startTime: '09:00', type: 'transporte' },
            { title: 'Entrada no parque', date: '2026-08-24', startTime: '10:00', type: 'atracao' },
          ],
        },
        {
          type: 'expenses.add',
          label: 'Despesas',
          items: [
            { description: 'Ingresso', amount: 450, currency: 'BRL', transactionDate: '2026-08-24' },
          ],
        },
        {
          type: 'checklist.add',
          label: 'Checklist',
          items: [{ label: 'Protetor solar', category: 'saude' }],
        },
      ],
      paris,
    );

    const report = await executeAIActions(actions, ctx(paris, USER_A));

    expect(report.ok).toBe(true);
    expect(report.outcomes.map((outcome) => outcome.type)).toEqual([
      'itinerary.add',
      'expenses.add',
      'checklist.add',
    ]);
    expect(await db.itinerary.listByTrip(paris.id)).toHaveLength(2);
    expect(await db.expenses.listByTrip(paris.id)).toHaveLength(1);
    expect(await db.checklist.listByTrip(paris.id)).toHaveLength(1);
  });
});

describe('recusas', () => {
  it('recusa uma proposta carimbada para outra viagem', async () => {
    const actionsDeParis = parseAIActions(
      [
        {
          type: 'itinerary.add',
          label: 'Adicionar ao roteiro',
          items: [{ title: 'Museu do Louvre', date: '2026-08-23', type: 'atracao' }],
        },
      ],
      paris,
    );

    // O usuário trocou a conversa para Tóquio e a proposta antiga tentou entrar.
    const report = await executeAIActions(actionsDeParis, ctx(toquio, USER_B));

    expect(report.ok).toBe(false);
    expect(report.outcomes[0].summary).toBe('Esta sugestão foi feita para outra viagem.');
    expect(await db.itinerary.listByTrip(toquio.id)).toHaveLength(0);
    expect(await db.itinerary.listByTrip(paris.id)).toHaveLength(0);
  });

  it('recusa payload forjado com valores impossíveis, mesmo contornando o parser', async () => {
    const forjada = {
      id: 'forjada',
      tripId: paris.id,
      type: 'expenses.add',
      label: 'Adicionar despesas',
      items: [
        {
          description: 'Negativa',
          category: 'outros',
          amount: -5000,
          currency: 'BRL',
          transactionDate: '2026-08-23',
          estimated: false,
        },
      ],
    } as unknown as AITripAction;

    const report = await executeAIActions([forjada], ctx(paris, USER_A));

    expect(report.ok).toBe(false);
    expect(await db.expenses.listByTrip(paris.id)).toHaveLength(0);
  });

  it('não grava nada quando não há ação', async () => {
    const report = await executeAIActions([], ctx(paris, USER_A));
    expect(report).toMatchObject({ ok: true, outcomes: [], created: [] });
  });
});

describe('falha parcial', () => {
  it('relata o que entrou e o que não entrou, sem anunciar sucesso', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    // O adaptador falha no segundo item do checklist — o primeiro já gravou.
    let calls = 0;
    const flaky: DataSource = {
      ...db,
      checklist: {
        ...db.checklist,
        create: async (input) => {
          calls += 1;
          if (calls === 2) throw new Error('Falha de rede ao gravar.');
          return db.checklist.create(input);
        },
      },
    };

    const actions = parseAIActions(
      [
        {
          type: 'checklist.add',
          label: 'Checklist',
          items: [
            { label: 'Protetor solar', category: 'saude' },
            { label: 'Garrafa de água', category: 'mala' },
          ],
        },
      ],
      paris,
    );

    const report = await executeAIActions(actions, {
      trip: paris,
      userId: USER_A,
      source: flaky,
    });

    expect(report.ok).toBe(false);
    expect(report.partial).toBe(true);
    expect(report.outcomes[0].summary).toBe('1 item adicionado ao checklist');
    expect(report.outcomes[0].failed).toEqual([
      { label: 'Garrafa de água', reason: 'Falha de rede ao gravar.' },
    ]);
    expect(await db.checklist.listByTrip(paris.id)).toHaveLength(1);
  });

  it('transforma falha na leitura inicial em relatório e guarda a causa em DEV', async () => {
    const failure = Object.assign(new Error("Could not find the 'visibility' column"), {
      code: 'PGRST204',
      details: null,
      hint: null,
    });
    const source: DataSource = {
      ...db,
      itinerary: {
        ...db.itinerary,
        listByTrip: async () => {
          throw failure;
        },
      },
    };
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const actions = parseAIActions(
      [
        {
          type: 'itinerary.add',
          label: 'Roteiro',
          items: [{ title: 'Louvre', date: '2026-08-23', type: 'atracao' }],
        },
      ],
      paris,
    );

    const report = await executeAIActions(actions, { trip: paris, userId: USER_A, source });

    expect(report).toMatchObject({ ok: false, partial: false });
    expect(report.outcomes[0].summary).toBe('Nenhum item foi adicionado ao roteiro');
    expect(log).toHaveBeenCalledWith(
      'AI_ACTION_REPOSITORY_ERROR',
      expect.objectContaining({
        type: 'itinerary.add',
        op: 'itinerary.listByTrip',
        code: 'PGRST204',
      }),
    );
  });

  it('identifica PGRST204 no INSERT de itinerary_items como `itinerary.create`', async () => {
    const failure = Object.assign(
      new Error(
        "Could not find the 'visibility' column of 'itinerary_items' in the schema cache",
      ),
      { code: 'PGRST204', details: null, hint: null },
    );
    const source: DataSource = {
      ...db,
      itinerary: {
        ...db.itinerary,
        create: async () => {
          throw failure;
        },
      },
    };
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const actions = parseAIActions(
      [
        {
          type: 'itinerary.add',
          label: 'Roteiro',
          items: [{ title: 'Louvre', date: '2026-08-23', type: 'atracao' }],
        },
      ],
      paris,
    );

    const report = await executeAIActions(actions, { trip: paris, userId: USER_A, source });

    expect(report).toMatchObject({ ok: false, partial: false });
    expect(log).toHaveBeenCalledWith('AI_ACTION_REPOSITORY_ERROR', {
      type: 'itinerary.add',
      op: 'itinerary.create',
      code: 'PGRST204',
      message: "Could not find the 'visibility' column of 'itinerary_items' in the schema cache",
      details: null,
      hint: null,
    });
  });

  it('não repete cada INSERT quando a primeira falha prova schema incompatível', async () => {
    const failure = new BackendCapabilityError('MISSING_VISIBILITY', {
      code: 'PGRST204',
      message: "Could not find the 'visibility' column of 'itinerary_items' in the schema cache",
      details: null,
      hint: null,
    });
    const create = jest.fn(async () => {
      throw failure;
    });
    const source: DataSource = { ...db, itinerary: { ...db.itinerary, create } };
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const actions = parseAIActions(
      [
        {
          type: 'itinerary.add',
          label: 'Roteiro',
          items: [
            { title: 'Louvre', date: '2026-08-23', type: 'atracao' },
            { title: 'Tuileries', date: '2026-08-23', type: 'atividade' },
            { title: 'Torre Eiffel', date: '2026-08-23', type: 'atracao' },
          ],
        },
      ],
      paris,
    );

    const report = await executeAIActions(actions, { trip: paris, userId: USER_A, source });

    expect(create).toHaveBeenCalledTimes(1);
    expect(report.outcomes[0].failed).toHaveLength(3);
    expect(report.outcomes[0].failed[0].backendCapability).toBe('MISSING_VISIBILITY');
    expect(report.outcomes[0].failed.every((item) => item.reason.includes('privacidade'))).toBe(
      true,
    );
  });
});

describe('diagnóstico seguro', () => {
  it('preserva tipo/operação e os quatro campos PostgREST', () => {
    expect(
      buildAIActionErrorDiagnostic('itinerary.add', 'itinerary.create', {
        code: 'PGRST204',
        message: "Could not find the 'visibility' column of 'itinerary_items' in the schema cache",
        details: null,
        hint: null,
      }),
    ).toEqual({
      type: 'itinerary.add',
      op: 'itinerary.create',
      code: 'PGRST204',
      message: "Could not find the 'visibility' column of 'itinerary_items' in the schema cache",
      details: null,
      hint: null,
    });
  });

  it('lê os campos PostgREST preservados dentro de BackendCapabilityError', () => {
    expect(
      buildAIActionErrorDiagnostic('itinerary.add', 'itinerary.create', {
        code: 'MISSING_VISIBILITY',
        backend: {
          code: 'PGRST204',
          message: "Could not find the 'visibility' column",
          details: null,
          hint: null,
        },
      }),
    ).toMatchObject({
      type: 'itinerary.add',
      op: 'itinerary.create',
      code: 'PGRST204',
      message: "Could not find the 'visibility' column",
    });
  });

  it('remove dados pessoais de message/details/hint', () => {
    const diagnostic = buildAIActionErrorDiagnostic('checklist.add', 'checklist.create', {
      code: '23505',
      message: 'Falha para maria@example.com e 550e8400-e29b-41d4-a716-446655440000',
      details: 'Key (email)=(maria@example.com) already exists. Failing row contains (segredo)',
      hint: 'Veja https://example.com/reset?token=abc e +55 (11) 99999-9999',
    });

    expect(JSON.stringify(diagnostic)).not.toMatch(
      /maria@example|550e8400|segredo|example\.com|99999-9999/,
    );
    expect(diagnostic).toMatchObject({
      type: 'checklist.add',
      op: 'checklist.create',
      code: '23505',
    });
  });
});

describe('desfazer', () => {
  it('remove exatamente os registros criados e nada mais', async () => {
    const preexistente = await db.checklist.create({
      tripId: paris.id,
      label: 'Passaporte',
      category: 'documentos',
      completed: false,
    });

    const actions = parseAIActions(
      [
        {
          type: 'checklist.add',
          label: 'Checklist',
          items: [
            { label: 'Protetor solar', category: 'saude' },
            { label: 'Garrafa de água', category: 'mala' },
          ],
        },
      ],
      paris,
    );

    const report = await executeAIActions(actions, ctx(paris, USER_A));
    expect(report.undoable).toBe(true);

    const { removed, failed } = await undoAIActions(report, ctx(paris, USER_A));
    expect({ removed, failed }).toEqual({ removed: 2, failed: 0 });

    const restante = await db.checklist.listByTrip(paris.id);
    expect(restante.map((item) => item.id)).toEqual([preexistente.id]);
  });
});

describe('isolamento entre contas', () => {
  it('a viagem do outro usuário não recebe nada', async () => {
    const actions = parseAIActions(
      [
        {
          type: 'checklist.add',
          label: 'Checklist',
          items: [{ label: 'Protetor solar', category: 'saude' }],
        },
      ],
      paris,
    );

    await executeAIActions(actions, ctx(paris, USER_A));

    expect(await db.checklist.listByTrip(toquio.id)).toHaveLength(0);
    expect(await db.trips.list(USER_B).then((trips) => trips.map((trip) => trip.id))).toEqual([
      toquio.id,
    ]);
  });
});
