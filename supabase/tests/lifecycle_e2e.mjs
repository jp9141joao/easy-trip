/* global Buffer */
/**
 * F8 — ciclo de vida dos arquivos (P-07) contra um Supabase de verdade.
 *
 * Para cada entidade que guarda arquivo: cria a linha, sobe o objeto, confirma
 * que os **dois** existem, exclui pelo fluxo do aplicativo e confere os dois de
 * novo, separadamente. Um "o arquivo sumiu" só vale se antes houve um "o
 * arquivo está aqui" — sem isso o teste passa por vacuidade.
 *
 * Roda só contra o Supabase LOCAL.
 *
 *   npx supabase start
 *   node supabase/tests/lifecycle_e2e.mjs
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
const check = (c, label) => {
  if (c) { passed += 1; console.log(`  OK   ${label}`); }
  else { failures.push(label); console.log(`  FALHOU  ${label}`); }
};

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n');
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const svc = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };

async function signUp(tag) {
  const r = await fetch(`${API}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `f8-${tag}-${stamp}@easytrip.test`, password: 'senhaForte123' }),
  }).then((x) => x.json());
  return { id: r.user?.id, token: r.access_token };
}

const rest = async (who, path, opts = {}) => {
  const r = await fetch(`${API}/rest/v1/${path}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${who.token}`, 'Content-Type': 'application/json', ...(opts.prefer ? { Prefer: opts.prefer } : {}) },
    method: opts.method ?? 'GET',
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  });
  const t = await r.text();
  return { status: r.status, body: t ? JSON.parse(t) : null };
};

const upload = async (who, bucket, path, bytes, type) =>
  (await fetch(`${API}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${who.token}`, 'Content-Type': type },
    body: bytes,
  })).status;

const removeObjects = async (who, bucket, paths) => {
  const r = await fetch(`${API}/storage/v1/object/${bucket}`, {
    method: 'DELETE',
    headers: { apikey: ANON, Authorization: `Bearer ${who.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: paths }),
  });
  return { status: r.status, removed: await r.json() };
};

/** Verdade sobre o Storage, com privilégio — independe da policy do usuário. */
const objectExists = async (bucket, path) => {
  const segs = path.split('/');
  const name = segs.pop();
  const r = await fetch(`${API}/storage/v1/object/list/${bucket}`, {
    method: 'POST', headers: svc,
    body: JSON.stringify({ prefix: segs.join('/'), limit: 100, search: name }),
  });
  const rows = await r.json();
  return Array.isArray(rows) && rows.some((o) => o.name === name);
};

const rowExists = async (table, id) =>
  (await fetch(`${API}/rest/v1/${table}?select=id&id=eq.${id}`, { headers: svc }).then((r) => r.json())).length > 0;

/**
 * O ciclo de vida como o aplicativo o executa (`fileLifecycle.ts`):
 * arquivo primeiro, linha depois, e a linha só cai se o arquivo caiu.
 */
async function deleteWithFiles(who, bucket, paths, table, id) {
  const alvos = paths.filter(Boolean);
  const proprios = alvos.filter((p) => p.split('/')[0] === who.id);
  if (proprios.length !== alvos.length) return { ok: false, motivo: 'caminho de terceiro' };

  const removidos = new Set();
  if (proprios.length) {
    const { removed } = await removeObjects(who, bucket, proprios);
    for (const o of removed ?? []) removidos.add(o.name);
  }
  for (const p of proprios) {
    if (!removidos.has(p) && (await objectExists(bucket, p))) {
      return { ok: false, motivo: 'objeto sobreviveu' };
    }
  }
  await rest(who, `${table}?id=eq.${id}`, { method: 'DELETE' });
  return { ok: true };
}

const A = await signUp('a');
const B = await signUp('b');
check(Boolean(A.id && A.token && B.id && B.token), '0: duas contas reais criadas');

const novaTrip = async (who) =>
  (await rest(who, 'trips', { method: 'POST', prefer: 'return=representation', body: {
    user_id: who.id, destination_city: 'Lisboa', destination_country: 'Portugal', country_code: 'PT',
    timezone: 'Europe/Lisbon', start_date: '2026-09-01', end_date: '2026-09-10',
    budget_total: 5000, budget_currency: 'BRL' } })).body[0];

const tripA = await novaTrip(A);
const tripB = await novaTrip(B);
check(Boolean(tripA?.id && tripB?.id), '1: cada conta tem a própria viagem');

// =============================================================================
console.log('\n== §43 TICKET: linha + arquivo ==');
{
  const path = `${A.id}/${tripA.id}/bilhete.pdf`;
  check((await upload(A, 'attachments', path, PDF, 'application/pdf')) === 200, '2: upload do bilhete');
  const tk = (await rest(A, 'tickets', { method: 'POST', prefer: 'return=representation', body: {
    trip_id: tripA.id, user_id: A.id, type: 'voo', title: 'TAP 1234',
    file_path: path, mime_type: 'application/pdf' } })).body[0];

  check(await rowExists('tickets', tk.id), '3: ANTES — a linha existe');
  check(await objectExists('attachments', path), '4: ANTES — o arquivo existe');

  const r = await deleteWithFiles(A, 'attachments', [path], 'tickets', tk.id);
  check(r.ok, '5: a exclusão completou');
  check(!(await rowExists('tickets', tk.id)), '6: DEPOIS — a linha sumiu');
  check(!(await objectExists('attachments', path)), '7: DEPOIS — o arquivo sumiu');
}

// =============================================================================
console.log('\n== §43 APÓLICE: era aqui que o P-07 acontecia ==');
{
  const path = `${A.id}/apolices/seguro.pdf`;
  check((await upload(A, 'attachments', path, PDF, 'application/pdf')) === 200, '8: upload da apólice');
  const ap = (await rest(A, 'insurance_policies', { method: 'POST', prefer: 'return=representation', body: {
    user_id: A.id, provider: 'Seguradora', policy_number: `AP-${stamp}`, file_path: path } })).body[0];

  check(await rowExists('insurance_policies', ap.id), '9: ANTES — a linha existe');
  check(await objectExists('attachments', path), '10: ANTES — o arquivo existe');

  // O fluxo ANTIGO, para deixar o defeito registrado: só o delete da linha.
  const antigo = `${A.id}/apolices/antigo.pdf`;
  await upload(A, 'attachments', antigo, PDF, 'application/pdf');
  const ap2 = (await rest(A, 'insurance_policies', { method: 'POST', prefer: 'return=representation', body: {
    user_id: A.id, provider: 'Seguradora', policy_number: `AP2-${stamp}`, file_path: antigo } })).body[0];
  await rest(A, `insurance_policies?id=eq.${ap2.id}`, { method: 'DELETE' });
  check(!(await rowExists('insurance_policies', ap2.id)), '11: fluxo ANTIGO — a linha sumiu');
  check(await objectExists('attachments', antigo), '12: fluxo ANTIGO — o arquivo FICOU (P-07 reproduzido)');
  await removeObjects(A, 'attachments', [antigo]);

  const r = await deleteWithFiles(A, 'attachments', [path], 'insurance_policies', ap.id);
  check(r.ok, '13: fluxo NOVO — a exclusão completou');
  check(!(await rowExists('insurance_policies', ap.id)), '14: DEPOIS — a linha sumiu');
  check(!(await objectExists('attachments', path)), '15: DEPOIS — o arquivo sumiu');
}

// =============================================================================
console.log('\n== §7 DIÁRIO: 0, 1 e várias mídias ==');
{
  const entrada = async () => (await rest(A, 'journal_entries', { method: 'POST', prefer: 'return=representation',
    body: { trip_id: tripA.id, user_id: A.id, entry_date: '2026-09-02', content: 'dia' } })).body[0];

  const semMidia = await entrada();
  const r0 = await deleteWithFiles(A, 'journal', [], 'journal_entries', semMidia.id);
  check(r0.ok && !(await rowExists('journal_entries', semMidia.id)), '16: entrada sem mídia é excluída');

  const uma = await entrada();
  const p1 = `${A.id}/${uma.id}/foto.png`;
  await upload(A, 'journal', p1, PNG, 'image/png');
  await rest(A, 'journal_media', { method: 'POST', body: { journal_entry_id: uma.id, file_path: p1, mime_type: 'image/png', sort_order: 0 } });
  check(await objectExists('journal', p1), '17: ANTES — a única mídia existe');
  await deleteWithFiles(A, 'journal', [p1], 'journal_entries', uma.id);
  check(!(await objectExists('journal', p1)), '18: DEPOIS — a única mídia sumiu');

  const varias = await entrada();
  const ps = ['a', 'b', 'c'].map((n) => `${A.id}/${varias.id}/${n}.png`);
  for (const p of ps) await upload(A, 'journal', p, PNG, 'image/png');
  for (const [i, p] of ps.entries())
    await rest(A, 'journal_media', { method: 'POST', body: { journal_entry_id: varias.id, file_path: p, mime_type: 'image/png', sort_order: i } });
  check((await Promise.all(ps.map((p) => objectExists('journal', p)))).every(Boolean), '19: ANTES — as três mídias existem');
  await deleteWithFiles(A, 'journal', ps, 'journal_entries', varias.id);
  check((await Promise.all(ps.map((p) => objectExists('journal', p)))).every((e) => !e), '20: DEPOIS — as três sumiram');
  check(!(await rowExists('journal_entries', varias.id)), '21: e a entrada também');

  // Mídia já ausente no meio do caminho.
  const parcial = await entrada();
  const px = [`${A.id}/${parcial.id}/existe.png`, `${A.id}/${parcial.id}/nunca-existiu.png`];
  await upload(A, 'journal', px[0], PNG, 'image/png');
  const rp = await deleteWithFiles(A, 'journal', px, 'journal_entries', parcial.id);
  check(rp.ok, '22: mídia já ausente não trava a exclusão');
  check(!(await rowExists('journal_entries', parcial.id)), '23: e a entrada é excluída assim mesmo');
}

// =============================================================================
console.log('\n== §5-G / §47 arquivo de OUTRO usuário ==');
{
  const pB = `${B.id}/${tripB.id}/de-b.pdf`;
  check((await upload(B, 'attachments', pB, PDF, 'application/pdf')) === 200, '24: B sobe o próprio documento');
  check(await objectExists('attachments', pB), '25: o documento de B existe (senão o resto seria vácuo)');

  // A grava na PRÓPRIA linha um caminho que é de B. A RLS deixa A apagar a
  // linha dele; o que não pode é isso virar "apagar o arquivo de B".
  const tk = (await rest(A, 'tickets', { method: 'POST', prefer: 'return=representation', body: {
    trip_id: tripA.id, user_id: A.id, type: 'outro', title: 'forjado', file_path: pB } })).body[0];

  const r = await deleteWithFiles(A, 'attachments', [pB], 'tickets', tk.id);
  check(!r.ok, `26: a exclusão é interrompida (${r.motivo})`);
  check(await objectExists('attachments', pB), '27: o arquivo de B continua intacto');
  check(await rowExists('tickets', tk.id), '28: e a linha de A não foi apagada às cegas');

  // E mesmo se a checagem local não existisse, o servidor barra.
  const direto = await removeObjects(A, 'attachments', [pB]);
  check(Array.isArray(direto.removed) && direto.removed.length === 0, '29: o Storage não remove nada para A');
  check(await objectExists('attachments', pB), '30: confirmando — o arquivo de B sobreviveu à tentativa direta');

  await rest(A, `tickets?id=eq.${tk.id}`, { method: 'DELETE' });
}

// =============================================================================
console.log('\n== §5-B falha parcial: o objeto não pode sair sem a linha ==');
{
  // Um caminho que A não consegue remover (é de B) preso a uma linha de A.
  const pB = `${B.id}/${tripB.id}/preso.pdf`;
  await upload(B, 'attachments', pB, PDF, 'application/pdf');
  const tk = (await rest(A, 'tickets', { method: 'POST', prefer: 'return=representation', body: {
    trip_id: tripA.id, user_id: A.id, type: 'outro', title: 'preso', file_path: pB } })).body[0];

  const r = await deleteWithFiles(A, 'attachments', [pB], 'tickets', tk.id);
  check(!r.ok && (await rowExists('tickets', tk.id)),
    '31: remoção do arquivo falha → a linha permanece (nada vira lixo invisível)');

  // Retry seguro: corrigido o caminho, a exclusão completa.
  const bom = `${A.id}/${tripA.id}/bom.pdf`;
  await upload(A, 'attachments', bom, PDF, 'application/pdf');
  await rest(A, `tickets?id=eq.${tk.id}`, { method: 'PATCH', body: { file_path: bom } });
  const r2 = await deleteWithFiles(A, 'attachments', [bom], 'tickets', tk.id);
  check(r2.ok && !(await rowExists('tickets', tk.id)), '32: a tentativa seguinte completa — a operação é repetível');
  check(!(await objectExists('attachments', bom)), '33: e o arquivo sumiu junto');
  await removeObjects(B, 'attachments', [pB]);
}

// =============================================================================
console.log('\n== §11 URL assinada não é identidade durável ==');
{
  const path = `${A.id}/${tripA.id}/assinada.pdf`;
  await upload(A, 'attachments', path, PDF, 'application/pdf');
  const assinada = await fetch(`${API}/storage/v1/object/sign/attachments/${path}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${A.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: 60 }),
  }).then((r) => r.json());

  check(Boolean(assinada.signedURL || assinada.signedUrl), '34: a URL assinada é gerada a partir do caminho');
  const tk = (await rest(A, 'tickets', { method: 'POST', prefer: 'return=representation', body: {
    trip_id: tripA.id, user_id: A.id, type: 'voo', title: 'assinada', file_path: path } })).body[0];

  const gravado = (await rest(A, `tickets?select=file_path&id=eq.${tk.id}`)).body[0].file_path;
  check(gravado === path, '35: o que ficou gravado é o CAMINHO, não a URL');
  check(!gravado.includes('token') && !gravado.includes('http'), '36: nenhum token expirável no banco');

  await deleteWithFiles(A, 'attachments', [path], 'tickets', tk.id);
}

// =============================================================================
console.log('\n== §46 exclusão de conta continua limpando tudo (P-02) ==');
{
  const path = `${A.id}/${tripA.id}/para-purgar.pdf`;
  await upload(A, 'attachments', path, PDF, 'application/pdf');
  await rest(A, 'tickets', { method: 'POST', body: {
    trip_id: tripA.id, user_id: A.id, type: 'voo', title: 'purga', file_path: path } });
  check(await objectExists('attachments', path), '37: ANTES — há arquivo da conta A');

  const r = await fetch(`${API}/functions/v1/delete-account`, {
    method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${A.token}` },
  });
  check(r.status === 200, `38: a Edge Function respondeu ${r.status}`);
  check(!(await objectExists('attachments', path)), '39: DEPOIS — o arquivo da conta A sumiu');
  check((await fetch(`${API}/rest/v1/trips?select=id&user_id=eq.${A.id}`, { headers: svc }).then((x) => x.json())).length === 0,
    '40: e as linhas também');
}

console.log(`\n${failures.length === 0 ? '=== F8: ciclo de vida dos arquivos ===' : '=== FALHAS ==='}`);
console.log(`${passed} verificações OK, ${failures.length} falhas`);
for (const f of failures) console.log(`  - ${f}`);
process.exit(failures.length === 0 ? 0 : 1);
