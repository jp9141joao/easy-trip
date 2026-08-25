/**
 * Easy Trip — sugestões de viagem (§39–§43).
 *
 * O QUE ESTA FUNÇÃO FAZ E O QUE ELA NÃO FAZ
 *
 * Ela **gera texto**. Recebe destino e datas, chama o Gemini com saída
 * estruturada, valida o formato e devolve. Só isso.
 *
 * Ela **não escreve no banco**. Quem grava é o aplicativo, com a sessão do
 * próprio usuário, sob RLS — do mesmo jeito que `ai-chat`. Se esta função
 * gravasse, precisaria de `service_role`, e um bug aqui viraria escrita
 * autorizada em qualquer viagem de qualquer conta. Gerando e devolvendo, o pior
 * que um bug faz é devolver texto ruim.
 *
 * Ela **não é a primeira fonte de sugestões**. O cliente busca primeiro em
 * `public.places`, que tem nome verificado, endereço e coordenada reais; esta
 * função entra para completar quando o catálogo não cobre o destino (§41).
 *
 * O QUE O MODELO NÃO PODE DEVOLVER
 *
 * Preço, horário de funcionamento, avaliação, disponibilidade, promoção, URL.
 * Nada disso existe no schema — a ausência é a validação. Um preço escrito por
 * um modelo é um chute apresentado como fato, e uma URL arbitrária é um vetor
 * de phishing embrulhado em recomendação de viagem.
 *
 * Deploy (NÃO executado nesta entrega):
 *   supabase secrets set GEMINI_API_KEY=...
 *   supabase functions deploy trip-suggestions
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const MODEL = 'gemini-3.6-flash';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/**
 * O mínimo de sugestões que uma viagem precisa ter para a tela não abrir vazia.
 * Espelha `MINIMUM_SUGGESTIONS` em `src/domain/suggestions.ts`.
 */
const MINIMUM_SUGGESTIONS = 3;

const CATEGORIES = [
  'para_voce',
  'lugares',
  'atracoes',
  'gastronomia',
  'noite',
  'ar_livre',
] as const;

/**
 * O schema que o Gemini é obrigado a seguir.
 *
 * Repare no que não está aqui: `url`, `price`, `rating`, `openingHours`,
 * `phone`, `availability`. Sem o campo, o modelo não tem onde escrever — é
 * mais forte do que uma instrução em prosa, que ele pode desobedecer.
 */
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      /*
       * Três é o mínimo que a tela precisa para não abrir vazia, e é aqui que
       * ele vira obrigação do modelo — não uma sugestão em prosa que ele possa
       * ignorar. O total final continua sendo catálogo + IA (§22 do handoff):
       * este mínimo é o que se PEDE ao Gemini, e o que se EXIGE está em
       * `minimumNeeded`, conferido depois da sanitização.
       */
      minItems: MINIMUM_SUGGESTIONS,
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          category: { type: 'string', enum: [...CATEGORIES] },
          description: { type: 'string' },
          placeName: { type: 'string' },
          area: { type: 'string' },
          latitude: { type: 'number' },
          longitude: { type: 'number' },
          estimatedDurationMinutes: { type: 'integer' },
          reason: { type: 'string' },
        },
        required: ['title', 'category', 'description'],
      },
    },
  },
  required: ['suggestions'],
};

const SYSTEM_PROMPT = `Você sugere lugares e experiências para uma viagem específica.

Responda em português brasileiro.

Cada sugestão precisa ser um lugar ou experiência REAL e conhecida do destino
informado. Se você não tiver certeza de que o lugar existe, não o sugira.

NUNCA inclua, em nenhum campo:
- preço, faixa de preço ou custo;
- horário de funcionamento;
- avaliação, nota ou número de estrelas;
- disponibilidade, ingresso disponível ou promoção;
- link, URL, telefone ou e-mail.

Esses dados mudam e você não tem como saber os atuais. Escrever qualquer um
deles é inventar.

"description" diz o que é o lugar, em 1 a 3 frases.
"reason" diz por que ele cabe NESTA viagem — a época do ano, a duração, o
perfil do destino. É o que separa uma sugestão de uma lista genérica.

"latitude" e "longitude" só quando você souber a localização com confiança, e
sempre as duas juntas — nunca só uma.

"estimatedDurationMinutes" é quanto tempo a visita costuma tomar.

Não repita nada que já esteja na lista de títulos existentes que o sistema
enviar.`;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/**
 * Limite por usuário: uma geração a cada 30 segundos.
 *
 * A defesa de verdade contra custo é a marca d'água `suggestions_refreshed_at`
 * no banco (0012), que impede refresh mais de uma vez a cada seis horas por
 * viagem. Este limitador é o segundo anteparo — o que sobra se alguém chamar a
 * função direto, sem passar pela tela.
 */
const lastCall = new Map<string, number>();
const MIN_INTERVAL_MS = 30_000;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método não suportado.' }, 405);

  // ---- Identidade vem do JWT, nunca do payload ----
  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return json({ error: 'Não autorizado.' }, 401);
  const userId: string = userData.user.id;

  const previous = lastCall.get(userId) ?? 0;
  if (Date.now() - previous < MIN_INTERVAL_MS) {
    return json({ error: 'Aguarde alguns segundos para gerar novamente.' }, 429);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Payload inválido.' }, 400);
  }

  const tripId = typeof payload.tripId === 'string' ? payload.tripId : '';
  if (!tripId) return json({ error: 'Viagem não informada.' }, 400);

  /*
   * Ler uma viagem prova participação, mas viewer também participa. Geração
   * tem custo e é uma mutação lógica da coleção; por isso usa a mesma regra
   * server-side de escrita de conteúdo que as policies: owner/editor apenas.
   * O JWT do usuário continua sendo a única identidade — nunca um papel vindo
   * do payload e nunca service_role.
   */
  const { data: canEdit, error: permissionError } = await supabase.rpc('can_edit_trip', {
    target_trip: tripId,
  });
  if (permissionError) {
    return json({ error: 'Não foi possível verificar a permissão da viagem.' }, 503);
  }
  if (canEdit !== true) {
    return json({ error: 'Sem permissão para gerar sugestões nesta viagem.' }, 403);
  }

  const { data: trip, error: tripError } = await supabase
    .from('trips')
    .select('id, destination_city, destination_country, start_date, end_date, suggestions_refreshed_at')
    .eq('id', tripId)
    .maybeSingle();

  if (tripError || !trip) return json({ error: 'Viagem não encontrada.' }, 404);

  if (!GEMINI_API_KEY) {
    // Checar identidade e papel vem antes da configuração: um viewer recebe
    // 403 mesmo num ambiente sem Gemini, sem aprender detalhes operacionais.
    return json({ error: 'A geração de sugestões não está configurada neste ambiente.' }, 503);
  }

  /*
   * Compare-and-set no Postgres ANTES do Gemini.
   *
   * A leitura acima serve para contexto, não para decidir a janela: duas
   * instâncias poderiam ler a mesma marca antiga. A RPC da 0012 adquire o lock
   * da linha, exige novamente `can_edit_trip` e só uma chamada em seis horas
   * recebe `claimed=true`. A janela é consumida mesmo se o provider falhar —
   * proteção de custo deliberada, sem RPC de "release" que um cliente
   * modificado pudesse abusar para gerar em loop.
   */
  const { data: claimRows, error: claimError } = await supabase.rpc(
    'claim_trip_suggestion_refresh',
    { target_trip: tripId },
  );
  if (claimError) {
    if (claimError.code === '42501') {
      return json({ error: 'Sem permissão para gerar sugestões nesta viagem.' }, 403);
    }
    return json({ error: 'Não foi possível reservar a atualização de sugestões.' }, 503);
  }
  const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows;
  if (!claim?.claimed) {
    return json({ error: 'As sugestões desta viagem já foram atualizadas nas últimas 6 horas.' }, 429);
  }
  lastCall.set(userId, Date.now());

  const existingTitles = Array.isArray(payload.existingTitles)
    ? (payload.existingTitles as unknown[])
        .filter((title): title is string => typeof title === 'string')
        .slice(0, 40)
    : [];

  /*
   * Quantas sugestões VÁLIDAS esta chamada precisa produzir.
   *
   * Quem sabe a conta é o cliente: o mínimo de três é o total final da viagem,
   * e o catálogo já pode ter coberto parte dele (§22 do handoff). Catálogo com
   * 2 pede 1; catálogo vazio pede 3; um refresh de uma viagem que já tem três
   * pede 0 e nada aqui reprova.
   *
   * Sem o campo — cliente antigo — o padrão é o mínimo inteiro, que é a
   * suposição segura: reprovar de menos seria declarar sucesso sem ter.
   */
  const minimumNeeded =
    typeof payload.minimumNeeded === 'number' && Number.isFinite(payload.minimumNeeded)
      ? Math.min(MINIMUM_SUGGESTIONS, Math.max(0, Math.trunc(payload.minimumNeeded)))
      : MINIMUM_SUGGESTIONS;

  const userPrompt = [
    `Destino: ${trip.destination_city}, ${trip.destination_country}.`,
    `Período da viagem: ${trip.start_date} a ${trip.end_date}.`,
    existingTitles.length
      ? `Já sugeridos (não repita): ${existingTitles.join('; ')}.`
      : 'Nenhuma sugestão anterior.',
    `Devolva entre 6 e 10 sugestões, variando as categorias. No mínimo ${MINIMUM_SUGGESTIONS}.`,
  ].join('\n');

  let response: Response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig: {
            temperature: 0.8,
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA,
          },
        }),
      },
    );
  } catch {
    return json({ error: 'Não foi possível gerar sugestões agora.' }, 502);
  }

  if (!response.ok) return json({ error: 'Não foi possível gerar sugestões agora.' }, 502);

  let parsed: { suggestions?: unknown[] };
  try {
    const body = await response.json();
    const text: string = (body?.candidates?.[0]?.content?.parts ?? [])
      .map((part: { text?: string }) => part.text ?? '')
      .join('');
    parsed = JSON.parse(text);
  } catch {
    return json({ error: 'Resposta do modelo em formato inesperado.' }, 502);
  }

  const suggestions = (Array.isArray(parsed.suggestions) ? parsed.suggestions : [])
    .map(sanitizeSuggestion)
    .filter((suggestion): suggestion is Record<string, unknown> => suggestion !== null)
    .slice(0, 12);

  /*
   * Geração parcial não é sucesso.
   *
   * O `responseSchema` pede `minItems`, mas o modelo pode devolver menos, e a
   * sanitização acima descarta o que não se sustenta — sobrar 1 quando o
   * objetivo era completar 3 é um resultado incompleto, e devolvê-lo com 200
   * faria o cliente pintar "pronto" numa tela que continua abaixo do mínimo
   * (§21 do handoff).
   *
   * O que já é válido vai junto: o 422 carrega o parcial, para o cliente
   * gravar o que serve e ainda assim dizer que não completou. A janela de seis
   * horas segue consumida — o custo do Gemini já foi pago.
   */
  if (suggestions.length < minimumNeeded) {
    return json(
      {
        error: 'A geração não alcançou o mínimo de sugestões para esta viagem.',
        code: 'INSUFFICIENT_SUGGESTIONS',
        requested: minimumNeeded,
        generated: suggestions.length,
        suggestions,
      },
      422,
    );
  }

  return json({ suggestions });
});

/**
 * Última barreira antes de devolver.
 *
 * O `responseSchema` do Gemini é forte, mas não é uma garantia: campos extras
 * aparecem, tipos escorregam e enums voltam com valor fora da lista. Esta
 * função reconstrói o objeto campo a campo — o que ela não copia, não sai.
 *
 * Coordenada é par ou não é nada: meia coordenada viraria um marcador no meio
 * do Atlântico.
 */
function sanitizeSuggestion(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;

  const title = text(item.title, 120);
  const description = text(item.description, 600);
  const category = CATEGORIES.includes(item.category as (typeof CATEGORIES)[number])
    ? (item.category as string)
    : 'lugares';

  if (!title || !description || description.length < 20) return null;

  const latitude = coordinate(item.latitude, 90);
  const longitude = coordinate(item.longitude, 180);
  const paired = latitude !== undefined && longitude !== undefined;

  const duration =
    typeof item.estimatedDurationMinutes === 'number' &&
    Number.isFinite(item.estimatedDurationMinutes)
      ? Math.min(1440, Math.max(15, Math.round(item.estimatedDurationMinutes)))
      : undefined;

  return {
    title,
    category,
    description,
    placeName: text(item.placeName, 140),
    area: text(item.area, 80),
    latitude: paired ? latitude : undefined,
    longitude: paired ? longitude : undefined,
    estimatedDurationMinutes: duration,
    reason: text(item.reason, 300),
  };
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().slice(0, max);
  return trimmed.length > 0 ? trimmed : undefined;
}

function coordinate(value: unknown, limit: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.abs(value) <= limit ? value : undefined;
}
