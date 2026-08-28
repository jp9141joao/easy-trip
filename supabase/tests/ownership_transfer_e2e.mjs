/**
 * Transferência de propriedade e guarda de exclusão, de ponta a ponta (§50).
 *
 * A suíte SQL (`ownership_transfer.test.sql`) já prova a função no banco. O que
 * ESTE arquivo prova é diferente e não se deduz daquele: que o caminho inteiro
 * funciona como o aplicativo o percorre — PostgREST com JWT real, a Edge
 * Function `delete-account` de verdade, e a cascata do Postgres de verdade.
 *
 * O cenário é o defeito que a 0014 corrige, encenado:
 *
 *   1. Alice cria uma viagem e convida Bento, que aceita.
 *   2. Alice tenta excluir a conta        → RECUSADO, e a viagem continua lá.
 *   3. Alice transfere a viagem a Bento.
 *   4. Alice exclui a conta               → aceito.
 *   5. A viagem do Bento CONTINUA EXISTINDO, com o conteúdo dele intacto.
 *
 * O passo 5 é o teste. Sem a 0014, `trips.user_id` ainda apontaria para a
 * Alice, e apagar a conta dela levaria a viagem — e o diário do Bento — junto.
 *
 * Roda só contra o Supabase LOCAL.
 *
 *   ./scripts/e2e/e2e-run.sh ownership_transfer_e2e
 */

const API = process.env.SUPABASE_API_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!ANON || !SERVICE) {
  console.error('Defina SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY (npx supabase status -o env).');
  process.exit(2);
}
// §53: nada destrutivo fora da máquina.
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(API)) {
  console.error(`Recusado: ${API} não é local. Este teste apaga dados.`);
  process.exit(2);
}

let passed = 0;
const failures = [];
const check = (condition, label) => {
  if (condition) { passed += 1; console.log(`  OK   ${label}`); }
  else { failures.push(label); console.log(`  FALHOU  ${label}`); }
};

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const svc = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };

async function signUp(tag) {
  const r = await fetch(`${API}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `owner-${tag}-${stamp}@easytrip.test`,
      password: 'senhaForte123',
      data: { name: tag === 'a' ? 'Alice' : 'Bento' },
    }),
  }).then((x) => x.json());
  return { id: r.user?.id, token: r.access_token, email: r.user?.email };
}

const asUser = (token) => ({
  apikey: ANON,
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
});

async function rest(headers, path, init = {}) {
  const r = await fetch(`${API}/rest/v1/${path}`, {
    ...init,
    headers: { ...headers, ...(init.prefer ? { Prefer: init.prefer } : {}) },
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}

async function rpc(headers, fn, args) {
  const r = await fetch(`${API}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(args ?? {}),
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}

console.log('\n=== 1. preparação ===');

const A = await signUp('a');
const B = await signUp('b');
check(Boolean(A.id && A.token), '1: conta A (Alice) criada');
check(Boolean(B.id && B.token), '2: conta B (Bento) criada');

const tripResult = await rest(asUser(A.token), 'trips', {
  method: 'POST',
  prefer: 'return=representation',
  body: JSON.stringify({
    user_id: A.id,
    destination_city: 'Lisboa',
    destination_country: 'Portugal',
    country_code: 'PT',
    timezone: 'Europe/Lisbon',
    start_date: '2026-11-01',
    end_date: '2026-11-10',
  }),
});
const tripId = tripResult.body?.[0]?.id;
check(Boolean(tripId), '3: Alice cria a viagem');

// Convite e aceite pelo protocolo real.
const invite = await rpc(asUser(A.token), 'create_trip_invite', {
  target_trip: tripId,
  target_email: B.email,
  target_role: 'editor',
});
const inviteId = invite.body?.id;
check(Boolean(inviteId), '4: Alice convida Bento como editor');

console.log('\n=== 2. antes de aceitar, Bento não pode receber a viagem ===');

const cedoDemais = await rpc(asUser(A.token), 'transfer_trip_ownership', {
  target_trip: tripId,
  new_owner: B.id,
});
// A regra é "tem linha em trip_members", e aceitar é o que a cria.
check(cedoDemais.status >= 400, '5: convite pendente não recebe a propriedade');

const aceite = await rpc(asUser(B.token), 'accept_trip_invite', { invite: inviteId });
check(aceite.status < 400, '6: Bento aceita o convite');

// Conteúdo do Bento, que é o que a cascata destruiria.
const diario = await rest(asUser(B.token), 'journal_entries', {
  method: 'POST',
  prefer: 'return=representation',
  body: JSON.stringify({
    user_id: B.id,
    trip_id: tripId,
    entry_date: '2026-11-02',
    content: 'Primeiro dia em Lisboa.',
    visibility: 'shared',
  }),
});
const diarioId = diario.body?.[0]?.id;
check(Boolean(diarioId), '7: Bento escreve no diário compartilhado');

console.log('\n=== 3. a guarda de exclusão de conta ===');

const bloqueiosA = await rpc(asUser(A.token), 'account_deletion_blockers');
check(
  Array.isArray(bloqueiosA.body) && bloqueiosA.body.length === 1,
  '8: Alice é bloqueada por uma viagem compartilhada',
);
check(
  bloqueiosA.body?.[0]?.destination_city === 'Lisboa',
  '9: o bloqueio nomeia a viagem',
);

const bloqueiosB = await rpc(asUser(B.token), 'account_deletion_blockers');
check(
  Array.isArray(bloqueiosB.body) && bloqueiosB.body.length === 0,
  '10: Bento, que é editor, não é bloqueado',
);

// A Function de verdade, com o JWT da Alice.
const recusa = await fetch(`${API}/functions/v1/delete-account`, {
  method: 'POST',
  headers: asUser(A.token),
}).then(async (r) => ({ status: r.status, body: await r.json() }));

check(recusa.status === 200, '11: delete-account responde 200 (e não um erro opaco)');
check(recusa.body?.ok === false, '12: a resposta diz que NÃO excluiu');
check(recusa.body?.reason === 'ownership-blocked', '13: e diz o motivo, de forma legível pela tela');
check(
  Array.isArray(recusa.body?.trips) && recusa.body.trips[0]?.destinationCity === 'Lisboa',
  '14: a resposta lista qual viagem trava a exclusão',
);

// A prova de que a recusa não destruiu nada pelo caminho.
const aindaExiste = await rest(svc, `trips?id=eq.${tripId}&select=id`);
check(aindaExiste.body?.length === 1, '15: a viagem continua intacta depois da recusa');
const contaA = await fetch(`${API}/auth/v1/admin/users/${A.id}`, { headers: svc })
  .then((r) => r.status);
check(contaA === 200, '16: a conta da Alice continua existindo depois da recusa');

console.log('\n=== 4. a transferência ===');

const transfer = await rpc(asUser(A.token), 'transfer_trip_ownership', {
  target_trip: tripId,
  new_owner: B.id,
});
check(transfer.status < 400, '17: Alice transfere a viagem para Bento');
check(transfer.body?.role === 'owner', '18: a resposta traz Bento como owner');

const tripDepois = await rest(svc, `trips?id=eq.${tripId}&select=user_id`);
check(
  tripDepois.body?.[0]?.user_id === B.id,
  '19: trips.user_id passou para Bento — é o que quebra a cascata',
);

const membros = await rest(svc, `trip_members?trip_id=eq.${tripId}&select=user_id,role`);
const papelA = membros.body?.find((m) => m.user_id === A.id)?.role;
const papelB = membros.body?.find((m) => m.user_id === B.id)?.role;
check(papelB === 'owner', '20: Bento é owner em trip_members');
check(papelA === 'editor', '21: Alice foi rebaixada a editor e continua na viagem');

// Alice perdeu a gerência de verdade, pelo caminho real.
const tentaGerenciar = await rpc(asUser(A.token), 'remove_trip_member', {
  target_trip: tripId,
  target_user: B.id,
});
check(tentaGerenciar.status >= 400, '22: Alice não gerencia mais membros');

console.log('\n=== 5. a exclusão, agora permitida ===');

const bloqueiosDepois = await rpc(asUser(A.token), 'account_deletion_blockers');
check(
  Array.isArray(bloqueiosDepois.body) && bloqueiosDepois.body.length === 0,
  '23: depois de transferir, nada mais bloqueia a Alice',
);

const exclusao = await fetch(`${API}/functions/v1/delete-account`, {
  method: 'POST',
  headers: asUser(A.token),
}).then(async (r) => ({ status: r.status, body: await r.json() }));
check(exclusao.status === 200 && exclusao.body?.ok === true, '24: a conta da Alice é excluída');

const contaAdepois = await fetch(`${API}/auth/v1/admin/users/${A.id}`, { headers: svc })
  .then((r) => r.status);
check(contaAdepois === 404, '25: a conta da Alice não existe mais');

console.log('\n=== 6. o que esta migration existe para proteger ===');

const viagemSobreviveu = await rest(svc, `trips?id=eq.${tripId}&select=id,user_id`);
check(
  viagemSobreviveu.body?.length === 1,
  '26: A VIAGEM DO BENTO SOBREVIVEU à exclusão da conta da Alice',
);
check(
  viagemSobreviveu.body?.[0]?.user_id === B.id,
  '27: e continua pertencendo a ele',
);

const diarioSobreviveu = await rest(svc, `journal_entries?id=eq.${diarioId}&select=id`);
check(diarioSobreviveu.body?.length === 1, '28: o diário do Bento sobreviveu junto');

const bentoLe = await rest(asUser(B.token), `trips?id=eq.${tripId}&select=id`);
check(bentoLe.body?.length === 1, '29: e Bento continua enxergando a própria viagem');

const bentoAgoraBloqueado = await rpc(asUser(B.token), 'account_deletion_blockers');
check(
  Array.isArray(bentoAgoraBloqueado.body) && bentoAgoraBloqueado.body.length === 0,
  '30: com a Alice fora, Bento é o único membro e deixa de ser bloqueado',
);

console.log(`\n=== Transferência de propriedade: ${passed} verificações OK, ${failures.length} falhas`);
if (failures.length) {
  for (const f of failures) console.error(`  · ${f}`);
  process.exit(1);
}
