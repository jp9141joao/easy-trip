/**
 * Easy Trip — briefing diário da viagem (§34–§38).
 *
 * POR QUE ISTO É SERVIDOR, E NÃO UMA TELA
 *
 * O briefing tem de existir mesmo com o aplicativo fechado (§35). Se fosse
 * calculado ao abrir a Home, ele chegaria depois do café da manhã — ou não
 * chegaria, no dia em que a pessoa só abre o aplicativo à noite. Então roda
 * aqui, por Supabase Cron, uma vez por hora.
 *
 * Agendamento sugerido (NÃO aplicado nesta entrega):
 *   select cron.schedule(
 *     'trip-daily-briefing',
 *     '0 * * * *',
 *     $$select net.http_post(
 *        url := '<PROJECT_URL>/functions/v1/trip-daily-briefing',
 *        headers := jsonb_build_object('Authorization', 'Bearer <SERVICE_ROLE_KEY>')
 *      )$$
 *   );
 *
 * O QUE IMPEDE DUPLICATA
 *
 * O índice único `notifications_daily_briefing_once` (0010), sobre
 * (user_id, data->>'tripId', data->>'date') para `type = 'trip_daily_briefing'`.
 * A unicidade mora no banco, e não num `if` aqui, porque duas execuções
 * simultâneas do cron passariam pelo `if` antes de qualquer uma gravar. Contra
 * o índice, a segunda esbarra.
 *
 * O QUE IMPEDE VAZAMENTO
 *
 * Esta função roda com `service_role`, que ignora RLS. Então a visibilidade é
 * reimplementada à mão, explicitamente, na função `visibleTo`: cada membro
 * recebe um briefing montado só com o que ELE veria — compartilhado, mais o
 * privado dele. Um item privado de Maria nunca entra no briefing de João.
 * Isto é o ponto mais sensível do arquivo.
 *
 * DE ONDE VEM CADA COISA
 *
 *   horário e atividades  → o roteiro real da viagem
 *   temperatura e chuva   → Open-Meteo, serviço real (§37)
 *   o texto amigável      → Gemini, a partir dos dois acima
 *
 * O Gemini NUNCA produz a previsão. Se ele falhar, o briefing é montado por
 * `deterministicBriefing` — e nesse caso a notificação não é apresentada como
 * escrita pela IA, porque não foi. Se o clima falhar, o briefing sai sem clima:
 * não se inventa temperatura.
 *
 * Deploy (NÃO executado nesta entrega):
 *   supabase functions deploy trip-daily-briefing --no-verify-jwt
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL = 'gemini-3.6-flash';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface ItineraryRow {
  id: string;
  date: string;
  start_time: string | null;
  title: string;
  place_name: string | null;
  latitude: number | null;
  longitude: number | null;
  visibility: string;
  created_by: string | null;
}

interface TripRow {
  id: string;
  destination_city: string;
  destination_country: string;
  timezone: string;
  latitude: number | null;
  longitude: number | null;
  start_date: string;
  end_date: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/**
 * A data de HOJE no fuso do destino (§36).
 *
 * "Hoje" da viagem não é o hoje do servidor. Um cron rodando às 23h UTC vê
 * 24 de agosto; em Tóquio já é dia 25, e o briefing sairia com o roteiro do dia
 * anterior. A mesma lógica de `getZoneDate` do aplicativo, reescrita aqui
 * porque esta função não compartilha módulo com o bundle.
 *
 * Fuso inválido cai no UTC — e é melhor um briefing possivelmente adiantado do
 * que nenhum, desde que a viagem tenha timezone plausível.
 */
function zoneDate(timezone: string, at: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(at);
    return parts;
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/** A hora local do destino, 0–23. */
function zoneHour(timezone: string, at: Date = new Date()): number {
  try {
    const value = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      hour12: false,
    }).format(at);
    return Number(value);
  } catch {
    return at.getUTCHours();
  }
}

/**
 * A regra de visibilidade da 0009, reescrita à mão.
 *
 * Está aqui porque `service_role` ignora RLS: sem esta função, o briefing de
 * João incluiria os itens privados de Maria. Ela é a única coisa entre os dois.
 */
function visibleTo(item: ItineraryRow, memberId: string): boolean {
  return item.visibility === 'shared' || item.created_by === memberId;
}

interface DayWeather {
  min: number;
  max: number;
  rainChance: number;
  rainFrom?: string;
}

/**
 * Clima real, do Open-Meteo (§37).
 *
 * Devolve `null` quando não deu — e `null` significa "o briefing sai sem
 * clima", nunca "chute uma temperatura". Um briefing que erra o clima é pior
 * do que um briefing que não fala dele.
 */
async function fetchWeather(
  latitude: number,
  longitude: number,
  date: string,
): Promise<DayWeather | null> {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
      '&daily=temperature_2m_max,temperature_2m_min' +
      '&hourly=precipitation_probability' +
      `&timezone=auto&start_date=${date}&end_date=${date}`;

    const response = await fetch(url);
    if (!response.ok) return null;
    const body = await response.json();

    const max = body?.daily?.temperature_2m_max?.[0];
    const min = body?.daily?.temperature_2m_min?.[0];
    if (typeof max !== 'number' || typeof min !== 'number') return null;

    const hours: string[] = body?.hourly?.time ?? [];
    const chances: number[] = body?.hourly?.precipitation_probability ?? [];
    let rainChance = 0;
    let rainFrom: string | undefined;
    for (let i = 0; i < chances.length; i += 1) {
      if (chances[i] > rainChance) rainChance = chances[i];
      if (!rainFrom && chances[i] >= 40) rainFrom = String(hours[i] ?? '').slice(11, 16);
    }

    return { min: Math.round(min), max: Math.round(max), rainChance, rainFrom };
  } catch {
    return null;
  }
}

/**
 * O briefing sem modelo nenhum.
 *
 * Não é um "fallback degradado": é uma resposta completa e verdadeira, montada
 * a partir do roteiro e da previsão reais. O que ela não é — e por isso não é
 * anunciada como tal — é um texto escrito pela IA (§37).
 */
function deterministicBriefing(
  trip: TripRow,
  items: ItineraryRow[],
  weather: DayWeather | null,
): string {
  const first = items[0];
  const lines: string[] = [];

  lines.push(
    first?.start_time
      ? `Seu dia começa às ${first.start_time.slice(0, 5)} — ${first.title}.`
      : `Hoje você tem ${items.length} ${items.length === 1 ? 'atividade planejada' : 'atividades planejadas'}.`,
  );

  lines.push(
    items
      .map((item) => `• ${item.start_time ? `${item.start_time.slice(0, 5)} ` : ''}${item.title}`)
      .join('\n'),
  );

  if (weather) {
    lines.push(`Temperatura prevista: ${weather.min}°–${weather.max}°.`);
    if (weather.rainChance >= 40) {
      lines.push(
        weather.rainFrom
          ? `Chance de chuva a partir das ${weather.rainFrom}. Talvez valha levar um guarda-chuva.`
          : 'Há chance de chuva. Talvez valha levar um guarda-chuva.',
      );
    }
  }

  return lines.join('\n\n');
}

const SYSTEM_PROMPT = `Você escreve o briefing matinal de um dia de viagem.

Responda em português brasileiro, em no máximo 6 linhas curtas, tom cordial e
direto. Comece com um cumprimento que mencione a cidade.

Você recebe do sistema: as atividades do dia com horário, e a previsão do tempo
quando houver.

REGRAS ABSOLUTAS:
- Use SOMENTE os dados recebidos. Não acrescente atividade, horário, local,
  preço ou recomendação que não esteja na lista.
- NUNCA invente clima. Se a previsão não vier, não fale de clima.
- Não afirme que algo está aberto, reservado ou confirmado.
- Não invente trânsito, tempo de deslocamento ou fila.

Termine com uma frase curta de bom dia.`;

async function writeBriefing(
  trip: TripRow,
  items: ItineraryRow[],
  weather: DayWeather | null,
): Promise<{ body: string; byAI: boolean }> {
  const deterministic = deterministicBriefing(trip, items, weather);
  if (!GEMINI_API_KEY) return { body: deterministic, byAI: false };

  const facts = [
    `Cidade: ${trip.destination_city}, ${trip.destination_country}.`,
    'Atividades de hoje:',
    ...items.map(
      (item) =>
        `- ${item.start_time ? item.start_time.slice(0, 5) : 'sem horário'}: ${item.title}` +
        (item.place_name ? ` (${item.place_name})` : ''),
    ),
    weather
      ? `Previsão: mínima ${weather.min}°, máxima ${weather.max}°, chance máxima de chuva ${weather.rainChance}%${weather.rainFrom ? `, a partir das ${weather.rainFrom}` : ''}.`
      : 'Previsão do tempo: indisponível. Não fale de clima.',
  ].join('\n');

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: facts }] }],
          generationConfig: { temperature: 0.6, maxOutputTokens: 400 },
        }),
      },
    );
    if (!response.ok) return { body: deterministic, byAI: false };

    const payload = await response.json();
    const text: string = (payload?.candidates?.[0]?.content?.parts ?? [])
      .map((part: { text?: string }) => part.text ?? '')
      .join('')
      .trim();

    // Texto vazio ou absurdamente curto não é um briefing. Melhor o
    // determinístico, que ao menos lista o dia.
    if (text.length < 40) return { body: deterministic, byAI: false };
    return { body: text.slice(0, 1500), byAI: true };
  } catch {
    return { body: deterministic, byAI: false };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const now = new Date();

  /*
   * Só viagens que podem estar acontecendo hoje.
   *
   * A janela é folgada em um dia de cada lado de propósito: o fuso do destino
   * pode estar até 14h à frente do UTC, e um filtro exato cortaria a viagem que
   * começa "amanhã" no servidor e "hoje" no destino. O recorte fino é feito
   * abaixo, com `zoneDate`.
   */
  const utcToday = now.toISOString().slice(0, 10);
  const { data: trips, error } = await db
    .from('trips')
    .select('id, destination_city, destination_country, timezone, latitude, longitude, start_date, end_date')
    .lte('start_date', addDays(utcToday, 1))
    .gte('end_date', addDays(utcToday, -1));

  if (error) return json({ error: error.message }, 500);

  let delivered = 0;
  let skipped = 0;

  for (const trip of (trips ?? []) as TripRow[]) {
    const localToday = zoneDate(trip.timezone, now);
    if (localToday < trip.start_date || localToday > trip.end_date) {
      skipped += 1;
      continue;
    }

    /*
     * A janela da manhã, no fuso do destino.
     *
     * O cron roda de hora em hora; sem esta condição, um briefing sairia à
     * meia-noite local — quando ainda não é "hoje" para quem está dormindo — e
     * o índice único impediria o das 7h de existir. Sete da manhã é a hora em
     * que a mensagem é útil.
     */
    const hour = zoneHour(trip.timezone, now);
    if (hour < 7 || hour >= 9) {
      skipped += 1;
      continue;
    }

    const { data: rawItems } = await db
      .from('itinerary_items')
      .select('id, date, start_time, title, place_name, latitude, longitude, visibility, created_by')
      .eq('trip_id', trip.id)
      .eq('date', localToday)
      .order('start_time', { ascending: true, nullsFirst: false });

    const items = (rawItems ?? []) as ItineraryRow[];
    if (items.length === 0) {
      skipped += 1;
      continue;
    }

    // Uma consulta de clima por viagem, e não uma por membro: o destino é o
    // mesmo para todo mundo.
    const point = firstPoint(items) ?? pointOf(trip);
    const weather = point ? await fetchWeather(point.latitude, point.longitude, localToday) : null;

    const { data: members } = await db
      .from('trip_members')
      .select('user_id')
      .eq('trip_id', trip.id);

    for (const member of (members ?? []) as { user_id: string }[]) {
      // A LINHA QUE PROTEGE A PRIVACIDADE: cada membro recebe o dia que ELE vê.
      const visible = items.filter((item) => visibleTo(item, member.user_id));
      if (visible.length === 0) continue;

      const { body, byAI } = await writeBriefing(trip, visible, weather);

      const { error: insertError } = await db.from('notifications').insert({
        user_id: member.user_id,
        type: 'trip_daily_briefing',
        title: `Bom dia! Hoje ${trip.destination_city} te espera.`,
        body,
        data: {
          tripId: trip.id,
          date: localToday,
          // Honestidade sobre a autoria do texto (§37): quando o Gemini falha,
          // o resumo é montado por regra, e a interface não pode chamá-lo de
          // mensagem gerada pela IA.
          generatedBy: byAI ? 'ai' : 'rules',
          hasWeather: Boolean(weather),
        },
      });

      // 23505 é o índice único de um briefing por usuário/viagem/dia: outra
      // execução já entregou. Não é erro, é a garantia funcionando.
      if (insertError && insertError.code !== '23505') {
        skipped += 1;
        continue;
      }
      if (!insertError) delivered += 1;
    }
  }

  return json({ delivered, skipped });
});

function firstPoint(items: ItineraryRow[]): { latitude: number; longitude: number } | null {
  for (const item of items) {
    if (typeof item.latitude === 'number' && typeof item.longitude === 'number') {
      return { latitude: item.latitude, longitude: item.longitude };
    }
  }
  return null;
}

function pointOf(trip: TripRow): { latitude: number; longitude: number } | null {
  if (typeof trip.latitude === 'number' && typeof trip.longitude === 'number') {
    return { latitude: trip.latitude, longitude: trip.longitude };
  }
  return null;
}

function addDays(date: string, amount: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + amount);
  return parsed.toISOString().slice(0, 10);
}
