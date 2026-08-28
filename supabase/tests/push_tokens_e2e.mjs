/**
 * Tokens de notificação push, de ponta a ponta (§33, migration 0016).
 *
 * A suíte SQL já prova as policies com identidade simulada. O que ESTE arquivo
 * prova é que o PostgREST de verdade recusa o que elas dizem recusar — a
 * diferença aparece quando um grant está faltando, ou quando um RPC responde
 * antes de a policy ser avaliada.
 *
 * A asserção que dá nome ao arquivo: **a conta A não alcança o endereço de
 * entrega da conta B**. Quem o alcança faz o telefone dela tocar com o texto
 * que quiser, na tela de bloqueio.
 *
 * Roda só contra o Supabase LOCAL.
 *   ./scripts/e2e/e2e-run.sh push_tokens_e2e
 */

const API = process.env.SUPABASE_API_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!ANON || !SERVICE) {
  console.error('Defina SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY (npx supabase status -o env).');
  process.exit(2);
}
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(API)) {
  console.error(`Recusado: ${API} não é local. Este teste apaga dados.`);
  process.exit(2);
}

let passed = 0;
const failures = [];
const check = (c, label) => {
  if (c) { passed += 1; console.log(`  OK   ${label}`); }
  else { failures.push(label); console.log(`  FALHOU  ${label}`); }
};

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const svc = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
const asUser = (t) => ({ apikey: ANON, Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });

async function signUp(tag) {
  const r = await fetch(`${API}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `push-${tag}-${stamp}@easytrip.test`, password: 'senhaForte123' }),
  }).then((x) => x.json());
  return { id: r.user?.id, token: r.access_token };
}

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
    method: 'POST', headers, body: JSON.stringify(args ?? {}),
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}

console.log('\n=== 1. registro ===');

const A = await signUp('a');
const B = await signUp('b');
check(Boolean(A.id && A.token), '1: conta A criada');
check(Boolean(B.id && B.token), '2: conta B criada');

const TOKEN_A = `ExponentPushToken[A-${stamp}]`;
const TOKEN_B = `ExponentPushToken[B-${stamp}]`;

const reg = await rpc(asUser(A.token), 'register_push_token', {
  device_token: TOKEN_A, device_platform: 'android', device_label: 'Pixel da A',
});
check(reg.status < 400, '3: A registra o próprio aparelho');
check(reg.body?.user_id === A.id, '4: o token fica no dono da sessão');
check(reg.body?.active === true, '5: nasce ativo');

await rpc(asUser(B.token), 'register_push_token', {
  device_token: TOKEN_B, device_platform: 'ios',
});

console.log('\n=== 2. ninguém lê o endereço de ninguém ===');

const listaA = await rest(asUser(A.token), 'push_tokens?select=token,user_id');
check(listaA.body?.length === 1, '6: A vê exatamente um token');
check(listaA.body?.[0]?.user_id === A.id, '7: e ele é o dela');
check(
  !JSON.stringify(listaA.body).includes(TOKEN_B),
  '8: O ENDEREÇO DO B NÃO APARECE PARA A',
);

const espiar = await rest(asUser(A.token), `push_tokens?user_id=eq.${B.id}&select=token`);
check(espiar.body?.length === 0, '9: filtrar pelo id do B não devolve nada');

const anonimo = await rest({ apikey: ANON, 'Content-Type': 'application/json' }, 'push_tokens?select=token');
check(
  anonimo.status >= 400 || anonimo.body?.length === 0,
  '10: sem sessão não se lê token nenhum',
);

console.log('\n=== 3. escrita alheia ===');

const forjar = await rest(asUser(B.token), 'push_tokens', {
  method: 'POST',
  prefer: 'return=representation',
  body: JSON.stringify({ user_id: A.id, token: `ExponentPushToken[FORJADO-${stamp}]`, platform: 'android' }),
});
check(forjar.status >= 400, '11: B não registra token no nome de A');

const sequestrar = await rest(asUser(B.token), `push_tokens?user_id=eq.${B.id}`, {
  method: 'PATCH',
  prefer: 'return=representation',
  body: JSON.stringify({ user_id: A.id }),
});
check(
  sequestrar.status >= 400 || (sequestrar.body ?? []).length === 0,
  '12: B não move o próprio token para a conta de A',
);

const apagarAlheio = await rest(asUser(B.token), `push_tokens?user_id=eq.${A.id}`, {
  method: 'DELETE',
  prefer: 'return=representation',
});
check((apagarAlheio.body ?? []).length === 0, '13: B não apaga o token de A');

const aindaLa = await rest(svc, `push_tokens?token=eq.${encodeURIComponent(TOKEN_A)}&select=id`);
check(aindaLa.body?.length === 1, '14: e o token de A continua lá');

console.log('\n=== 4. o aparelho passou de mão ===');

// O B reinstala e recebe um token que era do A.
await rpc(asUser(B.token), 'register_push_token', {
  device_token: TOKEN_A, device_platform: 'android', device_label: 'Pixel (agora do B)',
});
const depois = await rest(svc, `push_tokens?token=eq.${encodeURIComponent(TOKEN_A)}&select=user_id`);
check(depois.body?.[0]?.user_id === B.id, '15: o token acompanha quem usa o aparelho agora');
check(depois.body?.length === 1, '16: e continua havendo uma linha só');

console.log('\n=== 5. desregistrar ===');

const naoMeu = await rpc(asUser(A.token), 'unregister_push_token', { device_token: TOKEN_B });
check(naoMeu.body === false, '17: A não desregistra o aparelho do B');

const meu = await rpc(asUser(B.token), 'unregister_push_token', { device_token: TOKEN_B });
check(meu.body === true, '18: B desregistra o próprio aparelho');

const sumiu = await rest(svc, `push_tokens?token=eq.${encodeURIComponent(TOKEN_B)}&select=id`);
check(sumiu.body?.length === 0, '19: sair remove a inscrição daquele aparelho');

console.log('\n=== 6. desativação é do servidor ===');

const clienteDesativa = await rpc(asUser(B.token), 'deactivate_push_token', { device_token: TOKEN_A });
check(clienteDesativa.status >= 400, '20: cliente não desativa token');

const servidorDesativa = await rpc(svc, 'deactivate_push_token', { device_token: TOKEN_A });
check(servidorDesativa.status < 400, '21: o servidor desativa');
const desativado = await rest(svc, `push_tokens?token=eq.${encodeURIComponent(TOKEN_A)}&select=active`);
check(desativado.body?.[0]?.active === false, '22: e a linha fica inativa, não some');

console.log('\n=== 7. validação ===');

const vazio = await rpc(asUser(A.token), 'register_push_token', {
  device_token: '', device_platform: 'android',
});
check(vazio.status >= 400, '23: token vazio é recusado');

const plataforma = await rpc(asUser(A.token), 'register_push_token', {
  device_token: 'x', device_platform: 'symbian',
});
check(plataforma.status >= 400, '24: plataforma desconhecida é recusada');

console.log('\n=== 8. a conta some, o endereço some ===');

await fetch(`${API}/auth/v1/admin/users/${B.id}`, { method: 'DELETE', headers: svc });
const cascata = await rest(svc, `push_tokens?user_id=eq.${B.id}&select=id`);
check(cascata.body?.length === 0, '25: excluir a conta remove os tokens dela');

console.log(`\n=== Push tokens: ${passed} verificações OK, ${failures.length} falhas`);
if (failures.length) {
  for (const f of failures) console.error(`  · ${f}`);
  process.exit(1);
}
