/**
 * Easy Trip IA — BFF endpoint (§16, §47, §48, §49).
 *
 * The whole point of this function is that GEMINI_API_KEY lives HERE and never
 * in the mobile bundle (CA-06, §104). The flow is exactly the one §49 specifies:
 *
 *   Expo → authenticated BFF → validate → rate limit → build contextual prompt
 *        → Gemini → sanitize → Expo
 *
 * Deploy with:
 *   supabase secrets set GEMINI_API_KEY=...
 *   supabase functions deploy ai-chat
 *
 * O contrato do protocolo — prompt, schema, validação, coerência entre texto e
 * proposta, limite de chamadas — vive em `./protocol.ts`, que é puro e sem
 * dependência de Deno. Este arquivo cuida só do que é servidor: autenticar,
 * montar contexto, chamar o Gemini e responder HTTP.
 *
 * Esta função continua sem escrever no banco. Quem grava é o aplicativo, com a
 * sessão do próprio usuário, sob RLS.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

import {
  RESPONSE_SCHEMA,
  SYSTEM_PROMPT,
  buildRepairInstruction,
  classifyItineraryRequest,
  createRateLimiter,
  discloseIncompleteItinerary,
  classifyUpstreamException,
  classifyRateLimit,
  classifyUpstreamStatus,
  countCandidates,
  enforcePromiseCoherence,
  hasRenderableText,
  itineraryItemCount,
  joinCandidateText,
  readFinishReason,
  readRateLimitSignals,
  needsItineraryRepair,
  pickBetterItinerary,
  readModelOutput,
  type RateLimitSignals,
  type UpstreamFailure,
} from './protocol.ts';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const MODEL = 'gemini-3.6-flash';

/**
 * Instrumentação de diagnóstico.
 *
 * Ligada por variável de ambiente, desligada por padrão, e **só números**:
 * quantas ações o modelo mandou, quantas sobreviveram à validação, quantas
 * promessas foram cortadas. Nenhum prompt, nenhum contexto, nenhum trecho de
 * resposta — o conteúdo é dado privado de viagem e não vai para log.
 *
 * Existe porque a rodada anterior não tinha como responder "onde a action
 * sumiu?" sem adivinhar.
 */
const DEBUG_ACTIONS = Deno.env.get('AI_CHAT_DEBUG_ACTIONS') === 'true';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const rateLimiter = createRateLimiter();

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', ...headers },
  });
}

/** Caps sizes so a malicious client cannot blow up the model context. */
function sanitizeContext(context: unknown): unknown {
  if (!context || typeof context !== 'object') return null;
  const c = context as Record<string, unknown>;
  return {
    trip: c.trip ?? null,
    expenses: Array.isArray(c.expenses) ? c.expenses.slice(0, 100) : [],
    itinerary: Array.isArray(c.itinerary) ? c.itinerary.slice(0, 100) : [],
    checklist: Array.isArray(c.checklist) ? c.checklist.slice(0, 100) : [],
    profile: c.profile ?? null,
    places: Array.isArray(c.places) ? c.places.slice(0, 20) : [],
    // Quantos viajantes — muda como o modelo escreve ("seu roteiro" contra "o
    // roteiro de vocês") e o que ele pode assumir sobre quem fez o quê (§57).
    //
    // O que NÃO chega aqui é o conteúdo privado de outros membros: ele nunca
    // sai do Postgres, porque a RLS não o devolve ao aplicativo que monta este
    // contexto (§15). Esta função não consulta o banco e não teria como
    // acrescentá-lo nem se quisesse.
    collaboration: c.collaboration ?? null,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método não suportado.' }, 405);

  if (!GEMINI_API_KEY) {
    // Honest failure instead of a fabricated answer (§1, §8).
    return json({ error: 'O assistente não está configurado neste ambiente.' }, 503);
  }

  // ---- Authenticate: identity comes from the JWT, never from the payload ----
  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return json({ error: 'Não autorizado.' }, 401);
  }
  const userId = userData.user.id;

  // Antes de qualquer coisa cara: uma chamada recusada aqui não consome Gemini.
  if (rateLimiter.limited(userId)) {
    const retryAfter = rateLimiter.retryAfterSeconds(userId);
    return json(
      {
        error: 'Você enviou muitas mensagens. Aguarde alguns segundos para continuar.',
        retryAfter,
      },
      429,
      { 'Retry-After': String(retryAfter) },
    );
  }

  // ------------------------------- Validate --------------------------------
  let payload: { prompt?: unknown; context?: unknown; history?: unknown };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Payload inválido.' }, 400);
  }

  const prompt = typeof payload.prompt === 'string' ? payload.prompt.trim() : '';
  if (!prompt || prompt.length > 4000) {
    return json({ error: 'Pergunta inválida.' }, 400);
  }

  const context = sanitizeContext(payload.context);
  const history = Array.isArray(payload.history)
    ? (payload.history as { role?: string; content?: string }[])
        .filter((m) => m && typeof m.content === 'string' && m.role !== 'system')
        .slice(-12)
    : [];

  // --------------------------- Build the request ----------------------------
  const contents = [
    ...history.map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(message.content).slice(0, 4000) }],
    })),
    {
      role: 'user',
      parts: [
        {
          text: context
            ? `Contexto da viagem ativa (dados reais do sistema, em JSON):\n${JSON.stringify(context)}\n\nPergunta do usuário:\n${prompt}`
            : prompt,
        },
      ],
    },
  ];

  /**
   * O que este pedido espera de volta.
   *
   * Roda antes da chamada porque é o que decide se uma resposta com uma única
   * parada conta como cumprida. "Monte um roteiro para amanhã" e "quero só um
   * restaurante" produzem respostas com um item cada — e só a primeira está
   * errada.
   */
  const itineraryRequest = classifyItineraryRequest(prompt, history);

  /*
   * O ORÇAMENTO DE TEMPO DESTA REQUISIÇÃO.
   *
   * Aqui estava o defeito relatado como "Não foi possível obter uma resposta
   * agora": a tentativa de reparo do roteiro acrescentou uma SEGUNDA geração
   * em sequência, e as duas juntas passavam dos 30 segundos que o cliente
   * esperava por padrão. O aparelho abortava, mostrava o erro genérico, e o
   * servidor seguia respondendo para ninguém.
   *
   * A correção tem dois lados, e os dois precisam existir:
   *   - o cliente agora espera `AI_REQUEST_TIMEOUT_MS` (75s), em
   *     `src/services/ai.ts`;
   *   - esta função se dá um teto MENOR (60s) e desiste do reparo se ele não
   *     couber. Assim quem estoura o prazo primeiro é sempre o servidor, que
   *     ainda consegue devolver a primeira resposta — que é boa — em vez de o
   *     cliente abortar e jogar as duas fora.
   *
   * Uma primeira geração que já passou de `REPAIR_MIN_BUDGET_MS` não ganha
   * reparo: melhor um roteiro curto na tela do que um spinner até o timeout.
   */
  const AI_CHAT_BUDGET_MS = 60_000;
  const FIRST_CALL_TIMEOUT_MS = 45_000;
  const REPAIR_MIN_BUDGET_MS = 20_000;
  const requestStart = Date.now();
  const elapsed = () => Date.now() - requestStart;

  /*
   * O identificador que casa esta requisição com o log.
   *
   * Sem ele, "deu 502 às 11:48" não localiza nada: as linhas do log não têm
   * como ser ligadas ao 502 que a pessoa viu no aparelho. É um UUID, não tem
   * relação com o usuário e não identifica ninguém.
   */
  const requestId = crypto.randomUUID();

  const askGemini = (body: unknown, timeoutMs: number) =>
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY,
      },
      body: JSON.stringify(body),
      // Sem isto, uma chamada pendurada no provedor prenderia a requisição
      // inteira até o cliente desistir — sem nunca dizer por quê.
      signal: AbortSignal.timeout(timeoutMs),
    });

  const generationConfig = {
    temperature: 0.7,
    /*
     * 2048 não cabia um dia inteiro.
     *
     * O modelo é de raciocínio: as partes marcadas como `thought` consomem o
     * mesmo orçamento de saída e são descartadas por `joinCandidateText`. Num
     * pedido de roteiro — 3 a 6 itens em JSON estruturado, cada um com título,
     * data, horário e tipo — o raciocínio comia o teto e a resposta chegava
     * truncada ou vazia, de forma intermitente. Era o que fazia o MESMO pedido
     * ora devolver o roteiro, ora devolver nada.
     *
     * `finishReason` passa a ser lido justamente para essa falha parar de ser
     * invisível: `MAX_TOKENS` vira `GEMINI_TRUNCATED` no diagnóstico.
     */
    maxOutputTokens: 4096,
    // Saída estruturada: o modelo devolve `{ content, actions }`, e o
    // texto da conversa fica num campo só dele. É o que torna possível
    // a promessa de que nada é extraído do Markdown.
    responseMimeType: 'application/json',
    responseSchema: RESPONSE_SCHEMA,
  };

  /*
   * UMA repetição curta, e só para falha transitória.
   *
   * 429, 5xx e queda de rede são intermitências do provedor: a segunda
   * tentativa costuma passar. Já 400/401/403 e corpo malformado são
   * determinísticos — repetir devolve o mesmo erro mais tarde.
   *
   * A repetição NÃO é uma geração a mais no orçamento de conteúdo: ela
   * substitui uma tentativa que não produziu NADA. O teto de gerações
   * bem-sucedidas continua sendo duas — primeira e reparo —, e o orçamento
   * total continua soberano: se não couber, não repete.
   */
  const RETRY_MIN_BUDGET_MS = 15_000;
  const RETRY_BASE_DELAY_MS = 400;

  type GeminiResult =
    | { ok: true; data: unknown; attempts: number }
    | {
        ok: false;
        attempts: number;
        failure: UpstreamFailure;
        upstreamStatus?: number;
        /** Rótulos estruturados de um 429 — nunca a mensagem do provedor. */
        rateLimit?: RateLimitSignals;
      };

  const callGemini = async (
    body: unknown,
    timeoutMs: number,
    { allowRetry }: { allowRetry: boolean },
  ): Promise<GeminiResult> => {
    let attempts = 0;

    for (;;) {
      attempts += 1;
      let failure: UpstreamFailure;
      let upstreamStatus: number | undefined;
      let rateLimitSignals: RateLimitSignals | undefined;

      // O prazo de cada tentativa nunca ultrapassa o que sobrou do orçamento:
      // é o que garante que quem estoura o relógio primeiro somos nós, que
      // sabemos dizer o que aconteceu, e não o cliente, que só sabe "abortei".
      const restante = AI_CHAT_BUDGET_MS - elapsed();
      const prazo = Math.min(timeoutMs, Math.max(0, restante));

      try {
        const response = await askGemini(body, prazo);

        if (response.ok) {
          try {
            return { ok: true, data: await response.json(), attempts };
          } catch {
            // 200 com corpo que não é JSON. Determinístico: não repete.
            return {
              ok: false,
              attempts,
              failure: { code: 'GEMINI_PARSE_ERROR', retryable: false },
              upstreamStatus: response.status,
            };
          }
        }

        /*
         * O corpo da recusa NUNCA é logado.
         *
         * Era aqui que estava `await response.text()` dentro de um
         * `console.error`: a resposta de erro do provedor pode ecoar o prompt
         * enviado, que carrega o contexto da viagem.
         *
         * A ÚNICA exceção à leitura é o 429, e ela não afrouxa a regra: o
         * corpo é lido para uma variável local, `readRateLimitSignals` extrai
         * dele só rótulos com forma de identificador — `status`, `reason`,
         * `quotaId` — e o texto sai de escopo sem ser guardado, logado nem
         * devolvido. É o que separa "esperei demais neste minuto" de "a cota
         * do dia acabou", que chegavam iguais e pedem reações opostas.
         */
        if (response.status === 429) {
          let sinais: RateLimitSignals = { status: null, reason: null, quotaIds: [] };
          try {
            sinais = readRateLimitSignals(await response.text());
          } catch {
            // Corpo ilegível não muda o fato de ter sido 429.
          }
          failure = classifyRateLimit(sinais);
          rateLimitSignals = sinais;
        } else {
          try {
            await response.body?.cancel();
          } catch {
            // Corpo já consumido ou conexão caída: não muda o diagnóstico.
          }
          failure = classifyUpstreamStatus(response.status);
        }

        upstreamStatus = response.status;
      } catch (error) {
        failure = classifyUpstreamException(error);
      }

      const podeRepetir =
        allowRetry &&
        attempts === 1 &&
        failure.retryable &&
        AI_CHAT_BUDGET_MS - elapsed() >= RETRY_MIN_BUDGET_MS;

      if (!podeRepetir) {
        return { ok: false, attempts, failure, upstreamStatus, rateLimit: rateLimitSignals };
      }

      // Jitter para não sincronizar a volta de vários aparelhos no mesmo
      // instante em que o provedor está se recuperando.
      await new Promise((resolve) =>
        setTimeout(resolve, RETRY_BASE_DELAY_MS + Math.random() * RETRY_BASE_DELAY_MS),
      );
    }
  };

  /*
   * O RASTRO DA REQUISIÇÃO.
   *
   * Números e rótulos fechados, e nada mais: sem prompt, sem histórico, sem
   * contexto, sem JWT, sem `GEMINI_API_KEY`, sem `service_role` e sem o texto
   * da resposta. É o que faltava para responder "por que deu 502?" sem
   * adivinhar — e o limite é o mesmo de `DEBUG_ACTIONS`: contagens, não
   * conteúdo.
   */
  let firstGenerationMs = 0;
  let repairMs = 0;
  let repairAttempted = false;
  let repairSkippedForTime = false;
  let upstreamAttempts = 0;

  const diagnostics = (phase: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      requestId,
      phase,
      elapsedMs: elapsed(),
      firstGenerationMs,
      repairAttempted,
      repairMs,
      upstreamAttempts,
      ...extra,
    });

  try {
    const first = await callGemini(
      {
        contents,
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        generationConfig,
      },
      FIRST_CALL_TIMEOUT_MS,
      // A primeira geração é a que vale repetir: se ela falha por
      // intermitência, não sobra resposta nenhuma para devolver.
      { allowRetry: true },
    );

    firstGenerationMs = elapsed();
    upstreamAttempts = first.attempts;

    if (!first.ok) {
      console.error(
        'ai_chat_upstream_failure',
        diagnostics('FIRST_GENERATION', {
          upstreamStatus: first.upstreamStatus ?? null,
          upstreamCode: first.failure.code,
          retryable: first.failure.retryable,
          // Só rótulos. `error.message` do provedor nunca chega aqui.
          upstreamStatusLabel: first.rateLimit?.status ?? null,
          upstreamReason: first.rateLimit?.reason ?? null,
          quotaIds: first.rateLimit?.quotaIds ?? [],
        }),
      );
      return json(
        {
          error: 'O assistente não conseguiu responder agora.',
          code: first.failure.code,
          stage: 'UPSTREAM',
        },
        502,
      );
    }

    const candidateCount = countCandidates(first.data);
    const finishReason = readFinishReason(first.data);
    // `joinCandidateText` descarta as partes marcadas como raciocínio. Sem esse
    // filtro elas entram na mesma string do JSON, o parse falha e a proposta
    // some sem deixar rastro — ver `protocol.ts`.
    const rawText = joinCandidateText(first.data);

    if (!rawText) {
      console.error(
        'ai_chat_upstream_failure',
        diagnostics('FIRST_GENERATION', {
          upstreamStatus: 200,
          upstreamCode: finishReason === 'MAX_TOKENS' ? 'GEMINI_TRUNCATED' : 'GEMINI_EMPTY_RESPONSE',
          candidateCount,
          finishReason,
          rawTextPresent: false,
        }),
      );
      return json(
        {
          error: 'O assistente não retornou resposta.',
          code: finishReason === 'MAX_TOKENS' ? 'GEMINI_TRUNCATED' : 'GEMINI_EMPTY_RESPONSE',
          stage: 'UPSTREAM',
        },
        502,
      );
    }

    /*
     * Lido SEM o corte de promessas, de propósito.
     *
     * A resposta que precisa de reparo é justamente a que promete um roteiro
     * sem entregá-lo. Cortar a frase agora apagaria o sinal, e o reparo
     * decidiria em cima de um texto já editado. A coerência é aplicada uma vez
     * só, no fim, com a contagem final de actions.
     */
    let output = readModelOutput(rawText, { enforceCoherence: false });

    /*
     * UMA tentativa de completar, na mesma requisição (§5 do handoff).
     *
     * Uma, e não um laço: cada volta é uma chamada paga, e um modelo que
     * ignorou "3 a 6 atividades" duas vezes não passa a obedecer na terceira.
     * Se a segunda também vier curta, o que sobra é dizer a verdade — o que
     * `discloseIncompleteItinerary` faz logo abaixo.
     *
     * Isto é FALLBACK, não o caminho normal: as regras 14 e 15 do
     * `SYSTEM_PROMPT` já pedem o dia inteiro na PRIMEIRA geração, e o roteiro
     * típico sai numa chamada só.
     */
    const repairBudget = AI_CHAT_BUDGET_MS - elapsed();

    // O reparo é um extra que só vale se couber no tempo. Sem esta guarda ele
    // era exatamente o que estourava o relógio do cliente: um roteiro curto na
    // tela é melhor do que um indicador rodando até o timeout.
    const cabeReparo = repairBudget >= REPAIR_MIN_BUDGET_MS;
    const precisaReparo = needsItineraryRepair(itineraryRequest, output.actions);
    repairSkippedForTime = precisaReparo && !cabeReparo;

    if (precisaReparo && cabeReparo) {
      repairAttempted = true;
      const repairStart = Date.now();

      const repaired = await callGemini(
        {
          contents: [
            ...contents,
            { role: 'model', parts: [{ text: rawText.slice(0, 8000) }] },
            {
              role: 'user',
              parts: [{ text: buildRepairInstruction(itineraryItemCount(output.actions)) }],
            },
          ],
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          // Menos temperatura na segunda volta: aqui o pedido é obedecer a um
          // formato, não variar o conteúdo.
          generationConfig: { ...generationConfig, temperature: 0.4 },
        },
        repairBudget,
        // O reparo NÃO repete. Ele já é a segunda geração; uma repetição aqui
        // seria a terceira, e o orçamento total é soberano.
        { allowRetry: false },
      );

      repairMs = Date.now() - repairStart;

      if (repaired.ok) {
        const repairedText = joinCandidateText(repaired.data);
        if (repairedText) {
          output = pickBetterItinerary(
            output,
            readModelOutput(repairedText, { enforceCoherence: false }),
          );
        }
      } else {
        // O reparo é um extra: falhar aqui devolve a primeira resposta, que
        // continua válida, em vez de derrubar a conversa inteira.
        console.error(
          'ai_chat_repair_failure',
          diagnostics('REPAIR', {
            upstreamStatus: repaired.upstreamStatus ?? null,
            upstreamCode: repaired.failure.code,
          }),
        );
      }
    }

    /*
     * O MODELO NÃO PRODUZIU NADA — e isso não pode virar 200.
     *
     * Esta checagem vem ANTES da divulgação, e a ordem é o conserto. Quando o
     * modelo devolvia texto vazio e nenhuma action,
     * `discloseIncompleteItinerary` fabricava a frase "não consegui montar…" e
     * ela passava por `hasRenderableText` — porque tem letras. O resultado era
     * um 200 com uma mensagem inventada pelo servidor, indistinguível de uma
     * resposta real, e nada em log dizendo que o Gemini tinha voltado vazio.
     *
     * Uma resposta que o modelo não escreveu é uma falha, e falha se declara.
     */
    if (!hasRenderableText(output.content) && output.actions.length === 0) {
      const code = finishReason === 'MAX_TOKENS' ? 'GEMINI_TRUNCATED' : 'GEMINI_EMPTY_RESPONSE';
      console.error(
        'ai_chat_upstream_failure',
        diagnostics('MODEL_OUTPUT', {
          upstreamStatus: 200,
          upstreamCode: code,
          candidateCount,
          finishReason,
          rawTextPresent: true,
          parsed: output.stats.parsed,
          rawActionCount: output.stats.rawActions,
          validActionCount: output.stats.validActions,
        }),
      );
      return json({ error: 'O assistente não retornou resposta.', code, stage: 'UPSTREAM' }, 502);
    }

    // Só depois do reparo: honestidade sobre o que sobrou, e então o corte das
    // promessas que a contagem final de actions não sustenta.
    const disclosed = discloseIncompleteItinerary(
      output.content,
      itineraryRequest,
      output.actions,
    );
    const coherent = enforcePromiseCoherence(disclosed, output.actions.length);
    const content = coherent.content;
    const actions = output.actions;

    /*
     * A bolha do "•" morre AQUI, e não na tela.
     *
     * Uma resposta cujo conteúdo é só pontuação, um marcador solto ou um emoji
     * não é resposta: renderiza uma bolha que não diz nada e fica no histórico
     * para sempre. O cliente já sabia recusar isso, mas recusava tarde e sem
     * saber por quê. Quem tem o diagnóstico é o servidor.
     */
    if (!content || !hasRenderableText(content)) {
      console.error(
        'ai_chat_upstream_failure',
        diagnostics('FINAL_VALIDATION', {
          upstreamStatus: 200,
          upstreamCode: 'GEMINI_INVALID_RESPONSE',
          candidateCount,
          finishReason,
          rawTextPresent: true,
          parsed: output.stats.parsed,
          rawActionCount: output.stats.rawActions,
          validActionCount: output.stats.validActions,
        }),
      );
      return json(
        {
          error: 'O assistente não retornou resposta.',
          code: 'GEMINI_INVALID_RESPONSE',
          stage: 'UPSTREAM',
        },
        502,
      );
    }

    if (DEBUG_ACTIONS) {
      // Só contagens. Ver a nota em `DEBUG_ACTIONS`.
      console.log(
        'ai_chat_actions',
        diagnostics('SUCCESS', {
          upstreamStatus: 200,
          upstreamCode: null,
          candidateCount,
          finishReason,
          rawTextPresent: true,
          parsed: output.stats.parsed,
          rawActionCount: output.stats.rawActions,
          validActionCount: output.stats.validActions,
          strippedPromises: coherent.stripped,
          fullDayRequest: itineraryRequest.expectsFullDay,
          acceptsPriorOffer: itineraryRequest.acceptsPriorOffer,
          repairSkippedForTime,
          itineraryItems: itineraryItemCount(actions),
        }),
      );
    }

    return json({ content, actions });
  } catch (error) {
    /*
     * Rede de segurança. Uma exceção que chega aqui não passou pela
     * classificação do `callGemini` — é defeito nosso, não intermitência do
     * provedor —, e o log precisa dizer isso sem carregar a mensagem, que pode
     * conter trechos do payload.
     */
    const failure = classifyUpstreamException(error);
    console.error(
      'ai_chat_failure',
      diagnostics('UNHANDLED', {
        upstreamCode: failure.code,
        errorName: error instanceof Error ? error.name : 'Unknown',
      }),
    );
    return json(
      { error: 'Falha ao consultar o assistente.', code: failure.code, stage: 'UPSTREAM' },
      502,
    );
  }
});
