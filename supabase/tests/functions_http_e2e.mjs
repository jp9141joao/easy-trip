/**
 * Contrato HTTP real das duas Functions novas, contra o Supabase LOCAL.
 *
 * O que se mede aqui e não dá para medir no Jest: a barreira de papel roda no
 * servidor, com JWT de verdade, antes de qualquer custo de provedor. Gemini não
 * é chamado — a ausência de `GEMINI_API_KEY` no ambiente local é justamente o
 * que separa "recusou por papel" (403) de "aceitou o papel e parou na
 * configuração" (503).
 */

const API = process.env.SUPABASE_API_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET = process.env.TRIP_DAILY_BRIEFING_CRON_SECRET;

if (!ANON || !SERVICE) {
  console.error('Defina SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(2);
}
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(API)) {
  console.error(`Recusado: ${API} não é local.`);
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
const svc = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };

async function signUp(tag) {
  const r = await fetch(`${API}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `fn-${tag}-${stamp}@easytrip.test`, password: 'senhaForte123' }),
  });
  const body = await r.json();
  const token = body.access_token;
  const id = body.user?.id;
  if (!token || !id) throw new Error(`signup ${tag} falhou: ${r.status}`);
  return { id, token, headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } };
}

const OWNER = await signUp('owner');
const VIEWER = await signUp('viewer');
const EDITOR = await signUp('editor');

// A viagem é criada pelo dono; o gatilho de 0008 grava o membro `owner`.
const tripRes = await fetch(`${API}/rest/v1/trips`, {
  method: 'POST',
  headers: { ...OWNER.headers, Prefer: 'return=representation' },
  body: JSON.stringify({
    user_id: OWNER.id,
    destination_city: 'Paris',
    destination_country: 'França',
    country_code: 'FR',
    timezone: 'Europe/Paris',
    start_date: '2026-09-01',
    end_date: '2026-09-08',
    budget_total: 1000,
    budget_currency: 'BRL',
  }),
});
const trip = (await tripRes.json())[0];
if (!trip?.id) throw new Error(`criação da viagem falhou: ${tripRes.status}`);

// Membros extras entram por `service_role`: o convite tem fluxo próprio e não é
// o que está sob teste aqui.
await fetch(`${API}/rest/v1/trip_members`, {
  method: 'POST',
  headers: svc,
  body: JSON.stringify([
    { trip_id: trip.id, user_id: VIEWER.id, role: 'viewer' },
    { trip_id: trip.id, user_id: EDITOR.id, role: 'editor' },
  ]),
});

const callSuggestions = async (who, body = { tripId: trip.id }) => {
  const r = await fetch(`${API}/functions/v1/trip-suggestions`, {
    method: 'POST',
    headers: who.headers,
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

console.log('\n--- trip-suggestions ---');

const semSessao = await fetch(`${API}/functions/v1/trip-suggestions`, {
  method: 'POST',
  headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ tripId: trip.id }),
});
check(semSessao.status === 401, `1: sem JWT de usuário → 401 (foi ${semSessao.status})`);

const viewer = await callSuggestions(VIEWER);
check(viewer.status === 403, `2: viewer → 403 (foi ${viewer.status})`);
check(
  typeof viewer.body.error === 'string' && !('suggestions' in viewer.body),
  '3: a recusa do viewer não devolve conteúdo',
);

const owner = await callSuggestions(OWNER);
check(
  owner.status === 503,
  `4: owner passa pelo papel e para na configuração do provedor → 503 (foi ${owner.status})`,
);
check(owner.status !== 403, '5: owner NÃO é recusado por papel');

const editor = await callSuggestions(EDITOR);
check(editor.status === 503, `6: editor também passa pelo papel (foi ${editor.status})`);

// Um estranho não membro não descobre nem que a viagem existe.
const ESTRANHO = await signUp('estranho');
const estranho = await callSuggestions(ESTRANHO);
check(estranho.status === 403, `7: não membro → 403 (foi ${estranho.status})`);

const semTrip = await callSuggestions(OWNER, {});
check(semTrip.status === 400, `8: sem tripId → 400 (foi ${semTrip.status})`);

// O papel é lido do banco, nunca do payload.
const papelForjado = await callSuggestions(VIEWER, { tripId: trip.id, role: 'owner', canEdit: true });
check(papelForjado.status === 403, `9: papel forjado no payload não promove viewer (foi ${papelForjado.status})`);

const metodo = await fetch(`${API}/functions/v1/trip-suggestions`, { method: 'GET', headers: OWNER.headers });
check(metodo.status === 405, `10: GET → 405 (foi ${metodo.status})`);

// A janela de seis horas não pode ter sido consumida: nenhuma chamada acima
// chegou ao claim, porque nenhuma passou da checagem de configuração.
const marca = await fetch(`${API}/rest/v1/trips?id=eq.${trip.id}&select=suggestions_refreshed_at`, { headers: svc });
const [linha] = await marca.json();
check(
  linha?.suggestions_refreshed_at === null,
  '11: nenhuma recusa consumiu a janela de 6 horas',
);

console.log('\n--- trip-daily-briefing ---');

const briefing = async (headers, label) => {
  const r = await fetch(`${API}/functions/v1/trip-daily-briefing`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: '{}',
  });
  return { status: r.status, label };
};

const comumSemSegredo = await briefing({ apikey: ANON, Authorization: `Bearer ${OWNER.token}` });
check(comumSemSegredo.status === 403, `12: JWT comum → 403 (foi ${comumSemSegredo.status})`);

const comumComSegredo = await briefing({
  apikey: ANON,
  Authorization: `Bearer ${OWNER.token}`,
  'x-easy-trip-cron-secret': CRON_SECRET ?? 'qualquer',
});
check(
  comumComSegredo.status === 403,
  `13: JWT comum conhecendo o header do cron → 403 (foi ${comumComSegredo.status})`,
);

const serviceSegredoErrado = await briefing({
  apikey: SERVICE,
  Authorization: `Bearer ${SERVICE}`,
  'x-easy-trip-cron-secret': 'segredo-errado',
});
check(
  serviceSegredoErrado.status === 403,
  `14: service role com segredo errado → 403 (foi ${serviceSegredoErrado.status})`,
);

const serviceSemSegredo = await briefing({ apikey: SERVICE, Authorization: `Bearer ${SERVICE}` });
check(
  serviceSemSegredo.status === 403,
  `15: service role sem o header do cron → 403 (foi ${serviceSemSegredo.status})`,
);

if (CRON_SECRET) {
  const autorizado = await briefing({
    apikey: SERVICE,
    Authorization: `Bearer ${SERVICE}`,
    'x-easy-trip-cron-secret': CRON_SECRET,
  });
  check(
    autorizado.status !== 403 && autorizado.status !== 401,
    `16: cron autorizado passa da barreira (foi ${autorizado.status})`,
  );
} else {
  console.log('  (16 pulado: TRIP_DAILY_BRIEFING_CRON_SECRET não definido no ambiente do teste)');
}

const metodoBriefing = await fetch(`${API}/functions/v1/trip-daily-briefing`, {
  method: 'GET',
  headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
});
check(metodoBriefing.status === 405, `17: GET → 405 (foi ${metodoBriefing.status})`);

// ---- limpeza ----
for (const conta of [OWNER, VIEWER, EDITOR, ESTRANHO]) {
  await fetch(`${API}/auth/v1/admin/users/${conta.id}`, { method: 'DELETE', headers: svc });
}

console.log(`\n=== Functions HTTP: ${passed} verificações OK, ${failures.length} falhas`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
