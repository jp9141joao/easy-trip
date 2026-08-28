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
  TEXT_MODEL_CHAIN,
  buildRepairInstruction,
  classifyItineraryRequest,
  createRateLimiter,
  describeUpstreamFailure,
  discloseIncompleteItinerary,
  classifyUpstreamException,
  FULL_DAY_MIN_ITEMS,
  classifyUpstreamResponse,
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
  resolveFullDayDate,
  runModelChain,
  type AIModelConfig,
  type TripWindow,
  type ModelAttemptLog,
  type ModelCallResult,
  type RateLimitSignals,
} from './protocol.ts';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
/*
 * NÃO existe mais um modelo único.
 *
 * `TEXT_MODEL_CHAIN` é a fonte de verdade — ordem de preferência, IDs reais,
 * TTS já filtrado — e vive em `protocol.ts`, junto da política que decide
 * quando trocar. Aqui só se usa a lista.
 */
const MODELS = TEXT_MODEL_CHAIN;

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

/**
 * Os três campos de calendário que o contexto já traz.
 *
 * `trip.today` vem do aplicativo no fuso do DESTINO — é o que permite resolver
 * "amanhã" sem supor o fuso de quem pergunta. Nada aqui é opcional por
 * conveniência: sem o período, `resolveFullDayDate` devolve `null` e nenhuma
 * data é preenchida.
 */
function readTripWindow(context: unknown): TripWindow | null {
  const trip = (context as { trip?: unknown } | null)?.trip;
  if (!trip || typeof trip !== 'object') return null;
  const t = trip as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === 'string' ? value : undefined);
  return {
    today: text(t.today),
    startDate: text(t.startDate),
    endDate: text(t.endDate),
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

  /**
   * A DATA QUE ESTE PEDIDO TEM — quando ela é uma só.
   *
   * O caso real: "Monte um roteiro para amanhã", viagem de 27 a 28/08, e o
   * modelo devolveu cinco atividades com título e sem `date`. A proposta
   * inteira foi descartada em `validateActions` por falta de um campo cujo
   * valor o servidor já conhecia — `trip.today` mais o período da viagem dão
   * "amanhã" sem ambiguidade nenhuma.
   *
   * Resolvida aqui, e não dentro do parser, porque depende do CONTEXTO da
   * requisição. `null` quando a leitura não é única — e `null` significa que
   * nada será preenchido.
   */
  const tripWindow = readTripWindow(context);
  const fullDayDate = itineraryRequest.expectsFullDay
    ? resolveFullDayDate(prompt, history, tripWindow)
    : null;

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

  const askGemini = (modelId: string, body: unknown, timeoutMs: number) =>
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`, {
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
   * UMA repetição curta no MESMO modelo, e só para falha transitória.
   *
   * 5xx e queda de rede são intermitências do provedor: a segunda tentativa
   * costuma passar. Já 400/401/403 e corpo malformado são determinísticos —
   * repetir devolve o mesmo erro mais tarde.
   *
   * O QUE MUDOU: 429 SAIU DAQUI.
   *
   * Antes um 429 era "repetível", e a repetição ia para o MESMO modelo que
   * acabara de dizer que não tinha capacidade. Isso nunca podia dar certo — no
   * caso de cota do dia, nem em tese — e gastava metade do orçamento antes de
   * mostrar o erro. Agora um 429 vai para o PRÓXIMO modelo da cadeia, que é o
   * único lugar onde a requisição ainda pode ser atendida.
   *
   * A repetição NÃO é uma geração a mais no orçamento de conteúdo: ela
   * substitui uma tentativa que não produziu NADA.
   */
  const RETRY_MIN_BUDGET_MS = 15_000;
  const RETRY_BASE_DELAY_MS = 400;

  /*
   * O PISO PARA COMEÇAR UMA CHAMADA NOVA (§13).
   *
   * Uma geração custa segundos. Iniciar uma com três no relógio produz um
   * timeout garantido — e ainda assim consome uma chamada paga e adia a
   * mensagem que a pessoa precisa ver.
   *
   * O número é derivado dos que já existiam aqui, e não escolhido no vácuo:
   * `REPAIR_MIN_BUDGET_MS` (20s) é o piso para uma geração de roteiro
   * completa, e 8s é a metade arredondada do que sobra depois dela — espaço
   * para uma resposta curta ou para uma recusa rápida, que é o que a cadeia
   * mais encontra quando está trocando de modelo. Abaixo disso a cadeia para
   * e responde.
   *
   * Note que este número NÃO multiplica o orçamento: ele é um piso para
   * *começar*, e o prazo de cada chamada continua limitado pelo que sobrou de
   * `AI_CHAT_BUDGET_MS`. Os modelos da cadeia não ganham 45s cada.
   */
  const MIN_MODEL_ATTEMPT_BUDGET_MS = 8_000;

  /**
   * Uma chamada, a um modelo. Sem laço, sem política — isso é da cadeia.
   */
  const callModel = async (
    model: AIModelConfig,
    body: unknown,
    timeoutMs: number,
  ): Promise<ModelCallResult> => {
    try {
      const response = await askGemini(model.id, body, timeoutMs);

      if (response.ok) {
        try {
          return { ok: true, data: await response.json() };
        } catch {
          // 200 com corpo que não é JSON. Determinístico: nem repete, nem troca
          // de modelo — trocar esconderia um defeito nosso de leitura.
          return {
            ok: false,
            failure: { code: 'GEMINI_PARSE_ERROR', retryable: false },
            upstreamStatus: response.status,
          };
        }
      }

      /*
       * O TEXTO DO CORPO DA RECUSA NUNCA É LOGADO — e continua não sendo.
       *
       * Era aqui que estava `await response.text()` dentro de um
       * `console.error`: a resposta de erro do provedor pode ecoar o prompt
       * enviado, que carrega o contexto da viagem.
       *
       * O corpo passou a ser lido para TODA recusa, e não só para o 429, e a
       * regra não afrouxou nem um pouco. Ele vai para uma variável local,
       * `readRateLimitSignals` extrai dele só rótulos com forma de
       * identificador — `status`, `reason`, `quotaId` —, e o texto sai de
       * escopo sem ser guardado, logado nem devolvido. O filtro de `rotulo()`
       * é a garantia: frase livre não passa, mesmo vindo num campo esperado.
       *
       * A leitura agora vale a pena para além do 429 porque `NOT_FOUND` é o
       * que separa "este ID de modelo não existe mais" — passe para o próximo
       * — de "o provedor está fora do ar".
       */
      let sinais: RateLimitSignals = { status: null, reason: null, quotaIds: [] };
      try {
        sinais = readRateLimitSignals(await response.text());
      } catch {
        // Corpo ilegível não muda o status que veio.
      }

      return {
        ok: false,
        failure: classifyUpstreamResponse(response.status, sinais),
        upstreamStatus: response.status,
        signals: sinais,
      };
    } catch (error) {
      return { ok: false, failure: classifyUpstreamException(error) };
    }
  };

  /*
   * MODELOS QUE ESTA REQUISIÇÃO JÁ PROVOU INEXISTENTES.
   *
   * Vive só aqui dentro, e some quando a resposta sai. NÃO há estado global
   * entre usuários nem tabela lembrando qual modelo funcionou: um balde
   * compartilhado entre requisições faria a experiência de uma pessoa depender
   * do azar de outra, e ainda seria mais uma coisa para invalidar quando o
   * catálogo do provedor mudasse (§16).
   */
  const unavailableModels = new Set<string>();

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
  /** O modelo que efetivamente respondeu. Nunca chega à tela do usuário (§33). */
  let selectedModel: string | null = null;
  let selectedModelIndex: number | null = null;

  const diagnostics = (phase: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      requestId,
      phase,
      elapsedMs: elapsed(),
      firstGenerationMs,
      repairAttempted,
      repairMs,
      upstreamAttempts,
      selectedModel,
      ...extra,
    });

  /*
   * O RASTRO DA CADEIA, uma linha por tentativa.
   *
   * É o que responde "por que a resposta demorou 11 segundos?" com
   * "3.7 e 3.6 estavam sem cota, o 3.5 respondeu" em vez de um palpite.
   * `modelId` é configuração nossa; tudo o mais são números e rótulos
   * fechados. Nenhum prompt, nenhum contexto, nenhuma chave, nenhum trecho da
   * resposta do modelo.
   *
   * Sucesso no primeiro modelo, na primeira tentativa, é o caso normal e não
   * merece uma linha por requisição — só sai com `AI_CHAT_DEBUG_ACTIONS`.
   * Todo o resto sai sempre, porque é justamente o que precisa ser visto.
   */
  const logAttempt = (entry: ModelAttemptLog) => {
    const rotina =
      entry.result === 'SUCCESS' && entry.modelIndex === 0 && entry.modelAttempt === 1;
    if (rotina && !DEBUG_ACTIONS) return;
    console.log('ai_chat_model_attempt', JSON.stringify({ requestId, ...entry }));
  };

  /** O que toda passagem pela cadeia compartilha. */
  const chainBase = {
    models: MODELS,
    minModelBudgetMs: MIN_MODEL_ATTEMPT_BUDGET_MS,
    retryMinBudgetMs: RETRY_MIN_BUDGET_MS,
    retryDelayMs: RETRY_BASE_DELAY_MS,
    // O orçamento é GLOBAL e recalculado a cada volta: nunca 60s por modelo.
    remainingBudgetMs: () => AI_CHAT_BUDGET_MS - elapsed(),
    elapsedMs: elapsed,
    onAttempt: logAttempt,
    sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    skip: unavailableModels,
  };

  try {
    const generationBody = {
      contents,
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      generationConfig,
    };

    /*
     * A PRIMEIRA GERAÇÃO PERCORRE A CADEIA.
     *
     * O modelo preferido primeiro; quando ele responde 429 — teto do minuto ou
     * cota do dia —, o próximo assume, e a pessoa não fica sabendo. Antes um
     * único 429 aqui deixava o assistente inútil até a cota renovar.
     *
     * `allowSameModelRetry` continua ligado porque 5xx e queda de rede seguem
     * merecendo uma segunda tentativa no mesmo modelo — e 429 já não é
     * `retryable`, então isso não vira `A A B B C C`.
     */
    const first = await runModelChain({
      ...chainBase,
      phase: 'FIRST_GENERATION',
      timeoutMs: FIRST_CALL_TIMEOUT_MS,
      allowSameModelRetry: true,
      call: (model, prazo) => callModel(model, generationBody, prazo),
    });

    firstGenerationMs = elapsed();
    upstreamAttempts = first.attempts;

    if (!first.ok) {
      for (const id of first.unavailable) unavailableModels.add(id);

      console.error(
        'ai_chat_upstream_failure',
        diagnostics('FIRST_GENERATION', {
          upstreamStatus: first.lastUpstreamStatus,
          upstreamCode: first.failure.code,
          retryable: first.failure.retryable,
          modelsTried: first.modelsTried,
          // Cada modelo e o motivo dele. São códigos nossos, não texto do
          // provedor — é o que permite ver "todos por cota" contra "misto".
          fallbackReasons: first.reasons,
          // Só rótulos. `error.message` do provedor nunca chega aqui.
          upstreamStatusLabel: first.lastSignals?.status ?? null,
          upstreamReason: first.lastSignals?.reason ?? null,
          quotaIds: first.lastSignals?.quotaIds ?? [],
        }),
      );

      /*
       * O STATUS EXTERNO CONTINUA 502, E ISSO É DELIBERADO (§34).
       *
       * 429 já significa outra coisa neste endpoint: é o limitador POR USUÁRIO
       * daqui de cima, e o cliente o traduz em `AIRateLimitError` — "espere
       * alguns segundos", com o texto voltando para o campo. Reusar 429 para
       * "a cota do provedor acabou" faria a tela mostrar a mensagem errada e
       * convidaria a pessoa a tentar de novo em cinco segundos, sem chance
       * nenhuma de funcionar.
       *
       * Quem carrega a distinção é `code`, que o cliente já sabe ler.
       */
      return json(
        {
          error: describeUpstreamFailure(first.failure.code),
          code: first.failure.code,
          stage: 'UPSTREAM',
        },
        502,
      );
    }

    selectedModel = first.model.id;
    selectedModelIndex = first.modelIndex;
    for (const id of first.unavailable) unavailableModels.add(id);

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
    let output = readModelOutput(rawText, { enforceCoherence: false, fullDayDate });

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

      const repairBody = {
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
      };

      /*
       * O REPARO NÃO REFAZ A CADEIA INTEIRA (§14, §15).
       *
       * Se ele recomeçasse do topo, uma requisição em que 3.7 e 3.6 estão sem
       * cota gastaria os dois 429 DE NOVO antes de chegar ao modelo que já
       * tinha respondido — dobrando chamadas e latência para melhorar um
       * roteiro que já está na mão.
       *
       * Por isso ele começa em `selectedModelIndex`: o modelo que acabou de
       * funcionar é o mais provável de funcionar outra vez, e é também o que
       * escreveu o texto que o reparo está corrigindo — a continuidade de
       * estilo sai de graça.
       *
       * `maxModels: 2` é o fallback controlado: se o modelo escolhido perder a
       * cota entre uma chamada e outra, o seguinte pode assumir, e para por
       * aí. `allowSameModelRetry: false` porque o reparo JÁ é a segunda
       * geração; repetir aqui seria a terceira.
       */
      const repaired = await runModelChain({
        ...chainBase,
        phase: 'REPAIR',
        timeoutMs: repairBudget,
        startIndex: selectedModelIndex ?? 0,
        maxModels: 2,
        allowSameModelRetry: false,
        call: (model, prazo) => callModel(model, repairBody, prazo),
      });

      repairMs = Date.now() - repairStart;

      if (repaired.ok) {
        // O reparo pode ter saído de outro modelo. Ele ainda passa pelo mesmo
        // parser, pela mesma validação e pela mesma regra de 3 a 6 itens: um
        // modelo mais barato não ganha licença para devolver saída inválida.
        selectedModel = repaired.model.id;
        selectedModelIndex = repaired.modelIndex;
        const repairedText = joinCandidateText(repaired.data);
        if (repairedText) {
          output = pickBetterItinerary(
            output,
            readModelOutput(repairedText, { enforceCoherence: false, fullDayDate }),
          );
        }
      } else {
        for (const id of repaired.unavailable) unavailableModels.add(id);
        // O reparo é um extra: falhar aqui devolve a primeira resposta, que
        // continua válida, em vez de derrubar a conversa inteira.
        console.error(
          'ai_chat_repair_failure',
          diagnostics('REPAIR', {
            upstreamStatus: repaired.lastUpstreamStatus,
            upstreamCode: repaired.failure.code,
            modelsTried: repaired.modelsTried,
            fallbackReasons: repaired.reasons,
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

    /*
     * O CONTRATO FALHOU MAS A RESPOSTA É 200 — E ISSO PRECISA APARECER SEMPRE.
     *
     * Esta linha nasceu de uma investigação que não pôde ser feita pelos logs.
     * No aparelho, um pedido de dia inteiro voltou 200 sem action nenhuma; as
     * contagens que explicariam onde o número virou zero existiam, mas viviam
     * atrás de `DEBUG_ACTIONS`, desligado em produção. Sobrou ler código.
     *
     * Um dia inteiro que termina abaixo do piso é exatamente o caso que
     * ninguém quer descobrir depois. Ele sai sem depender de flag — e continua
     * sendo só número: nenhum prompt, nenhum texto, nenhum dado da viagem.
     */
    const finalActionCount = actions.length;
    const itensFinais = itineraryItemCount(actions);
    if (itineraryRequest.expectsFullDay && itensFinais < FULL_DAY_MIN_ITEMS) {
      console.warn(
        'ai_chat_contract_unmet',
        diagnostics('FULL_DAY_UNMET', {
          fullDayRequest: true,
          acceptsPriorOffer: itineraryRequest.acceptsPriorOffer,
          rawActionCount: output.stats.rawActions,
          validActionCount: output.stats.validActions,
          finalActionCount,
          itineraryItems: itensFinais,
          strippedPromises: coherent.stripped,
          /*
           * O CAMPO QUE FECHA A PERGUNTA.
           *
           * `rawActionCount: 1, validActionCount: 0` disse que a proposta
           * morreu na validação, e não conseguiu dizer em qual campo. Estes
           * rótulos dizem — sem carregar nenhum valor de campo.
           */
          dropReasons: output.stats.drops.reasons,
          itemsNoTitle: output.stats.drops.itemsNoTitle,
          itemsNoDate: output.stats.drops.itemsNoDate,
          /*
           * `itemsNoDate: 5` provou o campo e não a causa. Estes três separam
           * as três histórias possíveis: o modelo não mandou data nenhuma, ele
           * mandou algo que não é data, ou o servidor preencheu a data que
           * resolveu. Continuam sendo só números.
           */
          itemsDateMissing: output.stats.drops.itemsDateMissing,
          itemsDateInvalid: output.stats.drops.itemsDateInvalid,
          itemsDateFilled: output.stats.drops.itemsDateFilled,
          /* Booleano, e não a data: o dia da viagem é dado privado. */
          fullDayDateResolved: fullDayDate !== null,
          parsed: output.stats.parsed,
          repairSkippedForTime,
          selectedModelIndex,
        }),
      );
    }

    if (DEBUG_ACTIONS) {
      // Só contagens. Ver a nota em `DEBUG_ACTIONS`.
      console.log(
        'ai_chat_actions',
        diagnostics('SUCCESS', {
          finalActionCount,
          upstreamStatus: 200,
          upstreamCode: null,
          candidateCount,
          finishReason,
          rawTextPresent: true,
          parsed: output.stats.parsed,
          rawActionCount: output.stats.rawActions,
          validActionCount: output.stats.validActions,
          strippedPromises: coherent.stripped,
          dropReasons: output.stats.drops.reasons,
          itemsNoTitle: output.stats.drops.itemsNoTitle,
          itemsNoDate: output.stats.drops.itemsNoDate,
          itemsDateMissing: output.stats.drops.itemsDateMissing,
          itemsDateInvalid: output.stats.drops.itemsDateInvalid,
          itemsDateFilled: output.stats.drops.itemsDateFilled,
          fullDayDateResolved: fullDayDate !== null,
          fullDayRequest: itineraryRequest.expectsFullDay,
          acceptsPriorOffer: itineraryRequest.acceptsPriorOffer,
          repairSkippedForTime,
          selectedModelIndex,
          itineraryItems: itineraryItemCount(actions),
        }),
      );
    }

    return json({ content, actions });
  } catch (error) {
    /*
     * Rede de segurança. Uma exceção que chega aqui não passou pela
     * classificação de `callModel` — é defeito nosso, não intermitência do
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
