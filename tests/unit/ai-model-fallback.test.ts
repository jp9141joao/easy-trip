import {
  AI_FAILURE_MESSAGE as AI_FAILURE_MESSAGE_SERVIDOR,
  AI_GENERIC_FAILURE_MESSAGE as AI_GENERIC_SERVIDOR,
  AI_MODEL_CHAIN,
  FULL_DAY_MAX_ITEMS,
  FULL_DAY_MIN_ITEMS,
  PRIMARY_MODEL,
  TEXT_MODEL_CHAIN,
  classifyChainOutcome,
  classifyItineraryRequest,
  classifyUpstreamException,
  classifyRateLimit,
  classifyUpstreamResponse,
  describeUpstreamFailure,
  hasDailyQuotaEvidence,
  isProjectWideQuota,
  itineraryItemCount,
  joinCandidateText,
  needsItineraryRepair,
  readModelOutput,
  readRateLimitSignals,
  runModelChain,
  textModelChain,
  type AIModelConfig,
  type ModelAttemptLog,
  type ModelCallResult,
  type ModelChainOptions,
} from '../../supabase/functions/ai-chat/protocol';
import {
  AI_FAILURE_MESSAGE as AI_FAILURE_MESSAGE_CLIENTE,
  AI_GENERIC_FAILURE_MESSAGE as AI_GENERIC_CLIENTE,
  describeAIFailure,
} from '@/lib/aiTrace';
import { parseAIActions } from '@/domain/aiActions';
import type { Trip } from '@/domain/types';

/**
 * A CADEIA DE MODELOS (§1–§47 do pedido de fallback).
 *
 * O DEFEITO QUE ESTA SUÍTE MEDE
 *
 * `const MODEL = 'gemini-3.6-flash'`. Um único HTTP 429 daquele modelo — teto
 * do minuto ou cota do dia — deixava o aplicativo inteiro sem assistente até a
 * cota renovar, porque não havia para onde ir. Pior: a classificação marcava
 * `GEMINI_QUOTA_EXCEEDED` como repetível, então a requisição ainda gastava uma
 * segunda chamada no MESMO modelo antes de mostrar o erro.
 *
 * O QUE SE MEDE AQUI
 *
 * Que a cadeia troca de modelo por falta de capacidade e SÓ por isso; que erro
 * determinístico nosso continua parando tudo, para o defeito aparecer; que o
 * orçamento é global e nunca vira "60 segundos por modelo"; que o esgotamento
 * produz um código que diz o que aconteceu; e que nenhuma dessas linhas de
 * diagnóstico carrega texto de ninguém.
 */

/* ------------------------------ corpos reais ------------------------------ */

/**
 * O `message` do Google ecoa o prompt enviado. Ele está aqui de propósito: é o
 * que NÃO pode sobreviver a nenhuma etapa do diagnóstico.
 */
const PROMPT_ECOADO = 'Monte um roteiro para Tóquio com a Ana';

const corpo429 = (quotaId: string | null, reason = 'RATE_LIMIT_EXCEEDED') =>
  JSON.stringify({
    error: {
      code: 429,
      message: `Quota exceeded for quota metric ... prompt: "${PROMPT_ECOADO}"`,
      status: 'RESOURCE_EXHAUSTED',
      details: [
        ...(quotaId
          ? [
              {
                '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
                violations: [{ quotaMetric: 'generate_requests', quotaId }],
              },
            ]
          : []),
        { '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason },
      ],
    },
  });

/** Cota do DIA daquele modelo: trocar de modelo é exatamente o que resolve. */
const COTA_DIA_DO_MODELO = corpo429('GenerateRequestsPerDayPerProjectPerModel-FreeTier');
/** Teto do MINUTO daquele modelo. */
const MINUTO_DO_MODELO = corpo429('GenerateRequestsPerMinutePerProjectPerModel');
/** Cota sem `quotaId`: é cota, mas nada prova que ela renova amanhã. */
const COTA_SEM_PROVA_DE_DIA = corpo429(null, 'QUOTA_EXCEEDED');
/** Teto do PROJETO: já vale para todos os modelos da cadeia. */
const COTA_DO_PROJETO = corpo429('GenerateRequestsPerDayPerProject', 'QUOTA_EXCEEDED');

const NAO_ENCONTRADO = JSON.stringify({
  error: {
    code: 404,
    message: 'models/gemini-x is not found for API version v1beta',
    status: 'NOT_FOUND',
  },
});

/* -------------------------------- o harness ------------------------------- */

/** Uma resposta do Gemini, no envelope de `generateContent`. */
function respostaGemini(payload: unknown) {
  return { candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] }, finishReason: 'STOP' }] };
}

const OK_SIMPLES = respostaGemini({ content: 'Tudo certo por aqui.', actions: [] });

interface Passo {
  /** 200 com este corpo. */
  ok?: unknown;
  status?: number;
  /** Corpo de erro do provedor. */
  body?: string;
  /** Exceção do fetch, pelo `error.name`. */
  erro?: 'TimeoutError' | 'AbortError' | 'TypeError' | 'RangeError';
  /** Quanto esta chamada custa no relógio falso. */
  ms?: number;
}

const ORCAMENTO_PADRAO = 60_000;

/**
 * Roda a cadeia com relógio falso e um roteiro por modelo.
 *
 * Um `Passo` só vale para sempre naquele modelo; um array de `Passo` é
 * consumido em ordem e o último se repete — é como se escreve "falha e depois
 * responde" sem um mock que conte chamadas por fora.
 */
async function executar(
  roteiro: Record<string, Passo | Passo[]>,
  extra: Partial<ModelChainOptions> & { budgetMs?: number } = {},
) {
  const { budgetMs = ORCAMENTO_PADRAO, ...opcoes } = extra;
  let relogio = 0;
  const chamadas: { modelId: string; prazo: number }[] = [];
  const logs: ModelAttemptLog[] = [];
  const filas = new Map<string, Passo[]>();

  const resultado = await runModelChain({
    models: TEXT_MODEL_CHAIN,
    phase: 'FIRST_GENERATION',
    timeoutMs: 45_000,
    minModelBudgetMs: 8_000,
    retryMinBudgetMs: 15_000,
    retryDelayMs: 400,
    remainingBudgetMs: () => budgetMs - relogio,
    elapsedMs: () => relogio,
    sleep: async (ms) => {
      relogio += ms;
    },
    // Sem jitter: o teste mede orçamento, não sorte.
    jitter: () => 0,
    onAttempt: (entry) => logs.push(entry),
    call: async (model: AIModelConfig, prazo: number): Promise<ModelCallResult> => {
      chamadas.push({ modelId: model.id, prazo });

      const definido = roteiro[model.id] ?? { status: 429, body: COTA_DIA_DO_MODELO };
      const fila = filas.get(model.id) ?? (Array.isArray(definido) ? [...definido] : [definido]);
      filas.set(model.id, fila);
      const passo = fila.length > 1 ? fila.shift()! : fila[0];

      relogio += passo.ms ?? 1_000;

      if (passo.erro) {
        const erro = new Error('falha');
        erro.name = passo.erro;
        // Mesmo caminho do servidor: exceção do fetch não tem status HTTP.
        return { ok: false, failure: classifyUpstreamException(erro) };
      }

      if (passo.ok !== undefined) return { ok: true, data: passo.ok };

      const status = passo.status ?? 429;
      const sinais = readRateLimitSignals(passo.body ?? '');
      return {
        ok: false,
        failure: classifyUpstreamResponse(status, sinais),
        upstreamStatus: status,
        signals: sinais,
      };
    },
    ...opcoes,
  });

  return { resultado, chamadas, logs, relogio };
}

/** O mesmo passo para toda a cadeia. */
function paraTodos(passo: Passo | Passo[]): Record<string, Passo | Passo[]> {
  return Object.fromEntries(TEXT_MODEL_CHAIN.map((m) => [m.id, passo]));
}

const [MODELO_A, MODELO_B, MODELO_C] = TEXT_MODEL_CHAIN.map((m) => m.id);

/* --------------------------- a lista de modelos --------------------------- */

describe('a lista central de modelos', () => {
  it('a cadeia efetiva é a ordem de preferência declarada', () => {
    expect(TEXT_MODEL_CHAIN.map((m) => m.id)).toEqual([
      'gemini-3.6-flash',
      'gemini-3.5-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-3-flash-preview',
    ]);
    expect(TEXT_MODEL_CHAIN).toHaveLength(5);
    expect(PRIMARY_MODEL).toBe('gemini-3.6-flash');
  });

  it('só entra na cadeia o modelo com prova real do NOSSO payload', () => {
    /*
     * ListModels não é prova. Estes dois estavam no catálogo e saíram mesmo
     * assim: `gemini-3.7-flash` porque o probe nunca produziu resultado —
     * ausência de prova, e não incompatibilidade —, e `gemini-2.5-flash-lite`
     * porque o probe com o payload real devolveu 404 NOT_FOUND.
     *
     * O teste trava a remoção porque o custo de reincluir um deles no escuro
     * não é "um fallback pior": 400 não troca de modelo, então um ID que
     * recusasse o `responseSchema` cortaria a cadeia na posição dele e
     * levaria junto todos os que vêm depois.
     */
    const ids = TEXT_MODEL_CHAIN.map((m) => m.id);
    expect(ids).not.toContain('gemini-3.7-flash');
    expect(ids).not.toContain('gemini-2.5-flash-lite');
  });

  it('nenhum ID aparece duas vezes', () => {
    const ids = TEXT_MODEL_CHAIN.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('TTS, Live e áudio NUNCA entram na cadeia textual', () => {
    /*
     * Eles não são "modelos piores": geram fala, respondem por outro endpoint
     * e não devolvem `{ content, actions }` sob `responseSchema`. Um deles na
     * cadeia produziria uma falha de parse que pareceria defeito do nosso
     * protocolo — e o filtro é no código, não na revisão do array, porque a
     * lista vai mudar quando os modelos mudarem.
     */
    const comTTS: AIModelConfig[] = [
      { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', enabled: true },
      { id: 'gemini-3.1-flash-tts-preview', label: 'Gemini 3.1 Flash TTS', enabled: true },
      { id: 'gemini-2.5-flash-preview-tts', label: 'Gemini 2.5 Flash TTS', enabled: true },
      { id: 'gemini-3.1-flash-live-preview', label: 'Gemini 3.1 Flash Live', enabled: true },
      { id: 'gemini-2.5-flash-native-audio-preview-12-2025', label: 'Live', enabled: true },
    ];

    expect(textModelChain(comTTS).map((m) => m.id)).toEqual(['gemini-3.6-flash']);
    expect(TEXT_MODEL_CHAIN.some((m) => /tts|live|audio/i.test(m.id))).toBe(false);
  });

  it('modelo desligado sai da cadeia sem quebrar nada', () => {
    const desligado = AI_MODEL_CHAIN.map((m) =>
      m.id === 'gemini-3.6-flash' ? { ...m, enabled: false } : m,
    );
    expect(textModelChain(desligado).map((m) => m.id)).not.toContain('gemini-3.6-flash');
    expect(textModelChain(desligado)).toHaveLength(TEXT_MODEL_CHAIN.length - 1);
  });
});

/* ------------------------------ o fallback ------------------------------- */

describe('a cadeia troca de modelo por falta de capacidade', () => {
  it('sucesso no primeiro modelo não chama o segundo', async () => {
    const { resultado, chamadas } = await executar({ [MODELO_A]: { ok: OK_SIMPLES } });

    expect(resultado.ok).toBe(true);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].modelId).toBe(MODELO_A);
  });

  it('cota esgotada no A leva ao B, e o usuário não vê erro', async () => {
    const { resultado, chamadas } = await executar({
      [MODELO_A]: { status: 429, body: COTA_DIA_DO_MODELO },
      [MODELO_B]: { ok: OK_SIMPLES },
    });

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error('inalcançável');
    expect(resultado.model.id).toBe(MODELO_B);
    expect(chamadas.map((c) => c.modelId)).toEqual([MODELO_A, MODELO_B]);
  });

  it('teto do minuto no A leva ao B — sem repetir no A', async () => {
    // Era aqui que o orçamento sumia: o 429 do A ganhava uma segunda chamada
    // no próprio A antes de qualquer coisa útil acontecer.
    const { resultado, chamadas } = await executar(
      {
        [MODELO_A]: { status: 429, body: MINUTO_DO_MODELO },
        [MODELO_B]: { ok: OK_SIMPLES },
      },
      { allowSameModelRetry: true },
    );

    expect(resultado.ok).toBe(true);
    expect(chamadas.filter((c) => c.modelId === MODELO_A)).toHaveLength(1);
    expect(chamadas.map((c) => c.modelId)).toEqual([MODELO_A, MODELO_B]);
  });

  it('dois esgotados seguidos e o terceiro responde', async () => {
    const { resultado, chamadas } = await executar({
      [MODELO_A]: { status: 429, body: COTA_DIA_DO_MODELO },
      [MODELO_B]: { status: 429, body: COTA_DIA_DO_MODELO },
      [MODELO_C]: { ok: OK_SIMPLES },
    });

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error('inalcançável');
    // §15: é este que o reparo vai reaproveitar.
    expect(resultado.model.id).toBe(MODELO_C);
    expect(resultado.modelIndex).toBe(2);
    expect(resultado.modelsTried).toBe(3);
    expect(chamadas.map((c) => c.modelId)).toEqual([MODELO_A, MODELO_B, MODELO_C]);
  });

  it('modelo que não existe mais é pulado, e a cadeia segue', async () => {
    const { resultado, chamadas } = await executar({
      [MODELO_A]: { status: 404, body: NAO_ENCONTRADO },
      [MODELO_B]: { ok: OK_SIMPLES },
    });

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error('inalcançável');
    expect(resultado.model.id).toBe(MODELO_B);
    // O chamador guarda isto para o reparo não redescobrir o mesmo 404.
    expect(resultado.unavailable).toEqual([MODELO_A]);
    expect(chamadas).toHaveLength(2);
  });

  it('um ID já provado inexistente não é chamado de novo', async () => {
    const { chamadas } = await executar(
      { [MODELO_B]: { ok: OK_SIMPLES } },
      { skip: new Set([MODELO_A]) },
    );

    expect(chamadas.map((c) => c.modelId)).toEqual([MODELO_B]);
  });
});

/* -------------------------- erro determinístico --------------------------- */

describe('erro determinístico PARA a cadeia — trocar de modelo esconderia o defeito', () => {
  it.each([
    [400, 'GEMINI_UPSTREAM_400'],
    [401, 'GEMINI_UPSTREAM_401'],
    [403, 'GEMINI_UPSTREAM_403'],
  ])('%i não tenta o próximo modelo', async (status, code) => {
    const { resultado, chamadas } = await executar({
      [MODELO_A]: { status, body: '{}' },
      [MODELO_B]: { ok: OK_SIMPLES },
    });

    expect(resultado.ok).toBe(false);
    if (resultado.ok) throw new Error('inalcançável');
    // O código é o DELE, não o global: um 401 não é "a IA está sem cota".
    expect(resultado.failure.code).toBe(code);
    expect(chamadas).toHaveLength(1);
  });

  it('nem mesmo um rótulo NOT_FOUND transforma um 400 em troca de modelo', async () => {
    // Um 400 é do nosso payload. Deixar um rótulo do provedor promovê-lo a
    // "tente outro modelo" faria um defeito nosso sair como resposta boa.
    const { chamadas } = await executar({
      [MODELO_A]: { status: 400, body: JSON.stringify({ error: { status: 'NOT_FOUND' } }) },
      [MODELO_B]: { ok: OK_SIMPLES },
    });
    expect(chamadas).toHaveLength(1);
  });

  it('200 com corpo ilegível não vira troca de modelo', () => {
    // `GEMINI_PARSE_ERROR` é defeito de leitura nosso; nenhum outro modelo
    // conserta isso.
    expect(classifyUpstreamResponse(200, readRateLimitSignals('')).fallback).toBeUndefined();
  });
});

/* ------------------- transitório que não é falta de cota ------------------ */

describe('5xx e queda de rede mantêm a política de repetição existente', () => {
  it('500 repete UMA vez no mesmo modelo e não desce a cadeia', async () => {
    const { resultado, chamadas } = await executar(
      {
        [MODELO_A]: { status: 500, body: '{}' },
        [MODELO_B]: { ok: OK_SIMPLES },
      },
      { allowSameModelRetry: true },
    );

    expect(chamadas.map((c) => c.modelId)).toEqual([MODELO_A, MODELO_A]);
    expect(resultado.ok).toBe(false);
    if (resultado.ok) throw new Error('inalcançável');
    expect(resultado.failure.code).toBe('GEMINI_UPSTREAM_500');
  });

  it('queda de rede transitória repete e a segunda passa', async () => {
    const { resultado, chamadas } = await executar(
      { [MODELO_A]: [{ erro: 'TypeError' }, { ok: OK_SIMPLES }] },
      { allowSameModelRetry: true },
    );

    expect(chamadas.map((c) => c.modelId)).toEqual([MODELO_A, MODELO_A]);
    expect(resultado.ok).toBe(true);
  });

  it('nunca A A B B C C: nenhum modelo passa de duas chamadas', async () => {
    const { chamadas } = await executar(paraTodos({ status: 429, body: COTA_DIA_DO_MODELO }), {
      allowSameModelRetry: true,
    });

    for (const model of TEXT_MODEL_CHAIN) {
      expect(chamadas.filter((c) => c.modelId === model.id).length).toBeLessThanOrEqual(1);
    }
    // Um por modelo, e nada além: a cadeia anda para a frente e termina.
    expect(chamadas).toHaveLength(TEXT_MODEL_CHAIN.length);
  });
});

/* ------------------------------- orçamento -------------------------------- */

describe('o orçamento é GLOBAL, e nunca 60 segundos por modelo', () => {
  it('três recusas rápidas e um sucesso somam o tempo de todas', async () => {
    const { resultado, relogio } = await executar({
      [MODELO_A]: { status: 429, body: COTA_DIA_DO_MODELO, ms: 1_000 },
      [MODELO_B]: { status: 429, body: COTA_DIA_DO_MODELO, ms: 1_000 },
      [MODELO_C]: { ok: OK_SIMPLES, ms: 8_000 },
    });

    expect(resultado.ok).toBe(true);
    expect(relogio).toBe(10_000);
    expect(relogio).toBeLessThan(ORCAMENTO_PADRAO);
  });

  it('um modelo lento não dá 45s a cada um dos seguintes', async () => {
    const { chamadas } = await executar({
      [MODELO_A]: { status: 429, body: COTA_DIA_DO_MODELO, ms: 40_000 },
      [MODELO_B]: { ok: OK_SIMPLES, ms: 5_000 },
    });

    // O prazo do segundo é o que sobrou do orçamento, não o teto por chamada.
    expect(chamadas[0].prazo).toBe(45_000);
    expect(chamadas[1].prazo).toBe(20_000);
  });

  it('orçamento insuficiente NÃO inicia a chamada seguinte', async () => {
    const { resultado, chamadas, logs } = await executar(
      {
        [MODELO_A]: { status: 429, body: COTA_DIA_DO_MODELO, ms: 6_000 },
        [MODELO_B]: { ok: OK_SIMPLES },
      },
      { budgetMs: 12_000 },
    );

    // Sobraram 6s, e o piso é 8s: começar produziria um timeout garantido que
    // ainda gastaria uma chamada paga.
    expect(chamadas).toHaveLength(1);
    expect(logs.at(-1)).toMatchObject({ result: 'SKIPPED_BUDGET' });

    expect(resultado.ok).toBe(false);
    if (resultado.ok) throw new Error('inalcançável');
    // A cadeia não foi percorrida inteira: nada de afirmar "todos sem cota".
    expect(resultado.failure.code).toBe('AI_MODELS_EXHAUSTED');
  });

  it('sem orçamento para a repetição, ela não acontece', async () => {
    const { chamadas } = await executar(
      { [MODELO_A]: { status: 500, body: '{}', ms: 47_000 } },
      { allowSameModelRetry: true },
    );

    expect(chamadas).toHaveLength(1);
  });
});

/* --------------------------- resultado da cadeia -------------------------- */

describe('quando TODOS os modelos esgotam, o código diz o que aconteceu', () => {
  it('todos com cota do dia: limite diário, com prova', async () => {
    const { resultado, chamadas } = await executar(
      paraTodos({ status: 429, body: COTA_DIA_DO_MODELO }),
    );

    expect(chamadas).toHaveLength(TEXT_MODEL_CHAIN.length);
    expect(resultado.ok).toBe(false);
    if (resultado.ok) throw new Error('inalcançável');
    expect(resultado.failure.code).toBe('GEMINI_ALL_MODELS_DAILY_QUOTA');
  });

  it('todos com cota SEM prova de dia: nada de prometer amanhã', async () => {
    const { resultado } = await executar(paraTodos({ status: 429, body: COTA_SEM_PROVA_DE_DIA }));

    if (resultado.ok) throw new Error('inalcançável');
    expect(resultado.failure.code).toBe('GEMINI_ALL_MODELS_QUOTA_EXCEEDED');
    expect(describeUpstreamFailure(resultado.failure.code)).not.toMatch(/diário/);
  });

  it('todos com teto de minuto: peça para esperar instantes', async () => {
    const { resultado } = await executar(paraTodos({ status: 429, body: MINUTO_DO_MODELO }));

    if (resultado.ok) throw new Error('inalcançável');
    expect(resultado.failure.code).toBe('GEMINI_ALL_MODELS_RATE_LIMITED');
  });

  it('todos os IDs recusados: é catálogo nosso, não falta de cota', async () => {
    const { resultado } = await executar(paraTodos({ status: 404, body: NAO_ENCONTRADO }));

    if (resultado.ok) throw new Error('inalcançável');
    expect(resultado.failure.code).toBe('GEMINI_MODELS_UNAVAILABLE');
    expect(resultado.unavailable).toHaveLength(TEXT_MODEL_CHAIN.length);
  });

  it('resultado MISTO fica no neutro — afirmar "cota do dia" seria invenção', async () => {
    const roteiro: Record<string, Passo> = {};
    TEXT_MODEL_CHAIN.forEach((model, i) => {
      roteiro[model.id] = {
        status: 429,
        body: i % 2 === 0 ? COTA_DIA_DO_MODELO : MINUTO_DO_MODELO,
      };
    });

    const { resultado } = await executar(roteiro);
    if (resultado.ok) throw new Error('inalcançável');
    expect(resultado.failure.code).toBe('AI_MODELS_EXHAUSTED');
    expect(resultado.reasons).toContain('GEMINI_QUOTA_EXCEEDED');
    expect(resultado.reasons).toContain('GEMINI_RATE_LIMIT');
  });

  it('a classificação global exige unanimidade E cadeia completa', () => {
    expect(classifyChainOutcome(['GEMINI_RATE_LIMIT'], { complete: true }).code).toBe(
      'GEMINI_ALL_MODELS_RATE_LIMITED',
    );
    // Interrompida por orçamento: a conclusão não vale para a cadeia inteira.
    expect(classifyChainOutcome(['GEMINI_RATE_LIMIT'], { complete: false }).code).toBe(
      'AI_MODELS_EXHAUSTED',
    );
    expect(classifyChainOutcome([], { complete: true }).code).toBe('AI_MODELS_EXHAUSTED');
  });
});

/* --------------------- cota do projeto: parar mais cedo ------------------- */

describe('evidência de cota do PROJETO encerra a cadeia cedo (§37)', () => {
  it('um `quotaId` de projeto poupa as outras seis chamadas', async () => {
    const { resultado, chamadas, logs } = await executar(
      paraTodos({ status: 429, body: COTA_DO_PROJETO }),
    );

    expect(chamadas).toHaveLength(1);
    expect(logs.at(-1)).toMatchObject({ result: 'SHORT_CIRCUIT' });
    if (resultado.ok) throw new Error('inalcançável');
    // A evidência estruturada já cobre a cadeia inteira: o código é o global.
    expect(resultado.failure.code).toBe('GEMINI_ALL_MODELS_DAILY_QUOTA');
  });

  it('HTTP 429 sozinho NUNCA autoriza essa conclusão', async () => {
    const { chamadas } = await executar(paraTodos({ status: 429, body: 'not json at all' }));
    expect(chamadas).toHaveLength(TEXT_MODEL_CHAIN.length);
  });

  it('teto por projeto E por modelo não é cota global', () => {
    expect(isProjectWideQuota(readRateLimitSignals(COTA_DIA_DO_MODELO))).toBe(false);
    expect(isProjectWideQuota(readRateLimitSignals(COTA_DO_PROJETO))).toBe(true);
    expect(isProjectWideQuota(readRateLimitSignals('{}'))).toBe(false);
  });
});

/* --------------------------------- reparo --------------------------------- */

describe('o reparo começa no modelo que funcionou (§14, §15)', () => {
  /** A segunda passagem, com a política que o servidor usa no reparo. */
  const reparo = (roteiro: Record<string, Passo | Passo[]>, startIndex: number) =>
    executar(roteiro, {
      phase: 'REPAIR',
      startIndex,
      maxModels: 2,
      allowSameModelRetry: false,
      timeoutMs: 25_000,
    });

  it('não refaz a cadeia inteira: começa no escolhido', async () => {
    const { resultado, chamadas } = await reparo({ [MODELO_C]: { ok: OK_SIMPLES } }, 2);

    expect(chamadas.map((c) => c.modelId)).toEqual([MODELO_C]);
    expect(resultado.ok).toBe(true);
  });

  it('se o escolhido perder a cota, existe UM fallback controlado — e só um', async () => {
    const { chamadas } = await reparo(paraTodos({ status: 429, body: COTA_DIA_DO_MODELO }), 2);

    // Dois modelos, não cinco: o reparo é um extra, e a primeira resposta já
    // está na mão. Sem este teto, um roteiro curto custaria a cadeia duas vezes.
    expect(chamadas).toHaveLength(2);
    expect(chamadas.map((c) => c.modelId)).toEqual([MODELO_C, TEXT_MODEL_CHAIN[3].id]);
  });

  it('o reparo não repete no mesmo modelo', async () => {
    const { chamadas } = await reparo({ [MODELO_A]: { status: 500, body: '{}' } }, 0);
    expect(chamadas).toHaveLength(1);
  });
});

/* ------------------------ o fallback não afrouxa nada --------------------- */

describe('um modelo de fallback NÃO ganha licença para responder mal (§25, §27)', () => {
  const moscou: Trip = {
    id: 'trip-moscou',
    userId: 'user-1',
    destinationCity: 'Moscovo',
    destinationCountry: 'Rússia',
    countryCode: 'RU',
    timezone: 'Europe/Moscow',
    startDate: '2026-09-10',
    endDate: '2026-09-20',
    budgetTotal: 12000,
    budgetCurrency: 'BRL',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
  };

  const diaInteiro = (date: string) =>
    respostaGemini({
      content: 'Preparei o dia inteiro. Revise e confirme no aplicativo.',
      actions: [
        {
          type: 'itinerary.add',
          label: 'Adicionar ao roteiro',
          items: [
            { title: 'Praça Vermelha', date, startTime: '09:00', type: 'atracao' },
            { title: 'Catedral de São Basílio', date, startTime: '11:30', type: 'atracao' },
            { title: 'Almoço no Café Pushkin', date, startTime: '14:00', type: 'refeicao' },
            { title: 'Galeria Tretyakov', date, startTime: '16:00', type: 'atracao' },
          ],
        },
      ],
    });

  it('roteiro de dia inteiro sai íntegro pelo modelo de fallback (§30)', async () => {
    const pedido = classifyItineraryRequest('Monte um roteiro para 12/09/2026', []);
    expect(pedido.expectsFullDay).toBe(true);

    const { resultado } = await executar({
      [MODELO_A]: { status: 429, body: COTA_DIA_DO_MODELO },
      [MODELO_B]: { ok: diaInteiro('2026-09-12') },
    });

    if (!resultado.ok) throw new Error('o fallback devia ter respondido');
    const saida = readModelOutput(joinCandidateText(resultado.data), { enforceCoherence: false });

    // As mesmas regras de sempre: parser, validação, 3 a 6 itens, data certa.
    expect(needsItineraryRepair(pedido, saida.actions)).toBe(false);
    expect(itineraryItemCount(saida.actions)).toBeGreaterThanOrEqual(FULL_DAY_MIN_ITEMS);
    expect(itineraryItemCount(saida.actions)).toBeLessThanOrEqual(FULL_DAY_MAX_ITEMS);

    // E a validação do CLIENTE também, que é quem carimba o vínculo da viagem.
    const acoes = parseAIActions(saida.actions, moscou);
    expect(acoes).toHaveLength(1);
    expect(acoes[0].type).toBe('itinerary.add');
  });

  it('"Pode ser" preserva o contexto mesmo com troca de modelo (§31)', async () => {
    const historico = [
      { role: 'assistant' as const, content: 'Posso montar um roteiro para 18/09/2026?' },
    ];
    const pedido = classifyItineraryRequest('Pode ser', historico);
    expect(pedido.acceptsPriorOffer).toBe(true);
    expect(pedido.expectsFullDay).toBe(true);

    const { resultado } = await executar({
      [MODELO_A]: { status: 429, body: COTA_DIA_DO_MODELO },
      [MODELO_B]: { status: 429, body: MINUTO_DO_MODELO },
      [MODELO_C]: { ok: diaInteiro('2026-09-18') },
    });

    if (!resultado.ok) throw new Error('o fallback devia ter respondido');
    const saida = readModelOutput(joinCandidateText(resultado.data), { enforceCoherence: false });

    expect(needsItineraryRepair(pedido, saida.actions)).toBe(false);
    const acoes = parseAIActions(saida.actions, moscou);
    const itens = (acoes[0] as { items: { date: string }[] }).items;
    expect(itens).toHaveLength(4);
    expect(itens.every((i) => i.date === '2026-09-18')).toBe(true);
  });

  it('saída inválida do fallback continua sendo saída inválida', async () => {
    const { resultado } = await executar({
      [MODELO_A]: { status: 429, body: COTA_DIA_DO_MODELO },
      [MODELO_B]: {
        ok: respostaGemini({
          content: 'Prontinho.',
          actions: [{ type: 'itinerary.add', label: 'Adicionar', items: [{ title: '' }] }],
        }),
      },
    });

    if (!resultado.ok) throw new Error('inalcançável');
    const saida = readModelOutput(joinCandidateText(resultado.data), { enforceCoherence: false });
    // Item sem título e sem data não vira roteiro só porque veio de um
    // fallback: a action inteira é descartada, e `-1` é "não veio roteiro".
    expect(saida.actions).toHaveLength(0);
    expect(itineraryItemCount(saida.actions)).toBe(-1);
  });
});

/* ------------------------------ diagnóstico ------------------------------- */

describe('o rastro da cadeia não carrega texto de ninguém (§17, §18)', () => {
  it('cada tentativa vira uma linha com modelo, índice, motivo e orçamento', async () => {
    const { logs } = await executar({
      [MODELO_A]: { status: 429, body: COTA_DIA_DO_MODELO, ms: 812 },
      [MODELO_B]: { ok: OK_SIMPLES, ms: 6_432 },
    });

    expect(logs[0]).toMatchObject({
      phase: 'FIRST_GENERATION',
      modelId: MODELO_A,
      modelIndex: 0,
      modelAttempt: 1,
      result: 'FALLBACK',
      reason: 'GEMINI_QUOTA_EXCEEDED',
      elapsedMs: 812,
      upstreamStatus: 429,
      upstreamStatusLabel: 'RESOURCE_EXHAUSTED',
    });
    expect(logs[1]).toMatchObject({
      modelId: MODELO_B,
      modelIndex: 1,
      result: 'SUCCESS',
      elapsedMs: 7_244,
    });
    expect(logs[0].remainingBudgetMs).toBe(ORCAMENTO_PADRAO - 812);
  });

  it('NADA do prompt, do contexto ou da mensagem do provedor sobrevive', async () => {
    const { logs } = await executar(paraTodos({ status: 429, body: COTA_DIA_DO_MODELO }));
    const serializado = JSON.stringify(logs);

    expect(serializado).not.toContain(PROMPT_ECOADO);
    expect(serializado).not.toContain('Tóquio');
    expect(serializado).not.toContain('Ana');
    expect(serializado).not.toContain('Quota exceeded for');
    expect(serializado).not.toContain('prompt');

    // O que PODE aparecer é vocabulário fechado: rótulo, número, ID de cota.
    for (const linha of logs) {
      expect(Object.keys(linha).sort()).toEqual([
        'elapsedMs',
        'modelAttempt',
        'modelId',
        'modelIndex',
        'phase',
        'quotaIds',
        'reason',
        'remainingBudgetMs',
        'result',
        'upstreamReason',
        'upstreamStatus',
        'upstreamStatusLabel',
      ]);
    }
  });
});

/* --------------------------- a mensagem da tela --------------------------- */

describe('a frase que a pessoa lê (§21, §33)', () => {
  it('servidor e cliente dizem exatamente a mesma coisa', () => {
    // A duplicação é deliberada — Deno e o bundle do Expo não compartilham
    // módulo —, então a igualdade precisa ser medida, não assumida.
    expect(AI_FAILURE_MESSAGE_CLIENTE).toEqual(AI_FAILURE_MESSAGE_SERVIDOR);
    expect(AI_GENERIC_CLIENTE).toBe(AI_GENERIC_SERVIDOR);
  });

  it('só o limite com prova de cota diária fala em "diário"', () => {
    expect(describeAIFailure({ code: 'GEMINI_ALL_MODELS_DAILY_QUOTA' })).toMatch(/limite diário/);
    for (const code of [
      'GEMINI_ALL_MODELS_QUOTA_EXCEEDED',
      'GEMINI_ALL_MODELS_RATE_LIMITED',
      'AI_MODELS_EXHAUSTED',
      'GEMINI_MODELS_UNAVAILABLE',
    ]) {
      expect(describeAIFailure({ code })).not.toMatch(/limite diário/);
    }
  });

  it('rate limit puro pede instantes, não um dia', () => {
    expect(describeAIFailure({ code: 'GEMINI_ALL_MODELS_RATE_LIMITED' })).toMatch(
      /alguns instantes/,
    );
  });

  it('o que não é esgotamento continua na frase genérica', () => {
    expect(describeAIFailure({ code: 'GEMINI_UPSTREAM_500' })).toBe(AI_GENERIC_CLIENTE);
    expect(describeAIFailure(undefined)).toBe(AI_GENERIC_CLIENTE);
    expect(describeAIFailure({ code: 'GEMINI_TIMEOUT' })).toMatch(/Tente novamente/);
  });

  it('NENHUMA mensagem cita modelo, provedor ou detalhe interno', () => {
    for (const frase of Object.values(AI_FAILURE_MESSAGE_CLIENTE)) {
      expect(frase).not.toMatch(/gemini|flash|modelo|3\.7|3\.6|google/i);
    }
  });

  it('todo código global da cadeia tem frase própria', () => {
    // Um código novo sem frase cairia calado na genérica — que é justamente o
    // conselho errado quando a cota acabou.
    for (const code of [
      'GEMINI_ALL_MODELS_DAILY_QUOTA',
      'GEMINI_ALL_MODELS_QUOTA_EXCEEDED',
      'GEMINI_ALL_MODELS_RATE_LIMITED',
      'GEMINI_MODELS_UNAVAILABLE',
      'AI_MODELS_EXHAUSTED',
    ]) {
      expect(describeAIFailure({ code })).not.toBe(AI_GENERIC_CLIENTE);
      // E o cliente só aceita rótulo fechado: o código precisa passar no filtro.
      expect(code).toMatch(/^[A-Z0-9_]{1,64}$/);
    }
  });
});

/* ------------------------ a correção do `retryable` ----------------------- */

describe('cota esgotada não repete no mesmo modelo (§7, §8)', () => {
  it('quota e rate limit trocam de modelo em vez de insistir', () => {
    const cota = classifyRateLimit(readRateLimitSignals(COTA_DIA_DO_MODELO));
    expect(cota).toEqual({ code: 'GEMINI_QUOTA_EXCEEDED', retryable: false, fallback: true });

    const minuto = classifyRateLimit(readRateLimitSignals(MINUTO_DO_MODELO));
    expect(minuto).toEqual({ code: 'GEMINI_RATE_LIMIT', retryable: false, fallback: true });
  });

  it('prova de cota diária exige `quotaId`, não basta o `reason`', () => {
    expect(hasDailyQuotaEvidence(readRateLimitSignals(COTA_DIA_DO_MODELO))).toBe(true);
    expect(hasDailyQuotaEvidence(readRateLimitSignals(COTA_SEM_PROVA_DE_DIA))).toBe(false);
    expect(hasDailyQuotaEvidence(readRateLimitSignals(MINUTO_DO_MODELO))).toBe(false);
  });

  it('404 é sobre o modelo da URL, e vale por trocar de modelo', () => {
    expect(classifyUpstreamResponse(404, readRateLimitSignals(NAO_ENCONTRADO))).toEqual({
      code: 'GEMINI_MODEL_UNAVAILABLE',
      retryable: false,
      fallback: true,
    });
  });
});
