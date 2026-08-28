/**
 * Account deletion (§94, fluxo 15).
 *
 * Deleting an auth user needs the service role key, which must never reach the
 * bundle (§17). The client calls this function with its own JWT; the function
 * verifies the identity, then performs the privileged delete server-side.
 *
 * Every owned row cascades away via `on delete cascade` from `auth.users`.
 * Arquivos NÃO cascateiam: são apagados explicitamente antes, por
 * `purgeUserFiles` (P-02).
 *
 * A CASCATA NÃO PÁRA NO DONO — E É POR ISSO QUE EXISTE A GUARDA
 *
 * `public.trips.user_id` referencia `auth.users (id) on delete cascade` (0001).
 * Apagar o proprietário de uma viagem COMPARTILHADA apaga a viagem inteira, e
 * com ela as despesas, o diário e o roteiro dos outros membros. Uma pessoa
 * exercendo o próprio direito de exclusão destruiria dado de terceiros, sem
 * aviso e sem recuperação. Nenhuma policy protege contra isso: a cascata
 * acontece abaixo da RLS.
 *
 * A resposta NÃO é escolher um novo dono sozinha. Quem recebe uma viagem é
 * decisão de quem a organizou, não de um algoritmo — e transferir em silêncio
 * daria a estranhos a gerência de um grupo do qual eles não pediram para
 * cuidar. A função RECUSA e diz o que falta:
 *
 *   `account_deletion_blockers()` (0014) devolve as viagens em que quem chama é
 *   proprietário E há outra pessoa dentro. Lista vazia → segue a exclusão.
 *   Lista não vazia → 200 com `{ ok: false, reason: 'ownership-blocked' }`.
 *
 * POR QUE 200, E NÃO 409
 *
 * `supabase-js` entrega qualquer status não-2xx como `FunctionsHttpError` com o
 * corpo fora de alcance do chamador. Um 409 chegaria ao aplicativo como "erro
 * de rede, tente de novo" — exatamente a leitura errada, porque tentar de novo
 * nunca vai funcionar. O 200 carrega o motivo até a tela, que então mostra
 * quais viagens travam a exclusão e oferece a transferência.
 *
 * Viagem em que a pessoa é o ÚNICO membro não bloqueia: ela pode ir embora com
 * a conta, que é o que foi pedido.
 *
 * Deploy with:
 *   supabase functions deploy delete-account
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

import { purgeUserFiles, type StorageClient } from '../_shared/storagePurge.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** Os três buckets privados criados em `0002_rls.sql`, todos com `{uid}/` na raiz. */
const BUCKETS = ['attachments', 'journal', 'avatars'] as const;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método não suportado.' }, 405);

  // Identity is taken from the caller's JWT — never from the request body.
  const authHeader = req.headers.get('Authorization') ?? '';
  const asUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data, error } = await asUser.auth.getUser();
  if (error || !data.user) return json({ error: 'Não autorizado.' }, 401);

  const userId = data.user.id;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    // ---- 0. A conta pode ser excluída? ----
    //
    // Antes de qualquer destruição. Se esta checagem viesse depois do expurgo
    // de arquivos, a recusa deixaria a pessoa com a conta viva e as fotos
    // apagadas — o pior dos dois mundos.
    //
    // Chamado com o JWT DE QUEM PEDE, não com o service role: a função usa
    // `auth.uid()`, e é a mesma consulta que a tela faz para avisar antes. Uma
    // segunda consulta escrita aqui divergiria da primeira algum dia.
    const { data: blockers, error: blockersError } = await asUser.rpc(
      'account_deletion_blockers',
    );

    if (blockersError) {
      // Falhar fechado. Um backend sem a 0014 aplicada devolve erro aqui, e
      // seguir em frente seria exatamente a cascata que esta guarda existe para
      // impedir — só que agora silenciosa, porque ninguém olhou.
      console.error('delete_account_blockers_unavailable', {
        userId,
        message: blockersError.message,
      });
      return json(
        {
          error:
            'Não foi possível verificar suas viagens compartilhadas. Sua conta não foi excluída — tente novamente em alguns instantes.',
        },
        500,
      );
    }

    const blocking = (blockers ?? []) as {
      trip_id: string;
      destination_city: string;
      other_members: number;
    }[];

    if (blocking.length > 0) {
      console.info('delete_account_blocked_by_ownership', {
        userId,
        trips: blocking.length,
      });
      return json({
        ok: false,
        reason: 'ownership-blocked',
        trips: blocking.map((row) => ({
          tripId: row.trip_id,
          destinationCity: row.destination_city,
          otherMembers: row.other_members,
        })),
      });
    }

    // ---- 1. Arquivos primeiro, e a conta só depois ----
    //
    // A ordem importa e é a parte mais fácil de errar. Se a conta fosse apagada
    // antes e a limpeza falhasse, restariam arquivos pessoais sem dono — não
    // atribuíveis a ninguém, e o usuário sem conta para tentar de novo.
    //
    // Fazendo o inverso, uma falha deixa a conta intacta: nada foi destruído
    // pela metade e a operação pode ser repetida.
    const purge = await purgeUserFiles(
      admin.storage as unknown as StorageClient,
      BUCKETS,
      userId,
    );

    if (!purge.ok) {
      // Responder sucesso aqui seria a pior saída possível: o usuário pediu
      // exclusão, receberia confirmação, e os arquivos continuariam lá (§13).
      console.error('delete_account_storage_incomplete', {
        userId,
        deleted: purge.deleted.length,
        remaining: purge.remaining.length,
        errors: purge.errors,
      });
      return json(
        {
          error:
            'Não foi possível remover todos os seus arquivos. Sua conta não foi excluída — tente novamente em alguns instantes.',
        },
        500,
      );
    }

    // ---- 2. Conta: o delete cascateia para todas as tabelas ----
    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError) throw deleteError;

    return json({ ok: true, filesDeleted: purge.deleted.length });
  } catch (deletionError) {
    console.error('delete_account_failure', deletionError);
    return json({ error: 'Não foi possível excluir a conta.' }, 500);
  }
});
