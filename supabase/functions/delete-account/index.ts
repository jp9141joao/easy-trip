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
