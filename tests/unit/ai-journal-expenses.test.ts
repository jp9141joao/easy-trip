import {
  LIMITS,
  RESPONSE_SCHEMA,
  SYSTEM_PROMPT,
  classifyItineraryRequest,
  enforcePromiseCoherence,
  readModelOutput,
  validateActions,
} from '../../supabase/functions/ai-chat/protocol';

import {
  AI_ACTION_LIMITS,
  AI_ACTION_TYPES,
  PLANNED_JOURNAL_PREFIX,
  describeAction,
  describeJournalContent,
  enforceAIActionPromiseCoherence,
  isPlannedEntryDate,
  parseAIActions,
  type AITripAction,
} from '@/domain/aiActions';
import { buildReviewGroups, countSelected, reviewToActions, toggleGroup } from '@/domain/aiActionReview';
import { DEFAULT_VISIBILITY } from '@/domain/visibility';
import { buildTripContext } from '@/services/ai';
import { executeAIActions, undoAIActions } from '@/services/aiActionExecutor';
import { localDataSource } from '@/repositories/local/LocalDataSource';
import type { Trip } from '@/domain/types';

/**
 * DIÁRIO E PREVISÃO DE DESPESAS — as duas capacidades que o aparelho não tinha.
 *
 * O QUE ESTA SUÍTE EXISTE PARA PROVAR
 *
 * Duas queixas reais, com causas diferentes, e uma terceira que não era de
 * nenhuma das duas:
 *
 *  A. "crie um diário do dia 18" não produzia proposta nenhuma. `journal.add`
 *     simplesmente NÃO EXISTIA no contrato — `validateActions` recusava o tipo
 *     antes de olhar o payload —, e o pedido ainda era classificado como
 *     roteiro de dia inteiro, porque a frase cita "roteiro".
 *
 *  B. "crie despesas obrigatórias" voltava com a frase de ausência. O caminho
 *     de `expenses.add` sempre funcionou ponta a ponta; o que faltava era
 *     autorização no prompt — a regra 5 mandava PERGUNTAR quando faltasse dado
 *     essencial, e para o modelo o valor era um dado faltando.
 *
 *  C. o 502 `GEMINI_UNAVAILABLE` é medido em `ai-model-fallback.test.ts`, onde
 *     a cadeia mora. Aqui fica só o que toca estas duas capacidades.
 *
 * E, acima de tudo: que a IA continua SEM LER o diário de ninguém.
 */

const TOQUIO: Trip = {
  id: 'trip-toquio',
  userId: 'u1',
  destinationCity: 'Tóquio',
  destinationCountry: 'Japão',
  countryCode: 'JP',
  timezone: 'Asia/Tokyo',
  startDate: '2026-09-18',
  endDate: '2026-09-27',
  budgetTotal: 45000,
  budgetCurrency: 'BRL',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

/** Antes da viagem: o dia 18 ainda é plano. */
const ANTES = '2026-09-10';
/** Depois da viagem: o dia 18 já é relato. */
const DEPOIS = '2026-10-01';

const journalAction = (journal: unknown) => ({
  type: 'journal.add',
  label: 'Adicionar ao diário',
  journal,
});

const VALID_JOURNAL = {
  entryDate: '2026-09-18',
  content: 'Está previsto começar o dia em Asakusa e terminar em Shibuya.',
  placeName: 'Asakusa',
};

const reviewCtx = { trip: TOQUIO, itinerary: [], checklist: [] };

/* ========================================================================== */
/* 1. O CONTRATO                                                              */
/* ========================================================================== */

describe('o contrato ganhou um sexto tipo, e só um', () => {
  it('cliente e servidor declaram exatamente os mesmos seis tipos', () => {
    expect([...AI_ACTION_TYPES]).toEqual([
      'itinerary.add',
      'checklist.add',
      'expenses.add',
      'budget.update',
      'goal.add',
      'journal.add',
    ]);
    // O enum que o Gemini recebe é o mesmo — um tipo que o modelo não pode
    // nomear não chega nem a ser validado.
    expect(RESPONSE_SCHEMA.properties.actions.items.properties.type.enum).toEqual([
      ...AI_ACTION_TYPES,
    ]);
  });

  it('nenhum tipo destrutivo entrou junto', () => {
    for (const type of AI_ACTION_TYPES) {
      expect(type.endsWith('.delete')).toBe(false);
      expect(type.endsWith('.remove')).toBe(false);
    }
    // A união discriminada não consegue expressar exclusão — e o parser
    // descarta a invenção sem cerimônia.
    expect(parseAIActions([{ type: 'journal.delete', journal: VALID_JOURNAL }], TOQUIO)).toEqual([]);
    expect(validateActions([{ type: 'journal.delete', label: 'x', journal: VALID_JOURNAL }])).toEqual(
      [],
    );
  });

  it('os limites de texto do diário são os mesmos nos dois lados', () => {
    expect(AI_ACTION_LIMITS.maxJournalContent).toBe(LIMITS.maxJournalContent);
  });
});

/* ========================================================================== */
/* 2. SERVIDOR — journal.add                                                  */
/* ========================================================================== */

describe('servidor: journal.add', () => {
  it('aceita uma entrada válida e devolve só os campos reais da tabela', () => {
    const [action] = validateActions([journalAction(VALID_JOURNAL)]) as {
      type: string;
      label: string;
      journal: Record<string, unknown>;
    }[];

    expect(action.type).toBe('journal.add');
    expect(action.journal).toEqual({
      entryDate: '2026-09-18',
      content: VALID_JOURNAL.content,
      placeName: 'Asakusa',
    });
    // Nada de título, nada de coordenada, nada de id: o que sai é montado
    // campo a campo, não filtrado do que veio.
    expect(Object.keys(action.journal).sort()).toEqual(['content', 'entryDate', 'placeName']);
  });

  it('o rótulo ausente não custa a proposta', () => {
    const [action] = validateActions([
      { type: 'journal.add', journal: VALID_JOURNAL },
    ]) as { label: string }[];
    expect(action.label).toBe('Adicionar ao diário');
  });

  it('rejeita data inválida', () => {
    expect(validateActions([journalAction({ ...VALID_JOURNAL, entryDate: '2026-02-30' })])).toEqual(
      [],
    );
    expect(validateActions([journalAction({ ...VALID_JOURNAL, entryDate: '18/09/2026' })])).toEqual(
      [],
    );
    expect(validateActions([journalAction({ ...VALID_JOURNAL, entryDate: undefined })])).toEqual([]);
  });

  it('rejeita entrada sem texto', () => {
    expect(validateActions([journalAction({ ...VALID_JOURNAL, content: '   ' })])).toEqual([]);
    expect(validateActions([journalAction({ ...VALID_JOURNAL, content: undefined })])).toEqual([]);
  });

  it('corta o texto acima do limite em vez de aceitar qualquer tamanho', () => {
    const [action] = validateActions([
      journalAction({ ...VALID_JOURNAL, content: 'a'.repeat(9_000) }),
    ]) as { journal: { content: string } }[];

    expect(action.journal.content).toHaveLength(LIMITS.maxJournalContent);
  });

  it('aceita o payload em items[0] — a mesma tolerância dos outros tipos', () => {
    const [action] = validateActions([
      { type: 'journal.add', label: 'Diário', items: [{ date: '2026-09-18', description: 'Texto do dia 18.' }] },
    ]) as { journal: { entryDate: string; content: string } }[];

    expect(action.journal).toEqual({
      entryDate: '2026-09-18',
      content: 'Texto do dia 18.',
      placeName: undefined,
    });
  });

  it('uma proposta por tipo: dois journal.add viram um', () => {
    const out = validateActions([journalAction(VALID_JOURNAL), journalAction(VALID_JOURNAL)]);
    expect(out).toHaveLength(1);
  });

  it('convive com os outros tipos na mesma resposta', () => {
    const out = validateActions([
      { type: 'itinerary.add', label: 'r', items: [{ title: 'Asakusa', date: '2026-09-18' }] },
      journalAction(VALID_JOURNAL),
    ]) as { type: string }[];

    expect(out.map((a) => a.type)).toEqual(['itinerary.add', 'journal.add']);
  });

  it('o system prompt declara journal.add e proíbe inventar o passado', () => {
    expect(SYSTEM_PROMPT).toContain('journal.add');
    expect(SYSTEM_PROMPT).toContain('VOCÊ NÃO LÊ O DIÁRIO');
    expect(SYSTEM_PROMPT).toMatch(/ainda não aconteceu/i);
  });
});

/* ========================================================================== */
/* 3. O PEDIDO DE DIÁRIO NÃO É PEDIDO DE ROTEIRO                              */
/* ========================================================================== */

describe('classificação do pedido', () => {
  it('"com base no meu roteiro do dia 18 crie um diário" NÃO é pedido de dia inteiro', () => {
    /*
     * A frase cita "roteiro", e `FULL_DAY_PATTERNS` casa com a palavra. O
     * resultado no aparelho era duplo: o servidor gastava uma segunda geração
     * "reparando" um roteiro que ninguém pediu, e `discloseIncompleteItinerary`
     * colava "Não consegui montar um roteiro completo" na frente de uma
     * resposta que trazia a entrada certa.
     */
    const pedido = classifyItineraryRequest(
      'Agora com base no meu roteiro do dia 18 crie um diario do que acontecerá no dia',
    );
    expect(pedido.expectsFullDay).toBe(false);
  });

  it('citar o diário de passagem não desliga o roteiro', () => {
    const pedido = classifyItineraryRequest('Monte um roteiro para o dia 18; depois eu anoto tudo');
    expect(pedido.expectsFullDay).toBe(true);
  });

  it('"crie despesas obrigatórias" também não vira pedido de roteiro', () => {
    expect(
      classifyItineraryRequest('Crie despesas obrigatórias que terei nessa viagem').expectsFullDay,
    ).toBe(false);
  });
});

/* ========================================================================== */
/* 4. CLIENTE — parse, tripId e "planejado"                                   */
/* ========================================================================== */

describe('cliente: journal.add', () => {
  it('parseia a entrada e carimba o tripId do contexto local', () => {
    const [action] = parseAIActions([journalAction(VALID_JOURNAL)], TOQUIO, ANTES);

    expect(action.type).toBe('journal.add');
    expect(action.tripId).toBe(TOQUIO.id);
  });

  it('o tripId do payload é IGNORADO — quem carimba é o cliente', () => {
    const [action] = parseAIActions(
      [{ ...journalAction(VALID_JOURNAL), tripId: 'trip-de-outra-pessoa' }],
      TOQUIO,
      ANTES,
    );
    expect(action.tripId).toBe(TOQUIO.id);
  });

  it('data futura vira "planejado", e o modelo não tem voto nisso', () => {
    const [antes] = parseAIActions(
      // O modelo AFIRMA que é retrospectivo. Não é acreditado.
      [journalAction({ ...VALID_JOURNAL, planned: false })],
      TOQUIO,
      ANTES,
    );
    expect(antes.type === 'journal.add' && antes.journal.planned).toBe(true);

    const [depois] = parseAIActions([journalAction(VALID_JOURNAL)], TOQUIO, DEPOIS);
    expect(depois.type === 'journal.add' && depois.journal.planned).toBe(false);
  });

  it('o próprio dia conta como planejado — às nove da manhã o dia é quase todo futuro', () => {
    expect(isPlannedEntryDate('2026-09-18', '2026-09-18')).toBe(true);
    expect(isPlannedEntryDate('2026-09-18', '2026-09-19')).toBe(false);
  });

  it('o texto planejado é gravado marcado como planejado', () => {
    const planejado = { ...VALID_JOURNAL, planned: true };
    expect(describeJournalContent(planejado)).toBe(`${PLANNED_JOURNAL_PREFIX}${VALID_JOURNAL.content}`);
    // Sem prefixo duplicado se já vier prefixado.
    expect(describeJournalContent({ ...planejado, content: describeJournalContent(planejado) })).toBe(
      describeJournalContent(planejado),
    );
    // E um relato de verdade não ganha marca nenhuma.
    expect(describeJournalContent({ ...VALID_JOURNAL, planned: false })).toBe(VALID_JOURNAL.content);
  });

  it('recusa texto vazio e data inválida, como o servidor', () => {
    expect(parseAIActions([journalAction({ ...VALID_JOURNAL, content: '' })], TOQUIO, ANTES)).toEqual([]);
    expect(
      parseAIActions([journalAction({ ...VALID_JOURNAL, entryDate: 'ontem' })], TOQUIO, ANTES),
    ).toEqual([]);
  });

  it('descreve a proposta pelo que ela é', () => {
    const [planejado] = parseAIActions([journalAction(VALID_JOURNAL)], TOQUIO, ANTES);
    expect(describeAction(planejado)).toBe('Registro planejado');
    const [relato] = parseAIActions([journalAction(VALID_JOURNAL)], TOQUIO, DEPOIS);
    expect(describeAction(relato)).toBe('Nova entrada de diário');
  });
});

/* ========================================================================== */
/* 5. REVISÃO                                                                 */
/* ========================================================================== */

describe('revisão: a entrada aparece e nada é gravado antes da confirmação', () => {
  const actionsDe = (today = ANTES) => parseAIActions([journalAction(VALID_JOURNAL)], TOQUIO, today);

  it('a proposta vira um item de revisão marcado', () => {
    const groups = buildReviewGroups(actionsDe(), reviewCtx);
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toHaveLength(1);
    expect(groups[0].items[0].kind).toBe('journal');
    expect(groups[0].items[0].included).toBe(true);
    expect(countSelected(groups)).toBe(1);
  });

  it('entrada fora do período da viagem nasce DESMARCADA, com o motivo à vista', () => {
    const fora = parseAIActions(
      [journalAction({ ...VALID_JOURNAL, entryDate: '2026-10-05' })],
      TOQUIO,
      ANTES,
    );
    const groups = buildReviewGroups(fora, reviewCtx);

    expect(groups[0].items[0].included).toBe(false);
    expect(groups[0].items[0].warnings[0].kind).toBe('outsideTrip');
    expect(countSelected(groups)).toBe(0);
  });

  it('remover o bloco devolve ZERO ações ao executor', () => {
    const groups = toggleGroup(buildReviewGroups(actionsDe(), reviewCtx), actionsDe()[0].id);
    // O id muda a cada parse; o que importa é que desligar o único grupo esvazia.
    const desligado = toggleGroup(buildReviewGroups(actionsDe(), reviewCtx), '');
    expect(reviewToActions(groups.map((g) => ({ ...g, enabled: false })))).toEqual([]);
    expect(countSelected(desligado.map((g) => ({ ...g, enabled: false })))).toBe(0);
  });

  it('confirmar devolve a entrada com as edições feitas na folha', () => {
    const groups = buildReviewGroups(actionsDe(), reviewCtx);
    const editado = groups.map((group) => ({
      ...group,
      items: group.items.map((item) =>
        item.kind === 'journal'
          ? { ...item, value: { ...item.value, content: 'Reescrito por mim.' } }
          : item,
      ),
    }));

    const [action] = reviewToActions(editado);
    expect(action.type === 'journal.add' && action.journal.content).toBe('Reescrito por mim.');
    // O vínculo com a viagem NÃO é editável: a revisão muda conteúdo, não dono.
    expect(action.tripId).toBe(TOQUIO.id);
  });
});

/* ========================================================================== */
/* 6. EXECUTOR — gravação real, contra o adaptador local                      */
/* ========================================================================== */

describe('executor: journal.add', () => {
  const db = localDataSource;
  const USER = 'user-journal';
  let trip: Trip;

  beforeEach(async () => {
    await db.purgeUserData(USER);
    trip = await db.trips.create({
      userId: USER,
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

  const propor = (today = ANTES) =>
    parseAIActions([journalAction(VALID_JOURNAL)], trip, today);

  it('CANCELAR: nada foi gravado enquanto a proposta só existia', async () => {
    propor();
    expect(await db.journal.listByTrip(trip.id)).toHaveLength(0);

    // E uma revisão inteiramente desmarcada não grava nada, mesmo confirmada.
    const groups = buildReviewGroups(propor(), { trip, itinerary: [], checklist: [] });
    const nenhum = reviewToActions(groups.map((g) => ({ ...g, enabled: false })));
    await executeAIActions(nenhum, { trip, userId: USER, source: db });

    expect(await db.journal.listByTrip(trip.id)).toHaveLength(0);
  });

  it('CONFIRMAR: a entrada aparece no diário da viagem, privada e marcada como plano', async () => {
    const report = await executeAIActions(propor(), { trip, userId: USER, source: db });

    expect(report.ok).toBe(true);
    expect(report.outcomes[0].summary).toBe('Registro planejado adicionado ao diário');

    const [entry] = await db.journal.listByTrip(trip.id);
    expect(entry.entryDate).toBe('2026-09-18');
    expect(entry.tripId).toBe(trip.id);
    expect(entry.userId).toBe(USER);
    expect(entry.placeName).toBe('Asakusa');
    // A visibilidade padrão do domínio, e não uma escolha da folha.
    expect(entry.visibility).toBe('private');
    expect(DEFAULT_VISIBILITY.journal).toBe('private');
    // O "isto ainda não aconteceu" persiste — a tabela não tem coluna para ele.
    expect(entry.content.startsWith(PLANNED_JOURNAL_PREFIX)).toBe(true);
  });

  it('uma entrada de data já passada entra sem a marca de plano', async () => {
    await executeAIActions(propor(DEPOIS), { trip, userId: USER, source: db });
    const [entry] = await db.journal.listByTrip(trip.id);
    expect(entry.content).toBe(VALID_JOURNAL.content);
  });

  it('uma proposta de OUTRA viagem não entra nesta', async () => {
    const outra = await db.trips.create({
      userId: USER,
      destinationCity: 'Paris',
      destinationCountry: 'França',
      countryCode: 'FR',
      timezone: 'Europe/Paris',
      startDate: '2026-08-22',
      endDate: '2026-08-31',
      budgetTotal: 30000,
      budgetCurrency: 'BRL',
    });

    const deParis = parseAIActions(
      [journalAction({ ...VALID_JOURNAL, entryDate: '2026-08-23' })],
      outra,
      ANTES,
    );
    const report = await executeAIActions(deParis, { trip, userId: USER, source: db });

    expect(report.ok).toBe(false);
    expect(report.outcomes[0].failed[0].reason).toBe('Esta sugestão foi feita para outra viagem.');
    expect(await db.journal.listByTrip(trip.id)).toHaveLength(0);
  });

  it('desfazer remove exatamente a entrada criada', async () => {
    const report = await executeAIActions(propor(), { trip, userId: USER, source: db });
    expect(report.undoable).toBe(true);

    const { removed, failed } = await undoAIActions(report, { trip, userId: USER, source: db });
    expect({ removed, failed }).toEqual({ removed: 1, failed: 0 });
    expect(await db.journal.listByTrip(trip.id)).toHaveLength(0);
  });

  it('falha de gravação é relatada, não escondida', async () => {
    const source = {
      ...db,
      journal: {
        ...db.journal,
        create: async () => {
          throw new Error('permissão negada');
        },
      },
    };

    const report = await executeAIActions(propor(), { trip, userId: USER, source: source as never });
    expect(report.ok).toBe(false);
    expect(report.outcomes[0].failed[0].reason).toBe('permissão negada');
    expect(report.outcomes[0].summary).toBe('A entrada não foi adicionada ao diário');
  });
});

/* ========================================================================== */
/* 7. PRIVACIDADE — o que a IA continua NÃO podendo ler                       */
/* ========================================================================== */

describe('privacidade: o diário existente nunca chega ao modelo', () => {
  const contexto = () =>
    buildTripContext({
      trip: TOQUIO,
      status: 'upcoming',
      daysUntil: 8,
      totalSpent: 0,
      remainingBudget: 45000,
      expenses: [],
      itinerary: [],
      checklist: [],
      profile: null,
      viewerId: 'u1',
    });

  it('o contexto enviado ao Gemini não tem campo de diário — nem vazio', () => {
    const context = contexto();
    expect('journal' in context).toBe(false);
    expect(Object.keys(context)).not.toContain('diary');
    // Serializado inteiro, a palavra não aparece em lugar nenhum.
    expect(JSON.stringify(context).toLowerCase()).not.toContain('journal');
  });

  it('journal.add é ADITIVO: o executor só chama create, nunca listByTrip', async () => {
    /*
     * A prova é estrutural, e é a que importa. Se um dia alguém precisar
     * "conferir duplicata" no diário, terá de LER o diário — e o teste quebra
     * aqui antes de a leitura chegar a um prompt.
     */
    const db = localDataSource;
    const USER = 'user-journal-priv';
    await db.purgeUserData(USER);
    const trip = await db.trips.create({
      userId: USER,
      destinationCity: 'Tóquio',
      destinationCountry: 'Japão',
      countryCode: 'JP',
      timezone: 'Asia/Tokyo',
      startDate: '2026-09-18',
      endDate: '2026-09-27',
      budgetTotal: 45000,
      budgetCurrency: 'BRL',
    });

    // Uma entrada privada que já existe. Nada no caminho da IA pode tocá-la.
    await db.journal.create({
      tripId: trip.id,
      userId: USER,
      entryDate: '2026-09-19',
      content: 'Segredo que ninguém além de mim lê.',
      visibility: 'private',
    });

    const listByTrip = jest.fn(db.journal.listByTrip);
    const source = { ...db, journal: { ...db.journal, listByTrip } };

    await executeAIActions(parseAIActions([journalAction(VALID_JOURNAL)], trip, ANTES), {
      trip,
      userId: USER,
      source: source as never,
    });

    expect(listByTrip).not.toHaveBeenCalled();
  });

  it('a revisão do diário não abre o diário — nenhuma duplicata é procurada', () => {
    // `ReviewContext` só carrega roteiro e checklist. Não há por onde uma
    // entrada existente entrar nesta camada.
    const groups = buildReviewGroups(parseAIActions([journalAction(VALID_JOURNAL)], TOQUIO, ANTES), reviewCtx);
    expect(groups[0].items[0].warnings.filter((w) => w.kind === 'duplicate')).toEqual([]);
    expect(Object.keys(reviewCtx).sort()).toEqual(['checklist', 'itinerary', 'trip']);
  });
});

/* ========================================================================== */
/* 8. DESPESAS — a previsão que não saía                                      */
/* ========================================================================== */

const PREVISAO_DO_MODELO = {
  type: 'expenses.add',
  label: 'Adicionar às despesas',
  items: [
    { title: 'Transporte do aeroporto', date: '2026-09-18', amount: 150, category: 'transporte', estimated: true },
    { title: 'Alimentação — média diária', date: '2026-09-19', amount: 200, category: 'alimentacao', estimated: true },
    { title: 'Transporte local (Suica)', date: '2026-09-19', amount: 120, category: 'transporte', estimated: true },
    { title: 'Ingressos previstos no roteiro', date: '2026-09-20', amount: 90, category: 'lazer', estimated: true },
  ],
};

/**
 * O que o CLIENTE recebe é a saída do servidor, não a do modelo.
 *
 * A distinção não é detalhe de teste: `validateActions` é quem traduz o
 * vocabulário do modelo (`title`, `date`) para o do domínio (`description`,
 * `transactionDate`). O cliente valida o resultado dessa tradução — e alimentá-lo
 * com o bruto do modelo mediria um caminho que não existe em produção.
 */
const comoOServidorDevolve = (raw: unknown[]) => validateActions(raw);

describe('despesas: uma previsão vira várias propostas revisáveis', () => {
  it('o servidor aceita a previsão inteira', () => {
    const [action] = validateActions([PREVISAO_DO_MODELO]) as {
      items: { amount: number; transactionDate: string; estimated: boolean }[];
    }[];

    expect(action.items).toHaveLength(4);
    for (const item of action.items) {
      expect(item.amount).toBeGreaterThan(0);
      expect(item.transactionDate >= TOQUIO.startDate).toBe(true);
      expect(item.transactionDate <= TOQUIO.endDate).toBe(true);
      // Sem afirmação explícita do modelo, é estimativa.
      expect(item.estimated).toBe(true);
    }
  });

  it('o cliente parseia e a moeda ausente vira a do orçamento — nunca um palpite', () => {
    const [action] = parseAIActions(comoOServidorDevolve([PREVISAO_DO_MODELO]), TOQUIO, ANTES);
    expect(action.type).toBe('expenses.add');
    if (action.type !== 'expenses.add') throw new Error('inalcançável');

    expect(action.items).toHaveLength(4);
    for (const item of action.items) {
      // Nada de JPY fixo: a moeda é a da viagem, seja ela qual for.
      expect(item.currency).toBe(TOQUIO.budgetCurrency);
      expect(item.estimated).toBe(true);
    }
  });

  it('a categoria fora do enum cai no "outros" em vez de derrubar o item', () => {
    const [action] = parseAIActions(
      comoOServidorDevolve([
        { ...PREVISAO_DO_MODELO, items: [{ ...PREVISAO_DO_MODELO.items[0], category: 'sushi' }] },
      ]),
      TOQUIO,
      ANTES,
    );
    if (action.type !== 'expenses.add') throw new Error('inalcançável');
    expect(action.items[0].category).toBe('outros');
  });

  it('valor e data continuam obrigatórios: uma despesa sem eles não é despesa', () => {
    const semValor = { type: 'expenses.add', label: 'x', items: [{ title: 'Comida', date: '2026-09-19' }] };
    expect(validateActions([semValor])).toEqual([]);
    expect(parseAIActions(comoOServidorDevolve([semValor]), TOQUIO, ANTES)).toEqual([]);
    // E o cliente recusa sozinho, mesmo que um servidor comprometido deixasse
    // passar — é para isso que a terceira porta existe.
    expect(
      parseAIActions(
        [{ type: 'expenses.add', label: 'x', items: [{ description: 'Comida', transactionDate: '2026-09-19' }] }],
        TOQUIO,
        ANTES,
      ),
    ).toEqual([]);

    const valorNegativo = {
      type: 'expenses.add',
      label: 'x',
      items: [{ title: 'Comida', date: '2026-09-19', amount: -5 }],
    };
    expect(validateActions([valorNegativo])).toEqual([]);
  });

  it('a MESMA despesa repetida na mesma resposta entra uma vez só', () => {
    const repetida = PREVISAO_DO_MODELO.items[0];
    const [action] = parseAIActions(
      comoOServidorDevolve([{ ...PREVISAO_DO_MODELO, items: [repetida, repetida, repetida] }]),
      TOQUIO,
      ANTES,
    );
    if (action.type !== 'expenses.add') throw new Error('inalcançável');
    expect(action.items).toHaveLength(1);
  });

  it('dois gastos parecidos mas DIFERENTES continuam sendo dois', () => {
    const [action] = parseAIActions(
      comoOServidorDevolve([
        {
          ...PREVISAO_DO_MODELO,
          items: [
            { title: 'Almoço', date: '2026-09-19', amount: 60 },
            { title: 'Almoço', date: '2026-09-19', amount: 80 },
            { title: 'Almoço', date: '2026-09-20', amount: 60 },
          ],
        },
      ]),
      TOQUIO,
      ANTES,
    );
    if (action.type !== 'expenses.add') throw new Error('inalcançável');
    expect(action.items).toHaveLength(3);
  });

  it('o prompt autoriza a estimativa em vez de mandar perguntar o valor', () => {
    expect(SYSTEM_PROMPT).toContain('PREVISÃO DE DESPESAS');
    expect(SYSTEM_PROMPT).toMatch(/ISTO NÃO SE APLICA AO QUE A PESSOA PEDIU QUE VOCÊ ESTIMASSE/);
    expect(SYSTEM_PROMPT).toMatch(/NÃO ESCREVA ESTIMATIVA COMO FATO/);
  });

  it('CANCELAR não persiste; CONFIRMAR persiste — e a estimativa vai marcada', async () => {
    const db = localDataSource;
    const USER = 'user-expense-forecast';
    await db.purgeUserData(USER);
    const trip = await db.trips.create({
      userId: USER,
      destinationCity: 'Tóquio',
      destinationCountry: 'Japão',
      countryCode: 'JP',
      timezone: 'Asia/Tokyo',
      startDate: '2026-09-18',
      endDate: '2026-09-27',
      budgetTotal: 45000,
      budgetCurrency: 'BRL',
    });

    const actions = parseAIActions(comoOServidorDevolve([PREVISAO_DO_MODELO]), trip, ANTES);
    const groups = buildReviewGroups(actions, { trip, itinerary: [], checklist: [] });
    expect(countSelected(groups)).toBe(4);

    // Cancelar: zero gravações.
    expect(await db.expenses.listByTrip(trip.id)).toHaveLength(0);

    // A pessoa desmarca uma linha e confirma o resto.
    const semAPrimeira = groups.map((group) => ({
      ...group,
      items: group.items.map((item, index) => (index === 0 ? { ...item, included: false } : item)),
    }));

    const report = await executeAIActions(reviewToActions(semAPrimeira), {
      trip,
      userId: USER,
      source: db,
    });

    expect(report.ok).toBe(true);
    const expenses = await db.expenses.listByTrip(trip.id);
    expect(expenses).toHaveLength(3);
    // Estimativa não vira fato: a marca persiste no único lugar que o modelo
    // de dados comporta.
    for (const expense of expenses) {
      expect(expense.description.startsWith('Estimativa — ')).toBe(true);
    }
  });
});

/* ========================================================================== */
/* 9. COERÊNCIA TEXTO × PROPOSTA                                              */
/* ========================================================================== */

describe('coerência: prometer diário ou despesas sem action não passa', () => {
  const promessas = [
    'Preparei uma entrada de diário para o dia 18.',
    'Montei as despesas obrigatórias da sua viagem.',
    'Suas despesas estão prontas.',
  ];

  it.each(promessas)('o servidor corta "%s" quando actions está vazio', (frase) => {
    const { stripped } = enforcePromiseCoherence(frase, 0);
    expect(stripped).toBeGreaterThan(0);
  });

  it.each(promessas)('o cliente corta "%s" quando a validação local descarta tudo', (frase) => {
    const { stripped } = enforceAIActionPromiseCoherence(frase, 0);
    expect(stripped).toBeGreaterThan(0);
  });

  it('com a action presente, a mesma frase fica intacta nos dois lados', () => {
    for (const frase of promessas) {
      expect(enforcePromiseCoherence(frase, 1)).toEqual({ content: frase, stripped: 0 });
      expect(enforceAIActionPromiseCoherence(frase, 1)).toEqual({ content: frase, stripped: 0 });
    }
  });

  /*
   * O CORTE NÃO PODE COMER A RESPOSTA CERTA.
   *
   * Uma pergunta de leitura — "estou gastando demais?" — corretamente não traz
   * action, e a resposta fala de despesas. Um padrão que reagisse à palavra
   * "despesas" perto de "abaixo" apagaria exatamente a resposta boa e deixaria
   * a pessoa com a frase genérica de ausência.
   */
  const leituras = [
    'Suas despesas estão abaixo do orçamento previsto para esta altura da viagem.',
    'Os gastos com alimentação estão logo abaixo da média diária que você separou.',
    'Você ainda não tem despesas registradas nesta viagem.',
  ];

  it.each(leituras)('resposta de leitura sobrevive intacta: "%s"', (frase) => {
    expect(enforcePromiseCoherence(frase, 0)).toEqual({ content: frase, stripped: 0 });
    expect(enforceAIActionPromiseCoherence(frase, 0)).toEqual({ content: frase, stripped: 0 });
  });

  it('a resposta REAL do aparelho: promessa sem proposta virava a frase de ausência', () => {
    /*
     * Este é o texto que a pessoa viu. Ele não era um bug do corte — o corte
     * estava certo. O defeito estava atrás dele: o modelo devolvia
     * `actions: []` porque o prompt mandava perguntar o valor.
     */
    const { content } = enforceAIActionPromiseCoherence(
      'Preparei a proposta de despesas. Revise e confirme no aplicativo.',
      0,
    );
    expect(content).toContain('Não consegui montar uma proposta aplicável');
  });

  it('a leitura completa do servidor: journal + despesas na mesma resposta', () => {
    const bruto = JSON.stringify({
      content: 'Separei um registro para o dia 18 e uma previsão de gastos estimados.',
      actions: [journalAction(VALID_JOURNAL), PREVISAO_DO_MODELO],
    });

    const output = readModelOutput(bruto);
    expect(output.stats.parsed).toBe(true);
    expect(output.stats.validActions).toBe(2);

    const actions: AITripAction[] = parseAIActions(output.actions, TOQUIO, ANTES);
    expect(actions.map((a) => a.type).sort()).toEqual(['expenses.add', 'journal.add']);
    // O texto sobrevive intacto: a promessa é verdadeira.
    expect(output.stats.strippedPromises).toBe(0);
  });
});
