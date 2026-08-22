/**
 * F6 — a consulta de ofertas que o aplicativo envia, contra o PostgREST real.
 *
 * A vigência é decidida em dois lugares e precisa dar o mesmo resultado nos
 * dois: na policy `offers_read` (0004) e na consulta que o
 * `SupabaseDataSource.listOffers` monta. Para quem a RLS já filtra, o segundo
 * é redundante; para o administrador — a quem a policy deixa ver tudo — ele é
 * a única coisa que impede uma promoção vencida de reaparecer na Home.
 *
 * Por isso o teste roda com `service_role`: sem RLS no caminho, o que sobra é
 * exatamente o filtro do cliente. Se a sintaxe dos dois `or=` estiver errada,
 * ou se um deles sumir, aqui aparece.
 *
 * Roda só contra o Supabase LOCAL.
 *
 *   npx supabase start
 *   node supabase/tests/offer_window_e2e.mjs
 */

const API = process.env.SUPABASE_API_URL ?? 'http://127.0.0.1:54321';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE) {
  console.error('Defina SUPABASE_SERVICE_ROLE_KEY (npx supabase status -o env).');
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

const dia = 24 * 60 * 60 * 1000;
const isoDay = (offset) => new Date(Date.now() + offset * dia).toISOString().slice(0, 10);
const HOJE = isoDay(0);

const headers = {
  apikey: SERVICE,
  Authorization: `Bearer ${SERVICE}`,
  'Content-Type': 'application/json',
};

const stamp = Date.now();
const id = (n) => `f6f6f6f6-0000-4000-8000-${String(n).padStart(12, '0')}`;

// Todas as chaves em todas as linhas: o PostgREST recusa um lote em que os
// objetos tenham conjuntos de chaves diferentes (PGRST102). Por isso os dois
// extremos da vigência aparecem como `null` explícito, e não por omissão.
const base = {
  description: 'fixture da F6',
  cost_level: 'economy',
  image_url: 'https://exemplo/f6.jpg',
  status: 'published',
  active_from: null,
  active_until: null,
};

// As mesmas seis situações que decidem se uma oferta aparece.
const fixtures = [
  { id: id(1), destination: `F6 vigente ${stamp}`, sort_order: 10, ...base },
  { id: id(2), destination: `F6 rascunho ${stamp}`, sort_order: 20, ...base, status: 'draft' },
  { id: id(3), destination: `F6 vencida ${stamp}`, sort_order: 30, ...base, active_until: isoDay(-1) },
  { id: id(4), destination: `F6 futura ${stamp}`, sort_order: 40, ...base, active_from: isoDay(1) },
  { id: id(5), destination: `F6 comeca hoje ${stamp}`, sort_order: 50, ...base, active_from: HOJE },
  { id: id(6), destination: `F6 termina hoje ${stamp}`, sort_order: 60, ...base, active_until: HOJE },
];

// Um preparo que falha em silêncio faz o teste inteiro mentir: sem linha
// nenhuma no banco, todo "não aparece" passa por vacuidade.
const preparo = await fetch(`${API}/rest/v1/offers`, {
  method: 'POST',
  headers: { ...headers, Prefer: 'resolution=merge-duplicates' },
  body: JSON.stringify(fixtures),
});
check(preparo.status === 201, `0: as seis ofertas de teste foram criadas (HTTP ${preparo.status})`);
if (preparo.status !== 201) console.error(await preparo.text());

// Exatamente a consulta que `listOffers` monta, escrita à mão para o teste não
// depender do cliente JavaScript.
const consulta =
  `offers?select=id,destination,sort_order` +
  `&status=eq.published` +
  `&or=(active_from.is.null,active_from.lte.${HOJE})` +
  `&or=(active_until.is.null,active_until.gte.${HOJE})` +
  `&order=sort_order.asc,id.asc`;

const resposta = await fetch(`${API}/rest/v1/${consulta}`, { headers });
const linhas = await resposta.json();

check(resposta.status === 200, `1: o PostgREST aceita os dois \`or=\` (HTTP ${resposta.status})`);

const nossas = Array.isArray(linhas) ? linhas.filter((o) => o.destination.endsWith(String(stamp))) : [];
const vistas = nossas.map((o) => o.destination.replace(` ${stamp}`, ''));

check(vistas.includes('F6 vigente'), '2: a oferta vigente aparece');
check(!vistas.includes('F6 rascunho'), '3: o rascunho não aparece');
check(!vistas.includes('F6 vencida'), '4: a vencida não aparece');
check(!vistas.includes('F6 futura'), '5: a agendada para o futuro não aparece');
check(vistas.includes('F6 comeca hoje'), '6: a que começa hoje já vale — limite inclusivo');
check(vistas.includes('F6 termina hoje'), '7: a que termina hoje ainda vale — limite inclusivo');

// A ordem também é do cliente, e é o que a Home usa.
const ordem = nossas.map((o) => o.sort_order);
check(
  JSON.stringify(ordem) === JSON.stringify([...ordem].sort((a, b) => a - b)),
  '8: vem ordenada por `sort_order`',
);

// E o conjunto tem de bater com o que a fonte local devolveria para os mesmos
// registros — a paridade que `tests/unit/local-catalog.test.ts` mede do outro
// lado, com as mesmas seis situações.
check(vistas.length === 3, `9: três das seis situações aparecem (vistas: ${vistas.length})`);

await fetch(`${API}/rest/v1/offers?id=in.(${fixtures.map((f) => f.id).join(',')})`, {
  method: 'DELETE',
  headers,
});

console.log(`\n${failures.length === 0 ? '=== F6: vigência com paridade ===' : '=== FALHAS ==='}`);
console.log(`${passed} verificações OK, ${failures.length} falhas`);
for (const failure of failures) console.log(`  - ${failure}`);
process.exit(failures.length === 0 ? 0 : 1);
