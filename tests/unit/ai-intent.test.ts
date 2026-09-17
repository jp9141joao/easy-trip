import { analyzeIntent } from '../../supabase/functions/ai-chat/intent';
import {
  classifyItineraryRequest,
  classifyRequestIntent,
  gateActionsByIntent,
  enforcePromiseCoherence,
} from '../../supabase/functions/ai-chat/protocol';
import { allowsAIMutation, analyzeAIIntent } from '@/domain/aiIntent';

/**
 * CONSULTAR NÃO É CRIAR.
 *
 * O defeito que originou este arquivo: "Liste, sem criar nada, o que tenho
 * planejado no roteiro do dia 18" voltava com um roteiro NOVO e o cartão
 * "Revisar antes de adicionar". A causa era o classificador casar a palavra
 * `roteiro` e concluir intenção de criação — confundindo assunto com pedido.
 *
 * As listas abaixo são CATEGORIAS SEMÂNTICAS, não casos especiais. Nenhuma
 * frase daqui aparece no código: o classificador decide por léxico de verbo
 * mais vizinhança (negação, restrição, marcador descritivo). Trocar "Liste" por
 * "Mostre" ou "roteiro" por "checklist" tem de continuar funcionando — é o que
 * as variações naturais no fim do arquivo verificam.
 */

/* ------------------------------ 1. LEITURA -------------------------------- */

const LEITURA = [
  // roteiro
  'Liste meu roteiro do dia 18.',
  'Liste meu roteiro do dia 18, sem criar nada.',
  'Mostre o que tenho planejado amanhã.',
  'O que vou fazer no dia 18?',
  'Quais atividades já estão no meu roteiro?',
  'Verifique meu roteiro.',
  'Confira se tenho alguma atividade às 15h.',
  'Liste meu roteiro completo de amanhã.',
  'O que está planejado para dia 18?',
  'Quais são meus planos?',
  'Me diga o que já foi planejado.',
  // despesas e orçamento
  'Quais despesas eu já tenho?',
  'Quanto já gastei?',
  'Mostre minhas despesas da viagem.',
  'Liste os gastos de transporte.',
  'Quanto resta do orçamento?',
  'Verifique meu orçamento.',
  // checklist
  'O que falta no checklist?',
  'Liste meu checklist.',
  'Liste meus itens pendentes.',
  // metas e diário
  'Quais metas tenho?',
  'Liste meu diário.',
  // proibição explícita
  'Não adicione nada, apenas me diga o que tenho.',
  'Não crie nada, só me mostre o roteiro.',
  'Liste, sem criar nada, o que farei hoje.',
  'Somente liste o que já existe.',
  'Quero só consultar minhas despesas.',
];

/* ------------------------------- 2. ESCRITA ------------------------------- */

const ESCRITA = [
  'Monte um roteiro para amanhã.',
  'Crie um roteiro para o dia 18.',
  'Crie uma atividade às 10h.',
  'Adicione uma visita à Torre de Tóquio às 14h.',
  'Adicione estes itens ao checklist.',
  'Crie uma previsão de despesas para a viagem.',
  'Adicione R$ 100 de transporte.',
  'Crie uma meta para economizar R$ 500.',
  'Crie uma entrada de diário baseada no roteiro.',
  'Planeje o dia 12 pra mim.',
  'me faz um roteiro para o dia todo',
  'Quero um itinerário para quinta.',
  'o que fazer amanhã?',
  'Registre um gasto de 80 reais com almoço.',
  'Atualize meu orçamento para 8000 reais.',
];

/* ------------------------------ 3. AMBÍGUO -------------------------------- */

const AMBIGUO = [
  'Me ajuda com meu roteiro de amanhã.',
  'Meu roteiro de amanhã.',
  'E o checklist?',
];

/* ------------------- 4. o português real, não o formal -------------------- */

const LEITURA_NATURAL = [
  'oq tenho amanha',
  'me mostra oq vou fazer',
  've meu roteiro',
  'confere meu roteiro',
  'quero saber oq ja tem',
  'quais sao os planos pra amanha',
  'ja tem algo planejado?',
  'sem adicionar nada, lista pra mim',
];

describe('camada 1 — classificação semântica da intenção', () => {
  it.each(LEITURA)('LEITURA: %s', (prompt) => {
    const intent = analyzeIntent(prompt);
    expect(intent.operation).toBe('read');
    expect(intent.allowsMutation).toBe(false);
  });

  it.each(LEITURA_NATURAL)('LEITURA (fala corrente): %s', (prompt) => {
    expect(analyzeIntent(prompt).operation).toBe('read');
  });

  it.each(ESCRITA)('ESCRITA: %s', (prompt) => {
    const intent = analyzeIntent(prompt);
    expect(intent.operation).toBe('write');
    expect(intent.allowsMutation).toBe(true);
  });

  it.each(AMBIGUO)('AMBÍGUO — na dúvida não muta: %s', (prompt) => {
    const intent = analyzeIntent(prompt);
    expect(intent.operation).toBe('ambiguous');
    expect(intent.allowsMutation).toBe(false);
  });
});

describe('assunto não é intenção', () => {
  /*
   * O coração da correção. A MESMA palavra de domínio, os mesmos dados, e duas
   * operações opostas — decididas só pelo verbo.
   */
  it.each([
    ['roteiro', 'Liste meu roteiro do dia 18.', 'Monte um roteiro para o dia 18.', 'itinerary'],
    ['checklist', 'Liste meu checklist.', 'Crie os itens que faltam no checklist.', 'checklist'],
    ['despesa', 'Liste minhas despesas.', 'Crie uma previsão de despesas.', 'expense'],
    ['orçamento', 'Verifique meu orçamento.', 'Atualize meu orçamento para 9000.', 'budget'],
    ['meta', 'Quais metas tenho?', 'Crie uma meta de 500 reais.', 'goal'],
    ['diário', 'Liste meu diário.', 'Crie uma entrada de diário para o dia 18.', 'journal'],
  ])('%s: o assunto é o mesmo, a operação não', (_rotulo, leitura, escrita, dominio) => {
    const consulta = analyzeIntent(leitura);
    const pedido = analyzeIntent(escrita);

    expect(consulta.domains).toContain(dominio);
    expect(pedido.domains).toContain(dominio);

    expect(consulta.allowsMutation).toBe(false);
    expect(pedido.allowsMutation).toBe(true);
  });
});

describe('precedência: a negação é compreendida', () => {
  it('"Não crie, só liste meu roteiro" tem os três verbos e é LEITURA', () => {
    const intent = analyzeIntent('Não crie, só liste meu roteiro');
    expect(intent.explicitReadOnly).toBe(true);
    expect(intent.operation).toBe('read');
  });

  it('a proibição vence mesmo com "monte" na mesma frase', () => {
    expect(analyzeIntent('Não monte nada novo, só me mostre o roteiro').operation).toBe('read');
    expect(analyzeIntent('Sem criar nada: monte na sua cabeça e me diga o que já tenho').operation)
      .toBe('read');
  });

  it('"planejado" é estado, não ordem de planejar', () => {
    for (const prompt of [
      'Liste o que tenho planejado.',
      'Quais são meus planos?',
      'O que está planejado para dia 18?',
    ]) {
      expect(analyzeIntent(prompt).operation).toBe('read');
    }
  });

  it('"vou fazer" descreve; "fazer" solto pede', () => {
    expect(analyzeIntent('O que vou fazer no dia 18?').operation).toBe('read');
    expect(analyzeIntent('o que fazer no dia 18?').operation).toBe('write');
  });

  it('"quero saber" pergunta; "quero um roteiro" pede', () => {
    expect(analyzeIntent('quero saber o que já tem').operation).toBe('read');
    expect(analyzeIntent('quero um roteiro para quinta').operation).toBe('write');
  });
});

describe('camada 3 — o portão determinístico do servidor', () => {
  const proposta = [
    { type: 'itinerary.add', label: 'Adicionar ao roteiro', items: [{ title: 'Senso-ji', date: '2026-09-18' }] },
  ];

  it('a action do modelo NÃO é autoridade: numa leitura ela é descartada', () => {
    const intent = classifyRequestIntent('Liste, sem criar nada, meu roteiro do dia 18.', []);
    const gated = gateActionsByIntent(proposta, intent);

    expect(intent.allowsMutation).toBe(false);
    expect(gated.actions).toEqual([]);
    expect(gated.discarded).toBe(1);
  });

  it('numa escrita a mesma proposta passa intacta', () => {
    const intent = classifyRequestIntent('Monte um roteiro para o dia 18.', []);
    const gated = gateActionsByIntent(proposta, intent);

    expect(intent.allowsMutation).toBe(true);
    expect(gated.actions).toEqual(proposta);
    expect(gated.discarded).toBe(0);
  });

  it('o aceite de uma oferta anterior continua sendo escrita', () => {
    const intent = classifyRequestIntent('Pode ser', [
      { role: 'user', content: 'Monte um roteiro para amanhã' },
      { role: 'assistant', content: 'Posso montar o roteiro para o primeiro dia da viagem?' },
    ]);

    expect(intent.acceptsPriorOffer).toBe(true);
    expect(intent.promoted).toBe(true);
    expect(gateActionsByIntent(proposta, intent).actions).toEqual(proposta);
  });

  it('a promoção por data nua não alcança quem pediu leitura', () => {
    // "Tokyo dia 18 de setembro" (sem verbo) segue valendo como pedido do dia.
    expect(classifyRequestIntent('Tokyo dia 18 de setembro', []).allowsMutation).toBe(true);
    // A MESMA data, com verbo de consulta, não.
    expect(classifyRequestIntent('Liste meu roteiro do dia 18 de setembro', []).allowsMutation)
      .toBe(false);
  });
});

describe('camada 4 — o cliente barra o que é leitura comprovada', () => {
  it.each([...LEITURA, ...LEITURA_NATURAL])('recusa a proposta em: %s', (prompt) => {
    expect(allowsAIMutation(prompt)).toBe(false);
  });

  it.each(ESCRITA)('deixa passar em: %s', (prompt) => {
    expect(allowsAIMutation(prompt)).toBe(true);
  });

  it('deixa passar o ambíguo — quem tem o histórico é o servidor', () => {
    // "Pode ser" respondendo a uma oferta é escrita legítima, e esta camada não
    // vê o histórico. Barrar aqui apagaria a proposta certa depois de um "sim".
    for (const aceite of ['Pode ser', 'sim', 'ok', 'Me ajuda com meu roteiro']) {
      expect(allowsAIMutation(aceite)).toBe(true);
    }
  });
});

describe('paridade entre o servidor e o aplicativo', () => {
  /*
   * As duas implementações são independentes de propósito — o aplicativo
   * precisa se defender de uma Edge Function ainda não publicada. Independente
   * não pode virar divergente: este teste é o que transforma uma cópia que
   * envelheceu numa reprovação, e não num defeito em produção.
   */
  it.each([...LEITURA, ...LEITURA_NATURAL, ...ESCRITA, ...AMBIGUO])(
    'servidor e cliente leem igual: %s',
    (prompt) => {
      const servidor = analyzeIntent(prompt);
      const cliente = analyzeAIIntent(prompt);
      expect(cliente).toEqual(servidor);
    },
  );
});

describe('coerência do texto depois do descarte', () => {
  it('"preparei 5 atividades" não sobrevive a uma consulta', () => {
    const resposta =
      'Preparei 5 atividades para o dia 18. Revise e confirme no aplicativo.';
    const { content, stripped } = enforcePromiseCoherence(resposta, 0);

    expect(stripped).toBe(2);
    expect(content).not.toMatch(/Preparei/i);
    expect(content).not.toMatch(/Revise/i);
  });

  it('descrever o que EXISTE não é promessa e fica intacto', () => {
    const resposta =
      'Você possui 7 atividades no dia 18.\n' +
      '- 09:00 · Senso-ji\n' +
      '- 12:30 · Almoço em Asakusa';
    expect(enforcePromiseCoherence(resposta, 0)).toEqual({ content: resposta, stripped: 0 });
  });

  it('a resposta honesta de dia vazio passa inteira', () => {
    const resposta = 'Você ainda não tem atividades planejadas para esse dia.';
    expect(enforcePromiseCoherence(resposta, 0).content).toBe(resposta);
  });
});

describe('roteiro de dia inteiro só existe sob intenção de escrita', () => {
  it('"Monte um roteiro completo para amanhã" exige o dia inteiro', () => {
    expect(classifyItineraryRequest('Monte um roteiro completo para amanhã').expectsFullDay)
      .toBe(true);
  });

  it('"Liste meu roteiro completo de amanhã" NÃO liga reparo nenhum', () => {
    // Sem isto, o servidor gastava uma segunda geração paga tentando
    // "completar" um dia que ninguém mandou completar — e colava a ressalva
    // "não consegui montar um roteiro completo" em cima de uma consulta.
    expect(classifyItineraryRequest('Liste meu roteiro completo de amanhã').expectsFullDay)
      .toBe(false);
  });

  it.each(LEITURA)('nenhuma consulta liga o dia inteiro: %s', (prompt) => {
    expect(classifyItineraryRequest(prompt).expectsFullDay).toBe(false);
  });
});
