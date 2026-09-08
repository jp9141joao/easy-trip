import {
  ACTION_TYPES,
  FULL_DAY_MAX_ITEMS,
  FULL_DAY_MIN_ITEMS,
  RESPONSE_SCHEMA,
  buildRepairInstruction,
  classifyItineraryRequest,
  discloseIncompleteItinerary,
  enforcePromiseCoherence,
  itineraryItemCount,
  needsItineraryRepair,
  newActionDropLog,
  normalizeItineraryDates,
  pickBetterItinerary,
  readModelOutput,
  resolveFullDayDate,
  tripDays,
  validateActions,
} from '../../supabase/functions/ai-chat/protocol';

import { parseAIActions } from '@/domain/aiActions';
import type { Trip } from '@/domain/types';

/**
 * O contrato de roteiro de dia inteiro (§1–§6 do handoff).
 *
 * O DEFEITO QUE ESTA SUÍTE MEDE
 *
 * No Android real, "Monte um roteiro para amanhã" voltou com UMA atividade. Um
 * dia com uma parada não é um roteiro: a pessoa fecha a tela achando que
 * planejou o dia. E, quando amanhã caía fora da viagem, a IA oferecia o
 * primeiro dia — mas o "Pode ser" seguinte voltava como conversa genérica, sem
 * data resolvida e sem ActionCard.
 *
 * A classificação roda no SERVIDOR e sobre o PEDIDO, nunca sobre a resposta do
 * modelo: ela só liga ou desliga uma exigência de quantidade, e por isso texto
 * do usuário aqui continua sendo dado, não comando.
 */

const moscou: Trip = {
  id: 'trip-moscou',
  userId: 'user-1',
  destinationCity: 'Moscovo',
  destinationCountry: 'Rússia',
  countryCode: 'RU',
  timezone: 'Europe/Moscow',
  startDate: '2026-09-10',
  endDate: '2026-09-16',
  budgetTotal: 12000,
  budgetCurrency: 'BRL',
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-08-01T10:00:00.000Z',
};

/** Uma resposta do Gemini, no formato `{ content, actions }` já em texto. */
function reply(content: string, items: { title: string; date: string; startTime?: string }[]) {
  return JSON.stringify({
    content,
    actions: items.length
      ? [{ type: 'itinerary.add', label: 'Adicionar ao roteiro', items }]
      : [],
  });
}

const cincoParadas = [
  { title: 'Praça Vermelha', date: '2026-09-10', startTime: '09:00' },
  { title: 'Catedral de São Basílio', date: '2026-09-10', startTime: '11:30' },
  { title: 'Almoço no Café Pushkin', date: '2026-09-10', startTime: '14:00' },
  { title: 'Galeria Tretyakov', date: '2026-09-10', startTime: '17:00' },
  { title: 'Jantar no bairro Kitay-gorod', date: '2026-09-10', startTime: '20:00' },
];

describe('classificação do pedido', () => {
  it('reconhece um pedido de roteiro de dia inteiro', () => {
    for (const prompt of [
      'Monte um roteiro para amanhã',
      'monte meu dia',
      'Planeje o dia 12 pra mim',
      'me faz um roteiro para o dia todo',
      'o que fazer amanhã?',
      'Quero um itinerário para quinta',
    ]) {
      expect(classifyItineraryRequest(prompt).expectsFullDay).toBe(true);
    }
  });

  it('não exige o dia inteiro quando a pessoa pediu uma coisa só', () => {
    const pedido = classifyItineraryRequest('Quero só um restaurante para amanhã');
    expect(pedido.singleItem).toBe(true);
    expect(pedido.expectsFullDay).toBe(false);
  });

  it('não exige o dia inteiro quando o recorte é um período', () => {
    const pedido = classifyItineraryRequest('Planeje só minha manhã');
    expect(pedido.partialPeriod).toBe(true);
    expect(pedido.expectsFullDay).toBe(false);
  });

  it('não confunde leitura com pedido de roteiro', () => {
    expect(classifyItineraryRequest('quanto já gastei?').expectsFullDay).toBe(false);
    expect(classifyItineraryRequest('como está meu checklist?').expectsFullDay).toBe(false);
  });
});

describe('"Pode ser" resolve a proposta anterior', () => {
  const ofereceu = [
    { role: 'user', content: 'Monte um roteiro para amanhã' },
    {
      role: 'assistant',
      content:
        'Amanhã (09/09) ainda está fora do período da viagem, que começa em 10/09. ' +
        'Posso montar o roteiro para o primeiro dia da viagem?',
    },
  ];

  it.each(['Pode ser', 'sim', 'pode', 'Faça isso', 'isso mesmo', 'ok'])(
    '"%s" herda a intenção de roteiro da oferta anterior',
    (resposta) => {
      const pedido = classifyItineraryRequest(resposta, ofereceu);
      expect(pedido.acceptsPriorOffer).toBe(true);
      expect(pedido.expectsFullDay).toBe(true);
    },
  );

  it('um "sim" sem oferta anterior não vira pedido de roteiro', () => {
    const semOferta = [
      { role: 'user', content: 'quanto já gastei?' },
      { role: 'assistant', content: 'Você já gastou R$ 1.200 nesta viagem.' },
    ];
    const pedido = classifyItineraryRequest('sim', semOferta);
    expect(pedido.acceptsPriorOffer).toBe(false);
    expect(pedido.expectsFullDay).toBe(false);
  });

  it('uma resposta que carrega instrução nova não é um simples aceite', () => {
    const pedido = classifyItineraryRequest(
      'pode ser, mas troque o museu por um parque e comece mais tarde',
      ofereceu,
    );
    expect(pedido.acceptsPriorOffer).toBe(false);
  });

  it('o aceite gera roteiro completo com ActionCard no cliente', () => {
    const bruto = reply(
      'Fechado — preparei o dia 10/09, o primeiro da viagem. Revise e aplique quando quiser.',
      cincoParadas,
    );
    const saida = readModelOutput(bruto);
    const pedido = classifyItineraryRequest('Pode ser', ofereceu);

    expect(needsItineraryRepair(pedido, saida.actions)).toBe(false);

    // O circuito completo: o que o cliente aceitaria de fato vira o ActionCard.
    const doCliente = parseAIActions(saida.actions, moscou);
    expect(doCliente).toHaveLength(1);
    expect(doCliente[0].type).toBe('itinerary.add');
    expect(doCliente[0].type === 'itinerary.add' && doCliente[0].items).toHaveLength(5);
    // Todos os itens caem na MESMA data oferecida — não em datas espalhadas.
    if (doCliente[0].type === 'itinerary.add') {
      expect(new Set(doCliente[0].items.map((item) => item.date))).toEqual(new Set(['2026-09-10']));
    }
  });
});

describe('reparo do roteiro de um item só', () => {
  it('um roteiro de dia inteiro com 1 item pede reparo', () => {
    const saida = readModelOutput(
      reply('Preparei um roteiro para amanhã.', [
        { title: 'Praça Vermelha', date: '2026-09-10', startTime: '09:00' },
      ]),
    );
    expect(itineraryItemCount(saida.actions)).toBe(1);
    expect(needsItineraryRepair(classifyItineraryRequest('Monte um roteiro para amanhã'), saida.actions)).toBe(true);
  });

  it('texto prometendo roteiro sem action nenhuma também pede reparo', () => {
    const saida = readModelOutput(reply('Montei uma proposta de roteiro para amanhã.', []), {
      enforceCoherence: false,
    });
    expect(itineraryItemCount(saida.actions)).toBe(-1);
    expect(needsItineraryRepair(classifyItineraryRequest('Monte um roteiro para amanhã'), saida.actions)).toBe(true);
  });

  it('um item só NÃO pede reparo quando foi um item só que se pediu', () => {
    const saida = readModelOutput(
      reply('Posso adicionar este restaurante ao seu dia.', [
        { title: 'Café Pushkin', date: '2026-09-11', startTime: '20:00' },
      ]),
    );
    const pedido = classifyItineraryRequest('Quero só um restaurante para amanhã');
    expect(needsItineraryRepair(pedido, saida.actions)).toBe(false);
  });

  it('a instrução de reparo pede 3–6, mesma data, horários e nada inventado', () => {
    const instrucao = buildRepairInstruction(1);
    expect(instrucao).toMatch(/3 a 6 atividades/);
    expect(instrucao).toMatch(/MESMA data/);
    expect(instrucao).toMatch(/startTime/);
    expect(instrucao).toMatch(/nenhuma atividade repetida/);
    expect(instrucao).toMatch(/proibido inventar reserva, preço, disponibilidade/);
  });

  it('o reparo só substitui a resposta quando de fato completou mais', () => {
    const original = readModelOutput(
      reply('Comecei o seu dia.', [cincoParadas[0], cincoParadas[1]]),
    );
    const melhor = readModelOutput(reply('Aqui está o dia completo.', cincoParadas));
    const pior = readModelOutput(reply('Só consegui um ponto.', [cincoParadas[0]]));

    expect(pickBetterItinerary(original, melhor)).toBe(melhor);
    // Um reparo que veio pior não pode apagar o que já servia.
    expect(pickBetterItinerary(original, pior)).toBe(original);
  });
});

describe('honestidade quando o dia não fecha', () => {
  it('avisa que não é um roteiro completo em vez de fingir', () => {
    const saida = readModelOutput(
      reply('Preparei seu roteiro para amanhã.', [cincoParadas[0], cincoParadas[1]]),
      { enforceCoherence: false },
    );
    const texto = discloseIncompleteItinerary(
      saida.content,
      classifyItineraryRequest('Monte um roteiro para amanhã'),
      saida.actions,
    );

    expect(texto).toMatch(/Não consegui fechar o dia inteiro/);
    expect(texto).toMatch(/2 paradas/);
    // A proposta parcial continua existindo — o que muda é o que se afirma.
    expect(itineraryItemCount(saida.actions)).toBe(2);
  });

  it('não acrescenta ressalva a um roteiro que fechou o dia', () => {
    const saida = readModelOutput(reply('Seu dia está montado.', cincoParadas));
    expect(
      discloseIncompleteItinerary(
        saida.content,
        classifyItineraryRequest('Monte um roteiro para amanhã'),
        saida.actions,
      ),
    ).toBe(saida.content);
    expect(itineraryItemCount(saida.actions)).toBeGreaterThanOrEqual(FULL_DAY_MIN_ITEMS);
  });

  it('sem nenhuma action, a promessa continua sendo cortada', () => {
    const saida = readModelOutput(reply('Preparei a proposta de roteiro.', []), {
      enforceCoherence: false,
    });
    const texto = discloseIncompleteItinerary(
      saida.content,
      classifyItineraryRequest('Monte um roteiro para amanhã'),
      saida.actions,
    );
    const coerente = enforcePromiseCoherence(texto, saida.actions.length);

    expect(coerente.stripped).toBeGreaterThan(0);
    expect(coerente.content).not.toMatch(/[Pp]reparei a proposta/);
    expect(coerente.content).toMatch(/Não consegui montar um roteiro completo/);
  });
});

/* ---------------------- o caso real do Android (12:34) --------------------- */

/**
 * A CONVERSA QUE FALHOU NO APARELHO, TURNO A TURNO.
 *
 * Três requisições, todas HTTP 200, todas sem ActionCard na tela. Não foi
 * cota, não foi timeout, não foi deploy velho: foram dois defeitos de
 * interpretação, um em cada ponta do pipeline.
 *
 * 1. `classifyItineraryRequest` não reconheceu "Pode ser para o dia 18 na vdd"
 *    como aceite — sete palavras contra um teto de cinco, e padrões ancorados
 *    que não sobreviviam à cauda. Sem `expectsFullDay`, o reparo nunca rodou e
 *    o piso de 3 paradas nunca foi cobrado.
 *
 * 2. `enforcePromiseCoherence` não cortou "A proposta está pronta para revisão
 *    e aplicação." com zero actions, porque só conhecia o VERBO `revisar`. O
 *    texto prometeu um botão que a tela não tinha.
 *
 * O segundo é o mais grave dos dois: é o system prompt que manda escrever essa
 * frase, então ela é a redação MAIS PROVÁVEL do fluxo — e era justamente a que
 * escapava. Estes testes existem para que nenhuma das duas volte.
 */
describe('o caso do Android: aceite com data e promessa sem proposta', () => {
  const tokyo: Trip = {
    ...moscou,
    id: 'trip-tokyo',
    destinationCity: 'Tóquio',
    destinationCountry: 'Japão',
    countryCode: 'JP',
    timezone: 'Asia/Tokyo',
    startDate: '2026-09-18',
    endDate: '2026-09-27',
  };

  /** O turno anterior REAL: uma oferta concreta de data. */
  const ofertaConcreta = [
    {
      role: 'assistant',
      content:
        'Ainda não tenho a data. Posso montar o roteiro para o primeiro dia da ' +
        'viagem (18/09/2026) ou para outra data dentro do período?',
    },
  ];

  /*
   * As variações que a pessoa escreve de verdade. Nenhuma delas é a frase
   * literal "Pode ser" — e era só ela que funcionava.
   */
  const aceites = [
    'Pode ser',
    'Pode ser para o dia 18 na vdd',
    'Pode ser para o dia 18 na verdade',
    'Dia 18 então',
    'Vamos de 18',
    '18 pode ser',
    'Pode ser dia 18',
    'Sim, pode',
  ];

  it.each(aceites)('"%s" depois de uma oferta concreta é aceite de dia inteiro', (frase) => {
    const request = classifyItineraryRequest(frase, ofertaConcreta);
    expect(request.acceptsPriorOffer).toBe(true);
    expect(request.expectsFullDay).toBe(true);
  });

  it('nomear o dia já é pedir o dia: "Tokyo dia 18 de setembro"', () => {
    // Sem verbo e sem a palavra "roteiro" — era o que o classificador exigia,
    // e é o segundo turno que voltou "proposta pronta" sem proposta nenhuma.
    const request = classifyItineraryRequest('Tokyo dia 18 de setembro', []);
    expect(request.expectsFullDay).toBe(true);
  });

  it('um aceite sem oferta anterior continua não sendo pedido de roteiro', () => {
    /*
     * A trava que impede o caminho novo de virar gatilho universal: sem oferta
     * concreta no turno anterior, "pode ser" não decide nada. Sem isto, um
     * "sim" a "quer que eu detalhe o orçamento?" viraria um roteiro.
     */
    /*
     * Sem oferta, `acceptsPriorOffer` é falso — é ESSA a trava. Nomear o dia
     * ainda pode pedir o dia por conta própria ("dia 18" é um pedido tão
     * válido quanto "Tokyo dia 18 de setembro"); o que não pode é a frase
     * herdar uma intenção de um turno que não existiu.
     */
    expect(
      classifyItineraryRequest('Pode ser para o dia 18 na vdd', []).acceptsPriorOffer,
    ).toBe(false);

    // E um aceite SEM data, sem oferta, não decide nada.
    expect(classifyItineraryRequest('Pode ser', []).expectsFullDay).toBe(false);
    expect(
      classifyItineraryRequest('Pode ser', [
        { role: 'assistant', content: 'Quer que eu detalhe o orçamento?' },
      ]).expectsFullDay,
    ).toBe(false);
  });

  it('citar o dia numa PERGUNTA não vira roteiro', () => {
    // "Quanto gastei no dia 18?" nomeia a data e é leitura. Responder com um
    // roteiro seria responder outra pergunta.
    for (const consulta of [
      'Quanto gastei no dia 18?',
      'Qual o saldo do orçamento?',
      'Quanto já gastei?',
    ]) {
      expect(classifyItineraryRequest(consulta, []).expectsFullDay).toBe(false);
    }
  });

  it('aceite COM pedido dentro não é um simples sim', () => {
    // "pode ser, mas troque o museu pelo parque" carrega instrução: tratá-la
    // como "sim" perderia o que a pessoa pediu.
    const request = classifyItineraryRequest(
      'Pode ser, mas troque o museu pelo parque',
      ofertaConcreta,
    );
    expect(request.acceptsPriorOffer).toBe(false);
  });

  it('sem action, "A proposta está pronta para revisão e aplicação." não sobrevive', () => {
    /*
     * A frase exata da tela do Android. Com zero actions ela aponta para um
     * botão inexistente, e o contrato do §12 é claro: content e actions têm de
     * ser coerentes.
     */
    const frase = 'A proposta está pronta para revisão e aplicação.';
    const coerente = enforcePromiseCoherence(frase, 0);

    expect(coerente.stripped).toBeGreaterThan(0);
    expect(coerente.content).not.toMatch(/revis(ão|ao)/i);
    expect(coerente.content).not.toMatch(/aplica(ção|cao)/i);
    expect(coerente.content).toMatch(/Não consegui montar uma proposta aplicável/);
  });

  it('COM action, a mesma frase fica intacta', () => {
    // A coerência corta por falta de proposta, não por escolha de palavra. É o
    // system prompt que manda escrever assim quando existe o que aplicar.
    const frase = 'A proposta está pronta para revisão e aplicação.';
    const coerente = enforcePromiseCoherence(frase, 1);

    expect(coerente.stripped).toBe(0);
    expect(coerente.content).toBe(frase);
  });

  it('texto informativo sem promessa não é cortado', () => {
    // O corte precisa ser cirúrgico: uma resposta que só informa continua
    // valendo mesmo sem proposta.
    const texto = 'Tóquio em setembro costuma estar quente e úmido. O metrô fecha à meia-noite.';
    expect(enforcePromiseCoherence(texto, 0)).toEqual({ content: texto, stripped: 0 });
  });

  it('o servidor devolve a action, e o cliente a mantém — mesma proposta, ponta a ponta', () => {
    /*
     * O elo que faltava provar: um número que sai do servidor e chega ao
     * estado do cliente. Se `parseAIActions` descartasse a action aqui, o
     * ActionCard sumiria com o servidor tendo feito tudo certo.
     */
    const itens = [
      { title: 'Senso-ji', date: '2026-09-18', startTime: '09:00' },
      { title: 'Almoço em Asakusa', date: '2026-09-18', startTime: '12:30' },
      { title: 'Shibuya Crossing', date: '2026-09-18', startTime: '16:00' },
      { title: 'Jantar em Shinjuku', date: '2026-09-18', startTime: '20:00' },
    ];
    const bruto = readModelOutput(
      reply('A proposta está pronta para revisão e aplicação.', itens),
    );

    const request = classifyItineraryRequest('Tokyo dia 18 de setembro', []);
    expect(needsItineraryRepair(request, bruto.actions)).toBe(false);

    const servidor = enforcePromiseCoherence(bruto.content, bruto.actions.length);
    expect(servidor.stripped).toBe(0);
    expect(bruto.actions).toHaveLength(1);

    const cliente = parseAIActions(bruto.actions, tokyo);
    expect(cliente).toHaveLength(1);
    expect(cliente[0].type).toBe('itinerary.add');
    expect(cliente[0].type === 'itinerary.add' && cliente[0].items).toHaveLength(4);
    expect(
      cliente[0].type === 'itinerary.add' && cliente[0].items.every((i) => i.date === '2026-09-18'),
    ).toBe(true);
    // O carimbo é do servidor da conversa, nunca do modelo.
    expect(cliente[0].tripId).toBe(tokyo.id);
  });

  it('full-day sem action nenhuma nunca passa por sucesso', () => {
    /*
     * O estado proibido pelo §6: HTTP 200, texto prometendo proposta, zero
     * actions. O reparo tem de ser exigido, e o texto tem de perder a promessa.
     */
    const request = classifyItineraryRequest('Tokyo dia 18 de setembro', []);
    const semAction = readModelOutput(
      reply('A proposta está pronta para revisão e aplicação.', []),
    );

    expect(request.expectsFullDay).toBe(true);
    expect(needsItineraryRepair(request, semAction.actions)).toBe(true);

    const coerente = enforcePromiseCoherence(semAction.content, semAction.actions.length);
    expect(coerente.content).not.toMatch(/proposta está pronta/i);

    const avisado = discloseIncompleteItinerary(coerente.content, request, semAction.actions);
    expect(avisado).toMatch(/Não consegui montar/);
    expect(parseAIActions(semAction.actions, tokyo)).toHaveLength(0);
  });

  it('full-day com 2 paradas após o reparo não é anunciado como pronto', () => {
    const request = classifyItineraryRequest('Tokyo dia 18 de setembro', []);
    const duas = readModelOutput(
      reply('A proposta está pronta para revisão e aplicação.', [
        { title: 'Senso-ji', date: '2026-09-18', startTime: '09:00' },
        { title: 'Shibuya', date: '2026-09-18', startTime: '16:00' },
      ]),
    );

    expect(itineraryItemCount(duas.actions)).toBe(2);
    expect(needsItineraryRepair(request, duas.actions)).toBe(true);

    // Com action existindo, a frase fica — e o aviso de dia incompleto entra
    // na frente, que é o que muda como o resto deve ser lido.
    const avisado = discloseIncompleteItinerary(duas.content, request, duas.actions);
    expect(avisado).toMatch(/Não consegui fechar o dia inteiro: consegui 2 paradas/);
  });
});

/* ------------- por que a proposta morre na validação do servidor ----------- */

/**
 * O QUE O LOG DE PRODUÇÃO NÃO CONSEGUIU DIZER.
 *
 * A requisição real de 2026-08-27T17:52:02Z registrou
 * `rawActionCount: 1, validActionCount: 0`: o Gemini devolveu a proposta e o
 * servidor a recusou. O número provou ONDE a proposta morre — em
 * `validateActions` —, e não em qual campo, porque o payload não pode ser
 * logado: ele carrega o roteiro e o contexto da viagem.
 *
 * Estes rótulos são a resposta que faltava. O teste trava o vocabulário: se um
 * motivo mudar de nome ou parar de ser emitido, o próximo diagnóstico volta a
 * ser leitura de código.
 */
describe('motivo da recusa de uma action', () => {
  const drop = (raw: unknown) => {
    const log = newActionDropLog();
    const validas = validateActions(raw, log);
    return { validas, log };
  };

  it('tipo fora do contrato', () => {
    const { validas, log } = drop([{ type: 'itinerary.replace', label: 'x', items: [] }]);
    expect(validas).toHaveLength(0);
    expect(log.reasons).toEqual(['BAD_TYPE']);
  });

  it('roteiro com "items" vazio — o envelope veio, o dia não', () => {
    // O modelo escreveu o dia em "content" e mandou a action vazia: é a falha
    // que `buildRepairInstruction` descreve, e agora ela tem nome no log.
    const { validas, log } = drop([{ type: 'itinerary.add', label: 'Adicionar', items: [] }]);
    expect(validas).toHaveLength(0);
    expect(log.reasons).toEqual(['NO_ITEMS']);
  });

  it('roteiro com itens SEM data — a causa mais provável do caso real', () => {
    /*
     * O `responseSchema` não marca `date` como obrigatório (o objeto de item é
     * compartilhado entre roteiro, checklist e despesa, e cada um exige campos
     * diferentes). Nada obriga o modelo a preencher a data — e `validateActions`
     * exige. Um dia inteiro datado só no texto se perde INTEIRO aqui.
     */
    const { validas, log } = drop([
      {
        type: 'itinerary.add',
        label: 'Adicionar',
        items: [{ title: 'Ibirapuera' }, { title: 'Pinacoteca' }],
      },
    ]);
    expect(validas).toHaveLength(0);
    expect(log.reasons).toEqual(['ITEMS_INVALID']);
    expect(log.itemsNoDate).toBe(2);
    expect(log.itemsNoTitle).toBe(0);
  });

  it('roteiro com itens sem título', () => {
    const { validas, log } = drop([
      { type: 'itinerary.add', label: 'Adicionar', items: [{ date: '2026-08-28' }] },
    ]);
    expect(validas).toHaveLength(0);
    expect(log.reasons).toEqual(['ITEMS_INVALID']);
    expect(log.itemsNoTitle).toBe(1);
  });

  it('data em formato não-ISO não é data', () => {
    // "28/08/2026" é o que uma pessoa escreve; o contrato é 'AAAA-MM-DD'.
    const { validas, log } = drop([
      {
        type: 'itinerary.add',
        label: 'Adicionar',
        items: [{ title: 'Ibirapuera', date: '28/08/2026' }],
      },
    ]);
    expect(validas).toHaveLength(0);
    expect(log.itemsNoDate).toBe(1);
  });

  it('proposta boa não gera motivo nenhum', () => {
    const { validas, log } = drop([
      {
        type: 'itinerary.add',
        label: 'Adicionar',
        items: [
          { title: 'Ibirapuera', date: '2026-08-28', startTime: '09:00' },
          { title: 'Pinacoteca', date: '2026-08-28', startTime: '14:00' },
          { title: 'Jantar na Vila Madalena', date: '2026-08-28', startTime: '20:00' },
        ],
      },
    ]);
    expect(validas).toHaveLength(1);
    expect(log.reasons).toEqual([]);
    expect(log.itemsNoDate).toBe(0);
  });

  it('os motivos são rótulos fechados — nunca conteúdo', () => {
    /*
     * A garantia que permite esta linha existir em produção sem flag: o que
     * sai do log é vocabulário nosso, e nunca um valor que veio do modelo.
     */
    const permitidos = [
      'NOT_OBJECT',
      'BAD_TYPE',
      'DUPLICATE_TYPE',
      'NO_ITEMS',
      'ITEMS_INVALID',
      'NO_PAYLOAD',
    ];
    const { log } = drop([
      { type: 'itinerary.add', label: 'Segredo da viagem', items: [{ title: 'Lugar privado' }] },
      { type: 'nao-existe', label: 'x' },
      null,
    ]);
    for (const reason of log.reasons) expect(permitidos).toContain(reason);
    expect(JSON.stringify(log)).not.toMatch(/Segredo|privado|nao-existe/);
  });
});

/* ========================================================================== *
 *  O CASO DE SÃO PAULO — requisição 2026-08-28T02:24:35Z, ai-chat v12
 * ========================================================================== *
 *
 * O log estruturado dessa requisição fechou a pergunta que `rawActionCount: 1,
 * validActionCount: 0` não conseguia responder:
 *
 *   dropReasons: ["ITEMS_INVALID"]   itemsNoTitle: 0   itemsNoDate: 5
 *
 * O Gemini devolveu UMA action de roteiro com CINCO atividades, todas com
 * título, nenhuma com `date` utilizável — e `validateActions` descartou a
 * proposta inteira, porque `itinerary.add` sempre exigiu `date`.
 *
 * A divergência era estrutural: o `RESPONSE_SCHEMA` declarava TODOS os campos
 * do item como opcionais. O modelo cumpriu o contrato que recebeu e falhou o
 * contrato que o servidor cobrava. Estes testes travam os dois lados.
 */

const janelaSaoPaulo = {
  today: '2026-08-27',
  startDate: '2026-08-27',
  endDate: '2026-08-28',
};

const saoPaulo: Trip = {
  ...moscou,
  id: 'trip-sp',
  destinationCity: 'São Paulo',
  destinationCountry: 'Brasil',
  countryCode: 'BR',
  timezone: 'America/Sao_Paulo',
  startDate: janelaSaoPaulo.startDate,
  endDate: janelaSaoPaulo.endDate,
};

const PEDIDO_SP = 'Monte um roteiro para amanhã';

/** As cinco atividades como o modelo as mandou: com título, sem data. */
const cincoSemData = [
  { title: 'Café no Mercado Municipal', startTime: '09:00' },
  { title: 'MASP', startTime: '11:00' },
  { title: 'Almoço na Bela Vista', startTime: '13:00' },
  { title: 'Parque Ibirapuera', startTime: '16:00' },
  { title: 'Jantar na Vila Madalena', startTime: '20:00' },
];

function respostaCrua(items: unknown[]): string {
  return JSON.stringify({
    content: 'A proposta está pronta para revisão e aplicação.',
    actions: [{ type: 'itinerary.add', label: 'Adicionar ao roteiro', items }],
  });
}

describe('NÍVEL 1 — o contrato declarado ao modelo', () => {
  const itemSchema = RESPONSE_SCHEMA.properties.actions.items.properties.items.items;

  it('todo item exige "title" e "date" — o schema não pode mais permitir o que o validador recusa', () => {
    expect(itemSchema.required).toEqual(['title', 'date']);
  });

  it('o enum de tipos do schema é exatamente o que o validador aceita', () => {
    // Se um lado ganhar um tipo que o outro não tem, o drop volta a ser
    // BAD_TYPE sem ninguém saber por quê.
    expect(RESPONSE_SCHEMA.properties.actions.items.properties.type.enum).toEqual(ACTION_TYPES);
  });

  it('o payload MÍNIMO que o schema permite passa pelo validador', () => {
    /*
     * A prova de que os dois lados voltaram a concordar: um item com só o que
     * o schema torna obrigatório é aceito. Antes, o mínimo do schema era um
     * objeto vazio — e um objeto vazio nunca teve chance aqui.
     */
    const minimo = [
      {
        type: 'itinerary.add',
        label: 'Adicionar ao roteiro',
        items: [
          { title: 'Pinacoteca', date: '2026-08-28' },
          { title: 'Ibirapuera', date: '2026-08-28' },
          { title: 'Jantar', date: '2026-08-28' },
        ],
      },
    ];
    expect(validateActions(minimo)).toHaveLength(1);
  });
});

describe('NÍVEL 2 — o servidor resolve a data que o modelo omitiu', () => {
  it('o pedido é de dia inteiro e a data-alvo é 2026-08-28, sem ambiguidade', () => {
    expect(classifyItineraryRequest(PEDIDO_SP, []).expectsFullDay).toBe(true);
    expect(tripDays(janelaSaoPaulo)).toEqual(['2026-08-27', '2026-08-28']);
    expect(resolveFullDayDate(PEDIDO_SP, [], janelaSaoPaulo)).toBe('2026-08-28');
  });

  it('sem data-alvo, a resposta real reproduz o log de produção linha por linha', () => {
    const semAlvo = readModelOutput(respostaCrua(cincoSemData), { enforceCoherence: false });

    expect(semAlvo.stats.rawActions).toBe(1);
    expect(semAlvo.stats.validActions).toBe(0);
    expect(semAlvo.stats.drops.reasons).toEqual(['ITEMS_INVALID']);
    expect(semAlvo.stats.drops.itemsNoTitle).toBe(0);
    expect(semAlvo.stats.drops.itemsNoDate).toBe(5);
    // O campo novo: os cinco OMITIRAM a data, não mandaram data ilegível.
    expect(semAlvo.stats.drops.itemsDateMissing).toBe(5);
    expect(semAlvo.stats.drops.itemsDateInvalid).toBe(0);
    expect(semAlvo.stats.drops.itemsDateFilled).toBe(0);
  });

  it('com a data-alvo resolvida, a MESMA resposta vira proposta aplicável', () => {
    const request = classifyItineraryRequest(PEDIDO_SP, []);
    const alvo = resolveFullDayDate(PEDIDO_SP, [], janelaSaoPaulo);
    const output = readModelOutput(respostaCrua(cincoSemData), {
      enforceCoherence: false,
      fullDayDate: alvo,
    });

    expect(output.stats.drops.itemsDateFilled).toBe(5);
    expect(output.stats.drops.reasons).toEqual([]);
    expect(output.actions).toHaveLength(1);

    const itens = itineraryItemCount(output.actions);
    expect(itens).toBeGreaterThanOrEqual(FULL_DAY_MIN_ITEMS);
    expect(itens).toBeLessThanOrEqual(FULL_DAY_MAX_ITEMS);

    const acao = output.actions[0] as { items: { title: string; date: string }[] };
    expect(acao.items.every((item) => item.title.length > 0)).toBe(true);
    expect(acao.items.every((item) => item.date === '2026-08-28')).toBe(true);

    // O contrato fecha: nada de reparo, nada de ressalva, 200 legítimo.
    expect(needsItineraryRepair(request, output.actions)).toBe(false);
    expect(discloseIncompleteItinerary(output.content, request, output.actions)).not.toMatch(
      /Não consegui/,
    );
  });
});

describe('NÍVEL 3 — o que o servidor devolve chega ao cliente', () => {
  it('actions=1 no corpo HTTP vira 1 action no cliente, com os 5 itens em 28/08', () => {
    const output = readModelOutput(respostaCrua(cincoSemData), {
      enforceCoherence: false,
      fullDayDate: resolveFullDayDate(PEDIDO_SP, [], janelaSaoPaulo),
    });

    const cliente = parseAIActions(output.actions, saoPaulo);
    expect(cliente).toHaveLength(1);
    expect(cliente[0].type).toBe('itinerary.add');
    expect(cliente[0].type === 'itinerary.add' && cliente[0].items).toHaveLength(5);
    expect(
      cliente[0].type === 'itinerary.add' &&
        cliente[0].items.every((item) => item.date === '2026-08-28'),
    ).toBe(true);
    expect(cliente[0].tripId).toBe(saoPaulo.id);
  });
});

/* ------------- o que o normalizador NÃO pode fazer, e não faz ------------- */

/**
 * A DIFERENÇA ENTRE NORMALIZAR E INVENTAR.
 *
 * Preencher uma data omitida quando o pedido admite UM único dia é devolver ao
 * item o que o contrato já obrigava. Qualquer coisa além disso — escolher
 * entre duas datas, sobrescrever a data que o modelo escreveu, dar data a um
 * item sem nome — é o servidor fabricando conteúdo. Estes testes são a cerca.
 */
describe('as travas do normalizador', () => {
  it('data ilegível NÃO é sobrescrita — ela é recusada, e o log diz isso', () => {
    const comLixo = cincoSemData.map((item) => ({ ...item, date: '28 de agosto' }));
    const output = readModelOutput(respostaCrua(comLixo), {
      enforceCoherence: false,
      fullDayDate: '2026-08-28',
    });

    expect(output.stats.drops.itemsDateFilled).toBe(0);
    expect(output.stats.drops.itemsDateInvalid).toBe(5);
    expect(output.stats.drops.itemsDateMissing).toBe(0);
    expect(output.actions).toHaveLength(0);
  });

  it('item SEM título não ganha data', () => {
    const semTitulo = [{ startTime: '09:00' }, { startTime: '12:00' }, { startTime: '18:00' }];
    const output = readModelOutput(respostaCrua(semTitulo), {
      enforceCoherence: false,
      fullDayDate: '2026-08-28',
    });

    expect(output.stats.drops.itemsDateFilled).toBe(0);
    expect(output.stats.drops.itemsNoTitle).toBe(3);
    expect(output.actions).toHaveLength(0);
  });

  it('quando a data-alvo e a data do próprio modelo discordam, nada é preenchido', () => {
    /*
     * Metade dos itens datada em 27, alvo resolvido em 28: escolher um dos
     * dois é corrigir a escolha do modelo. O servidor não escolhe — devolve o
     * que veio e deixa a validação recusar.
     */
    const misto = [
      { title: 'Mercado', date: '2026-08-27' },
      { title: 'MASP', date: '2026-08-27' },
      { title: 'Ibirapuera' },
    ];
    const output = readModelOutput(respostaCrua(misto), {
      enforceCoherence: false,
      fullDayDate: '2026-08-28',
    });

    expect(output.stats.drops.itemsDateFilled).toBe(0);
    expect(itineraryItemCount(output.actions)).toBe(2);
  });

  it('sem data-alvo, o item sem data continua sendo descartado', () => {
    /*
     * A trava que impede o normalizador de virar uma regra geral: sem a data
     * que o SERVIDOR resolveu, ele é identidade. Deduzir a data de um item a
     * partir dos irmãos seria o servidor decidindo por conta própria em
     * pedidos que nem são de dia inteiro.
     */
    const parcial = [
      { title: 'Mercado', date: '2026-08-28' },
      { title: 'MASP', date: '2026-08-28' },
      { title: 'Ibirapuera' },
    ];
    const output = readModelOutput(respostaCrua(parcial), { enforceCoherence: false });

    expect(output.stats.drops.itemsDateFilled).toBe(0);
    expect(output.stats.drops.itemsDateMissing).toBe(1);
    expect(itineraryItemCount(output.actions)).toBe(2);
  });

  it('com a data-alvo, os irmãos sem data entram no MESMO dia', () => {
    const parcial = [
      { title: 'Mercado', date: '2026-08-28' },
      { title: 'MASP', date: '2026-08-28' },
      { title: 'Ibirapuera' },
    ];
    const output = readModelOutput(respostaCrua(parcial), {
      enforceCoherence: false,
      fullDayDate: '2026-08-28',
    });

    expect(output.stats.drops.itemsDateFilled).toBe(1);
    expect(itineraryItemCount(output.actions)).toBe(3);
  });

  it('action que não é roteiro passa intacta', () => {
    const semRoteiro = [
      { type: 'checklist.add', label: 'Adicionar ao checklist', items: [{ label: 'Passaporte' }] },
    ];
    expect(normalizeItineraryDates(semRoteiro, '2026-08-28')).toEqual(semRoteiro);
  });

  it('sem âncora nenhuma, nada é preenchido', () => {
    const drops = newActionDropLog();
    const cru = [
      { type: 'itinerary.add', label: 'x', items: [{ title: 'MASP' }] },
    ];
    expect(normalizeItineraryDates(cru, null, drops)).toEqual(cru);
    expect(drops.itemsDateFilled).toBe(0);
  });
});

/* ------------------------- a data que o servidor lê ----------------------- */

describe('resolução da data-alvo', () => {
  const janelaTokyo = { today: '2026-09-01', startDate: '2026-09-18', endDate: '2026-09-27' };

  it('F — "Monte um roteiro para amanhã", São Paulo 27–28/08 → 28/08', () => {
    expect(resolveFullDayDate(PEDIDO_SP, [], janelaSaoPaulo)).toBe('2026-08-28');
  });

  it('G — "Tokyo dia 18 de setembro", viagem 18–27/09 → 18/09', () => {
    expect(resolveFullDayDate('Tokyo dia 18 de setembro', [], janelaTokyo)).toBe('2026-09-18');
  });

  it('"Monte um roteiro para hoje", com a viagem em andamento, resolve o dia de hoje NO DESTINO',
    () => {
      /*
       * O pedido do teste em aparelho: Paris, 07 a 15/09, e a pessoa em Paris
       * no dia 07. "Hoje" tem uma leitura só — e ela vem de `trip.today`, que
       * o aplicativo calcula no fuso do DESTINO. Usar o relógio do servidor
       * aqui erraria o dia para metade do planeta.
       */
      const paris = { today: '2026-09-07', startDate: '2026-09-07', endDate: '2026-09-15' };

      expect(resolveFullDayDate('Monte um roteiro para hoje', [], paris)).toBe('2026-09-07');
      expect(resolveFullDayDate('Monte um roteiro para amanhã', [], paris)).toBe('2026-09-08');
    },
  );

  it('"hoje" fora do período não é resolvido — a viagem ainda não começou', () => {
    // Mesma regra do "amanhã": data fora da viagem se diz, não se ajusta.
    expect(resolveFullDayDate('Monte um roteiro para hoje', [], janelaTokyo)).toBeNull();
  });

  it('H — "Pode ser para o dia 18 na vdd", depois da oferta de 18/09 → 18/09', () => {
    const oferta = [
      {
        role: 'assistant',
        content:
          'Ainda não tenho a data. Posso montar o roteiro para o primeiro dia da ' +
          'viagem (18/09/2026) ou para outra data dentro do período?',
      },
    ];
    expect(resolveFullDayDate('Pode ser para o dia 18 na vdd', oferta, janelaTokyo)).toBe(
      '2026-09-18',
    );
  });

  it('"Pode ser" seco herda a data que a oferta anterior nomeou', () => {
    const oferta = [
      { role: 'assistant', content: 'Posso montar para o primeiro dia da viagem (18/09/2026)?' },
    ];
    expect(resolveFullDayDate('Pode ser', oferta, janelaTokyo)).toBe('2026-09-18');
  });

  it('"amanhã" fora do período NÃO é resolvido — é conversa, não preenchimento', () => {
    // Regra 16 do prompt: data fora da viagem se diz, não se ajusta em silêncio.
    expect(resolveFullDayDate('Monte um roteiro para amanhã', [], janelaTokyo)).toBeNull();
  });

  it('duas datas na mesma frase é ambiguidade — o servidor não escolhe', () => {
    expect(resolveFullDayDate('Roteiro para 18/09 e 19/09', [], janelaTokyo)).toBeNull();
  });

  it('sem período de viagem não há resolução possível', () => {
    expect(resolveFullDayDate(PEDIDO_SP, [], null)).toBeNull();
    expect(resolveFullDayDate(PEDIDO_SP, [], { today: '2026-08-27' })).toBeNull();
  });

  it('viagem de um dia só não tem outro dia onde o pedido caia', () => {
    const umDia = { today: '2026-09-18', startDate: '2026-09-18', endDate: '2026-09-18' };
    expect(resolveFullDayDate('Monte um roteiro', [], umDia)).toBe('2026-09-18');
  });

  it('um dia que se repete no período não é inequívoco', () => {
    // 18/09 e 18/10 dentro da mesma viagem: "dia 18" não decide nada.
    const longa = { today: '2026-09-17', startDate: '2026-09-10', endDate: '2026-10-20' };
    expect(resolveFullDayDate('Monte um roteiro para o dia 18', [], longa)).toBeNull();
    // Com o mês nomeado, volta a ser único.
    expect(resolveFullDayDate('Monte um roteiro para o dia 18 de outubro', [], longa)).toBe(
      '2026-10-18',
    );
  });
});

/* ------------------------------- regressões ------------------------------- */

describe('regressões do contrato de dia inteiro', () => {
  const request = classifyItineraryRequest(PEDIDO_SP, []);
  const alvo = resolveFullDayDate(PEDIDO_SP, [], janelaSaoPaulo);
  const ler = (items: unknown[]) =>
    readModelOutput(respostaCrua(items), { enforceCoherence: false, fullDayDate: alvo });

  it('A — 4 itens com título e data passam', () => {
    const output = ler([
      { title: 'Mercado', date: '2026-08-28', startTime: '09:00' },
      { title: 'MASP', date: '2026-08-28', startTime: '11:00' },
      { title: 'Ibirapuera', date: '2026-08-28', startTime: '16:00' },
      { title: 'Jantar', date: '2026-08-28', startTime: '20:00' },
    ]);
    expect(output.actions).toHaveLength(1);
    expect(itineraryItemCount(output.actions)).toBe(4);
    expect(needsItineraryRepair(request, output.actions)).toBe(false);
  });

  it('B — itens sem data ganham a data resolvida, e o log registra o preenchimento', () => {
    const output = ler(cincoSemData);
    expect(output.actions).toHaveLength(1);
    expect(output.stats.drops.itemsDateFilled).toBe(5);
    expect(output.stats.drops.reasons).toEqual([]);
  });

  it('C — itens sem título continuam recusados', () => {
    const output = ler([{ startTime: '09:00' }, { startTime: '12:00' }]);
    expect(output.actions).toHaveLength(0);
    expect(output.stats.drops.reasons).toEqual(['ITEMS_INVALID']);
    expect(output.stats.drops.itemsNoTitle).toBe(2);
  });

  it('D — items vazio continua recusado, e o pedido continua exigindo reparo', () => {
    const output = readModelOutput(respostaCrua([]), {
      enforceCoherence: false,
      fullDayDate: alvo,
    });
    expect(output.actions).toHaveLength(0);
    expect(output.stats.drops.reasons).toEqual(['NO_ITEMS']);
    expect(needsItineraryRepair(request, output.actions)).toBe(true);
    expect(discloseIncompleteItinerary(output.content, request, output.actions)).toMatch(
      /Não consegui montar/,
    );
  });

  it('E — tipo fora do contrato continua recusado', () => {
    const cru = JSON.stringify({
      content: 'ok',
      actions: [{ type: 'itinerary.delete', label: 'Apagar', items: [{ title: 'x' }] }],
    });
    const output = readModelOutput(cru, { enforceCoherence: false, fullDayDate: alvo });
    expect(output.actions).toHaveLength(0);
    expect(output.stats.drops.reasons).toEqual(['BAD_TYPE']);
  });
});
