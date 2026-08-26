import {
  classifyRateLimit,
  classifyUpstreamException,
  classifyUpstreamStatus,
  countCandidates,
  discloseIncompleteItinerary,
  enforcePromiseCoherence,
  hasRenderableText as serverHasRenderableText,
  readFinishReason,
  readRateLimitSignals,
} from '../../supabase/functions/ai-chat/protocol';
import {
  enforceAIActionPromiseCoherence,
  hasRenderableText,
} from '@/domain/aiActions';
import { formatAIFailure, readServerFailure } from '@/lib/aiTrace';
import { parseMarkdown } from '@/lib/markdown';

/**
 * A bolha do "•" e o erro genérico da IA (§1–§5 do handoff).
 *
 * DOIS SINTOMAS, DUAS CAUSAS DIFERENTES
 *
 * 1. Uma bolha praticamente vazia, com um "•" e mais nada. O corte de
 *    promessas juntava a resposta inteira com espaço — o Markdown virava um
 *    parágrafo só — e, quando o texto de um item de lista era cortado, o
 *    MARCADOR ficava para trás. Uma linha "- " renderiza um bullet mudo, e ela
 *    ia para o banco: reaparecia a cada abertura da conversa.
 *
 * 2. "Não foi possível obter uma resposta agora", sem dizer o quê. Todos os
 *    caminhos — 429, timeout, parser, action inválida — chegavam à mesma
 *    frase, e não havia como saber qual tinha sido no aparelho.
 *
 * O que se mede aqui: que o corte preserva a estrutura, que resíduo de lista
 * não sobrevive, que texto sem nada legível é recusado antes de virar mensagem,
 * e que a linha de diagnóstico diz status, código e fase.
 */

describe('o corte de promessas preserva o Markdown', () => {
  const roteiro = [
    'Preparei um roteiro para amanhã:',
    '',
    '- 09:00 — Praça Vermelha',
    '- 11:30 — Catedral de São Basílio',
    '- 14:00 — Almoço no Café Pushkin',
    '',
    'Revise e confirme no aplicativo.',
  ].join('\n');

  it('a lista continua sendo lista depois do corte', () => {
    const { content, stripped } = enforcePromiseCoherence(roteiro, 0);

    expect(stripped).toBeGreaterThan(0);
    // Antes isto virava um parágrafo só, com os hífens no meio da frase.
    const blocos = parseMarkdown(content);
    expect(blocos.some((b) => b.kind === 'bullets')).toBe(true);
    expect(content).not.toMatch(/[Rr]evise/);
    expect(content).toContain('Praça Vermelha');
  });

  it('o cliente corta do mesmo jeito que o servidor', () => {
    const { content } = enforceAIActionPromiseCoherence(roteiro, 0);
    expect(parseMarkdown(content).some((b) => b.kind === 'bullets')).toBe(true);
    expect(content).toContain('Café Pushkin');
  });
});

describe('resíduo de lista nunca sobrevive ao corte', () => {
  /** Um item cujo texto é inteiramente promessa: o marcador ficaria órfão. */
  const comResiduo = ['Sobre amanhã:', '- Revise a proposta.', '- Praça Vermelha'].join('\n');

  it.each([
    ['servidor', (t: string) => enforcePromiseCoherence(t, 0).content],
    ['cliente', (t: string) => enforceAIActionPromiseCoherence(t, 0).content],
  ])('%s: a linha que perdeu o texto some inteira', (_lado, cortar) => {
    const content = cortar(comResiduo);

    // Nenhuma linha pode ser só um marcador — é o que virava o "•" na tela.
    for (const linha of content.split('\n')) {
      expect(linha.trim()).not.toMatch(/^(?:[-*+]|\d{1,3}[.)])$/);
    }
    expect(content).toContain('Praça Vermelha');
  });

  it.each([
    ['servidor', (t: string) => enforcePromiseCoherence(t, 0).content],
    ['cliente', (t: string) => enforceAIActionPromiseCoherence(t, 0).content],
  ])('%s: quando tudo é promessa, sobra uma frase honesta — não um bullet', (_lado, cortar) => {
    const content = cortar('- Revise a proposta.\n- Confirme no aplicativo.');

    expect(hasRenderableText(content)).toBe(true);
    expect(content).toMatch(/Não consegui montar uma proposta aplicável/);
  });
});

describe('texto sem nada legível não é resposta', () => {
  it.each(['•', '-', '- ', '*', '   ', '', '.', '· ·'])(
    '%p é recusado antes de virar mensagem',
    (texto) => {
      expect(hasRenderableText(texto)).toBe(false);
      expect(serverHasRenderableText(texto)).toBe(false);
    },
  );

  it('texto de verdade passa, inclusive com acento e número', () => {
    for (const texto of ['Praça Vermelha', '09:00 Café', 'Ok']) {
      expect(hasRenderableText(texto)).toBe(true);
      expect(serverHasRenderableText(texto)).toBe(true);
    }
  });

  it('emoji sozinho não conta como resposta', () => {
    // Uma bolha só com um emoji é tão muda quanto uma só com um bullet.
    expect(hasRenderableText('🙂')).toBe(false);
  });
});

describe('a linha de diagnóstico em DEV (§5)', () => {
  it('mostra status, código e fase', () => {
    expect(formatAIFailure({ httpStatus: 429, code: 'RATE_LIMIT', stage: 'REQUEST' })).toBe(
      'DEV · HTTP 429 · RATE_LIMIT · REQUEST',
    );
    expect(
      formatAIFailure({ httpStatus: 200, code: 'ACTION_PARSE_FAILED', stage: 'PARSE' }),
    ).toBe('DEV · HTTP 200 · ACTION_PARSE_FAILED · PARSE');
  });

  it('sem status HTTP — timeout, offline — ainda diz o que foi', () => {
    expect(formatAIFailure({ code: 'TIMEOUT', stage: 'TRANSPORT' })).toBe(
      'DEV · HTTP — · TIMEOUT · TRANSPORT',
    );
  });

  it('nunca inventa: sem código, diz UNKNOWN', () => {
    expect(formatAIFailure({})).toBe('DEV · HTTP — · UNKNOWN · REQUEST');
  });
});

/**
 * A CAUSA DO 502, E NÃO SÓ O 502 (§4–§5 da rodada de produção).
 *
 * O 502 observado em produção — 26/08/2026 11:48:14 UTC, 3236 ms — chegou ao
 * aparelho como `HTTP_502 · TRANSPORT`. Esse rótulo só diz "a nossa Function
 * recusou": as quatro causas possíveis (upstream não-2xx, exceção no fetch,
 * resposta sem candidato, resultado final inválido) saíam com o mesmo corpo.
 *
 * O que se mede aqui: que cada causa tem código próprio, que só o transitório
 * é repetível, e que o código do servidor sobrevive até a linha DEV da tela.
 */
describe('classificação da falha do Gemini', () => {
  it('mapeia cada status do upstream para um código próprio', () => {
    expect(classifyUpstreamStatus(429).code).toBe('GEMINI_RATE_LIMIT');
    expect(classifyUpstreamStatus(500).code).toBe('GEMINI_UPSTREAM_500');
    expect(classifyUpstreamStatus(502).code).toBe('GEMINI_UPSTREAM_502');
    expect(classifyUpstreamStatus(503).code).toBe('GEMINI_UNAVAILABLE');
    expect(classifyUpstreamStatus(504).code).toBe('GEMINI_TIMEOUT');
  });

  it('só considera repetível o que é intermitência do provedor', () => {
    for (const status of [429, 500, 502, 503, 504]) {
      expect(classifyUpstreamStatus(status).retryable).toBe(true);
    }
    // Determinísticos: chave errada, sessão inválida, payload recusado.
    // Repetir devolveria o mesmo erro e dobraria a espera da pessoa.
    for (const status of [400, 401, 403, 404]) {
      expect(classifyUpstreamStatus(status).retryable).toBe(false);
    }
  });

  it('separa estouro de prazo, queda de rede e defeito nosso', () => {
    const timeout = new Error('deadline');
    timeout.name = 'TimeoutError';
    expect(classifyUpstreamException(timeout)).toEqual({
      code: 'GEMINI_TIMEOUT',
      retryable: true,
    });

    const abort = new Error('aborted');
    abort.name = 'AbortError';
    expect(classifyUpstreamException(abort).code).toBe('GEMINI_TIMEOUT');

    expect(classifyUpstreamException(new TypeError('Network request failed'))).toEqual({
      code: 'GEMINI_NETWORK',
      retryable: true,
    });

    // Um defeito nosso não pode ser rotulado como problema de rede nem ganhar
    // uma segunda tentativa: ele vai falhar de novo, igual.
    expect(classifyUpstreamException(new RangeError('bug'))).toEqual({
      code: 'AI_CHAT_INTERNAL',
      retryable: false,
    });
  });

  it('conta candidatos para separar "veio vazio" de "não deu para ler"', () => {
    expect(countCandidates({ candidates: [{}, {}] })).toBe(2);
    expect(countCandidates({ candidates: [] })).toBe(0);
    expect(countCandidates({})).toBe(0);
    expect(countCandidates(null)).toBe(0);
  });
});

describe('o código do servidor chega à linha DEV', () => {
  it('lê código e fase do corpo da recusa', () => {
    expect(readServerFailure({ code: 'GEMINI_UNAVAILABLE', stage: 'UPSTREAM' })).toEqual({
      code: 'GEMINI_UNAVAILABLE',
      stage: 'UPSTREAM',
    });
  });

  it('ignora corpo ausente, malformado ou com fase desconhecida', () => {
    expect(readServerFailure(undefined)).toEqual({ code: undefined, stage: undefined });
    expect(readServerFailure('502')).toEqual({ code: undefined, stage: undefined });
    // Rótulo é maiúscula, dígito e sublinhado. Qualquer outra coisa é texto,
    // e texto do provedor não entra no diagnóstico.
    expect(readServerFailure({ code: 'quota exceeded for project X' }).code).toBeUndefined();
    expect(readServerFailure({ code: 'GEMINI_TIMEOUT', stage: 'QUALQUER' })).toEqual({
      code: 'GEMINI_TIMEOUT',
      stage: undefined,
    });
  });

  it('substitui HTTP_502 · TRANSPORT pela causa real', () => {
    const servidor = readServerFailure({ code: 'GEMINI_UNAVAILABLE', stage: 'UPSTREAM' });
    expect(
      formatAIFailure({ httpStatus: 502, code: servidor.code, stage: servidor.stage }),
    ).toBe('DEV · HTTP 502 · GEMINI_UNAVAILABLE · UPSTREAM');
  });

  it('mantém o rótulo de transporte quando a recusa não traz código', () => {
    const servidor = readServerFailure(undefined);
    expect(
      formatAIFailure({
        httpStatus: 502,
        code: servidor.code ?? 'HTTP_502',
        stage: servidor.stage ?? 'TRANSPORT',
      }),
    ).toBe('DEV · HTTP 502 · HTTP_502 · TRANSPORT');
  });
});

/**
 * O SERVIDOR NÃO INVENTA RESPOSTA (§9 da rodada de produção).
 *
 * Em produção o mesmo pedido ora devolvia o roteiro, ora devolvia um 200 com
 * a frase "Não consegui montar um roteiro completo para este dia agora — o que
 * segue é só o que tenho" e NADA em seguida. A frase era do servidor, não do
 * modelo: com `content` vazio, a divulgação virava conteúdo, passava por
 * `hasRenderableText` — porque tem letras — e a falha sumia.
 *
 * Anunciar conteúdo que não existe é a mesma incoerência que o corte de
 * promessas existe para impedir, só que cometida pelo nosso próprio código.
 */
describe('a divulgação de roteiro incompleto não promete o que não veio', () => {
  const pedido = { expectsFullDay: true, acceptsPriorOffer: false } as Parameters<
    typeof discloseIncompleteItinerary
  >[1];

  it('sem texto do modelo, não diz "o que segue"', () => {
    const saida = discloseIncompleteItinerary('', pedido, []);
    expect(saida).toBe('Não consegui montar um roteiro completo para este dia agora.');
    expect(saida).not.toContain('o que segue');
  });

  it('trata texto sem nada legível como ausência de texto', () => {
    // Um "•" solto não é conteúdo: prometer que ele "é o que tenho" repete
    // exatamente o defeito da bolha vazia.
    expect(discloseIncompleteItinerary('  •  ', pedido, [])).not.toContain('o que segue');
  });

  it('com texto do modelo, mantém o aviso e preserva o texto', () => {
    const saida = discloseIncompleteItinerary('- 09:00 Museu', pedido, []);
    expect(saida).toContain('o que segue é só o que tenho');
    expect(saida).toContain('- 09:00 Museu');
  });

  it('não toca em pedido que não é de dia inteiro', () => {
    const avulso = { expectsFullDay: false, acceptsPriorOffer: false } as typeof pedido;
    expect(discloseIncompleteItinerary('', avulso, [])).toBe('');
  });
});

describe('por que o modelo parou', () => {
  it('lê o finishReason do primeiro candidato', () => {
    expect(readFinishReason({ candidates: [{ finishReason: 'MAX_TOKENS' }] })).toBe('MAX_TOKENS');
    expect(readFinishReason({ candidates: [{ finishReason: 'STOP' }] })).toBe('STOP');
  });

  it('devolve null quando a resposta não diz', () => {
    expect(readFinishReason({ candidates: [{}] })).toBeNull();
    expect(readFinishReason({ candidates: [] })).toBeNull();
    expect(readFinishReason(null)).toBeNull();
  });
});

/**
 * 429 NÃO É UMA COISA SÓ.
 *
 * Teto do minuto e cota do dia chegam com o mesmo HTTP 429 e pedem reações
 * opostas: um passa sozinho em segundos, o outro não passa hoje. Enquanto os
 * dois saíam como `GEMINI_RATE_LIMIT`, a validação de produção parecia
 * instável — até ficar claro que a cota diária do projeto tinha acabado.
 *
 * O que se mede aqui: que os rótulos estruturados são extraídos, que a
 * mensagem do provedor NUNCA sobrevive à extração, e que a distinção sai certa.
 */
describe('rótulos estruturados de um 429 do Gemini', () => {
  const corpoCota = JSON.stringify({
    error: {
      code: 429,
      message: 'Quota exceeded for quota metric ... prompt: "Monte um roteiro para Tóquio"',
      status: 'RESOURCE_EXHAUSTED',
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [{ quotaMetric: 'generate_requests', quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }],
        },
        { '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'RATE_LIMIT_EXCEEDED' },
      ],
    },
  });

  const corpoMinuto = JSON.stringify({
    error: {
      code: 429,
      message: 'Too many requests',
      status: 'RESOURCE_EXHAUSTED',
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel' }],
        },
        { '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'RATE_LIMIT_EXCEEDED' },
      ],
    },
  });

  it('extrai status, reason e quotaId', () => {
    expect(readRateLimitSignals(corpoCota)).toEqual({
      status: 'RESOURCE_EXHAUSTED',
      reason: 'RATE_LIMIT_EXCEEDED',
      quotaIds: ['GenerateRequestsPerDayPerProjectPerModel-FreeTier'],
    });
  });

  it('NUNCA deixa a mensagem do provedor passar', () => {
    // A mensagem do Google pode ecoar o prompt, que é dado privado de viagem.
    const sinais = readRateLimitSignals(corpoCota);
    const serializado = JSON.stringify(sinais);
    expect(serializado).not.toContain('Monte um roteiro');
    expect(serializado).not.toContain('prompt');
    expect(serializado).not.toContain('Quota exceeded for');
    expect(Object.keys(sinais).sort()).toEqual(['quotaIds', 'reason', 'status']);
  });

  it('descarta campo esperado que venha como frase livre', () => {
    const sinais = readRateLimitSignals(
      JSON.stringify({ error: { status: 'cota estourada para o projeto X', details: [] } }),
    );
    expect(sinais.status).toBeNull();
  });

  it('cota do dia vira GEMINI_QUOTA_EXCEEDED', () => {
    expect(classifyRateLimit(readRateLimitSignals(corpoCota)).code).toBe('GEMINI_QUOTA_EXCEEDED');
  });

  it('teto do minuto continua GEMINI_RATE_LIMIT', () => {
    expect(classifyRateLimit(readRateLimitSignals(corpoMinuto)).code).toBe('GEMINI_RATE_LIMIT');
  });

  it('reason que fala em cota basta, sem quotaId', () => {
    const sinais = readRateLimitSignals(
      JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED', details: [{ reason: 'QUOTA_EXCEEDED' }] } }),
    );
    expect(classifyRateLimit(sinais).code).toBe('GEMINI_QUOTA_EXCEEDED');
  });

  it('sem rótulo nenhum, fica no código conservador', () => {
    // O que se resolve esperando é o palpite seguro: rotular cota sem prova
    // faria a tela dizer "acabou por hoje" para quem só tocou rápido demais.
    for (const corpo of ['', 'not json at all', '<html>502</html>', JSON.stringify({ error: {} })]) {
      expect(classifyRateLimit(readRateLimitSignals(corpo)).code).toBe('GEMINI_RATE_LIMIT');
    }
  });

  it('ignora corpo grande demais para ser erro estruturado', () => {
    const gigante = JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED', padding: 'x'.repeat(20_000) } });
    expect(readRateLimitSignals(gigante)).toEqual({ status: null, reason: null, quotaIds: [] });
  });

  it('o código do 429 chega à linha DEV', () => {
    const code = classifyRateLimit(readRateLimitSignals(corpoCota)).code;
    expect(formatAIFailure({ httpStatus: 502, code, stage: 'UPSTREAM' })).toBe(
      'DEV · HTTP 502 · GEMINI_QUOTA_EXCEEDED · UPSTREAM',
    );
  });
});
