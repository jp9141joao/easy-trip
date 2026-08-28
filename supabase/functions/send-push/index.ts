/**
 * Easy Trip — envio de notificação push (§33).
 *
 * POR QUE ISTO É SERVIDOR
 *
 * Mandar o aparelho de alguém tocar exige ler o token de entrega dele, e
 * `push_tokens` (0016) é legível apenas pelo próprio dono. Nenhum cliente pode
 * — nem deve poder — alcançar o endereço de outra pessoa: quem o tem faz o
 * telefone dela tocar com o texto que quiser, na tela de bloqueio.
 *
 * Então o envio roda aqui, com `service_role`, atrás de duas credenciais.
 *
 * O QUE ESTA FUNÇÃO NÃO FAZ
 *
 * Ela não decide QUANDO notificar, e não escreve em `notifications`. Ela recebe
 * um destinatário e um texto, e entrega. Quem decide continua sendo quem já
 * decidia — os gatilhos da 0010 e a `trip-daily-briefing`. Separar as duas
 * coisas é o que evita que "avisar" e "entregar" virem uma coisa só, com a
 * regra de negócio embaralhada com a chamada ao Expo.
 *
 * A entrega é feita pelo serviço do Expo (`exp.host/--/api/v2/push/send`), que
 * é o caminho suportado por `expo-notifications`. Nenhuma credencial do FCM ou
 * do APNs vive aqui: elas ficam na conta Expo do projeto.
 *
 * Antes do deploy, configure um segredo aleatório exclusivo do envio:
 *   supabase secrets set EASY_TRIP_PUSH_SECRET=...
 *
 * Deploy:
 *   supabase functions deploy send-push
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  PUSH_SECRET_HEADER,
  authorizePush,
  buildMessages,
  isPushMethodAllowed,
  parsePushRequest,
  readTickets,
  type ExpoTicket,
} from './protocol.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const PUSH_SECRET = Deno.env.get('EASY_TRIP_PUSH_SECRET');

const EXPO_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': `authorization, content-type, ${PUSH_SECRET_HEADER}`,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (!isPushMethodAllowed(req.method)) return json({ error: 'Método não permitido.' }, 405);

  const authorization = authorizePush(req.headers, SERVICE_ROLE_KEY, PUSH_SECRET);
  if (!authorization.ok) {
    return json(
      {
        error:
          authorization.reason === 'misconfigured'
            ? 'Serviço temporariamente indisponível.'
            : 'Acesso negado.',
      },
      authorization.status,
    );
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ error: 'Serviço temporariamente indisponível.' }, 503);
  }

  const pedido = parsePushRequest(await req.json().catch(() => null));
  if (!pedido) return json({ error: 'Pedido inválido.' }, 400);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: rows, error } = await db
    .from('push_tokens')
    .select('token')
    .eq('user_id', pedido.userId)
    .eq('active', true);

  if (error) {
    console.error('send_push_tokens_unavailable', { message: error.message });
    return json({ error: 'Não foi possível ler os aparelhos.' }, 500);
  }

  const tokens = ((rows ?? []) as { token: string }[]).map((row) => row.token);

  // Ninguém para receber não é falha: a pessoa pode ter recusado a permissão,
  // ou não ter o aplicativo instalado. Responder erro aqui faria quem chama
  // tentar de novo por algo que não vai mudar.
  if (tokens.length === 0) return json({ delivered: 0, failed: 0, skipped: 'no-tokens' });

  const messages = buildMessages(pedido, tokens);

  let tickets: ExpoTicket[] = [];
  try {
    const response = await fetch(EXPO_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
    });
    if (!response.ok) {
      console.error('send_push_provider_rejected', { status: response.status });
      return json({ error: 'O serviço de notificação recusou o envio.' }, 502);
    }
    const payload = await response.json();
    tickets = Array.isArray(payload?.data) ? payload.data : [];
  } catch (providerError) {
    console.error('send_push_provider_unreachable', providerError);
    return json({ error: 'O serviço de notificação não respondeu.' }, 502);
  }

  const outcome = readTickets(tokens, tickets);

  // Um token que o serviço diz não existir mais é desativado. Continuar
  // mandando para ele gastaria requisição para sempre num endereço morto.
  for (const token of outcome.invalidTokens) {
    const { error: deactivateError } = await db.rpc('deactivate_push_token', {
      device_token: token,
    });
    if (deactivateError) {
      console.error('send_push_deactivate_failed', { message: deactivateError.message });
    }
  }

  return json({
    delivered: outcome.delivered,
    failed: outcome.failed,
    deactivated: outcome.invalidTokens.length,
  });
});
