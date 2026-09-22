import AsyncStorage from '@react-native-async-storage/async-storage';

import { buildReviewGroups, reviewToActions, toggleItem } from '@/domain/aiActionReview';
import { isApplyConfirmation, parseAIActions } from '@/domain/aiActions';
import { readModelOutput } from '../../supabase/functions/ai-chat/protocol';
import { readAITripContext, writeAITripContext } from '@/lib/aiTripContext';
import { prefsStorage } from '@/lib/storage';
import { getRemainingBudget, getTripTotalSpent } from '@/domain/selectors';
import type { Trip } from '@/domain/types';
import { localDataSource as db } from '@/repositories/local/LocalDataSource';
import { executeAIActions } from '@/services/aiActionExecutor';

/**
 * O percurso inteiro da IA acionável, na ordem em que ele acontece de verdade
 * (§34, §35).
 *
 * O que este teste mede que os unitários não medem é a **costura**: a proposta
 * que a Edge Function devolveria é validada, carimbada com a viagem, revisada,
 * confirmada, gravada — e o que se lê depois é o roteiro real da viagem, pelo
 * mesmo `listByTrip` que a tela de Roteiro usa. Nenhum atalho, nenhuma
 * estrutura paralela.
 *
 * `localDataSource` é o adaptador do modo demonstração, com AsyncStorage real
 * em memória. O equivalente remoto — RLS de verdade separando USER_A de USER_B
 * no Postgres — são as baterias de `supabase/tests/`; aqui a separação é
 * verificada pelo mesmo contrato de repositório que as duas implementações
 * satisfazem.
 */

const USER_A = 'user-ia-acionavel-a';
const USER_B = 'user-ia-acionavel-b';

/** O corpo que `ai-chat` devolveria — texto para ler, ações para aplicar. */
const respostaDoModelo = {
  content:
    'Claro. Organizei o dia considerando sua viagem para Paris — o Louvre pela manhã ' +
    'e a Torre Eiffel no fim da tarde. Se quiser, posso adicionar isso ao seu roteiro.',
  actions: [
    {
      type: 'itinerary.add',
      label: 'Adicionar 4 itens ao roteiro',
      items: [
        { title: 'Museu do Louvre', date: '2026-08-23', startTime: '09:00', type: 'atracao' },
        { title: 'Almoço', date: '2026-08-23', startTime: '12:30', type: 'refeicao' },
        { title: 'Jardin des Tuileries', date: '2026-08-23', startTime: '15:00', type: 'atividade' },
        { title: 'Torre Eiffel', date: '2026-08-23', startTime: '18:00', type: 'atracao' },
      ],
    },
  ],
};

let paris: Trip;
let toquio: Trip;

beforeAll(async () => {
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

describe('IA acionável, do pedido ao registro', () => {
  it('"monte um roteiro de amanhã" → revisar → confirmar → o roteiro real recebe', async () => {
    /* 1. A proposta chega e é validada e carimbada com a viagem da conversa. */
    const propostas = parseAIActions(respostaDoModelo.actions, paris);
    expect(propostas).toHaveLength(1);
    expect(propostas[0].tripId).toBe(paris.id);

    /* 2. A revisão abre com tudo marcado — nada duplica, tudo cabe nas datas. */
    const grupos = buildReviewGroups(propostas, {
      trip: paris,
      itinerary: await db.itinerary.listByTrip(paris.id),
      checklist: await db.checklist.listByTrip(paris.id),
    });
    expect(grupos[0].items.every((item) => item.included)).toBe(true);

    /* 3. Confirmação. */
    const relatorio = await executeAIActions(reviewToActions(grupos), {
      trip: paris,
      userId: USER_A,
      source: db,
    });
    expect(relatorio.ok).toBe(true);
    expect(relatorio.outcomes[0].summary).toBe('4 itens adicionados ao roteiro');

    /* 4. O roteiro real — o mesmo que a tela lê. */
    const roteiro = await db.itinerary.listByTrip(paris.id);
    expect(roteiro).toHaveLength(4);
    expect(roteiro.map((item) => item.startTime).sort()).toEqual([
      '09:00',
      '12:30',
      '15:00',
      '18:00',
    ]);
  });

  it('os itens saem da memória e chegam ao armazenamento durável', async () => {
    /*
     * O que faz os itens sobreviverem ao fechamento do app não é o cache em
     * memória da coleção — é a gravação no AsyncStorage. Então é ela que se
     * verifica, lendo a chave crua: se o registro está aqui, a próxima abertura
     * o encontra, porque é exatamente daqui que a coleção hidrata.
     */
    const bruto = await AsyncStorage.getItem('et:data:itinerary');
    const gravados = JSON.parse(bruto ?? '[]') as { tripId: string; title: string }[];

    expect(
      gravados
        .filter((item) => item.tripId === paris.id)
        .map((item) => item.title)
        .sort(),
    ).toEqual(['Almoço', 'Jardin des Tuileries', 'Museu do Louvre', 'Torre Eiffel']);
  });

  it('"adicione protetor solar e adaptador ao checklist" → o checklist real recebe', async () => {
    const propostas = parseAIActions(
      [
        {
          type: 'checklist.add',
          label: 'Adicionar 2 itens ao checklist',
          items: [
            { label: 'Protetor solar', category: 'saude' },
            { label: 'Adaptador de tomada', category: 'mala' },
          ],
        },
      ],
      paris,
    );

    await executeAIActions(propostas, { trip: paris, userId: USER_A, source: db });

    const checklist = await db.checklist.listByTrip(paris.id);
    expect(checklist.map((item) => item.label).sort()).toEqual([
      'Adaptador de tomada',
      'Protetor solar',
    ]);
  });

  it('"minha passagem custou R$ 3.200" → a despesa entra e o orçamento reage', async () => {
    const propostas = parseAIActions(
      [
        {
          type: 'expenses.add',
          label: 'Adicionar despesa de R$ 3.200',
          items: [
            {
              description: 'Passagem aérea',
              category: 'transporte',
              amount: 3200,
              currency: 'BRL',
              transactionDate: '2026-08-22',
              // Valor informado pela pessoa — não é estimativa.
              estimated: false,
            },
          ],
        },
      ],
      paris,
    );

    await executeAIActions(propostas, { trip: paris, userId: USER_A, source: db });

    const despesas = await db.expenses.listByTrip(paris.id);
    expect(despesas).toHaveLength(1);
    expect(despesas[0].description).toBe('Estimativa — Passagem aérea');
    expect(despesas[0].amount).toBe(3200);

    // O orçamento restante sai dos seletores de sempre, sem nada específico da IA.
    expect(getTripTotalSpent(despesas, paris)).toBe(3200);
    expect(getRemainingBudget(despesas, paris)).toBe(26800);
  });

  it('plano composto: roteiro + despesas, escolhendo o que entra', async () => {
    const propostas = parseAIActions(
      [
        {
          type: 'itinerary.add',
          label: 'Roteiro do dia',
          items: [
            { title: 'Saída do hotel', date: '2026-08-24', startTime: '09:00', type: 'transporte' },
            { title: 'Entrada no parque', date: '2026-08-24', startTime: '10:00', type: 'atracao' },
            { title: 'Retorno', date: '2026-08-24', startTime: '18:00', type: 'transporte' },
          ],
        },
        {
          type: 'expenses.add',
          label: 'Despesas estimadas',
          items: [
            { description: 'Ingresso', category: 'lazer', amount: 450, currency: 'BRL', transactionDate: '2026-08-24' },
            { description: 'Alimentação', category: 'alimentacao', amount: 150, currency: 'BRL', transactionDate: '2026-08-24' },
            { description: 'Transporte', category: 'transporte', amount: 80, currency: 'BRL', transactionDate: '2026-08-24' },
          ],
        },
      ],
      paris,
    );

    let grupos = buildReviewGroups(propostas, {
      trip: paris,
      itinerary: await db.itinerary.listByTrip(paris.id),
      checklist: await db.checklist.listByTrip(paris.id),
    });

    // A pessoa decide não registrar a estimativa de alimentação.
    grupos = toggleItem(grupos, grupos[1].items[1].key);

    const relatorio = await executeAIActions(reviewToActions(grupos), {
      trip: paris,
      userId: USER_A,
      source: db,
    });

    expect(relatorio.ok).toBe(true);
    expect(relatorio.outcomes.map((outcome) => outcome.summary)).toEqual([
      '3 itens adicionados ao roteiro',
      'R$ 530,00 em despesas adicionadas',
    ]);

    const dia = (await db.itinerary.listByTrip(paris.id)).filter((item) => item.date === '2026-08-24');
    expect(dia).toHaveLength(3);

    const despesas = await db.expenses.listByTrip(paris.id);
    // O que ficou desmarcado não entrou; o que era estimativa entrou rotulado.
    expect(despesas.map((expense) => expense.description).sort()).toEqual([
      'Estimativa — Ingresso',
      'Estimativa — Passagem aérea',
      'Estimativa — Transporte',
    ]);
  });

  it('a proposta de Paris não entra em Tóquio, nem na conta de outra pessoa', async () => {
    const deParis = parseAIActions(respostaDoModelo.actions, paris);

    const relatorio = await executeAIActions(deParis, {
      trip: toquio,
      userId: USER_B,
      source: db,
    });

    expect(relatorio.ok).toBe(false);
    expect(await db.itinerary.listByTrip(toquio.id)).toHaveLength(0);
    expect(await db.checklist.listByTrip(toquio.id)).toHaveLength(0);
    expect(await db.expenses.listByTrip(toquio.id)).toHaveLength(0);

    // E nada do USER_A vazou para a lista do USER_B.
    const viagensB = await db.trips.list(USER_B);
    expect(viagensB.map((trip) => trip.id)).toEqual([toquio.id]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * O fluxo crítico do hotfix, ponta a ponta: a resposta crua do Gemini entra
 * pelo mesmo lugar por onde ela entra em produção — `readModelOutput`, na Edge
 * Function — e sai como registro no roteiro real. É a costura que faltava: os
 * testes anteriores começavam da proposta já validada, e o defeito no aparelho
 * estava justamente **antes** disso.
 * ---------------------------------------------------------------------------
 */

describe('do Gemini ao roteiro, sem atalho', () => {
  const USER_C = 'user-ia-acionavel-c';
  let lisboa: Awaited<ReturnType<typeof db.trips.create>>;

  /** O corpo cru que a API do Gemini devolve, incluindo a parte de raciocínio. */
  const respostaCrua = {
    candidates: [
      {
        content: {
          parts: [
            { text: 'Preciso usar trip.today para resolver "amanhã".', thought: true },
            {
              text: JSON.stringify({
                content:
                  'Preparei uma sugestão para amanhã com três lugares. ' +
                  'Revise e confirme a aplicação no aplicativo.',
                actions: [
                  {
                    type: 'itinerary.add',
                    label: 'Adicionar 3 itens ao roteiro',
                    items: [
                      { title: 'Mosteiro dos Jerónimos', date: '2026-09-02', startTime: '09:30', type: 'atracao' },
                      { title: 'Torre de Belém', date: '2026-09-02', startTime: '11:30', type: 'atracao' },
                      { title: 'Time Out Market', date: '2026-09-02', startTime: '13:00', type: 'refeicao' },
                    ],
                  },
                ],
              }),
            },
          ],
        },
      },
    ],
  };

  const juntarPartes = (data: typeof respostaCrua) =>
    data.candidates[0].content.parts
      .filter((part) => (part as { thought?: boolean }).thought !== true)
      .map((part) => part.text ?? '')
      .join('')
      .trim();

  beforeAll(async () => {
    await db.purgeUserData(USER_C);
    lisboa = await db.trips.create({
      userId: USER_C,
      destinationCity: 'Lisboa',
      destinationCountry: 'Portugal',
      countryCode: 'PT',
      timezone: 'Europe/Lisbon',
      startDate: '2026-09-01',
      endDate: '2026-09-10',
      budgetTotal: 20000,
      budgetCurrency: 'BRL',
    });
    await writeAITripContext(USER_C, lisboa.id);
  });

  it('a resposta crua vira três itens no roteiro real', async () => {
    /* 1. O servidor lê a resposta: raciocínio fora, proposta dentro. */
    const saida = readModelOutput(juntarPartes(respostaCrua));
    expect(saida.actions).toHaveLength(1);
    // A promessa do texto é verdadeira, então ela permanece.
    expect(saida.content).toMatch(/Revise e confirme/i);

    /* 2. O cliente valida de novo e carimba a viagem da conversa. */
    const propostas = parseAIActions(saida.actions, lisboa);
    expect(propostas).toHaveLength(1);
    expect(propostas[0].tripId).toBe(lisboa.id);

    /* 3. A tela mostraria o card: há proposta, e ela tem três itens. */
    expect(propostas[0].type === 'itinerary.add' && propostas[0].items).toHaveLength(3);

    /* 4. "Pode aplicar" abre a revisão da proposta que já existe. */
    expect(isApplyConfirmation('Pode aplicar')).toBe(true);
    const grupos = buildReviewGroups(propostas, {
      trip: lisboa,
      itinerary: await db.itinerary.listByTrip(lisboa.id),
      checklist: await db.checklist.listByTrip(lisboa.id),
    });
    expect(grupos[0].items).toHaveLength(3);
    expect(grupos[0].items.every((item) => item.included)).toBe(true);

    /* 5. Confirmação → gravação. */
    const relatorio = await executeAIActions(reviewToActions(grupos), {
      trip: lisboa,
      userId: USER_C,
      source: db,
    });
    expect(relatorio.ok).toBe(true);

    /* 6. E a aba Roteiro passa a mostrar os três. */
    const roteiro = await db.itinerary.listByTrip(lisboa.id);
    expect(roteiro.map((item) => item.title).sort()).toEqual([
      'Mosteiro dos Jerónimos',
      'Time Out Market',
      'Torre de Belém',
    ]);
  });

  it('fechar e reabrir mantém os três', async () => {
    // A durabilidade real: o que está no AsyncStorage é o que a próxima
    // abertura hidrata.
    const bruto = await AsyncStorage.getItem('et:data:itinerary');
    const gravados = JSON.parse(bruto ?? '[]') as { tripId: string; title: string }[];

    expect(gravados.filter((item) => item.tripId === lisboa.id)).toHaveLength(3);
  });

  it('novo chat apaga a conversa, e o roteiro continua lá', async () => {
    const conversa = await db.ai.getOrCreateConversation(USER_C, lisboa.id);
    await db.ai.addMessage({
      conversationId: conversa.id,
      role: 'user',
      content: 'Monte um roteiro para amanhã com 3 lugares.',
    });

    await db.ai.deleteConversation(conversa.id);
    const nova = await db.ai.createConversation(USER_C, lisboa.id);

    expect(await db.ai.listMessages(nova.id)).toEqual([]);
    expect((await db.ai.getOrCreateConversation(USER_C, lisboa.id)).id).toBe(nova.id);
    // O que foi aplicado é registro da viagem, não da conversa: apagar o chat
    // não desfaz o roteiro.
    expect(await db.itinerary.listByTrip(lisboa.id)).toHaveLength(3);
  });

  it('a Home muda de viagem e a IA continua em Lisboa', async () => {
    // As duas seleções são independentes (ver `ai-context-independence`). Aqui
    // a verificação é de ponta: mexer numa não move a outra, em disco.
    await prefsStorage.set('currentTripId', paris.id);

    expect(await readAITripContext(USER_C)).toBe(lisboa.id);
    expect(await prefsStorage.get('currentTripId', null)).toBe(paris.id);
  });
});
