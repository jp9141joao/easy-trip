/**
 * Account deletion (§94, fluxo 15).
 *
 * Deleting an auth user needs the service role key, which must never reach the
 * bundle (§17). The client calls this function with its own JWT; the function
 * verifies the identity, then performs the privileged delete server-side.
 *
 * Every owned row cascades away via `on delete cascade` from `auth.users`.
 *
 * Deploy with:
 *   supabase functions deploy delete-account
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
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
    // Remove stored files first — they do not cascade with the database rows.
    for (const bucket of ['attachments', 'journal', 'avatars']) {
      const { data: files } = await admin.storage.from(bucket).list(userId, { limit: 1000 });
      if (files?.length) {
        await admin.storage
          .from(bucket)
          .remove(files.map((file) => `${userId}/${file.name}`));
      }
    }

    // Deleting the auth user cascades to every table referencing auth.users.
    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError) throw deleteError;

    return json({ ok: true });
  } catch (deletionError) {
    console.error('delete_account_failure', deletionError);
    return json({ error: 'Não foi possível excluir a conta.' }, 500);
  }
});
