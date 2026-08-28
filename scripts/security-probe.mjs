/**
 * Sondagem de segurança — o que um atacante SEM credencial alcança.
 *
 * Faz parte da avaliação interna orientada pelo OWASP MASVS 2.1.0
 * (`SECURITY_MASVS_ASSESSMENT.md`). NÃO é um pentest: não há avaliador
 * independente, não há tentativa de exploração além da leitura, e o alvo é a
 * pilha local.
 *
 * O que ele mede é uma pergunta só, repetida contra cada superfície: *o que
 * responde a quem não provou ser ninguém?*
 *
 *   tabelas          → nada. `anon` não tem privilégio de tabela (0005).
 *   RPC privilegiado → nada.
 *   Vault e catálogos→ nada.
 *   Storage          → nada, e `trip-covers` não serve URL pública.
 *   Edge Functions   → 401/403, e NUNCA 503 — um 503 revelaria se a chave do
 *                      provedor está configurada, que é informação de
 *                      implantação. Foi assim que se encontrou o defeito de
 *                      ordem em `admin-generate-content`.
 *
 * Somente leitura, e só contra 127.0.0.1.
 *
 *   source scripts/e2e/e2e-env.sh && ./scripts/e2e/e2e-start.sh && e2e_export_keys
 *   node scripts/security-probe.mjs
 */

const API = process.env.SUPABASE_API_URL;
const ANON = process.env.SUPABASE_ANON_KEY;

if (!API || !ANON) {
  console.error('Defina SUPABASE_API_URL e SUPABASE_ANON_KEY (source scripts/e2e/e2e-env.sh).');
  process.exit(2);
}
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(API)) {
  console.error(`Recusado: ${API} não é local.`);
  process.exit(2);
}
const anon = { apikey: ANON, 'Content-Type': 'application/json' };
const ok = [];
const bad = [];
const t = (c, l) => (c ? ok : bad).push(l) && console.log(`  ${c ? 'PASS' : 'FAIL'}  ${l}`);

console.log('\n== acesso anônimo às tabelas ==');
const TABELAS = ['trips','expenses','journal_entries','itinerary_items','checklist_items',
  'goals','profiles','trip_members','trip_invites','notifications','reminders',
  'tickets','push_tokens','insurance_policies','consultations','reservation_requests'];
for (const tb of TABELAS) {
  const r = await fetch(`${API}/rest/v1/${tb}?select=*&limit=1`, { headers: anon });
  const b = await r.text();
  let rows = 0; try { const j = JSON.parse(b); rows = Array.isArray(j) ? j.length : 0; } catch {}
  t(r.status >= 400 || rows === 0, `anon não lê ${tb} (HTTP ${r.status}, ${rows} linhas)`);
}

console.log('\n== escrita anônima ==');
for (const tb of ['trips','expenses','push_tokens','profiles']) {
  const r = await fetch(`${API}/rest/v1/${tb}`, {
    method: 'POST', headers: anon, body: JSON.stringify({}),
  });
  t(r.status >= 400, `anon não escreve em ${tb} (HTTP ${r.status})`);
}

console.log('\n== conteúdo editorial ==');
// O Easy Trip NÃO tem área pública, e isso é deliberado (0005): `anon` não
// recebe privilégio de tabela nenhum, nem sobre o catálogo publicado. Sem o
// GRANT, uma policy escrita errada no futuro ainda esbarra na falta de
// privilégio — é a segunda barreira, para o dia em que a primeira falhar.
//
// Uma sondagem que esperasse `anon` lendo o catálogo estaria medindo a
// suposição errada sobre este produto.
const pub = await fetch(`${API}/rest/v1/articles?select=id,status&limit=50`, { headers: anon });
const arts = await pub.json().catch(() => null);
t(pub.status >= 400, `anon não lê nem o catálogo publicado (HTTP ${pub.status})`);
t(!Array.isArray(arts) || arts.length === 0, 'nenhum artigo — nem rascunho, nem publicado');

console.log('\n== RPC privilegiado pelo anon ==');
for (const fn of ['transfer_trip_ownership','account_deletion_blockers','deactivate_push_token',
                  'dispatch_trip_daily_briefing','schedule_trip_daily_briefing','briefing_secret',
                  'register_push_token','set_trip_member_role','remove_trip_member']) {
  const r = await fetch(`${API}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: anon, body: '{}',
  });
  t(r.status >= 400, `anon não executa ${fn} (HTTP ${r.status})`);
}

console.log('\n== Vault e catálogos internos ==');
for (const p of ['vault_decrypted_secrets','pg_stat_activity','cron_job']) {
  const r = await fetch(`${API}/rest/v1/${p}?select=*&limit=1`, { headers: anon });
  t(r.status >= 400, `anon não alcança ${p} (HTTP ${r.status})`);
}

console.log('\n== Storage ==');
for (const b of ['attachments','journal','avatars','trip-covers']) {
  const r = await fetch(`${API}/storage/v1/object/list/${b}`, {
    method: 'POST', headers: anon, body: JSON.stringify({ prefix: '', limit: 100 }),
  });
  const body = await r.text();
  let n = 0; try { const j = JSON.parse(body); n = Array.isArray(j) ? j.length : 0; } catch {}
  t(r.status >= 400 || n === 0, `anon não lista ${b} (HTTP ${r.status}, ${n} objetos)`);
}
const publico = await fetch(`${API}/storage/v1/object/public/trip-covers/qualquer/x.jpg`);
t(publico.status >= 400, `trip-covers não serve URL pública (HTTP ${publico.status})`);

console.log('\n== Edge Functions sem credencial ==');
for (const fn of ['send-push','trip-daily-briefing','admin-generate-content']) {
  const r = await fetch(`${API}/functions/v1/${fn}`, {
    method: 'POST', headers: anon, body: '{}',
  });
  t(r.status === 401 || r.status === 403, `${fn} recusa sem credencial (HTTP ${r.status})`);
}

console.log(`\n== ${ok.length} PASS, ${bad.length} FAIL ==`);
if (bad.length) { for (const f of bad) console.error('  · ' + f); process.exit(1); }
