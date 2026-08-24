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
  createRateLimiter,
  joinCandidateText,
  readModelOutput,
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

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents,
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 2048,
            // Saída estruturada: o modelo devolve `{ content, actions }`, e o
            // texto da conversa fica num campo só dele. É o que torna possível
            // a promessa de que nada é extraído do Markdown.
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA,
          },
        }),
      },
    );

    if (!response.ok) {
      console.error('gemini_error', response.status, await response.text());
      return json({ error: 'O assistente não conseguiu responder agora.' }, 502);
    }

    const data = await response.json();
    // `joinCandidateText` descarta as partes marcadas como raciocínio. Sem esse
    // filtro elas entram na mesma string do JSON, o parse falha e a proposta
    // some sem deixar rastro — ver `protocol.ts`.
    const rawText = joinCandidateText(data);

    if (!rawText) {
      return json({ error: 'O assistente não retornou resposta.' }, 502);
    }

    const { content, actions, stats } = readModelOutput(rawText);
    if (!content) {
      return json({ error: 'O assistente não retornou resposta.' }, 502);
    }

    if (DEBUG_ACTIONS) {
      // Só contagens. Ver a nota em `DEBUG_ACTIONS`.
      console.log(
        'ai_chat_actions',
        JSON.stringify({
          parsed: stats.parsed,
          raw: stats.rawActions,
          valid: stats.validActions,
          strippedPromises: stats.strippedPromises,
        }),
      );
    }

    return json({ content, actions });
  } catch (error) {
    console.error('ai_chat_failure', error);
    return json({ error: 'Falha ao consultar o assistente.' }, 502);
  }
});
