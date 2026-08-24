import {
  RATE_LIMIT,
  RESPONSE_SCHEMA,
  SYSTEM_PROMPT,
  createRateLimiter,
  enforcePromiseCoherence,
  joinCandidateText,
  readModelOutput,
  validateActions,
} from '../../supabase/functions/ai-chat/protocol';

import { AI_RATE_LIMIT } from '@/domain/aiRateLimit';
import { parseAIActions } from '@/domain/aiActions';
import type { Trip } from '@/domain/types';

/**
 * O protocolo da Edge Function `ai-chat` — o lado do servidor, exercitado aqui.
 *
 * ESTA SUÍTE EXISTE POR CAUSA DE UM DEFEITO ESPECÍFICO
 *
 * No aparelho, a IA respondeu "preparei a proposta, revise e confirme a
 * aplicação no aplicativo" e **nenhum card apareceu**. O usuário escreveu
 * "aprovar", depois "pode aplicar", e nada foi gravado: o roteiro continuou
 * vazio. Os testes existentes não pegaram nada disso, porque nenhum deles
 * tocava no código que roda no Deno — a Function era território sem cobertura.
 *
 * `protocol.ts` foi extraído justamente para acabar com isso. Ele é puro, e o
 * que se mede aqui é o percurso completo do lado servidor:
 *
 *   resposta bruta do Gemini
 *     → `joinCandidateText`  (junta as partes, descarta raciocínio)
 *     → `readModelOutput`    (lê o JSON, valida, confere coerência)
 *     → `parseAIActions`     (a validação do cliente, para fechar o circuito)
 *
 * As respostas usadas são as que a API do Gemini devolve de verdade, no formato
 * `candidates[].content.parts[].text`.
 */

const paris: Trip = {
  id: 'trip-paris',
  userId: 'u1',
  destinationCity: 'Paris',
  destinationCountry: 'França',
  countryCode: 'FR',
  timezone: 'Europe/Paris',
  startDate: '2026-08-22',
  endDate: '2026-08-31',
  budgetTotal: 30000,
  budgetCurrency: 'BRL',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

/** Envelope de resposta do Gemini, como ele chega pela REST. */
const geminiResponse = (parts: { text?: string; thought?: boolean }[]) => ({
  candidates: [{ content: { parts, role: 'model' } }],
});

/** O que o modelo devolveria para "Monte um roteiro para amanhã…". */
const roteiroJson = JSON.stringify({
  content:
    'Preparei uma sugestão para amanhã, 23/08: Louvre pela manhã e Torre Eiffel ' +
    'no fim da tarde. Revise e confirme a aplicação no aplicativo.',
  actions: [
    {
      type: 'itinerary.add',
      label: 'Adicionar 2 itens ao roteiro',
      items: [
        {
          title: 'Museu do Louvre',
          date: '2026-08-23',
          startTime: '09:00',
          type: 'atracao',
          placeName: 'Rue de Rivoli',
        },
        { title: 'Torre Eiffel', date: '2026-08-23', startTime: '18:00', type: 'atracao' },
      ],
    },
  ],
});

/* -------------------------------------------------------------------------- */

describe('A. onde a proposta desaparecia', () => {
  it('descarta as partes de raciocínio antes de ler o JSON', () => {
    /*
     * ESTE É O DEFEITO.
     *
     * Um modelo com raciocínio devolve partes marcadas `thought: true` junto
     * com a resposta. A versão anterior concatenava **todas** as partes; o
     * resultado era "raciocínio + JSON" numa string só, `JSON.parse` falhava, e
     * o caminho degradado entregava `content` com `actions: []`.
     *
     * Do lado de fora isso aparece exatamente como o relatado: a IA fala da
     * proposta, e proposta nenhuma chega à tela.
     */
    const resposta = geminiResponse([
      { text: 'O usuário quer um roteiro. Vou usar trip.today para resolver "amanhã".', thought: true },
      { text: roteiroJson },
    ]);

    const raw = joinCandidateText(resposta);
    expect(raw).toBe(roteiroJson);

    const { actions, stats } = readModelOutput(raw);
    expect(stats.parsed).toBe(true);
    expect(actions).toHaveLength(1);
  });

  it('recupera o JSON de uma resposta embrulhada em cerca de código', () => {
    // Acontece na prática mesmo com `responseMimeType: application/json`.
    // Recortar não inventa nada: o que não for JSON continua não sendo.
    const raw = '```json\n' + roteiroJson + '\n```';
    const { actions, stats } = readModelOutput(raw);

    expect(stats.parsed).toBe(true);
    expect(actions).toHaveLength(1);
  });

  it('degrada para conversa quando não há JSON nenhum — e sem prometer botão', () => {
    const { content, actions, stats } = readModelOutput('Desculpe, não entendi a pergunta.');

    expect(actions).toEqual([]);
    expect(stats.parsed).toBe(false);
    expect(content).toBe('Desculpe, não entendi a pergunta.');
  });
});

describe('B. "Monte um roteiro para amanhã com Louvre e Torre Eiffel"', () => {
  it('produz itinerary.add com itens válidos, ponta a ponta', () => {
    const raw = joinCandidateText(geminiResponse([{ text: roteiroJson }]));
    const { content, actions } = readModelOutput(raw);

    // 1. o servidor entrega uma proposta, não só texto
    expect(actions.length).toBeGreaterThanOrEqual(1);
    expect((actions[0] as { type: string }).type).toBe('itinerary.add');

    // 2. a promessa do texto é verdadeira — há o que confirmar
    expect(content).toMatch(/confirme a aplicação no aplicativo/i);

    // 3. e a validação do cliente aceita o que o servidor mandou. Este passo é
    //    o que faltava conferir: as duas validações são independentes, e uma
    //    divergência entre elas descartaria a proposta em silêncio no aparelho.
    const parsed = parseAIActions(actions, paris);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ type: 'itinerary.add', tripId: 'trip-paris' });
    expect(parsed[0].type === 'itinerary.add' && parsed[0].items).toHaveLength(2);
  });

  it('aproveita a proposta mesmo sem o rótulo que o modelo esqueceu', () => {
    // Rótulo é decoração de botão, e o sistema tem um para cada tipo. Descartar
    // um roteiro válido por falta de rótulo — como a versão anterior fazia —
    // é o pior dos dois erros.
    const semLabel = JSON.stringify({
      content: 'Sugestão para amanhã.',
      actions: [
        { type: 'itinerary.add', items: [{ title: 'Louvre', date: '2026-08-23', type: 'atracao' }] },
      ],
    });

    const { actions } = readModelOutput(semLabel);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ label: 'Adicionar ao roteiro' });
    expect(parseAIActions(actions, paris)).toHaveLength(1);
  });

  it('descarta o item sem data e mantém os outros', () => {
    const misto = JSON.stringify({
      content: 'Sugestão.',
      actions: [
        {
          type: 'itinerary.add',
          label: 'Roteiro',
          items: [
            { title: 'Louvre', date: '2026-08-23' },
            { title: 'Sem data nenhuma' },
            { title: 'Data impossível', date: '2026-02-30' },
          ],
        },
      ],
    });

    const { actions } = readModelOutput(misto);
    expect((actions[0] as { items: unknown[] }).items).toHaveLength(1);
  });
});

describe('C. checklist e despesas', () => {
  it('"o que falta levar?" → checklist.add', () => {
    const raw = JSON.stringify({
      content: 'Sugiro estes itens.',
      actions: [
        {
          type: 'checklist.add',
          label: 'Adicionar 2 itens',
          items: [
            { label: 'Adaptador de tomada', category: 'mala' },
            { label: 'Seguro viagem', category: 'reservas', priority: 'high' },
          ],
        },
      ],
    });

    const { actions } = readModelOutput(raw);
    const parsed = parseAIActions(actions, paris);
    expect(parsed[0]).toMatchObject({ type: 'checklist.add' });
    expect(parsed[0].type === 'checklist.add' && parsed[0].items[0].category).toBe('mala');
  });

  it('valor informado pela pessoa vira estimated=false', () => {
    const raw = JSON.stringify({
      content: 'Registrei o valor que você informou como proposta.',
      actions: [
        {
          type: 'expenses.add',
          label: 'Adicionar despesa',
          items: [
            {
              description: 'Passagem aérea',
              amount: 3200,
              currency: 'BRL',
              category: 'transporte',
              transactionDate: '2026-08-22',
              estimated: false,
            },
          ],
        },
      ],
    });

    const parsed = parseAIActions(readModelOutput(raw).actions, paris);
    expect(parsed[0].type === 'expenses.add' && parsed[0].items[0].estimated).toBe(false);
  });

  it('sem afirmação explícita, a despesa é estimativa', () => {
    // O erro caro é o outro: apresentar um chute como preço informado (§19).
    const raw = JSON.stringify({
      content: 'Uma estimativa para planejamento.',
      actions: [
        {
          type: 'expenses.add',
          label: 'Adicionar despesa',
          items: [
            {
              description: 'Jantar no Marais',
              amount: 350,
              category: 'alimentacao',
              transactionDate: '2026-08-23',
            },
          ],
        },
      ],
    });

    const parsed = parseAIActions(readModelOutput(raw).actions, paris);
    expect(parsed[0].type === 'expenses.add' && parsed[0].items[0].estimated).toBe(true);
  });
});

describe('D. coerência entre o texto e a proposta', () => {
  it('não deixa a resposta prometer um botão que não existe', () => {
    /*
     * A regra absoluta do hotfix. Foi isto que a pessoa encontrou: um texto
     * pedindo confirmação de uma proposta que a validação já tinha descartado.
     * "Aprovar" três vezes, nada gravado.
     */
    const semAction = JSON.stringify({
      content:
        'Preparei a proposta de roteiro para amanhã. Revise e confirme a aplicação no aplicativo.',
      actions: [{ type: 'itinerary.add', label: 'Roteiro', items: [{ title: 'Sem data' }] }],
    });

    const { content, actions, stats } = readModelOutput(semAction);

    expect(actions).toEqual([]);
    expect(stats.rawActions).toBe(1);
    expect(stats.validActions).toBe(0);
    expect(stats.strippedPromises).toBeGreaterThan(0);
    expect(content).not.toMatch(/revise e confirme/i);
    expect(content).not.toMatch(/preparei a proposta/i);
  });

  it('não toca no texto quando a promessa é verdadeira', () => {
    const { content, stats } = readModelOutput(roteiroJson);
    expect(stats.strippedPromises).toBe(0);
    expect(content).toMatch(/Revise e confirme a aplicação no aplicativo/);
  });

  it('responde algo útil quando a resposta era só promessa', () => {
    const { content } = enforcePromiseCoherence('Revise e confirme a aplicação no aplicativo.', 0);
    expect(content).toMatch(/não consegui montar uma proposta/i);
  });

  it('preserva a informação e corta só a frase incoerente', () => {
    const { content } = enforcePromiseCoherence(
      'Você já gastou R$ 4.200 dos R$ 30.000. Posso adicionar isso ao seu roteiro.',
      0,
    );
    expect(content).toContain('R$ 4.200');
    expect(content).not.toMatch(/posso adicionar/i);
  });
});

describe('E. o que o modelo não consegue propor', () => {
  it('descarta tipos que não existem', () => {
    const raw = JSON.stringify({
      content: 'ok',
      actions: [
        { type: 'trip.delete', label: 'Apagar viagem' },
        { type: 'ticket.issue', label: 'Emitir bilhete' },
      ],
    });
    expect(readModelOutput(raw).actions).toEqual([]);
  });

  it('não deixa o modelo nomear a viagem', () => {
    const raw = JSON.stringify({
      content: 'ok',
      actions: [
        {
          type: 'itinerary.add',
          label: 'Roteiro',
          tripId: 'trip-de-outra-pessoa',
          items: [{ title: 'Louvre', date: '2026-08-23' }],
        },
      ],
    });

    // Reconstruído campo a campo: `tripId` não sobrevive porque não é copiado.
    expect(readModelOutput(raw).actions[0]).not.toHaveProperty('tripId');
    // E quem carimba é o cliente, com a viagem da conversa.
    expect(parseAIActions(readModelOutput(raw).actions, paris)[0].tripId).toBe('trip-paris');
  });

  it('uma proposta por tipo, e no máximo quatro', () => {
    const muitas = Array.from({ length: 8 }, () => ({
      type: 'budget.update',
      label: 'Orçamento',
      budgetTotal: 40000,
    }));
    expect(readModelOutput(JSON.stringify({ content: 'ok', actions: muitas })).actions).toHaveLength(1);
  });
});

describe('F. o contrato declarado ao Gemini', () => {
  it('exige `actions` na saída estruturada', () => {
    // Opcional, o campo tinha a saída de menor esforço de simplesmente não
    // existir — e uma resposta prometendo aplicação chegava sem nada a aplicar.
    expect(RESPONSE_SCHEMA.required).toEqual(['content', 'actions']);
  });

  it('proíbe a promessa sem proposta no próprio prompt', () => {
    expect(SYSTEM_PROMPT).toMatch(/COERÊNCIA OBRIGATÓRIA/);
    expect(SYSTEM_PROMPT).toMatch(/"actions" é obrigatório/);
  });
});

describe('G. limite de chamadas no servidor', () => {
  it('aceita cinco por minuto e barra a sexta', () => {
    let agora = 1_000_000;
    const limiter = createRateLimiter(() => agora);

    for (let i = 0; i < 5; i += 1) {
      expect(limiter.limited('user-a')).toBe(false);
      agora += 1_000;
    }
    // A sexta é barrada **antes** de o Gemini ser chamado: uma chamada recusada
    // não pode custar dinheiro.
    expect(limiter.limited('user-a')).toBe(true);
  });

  it('conta por usuário', () => {
    const limiter = createRateLimiter(() => 1_000_000);
    for (let i = 0; i < 5; i += 1) limiter.limited('user-a');

    expect(limiter.limited('user-a')).toBe(true);
    expect(limiter.limited('user-b')).toBe(false);
  });

  it('libera quando a janela passa', () => {
    let agora = 1_000_000;
    const limiter = createRateLimiter(() => agora);
    for (let i = 0; i < 5; i += 1) limiter.limited('user-a');
    expect(limiter.limited('user-a')).toBe(true);

    agora += RATE_LIMIT.windowMs + 1;
    expect(limiter.limited('user-a')).toBe(false);
  });

  it('insistir não estica a espera', () => {
    let agora = 1_000_000;
    const limiter = createRateLimiter(() => agora);
    for (let i = 0; i < 5; i += 1) limiter.limited('user-a');

    const espera = limiter.retryAfterSeconds('user-a');
    limiter.limited('user-a');
    limiter.limited('user-a');
    // A tentativa recusada não entra no balde: uma janela que só cresce com
    // insistência seria punição, não limite.
    expect(limiter.retryAfterSeconds('user-a')).toBe(espera);
  });

  it('o teto do servidor e o do cliente são o mesmo número', () => {
    // Eles são espelhados, não compartilhados (Deno e Expo não têm módulo em
    // comum). Este teste é o que impede a divergência silenciosa.
    expect(RATE_LIMIT.max).toBe(AI_RATE_LIMIT.max);
    expect(RATE_LIMIT.windowMs).toBe(AI_RATE_LIMIT.windowMs);
    expect(RATE_LIMIT.max).toBe(5);
  });
});

describe('H. validação isolada', () => {
  it('recusa qualquer coisa que não seja lista', () => {
    expect(validateActions(null)).toEqual([]);
    expect(validateActions('itinerary.add')).toEqual([]);
    expect(validateActions({ type: 'itinerary.add' })).toEqual([]);
  });

  it('recusa valores impossíveis em orçamento e meta', () => {
    const casos = [
      { type: 'budget.update', label: 'x', budgetTotal: -1 },
      { type: 'budget.update', label: 'x', budgetTotal: Number.NaN },
      { type: 'budget.update', label: 'x', budgetTotal: Number.POSITIVE_INFINITY },
      { type: 'goal.add', label: 'x', goal: { title: 'Meta', targetValue: 0 } },
    ];
    for (const caso of casos) expect(validateActions([caso])).toEqual([]);
  });
});
