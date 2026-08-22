/**
 * F4 — a exclusão de conta, exercitada de ponta a ponta (§10, §14.10).
 *
 * A F2 corrigiu esta função (P-02) e a cobriu com testes de unidade do
 * `purgeUserFiles`. O que faltava era rodá-la inteira: JWT de verdade, Storage
 * de verdade, cascata do banco de verdade. É o que este script faz.
 *
 * Nada é reimplementado aqui — a função chamada é a mesma que o aplicativo
 * chama. Roda só contra o Supabase LOCAL (precisa de `storage-api` e
 * `edge-runtime` no ar).
 *
 *   npx supabase start
 *   node supabase/tests/delete_account_e2e.mjs
 */

const API = process.env.SUPABASE_API_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!ANON || !SERVICE) {
  console.error('Defina SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY (npx supabase status -o env).');
  process.exit(2);
}

let passed = 0;
const failures = [];
const check = (condition, label) => {
  if (condition) {
    passed += 1;
    console.log(`  OK   ${label}`);
  } else {
    failures.push(label);
    console.log(`  FALHOU  ${label}`);
  }
};

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const email = `delete-me-${stamp}@easytrip.test`;
const password = 'senhaForte123';

// ---------------------------------------------------------------- preparação
const signup = await fetch(`${API}/auth/v1/signup`, {
  method: 'POST',
  headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password, data: { name: 'Para Excluir' } }),
}).then((r) => r.json());

const uid = signup.user?.id;
const token = signup.access_token;
check(Boolean(uid && token), '1: conta de teste criada');

// Uma viagem, para provar a cascata do banco.
const trip = await fetch(`${API}/rest/v1/trips`, {
  method: 'POST',
  headers: {
    apikey: ANON,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  },
  body: JSON.stringify({
    user_id: uid,
    destination_city: 'Porto',
    destination_country: 'Portugal',
    country_code: 'PT',
    timezone: 'Europe/Lisbon',
    start_date: '2026-10-01',
    end_date: '2026-10-05',
  }),
}).then((r) => r.json());
check(Array.isArray(trip) && trip.length === 1, '2: viagem criada para testar a cascata');

// Arquivos em dois buckets e em profundidades diferentes — o caso que o `list`
// não recursivo do Supabase deixava passar (P-02).
// O tipo declarado importa: desde a `0006` o bucket `avatars` só aceita
// imagem. Mandar tudo como `application/octet-stream` faria o preparo falhar
// por um motivo que nada tem a ver com o que este teste mede.
const arquivos = [
  ['attachments', `${uid}/tickets/voo.pdf`, 'application/pdf'],
  ['attachments', `${uid}/apolices/2026/seguro.pdf`, 'application/pdf'],
  ['journal', `${uid}/${trip[0]?.id}/foto.jpg`, 'image/jpeg'],
  ['avatars', `${uid}/avatar.png`, 'image/png'],
];

for (const [bucket, path, contentType] of arquivos) {
  const upload = await fetch(`${API}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': contentType },
    body: new Uint8Array([1, 2, 3, 4]),
  });
  check(upload.status === 200, `3: arquivo enviado — ${bucket}/${path.replace(uid, '{uid}')}`);
}

// Arquivo de OUTRA conta, que precisa sobreviver.
//
// `x-upsert` porque o caminho é fixo e o arquivo **sobrevive de propósito**: na
// segunda execução contra o mesmo banco ele já está lá, e um POST comum
// responderia 400 (Duplicate). Sem isto o teste só passava em banco recém-
// criado — e falhava no preparo, não na verificação, que é o pior lugar para
// falhar: o cenário deixaria de ser medido sem que ninguém percebesse.
const outro = await fetch(`${API}/storage/v1/object/avatars/00000000-0000-4000-8000-000000009999/avatar.png`, {
  method: 'POST',
  headers: {
    apikey: SERVICE,
    Authorization: `Bearer ${SERVICE}`,
    'Content-Type': 'image/png',
    'x-upsert': 'true',
  },
  body: new Uint8Array([9, 9]),
});
check(outro.status === 200, '4: arquivo de outra conta preparado');

// ------------------------------------------------------------------ exclusão
console.log('\n== Chamando a Edge Function delete-account ==');

const resposta = await fetch(`${API}/functions/v1/delete-account`, {
  method: 'POST',
  headers: { apikey: ANON, Authorization: `Bearer ${token}` },
});
const corpo = await resposta.json().catch(() => null);

check(resposta.status === 200, `5: função respondeu 200 (recebido ${resposta.status})`);
check(corpo?.ok === true, '6: função reportou sucesso');
check(corpo?.filesDeleted === arquivos.length, `7: apagou os ${arquivos.length} arquivos e disse quantos`);

// ---------------------------------------------------------------- verificação
console.log('\n== O que sobrou ==');

const listar = async (bucket, prefix) =>
  fetch(`${API}/storage/v1/object/list/${bucket}`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix, limit: 100 }),
  }).then((r) => r.json());

for (const bucket of ['attachments', 'journal', 'avatars']) {
  const restante = await listar(bucket, `${uid}/`);
  check(Array.isArray(restante) && restante.length === 0, `8: nada sobrou em ${bucket}/{uid}/`);
}

const alheio = await listar('avatars', '00000000-0000-4000-8000-000000009999/');
check(
  Array.isArray(alheio) && alheio.length === 1,
  '9: o arquivo da outra conta continua intacto — a limpeza é do dono, não geral',
);

const usuario = await fetch(`${API}/auth/v1/admin/users/${uid}`, {
  headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
});
check(usuario.status === 404, '10: a conta não existe mais em auth.users');

const viagens = await fetch(`${API}/rest/v1/trips?user_id=eq.${uid}&select=id`, {
  headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
}).then((r) => r.json());
check(Array.isArray(viagens) && viagens.length === 0, '11: a viagem cascateou junto com a conta');

const perfil = await fetch(`${API}/rest/v1/profiles?user_id=eq.${uid}&select=user_id`, {
  headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
}).then((r) => r.json());
check(Array.isArray(perfil) && perfil.length === 0, '12: o perfil cascateou junto');

const tokenVelho = await fetch(`${API}/rest/v1/profiles?select=user_id`, {
  headers: { apikey: ANON, Authorization: `Bearer ${token}` },
}).then((r) => r.json());
check(
  !Array.isArray(tokenVelho) || tokenVelho.length === 0,
  '13: o token da conta excluída não devolve mais nada',
);

console.log(`\n${failures.length === 0 ? '=== exclusão de conta: tudo passou ===' : '=== FALHAS ==='}`);
console.log(`${passed} verificações OK, ${failures.length} falhas`);
for (const failure of failures) console.log(`  - ${failure}`);
process.exit(failures.length === 0 ? 0 : 1);
