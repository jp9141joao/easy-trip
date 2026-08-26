import {
  FULL_DAY_MIN_ITEMS,
  buildRepairInstruction,
  classifyItineraryRequest,
  discloseIncompleteItinerary,
  enforcePromiseCoherence,
  itineraryItemCount,
  needsItineraryRepair,
  pickBetterItinerary,
  readModelOutput,
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
