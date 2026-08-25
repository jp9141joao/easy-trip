/**
 * F10 — a matriz de RLS inteira, medida de uma vez só.
 *
 * As baterias anteriores provaram o isolamento onde ele tinha defeito conhecido:
 * artigos (P-01), perfis (F5), Storage (F7), arquivos (F8), conteúdo editorial
 * (F9). O que faltava era a varredura: **todas** as tabelas privadas, com os
 * cinco papéis, na mesma execução — inclusive as que nunca tiveram defeito e por
 * isso nunca foram medidas.
 *
 * Cinco identidades:
 *
 *   ANON          sem sessão
 *   USER_A        conta comum, dona dos dados
 *   USER_B        conta comum, vizinha — é ela que tenta o que não pode
 *   ADMIN         conta comum promovida por `profiles.role`
 *   SERVICE_ROLE  ignora RLS por definição; serve de **fonte da verdade**
 *
 * O papel do `service_role` aqui não é testar permissão: é confirmar que a
 * linha existe antes de afirmar que alguém não a vê. Sem isso, "B não lê a
 * viagem de A" passaria se o insert de A tivesse falhado (§33 da F9).
 *
 * Roda só contra o Supabase LOCAL.
 *
 *   npx supabase start
 *   node supabase/tests/rls_matrix_e2e.mjs
 */

const API = process.env.SUPABASE_API_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!ANON || !SERVICE) {
  console.error('Defina SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY (npx supabase status -o env).');
  process.exit(2);
}
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(API)) {
  console.error(`Recusado: ${API} não é local. Este teste cria e apaga dados.`);
  process.exit(2);
}

let passed = 0;
const failures = [];
const check = (c, label) => {
  if (c) {
    passed += 1;
    console.log(`  OK   ${label}`);
  } else {
    failures.push(label);
    console.log(`  FALHOU  ${label}`);
  }
};

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const svc = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };

async function signUp(tag) {
  const r = await fetch(`${API}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `f10-${tag}-${stamp}@easytrip.test`, password: 'senhaForte123' }),
  }).then((x) => x.json());
  return { tag, id: r.user?.id, token: r.access_token };
}

/** `who` = objeto de conta, ou `null` para ANON (só a chave publicável). */
const rest = async (who, path, opts = {}) => {
  const headers = { apikey: ANON, 'Content-Type': 'application/json' };
  if (who) headers.Authorization = `Bearer ${who.token}`;
  if (opts.prefer) headers.Prefer = opts.prefer;
  const r = await fetch(`${API}/rest/v1/${path}`, {
    method: opts.method ?? 'GET',
    headers,
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  });
  const t = await r.text();
  return { status: r.status, body: t ? JSON.parse(t) : null };
};

const asService = async (path, opts = {}) => {
  const r = await fetch(`${API}/rest/v1/${path}`, {
    method: opts.method ?? 'GET',
    headers: { ...svc, ...(opts.prefer ? { Prefer: opts.prefer } : {}) },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  });
  const t = await r.text();
  return { status: r.status, body: t ? JSON.parse(t) : null };
};

const rows = (r) => (Array.isArray(r.body) ? r.body.length : 0);

/* ========================================================================== */

const A = await signUp('a');
const B = await signUp('b');
const ADMIN = await signUp('admin');
check(Boolean(A.id && B.id && ADMIN.id), '0: três contas reais criadas');

await asService(`profiles?user_id=eq.${ADMIN.id}`, { method: 'PATCH', body: { role: 'admin' } });
check(
  (await asService(`profiles?select=role&user_id=eq.${ADMIN.id}`)).body?.[0]?.role === 'admin',
  '0b: a terceira conta é administradora',
);

/* ------------------------- a árvore privada do A -------------------------- */

console.log('\n== preparo: a árvore de dados do usuário A ==');

const viagem = (
  await rest(A, 'trips', {
    method: 'POST',
    prefer: 'return=representation',
    body: [
      {
        user_id: A.id,
        destination_city: 'Lisboa',
        destination_country: 'Portugal',
        country_code: 'PT',
        timezone: 'Europe/Lisbon',
        start_date: '2026-10-05',
        end_date: '2026-10-12',
        budget_total: 9000,
        budget_currency: 'BRL',
      },
    ],
  })
).body?.[0];
check(Boolean(viagem?.id), '1: A cria a própria viagem');

// Os nomes das colunas são os do banco, não os do domínio — é de propósito:
// o teste fala PostgREST direto, sem o mapeamento do aplicativo no meio.
const filhos = [
  ['itinerary_items', { trip_id: viagem.id, date: '2026-10-06', type: 'atracao', title: 'Jerónimos' }],
  ['checklist_items', { trip_id: viagem.id, label: 'Passaporte', category: 'documentos', completed: false }],
  ['expenses', { trip_id: viagem.id, user_id: A.id, description: 'Jantar', amount: 320, currency: 'BRL', category: 'alimentacao', transaction_date: '2026-10-06' }],
  ['tickets', { trip_id: viagem.id, user_id: A.id, type: 'flight', title: 'GRU → LIS' }],
  ['journal_entries', { trip_id: viagem.id, user_id: A.id, entry_date: '2026-10-06', content: 'Pastel de nata.' }],
  ['goals', { user_id: A.id, type: 'economia', title: 'Guardar', target_value: 5000, current_value: 0, unit: 'R$', status: 'active' }],
  ['insurance_policies', { user_id: A.id, trip_id: viagem.id, provider: 'Seguradora X', policy_number: 'AP-1' }],
];

const criados = {};
for (const [tabela, payload] of filhos) {
  const r = await rest(A, tabela, { method: 'POST', prefer: 'return=representation', body: [payload] });
  criados[tabela] = r.body?.[0]?.id;
  check(Boolean(criados[tabela]), `1.${tabela}: A cria seu registro em ${tabela}`);
  if (!criados[tabela]) console.error(`     HTTP ${r.status}`, JSON.stringify(r.body));
}

// Consulta e curtida: dependem de conteúdo editorial existente.
const advisorId = (await asService('advisors?select=id&limit=1')).body?.[0]?.id;
const artigoId = (await asService('articles?select=id&status=eq.published&limit=1')).body?.[0]?.id;
check(Boolean(advisorId && artigoId), '1b: há conteúdo editorial semeado para as tabelas de vínculo');

const consulta = (
  await rest(A, 'consultations', {
    method: 'POST',
    prefer: 'return=representation',
    body: [{ user_id: A.id, advisor_id: advisorId, scheduled_at: 'quinta à tarde', status: 'requested' }],
  })
).body?.[0];
check(Boolean(consulta?.id), '1.consultations: A pede uma consulta');

const curtida = await rest(A, 'article_likes', {
  method: 'POST',
  prefer: 'return=representation',
  body: [{ user_id: A.id, article_id: artigoId }],
});
check(curtida.status < 400, '1.article_likes: A curte um artigo');

/* --------------------------- ANON não lê nada ----------------------------- */

console.log('\n== ANON: sem sessão, sem dado ==');

const privadas = [
  'profiles',
  'trips',
  'itinerary_items',
  'checklist_items',
  'expenses',
  'tickets',
  'journal_entries',
  'goals',
  'insurance_policies',
  'consultations',
  'article_likes',
];
for (const tabela of privadas) {
  const r = await rest(null, `${tabela}?select=id`);
  check(rows(r) === 0, `2.${tabela}: ANON não lê`);
}

// E o conteúdo editorial também exige sessão neste produto (policies `to authenticated`).
for (const tabela of ['articles', 'offers', 'places', 'advisors']) {
  const r = await rest(null, `${tabela}?select=id`);
  check(rows(r) === 0, `2.${tabela}: ANON não lê conteúdo editorial (leitura é autenticada)`);
}

/* ------------------- USER_B não alcança nada do USER_A -------------------- */

console.log('\n== USER_B contra USER_A ==');

// Antes de cada "não vê", o service_role confirma que existe o que não ver.
const alvos = [
  ['trips', viagem.id],
  ['itinerary_items', criados.itinerary_items],
  ['checklist_items', criados.checklist_items],
  ['expenses', criados.expenses],
  ['tickets', criados.tickets],
  ['journal_entries', criados.journal_entries],
  ['goals', criados.goals],
  ['insurance_policies', criados.insurance_policies],
  ['consultations', consulta.id],
];

for (const [tabela, id] of alvos) {
  const existe = rows(await asService(`${tabela}?select=id&id=eq.${id}`)) === 1;
  check(existe, `3.${tabela}: a linha de A existe (service_role)`);

  check(rows(await rest(B, `${tabela}?select=id&id=eq.${id}`)) === 0, `4.${tabela}: B não LÊ`);

  const update = await rest(B, `${tabela}?id=eq.${id}`, {
    method: 'PATCH',
    prefer: 'return=representation',
    body: tabela === 'goals' ? { title: 'invadido' } : { updated_at: new Date().toISOString() },
  });
  check(rows(update) === 0, `5.${tabela}: B não ALTERA`);

  await rest(B, `${tabela}?id=eq.${id}`, { method: 'DELETE' });
  check(
    rows(await asService(`${tabela}?select=id&id=eq.${id}`)) === 1,
    `6.${tabela}: B não EXCLUI — a linha continua lá`,
  );
}

// Escrever em nome de A também não vale: a policy compara com `auth.uid()`.
const forjada = await rest(B, 'expenses', {
  method: 'POST',
  body: [{ trip_id: viagem.id, description: 'forjada', amount: 1, currency: 'BRL', category: 'food', date: '2026-10-06' }],
});
check(forjada.status >= 400, '7: B não cria despesa dentro da viagem de A');

const perfilDeA = await rest(B, `profiles?select=name&user_id=eq.${A.id}`);
check(rows(perfilDeA) === 0, '8: B não lê o perfil de A');

const escalada = await rest(B, `profiles?user_id=eq.${B.id}`, {
  method: 'PATCH',
  prefer: 'return=representation',
  body: { role: 'admin' },
});
const virouAdmin = (await asService(`profiles?select=role&user_id=eq.${B.id}`)).body?.[0]?.role;
check(virouAdmin !== 'admin', '9: B não se promove a admin (escalada de papel bloqueada)');
if (escalada.status < 400 && virouAdmin === 'admin') console.error('  → role virou admin!');

/* ------------------------------- o ADMIN ---------------------------------- */

console.log('\n== ADMIN: manda no conteúdo, não nos dados de ninguém ==');

check(
  rows(await rest(ADMIN, `trips?select=id&id=eq.${viagem.id}`)) === 0,
  '10: admin NÃO lê a viagem de A — administrar conteúdo não é administrar gente',
);
check(
  rows(await rest(ADMIN, `journal_entries?select=id&id=eq.${criados.journal_entries}`)) === 0,
  '11: admin NÃO lê o diário de A',
);

const rascunho = await rest(ADMIN, 'articles', {
  method: 'POST',
  prefer: 'return=representation',
  body: [
    {
      slug: `f10-matriz-${stamp}`,
      title: 'Rascunho da matriz',
      category: 'Teste',
      author_name: 'Equipe',
      content: 'x'.repeat(120),
      published_at: new Date().toISOString(),
      estimated_read_minutes: 2,
      status: 'draft',
    },
  ],
});
check(rascunho.status < 400, '12: admin cria conteúdo editorial');
const rascunhoId = rascunho.body?.[0]?.id;
check(rows(await asService(`articles?select=id&id=eq.${rascunhoId}`)) === 1, '12b: o rascunho existe');
check(rows(await rest(A, `articles?select=id&id=eq.${rascunhoId}`)) === 0, '13: A não vê rascunho');

const tentativaComum = await rest(A, 'articles', {
  method: 'POST',
  body: [
    {
      slug: `f10-comum-${stamp}`,
      title: 'Não deve existir',
      category: 'x',
      author_name: 'x',
      content: 'x'.repeat(120),
      published_at: new Date().toISOString(),
      estimated_read_minutes: 1,
      status: 'draft',
    },
  ],
});
check(tentativaComum.status >= 400, '14: conta comum não cria conteúdo editorial');

/* --------------------------------- limpeza -------------------------------- */

await asService(`articles?id=eq.${rascunhoId}`, { method: 'DELETE' });
for (const conta of [A, B, ADMIN]) {
  await fetch(`${API}/auth/v1/admin/users/${conta.id}`, { method: 'DELETE', headers: svc });
}
// A exclusão do usuário cascateia; conferir é o que prova que a limpeza é real.
check(
  rows(await asService(`trips?select=id&id=eq.${viagem.id}`)) === 0,
  '15: excluir a conta de A levou a viagem junto (CASCADE)',
);

console.log(`\n${passed} verificações OK, ${failures.length} falharam.`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
