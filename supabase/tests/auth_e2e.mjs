/**
 * F4 — autenticação e isolamento contra um Supabase de verdade (§14, §15).
 *
 * Nada aqui é simulado: os usuários são criados pelo GoTrue, os JWTs são os que
 * ele emite, e as leituras passam pelo PostgREST — que aplica as policies. É a
 * diferença entre provar que a RLS bloqueia e provar que uma condição SQL é
 * falsa.
 *
 * Roda contra o Supabase LOCAL. Nunca contra o remoto: nenhum usuário de teste
 * é criado em projeto hospedado.
 *
 *   npx supabase start
 *   node supabase/tests/auth_e2e.mjs
 *
 * A chave anônima é lida do ambiente (`npx supabase status -o env`), então
 * nenhum material de autenticação fica escrito neste arquivo.
 */

const API = process.env.SUPABASE_API_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.SUPABASE_ANON_KEY;

if (!ANON) {
  console.error('Defina SUPABASE_ANON_KEY (veja: npx supabase status -o env).');
  process.exit(2);
}

let passed = 0;
const failures = [];

function check(condition, label) {
  if (condition) {
    passed += 1;
    console.log(`  OK   ${label}`);
  } else {
    failures.push(label);
    console.log(`  FALHOU  ${label}`);
  }
}

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function auth(path, body, token) {
  const response = await fetch(`${API}/auth/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

/** Uma chamada ao PostgREST como o aplicativo faria: anon key + JWT do usuário. */
async function rest(path, { token, method = 'GET', body, prefer } = {}) {
  const response = await fetch(`${API}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: response.status, body: parsed };
}

async function signUp(email, password, name) {
  return auth('signup', { email, password, data: { name } });
}

async function signIn(email, password) {
  return auth('token?grant_type=password', { email, password });
}

// =============================================================================
console.log('\n== 1. Cadastro cria conta e perfil ==');

const stamp = unique();
const A = { email: `user-a-${stamp}@easytrip.test`, password: 'senhaForte123', name: 'Ana' };
const B = { email: `user-b-${stamp}@easytrip.test`, password: 'senhaForte456', name: 'Bruno' };

const signUpA = await signUp(A.email, A.password, A.name);
check(signUpA.status === 200, '1: cadastro aceito pelo GoTrue');
check(Boolean(signUpA.body?.user?.id), '2: a conta existe em auth.users');
A.id = signUpA.body?.user?.id;
A.token = signUpA.body?.access_token;

check(Boolean(A.token), '3: cadastro devolve sessão (projeto local sem confirmação de e-mail)');

// O perfil não é criado pelo aplicativo: quem cria é o gatilho `handle_new_user`
// (0001), na mesma transação do cadastro.
const perfilA = await rest(`profiles?select=user_id,name,role`, { token: A.token });
check(perfilA.status === 200 && perfilA.body?.length === 1, '4: o gatilho criou exatamente um perfil');
check(perfilA.body?.[0]?.user_id === A.id, '5: o perfil pertence ao UID autenticado');
check(perfilA.body?.[0]?.name === A.name, '6: o nome veio dos metadados do cadastro');
check(perfilA.body?.[0]?.role === 'user', '7: toda conta nasce como `user`, nunca admin');

// =============================================================================
console.log('\n== 2. Login devolve sessão utilizável ==');

const loginA = await signIn(A.email, A.password);
check(loginA.status === 200 && Boolean(loginA.body?.access_token), '8: login com senha correta');
A.token = loginA.body.access_token;
A.refresh = loginA.body.refresh_token;

const loginErrado = await signIn(A.email, 'senhaErrada999');
check(loginErrado.status === 400, '9: senha errada é recusada');
check(!loginErrado.body?.access_token, '10: senha errada não devolve token');

const semConta = await signIn(`fantasma-${stamp}@easytrip.test`, 'qualquer123');
check(semConta.status === 400 && !semConta.body?.access_token, '11: conta inexistente é recusada');

// =============================================================================
console.log('\n== 3. Dados próprios ==');

const criarViagem = await rest('trips', {
  token: A.token,
  method: 'POST',
  prefer: 'return=representation',
  body: {
    user_id: A.id,
    destination_city: 'Lisboa',
    destination_country: 'Portugal',
    country_code: 'PT',
    timezone: 'Europe/Lisbon',
    start_date: '2026-09-01',
    end_date: '2026-09-10',
  },
});
check(criarViagem.status === 201, '12: A cria a própria viagem');
A.tripId = criarViagem.body?.[0]?.id;

const criarItem = await rest('itinerary_items', {
  token: A.token,
  method: 'POST',
  prefer: 'return=representation',
  body: { trip_id: A.tripId, date: '2026-09-02', type: 'atracao', title: 'Torre de Belém' },
});
check(criarItem.status === 201, '13: A cria um item dentro da própria viagem');

const lerA = await rest('trips?select=id,destination_city', { token: A.token });
check(lerA.status === 200 && lerA.body?.length === 1, '14: A lê a própria viagem');

// =============================================================================
console.log('\n== 4. Isolamento entre USER_A e USER_B ==');

const signUpB = await signUp(B.email, B.password, B.name);
B.id = signUpB.body?.user?.id;
const loginB = await signIn(B.email, B.password);
B.token = loginB.body?.access_token;
check(Boolean(B.token) && B.id !== A.id, '15: B é uma conta distinta, com sessão própria');

const viagensDeB = await rest('trips?select=id', { token: B.token });
check(viagensDeB.status === 200 && viagensDeB.body?.length === 0, '16: B NÃO lê a viagem de A');

const viagemDireta = await rest(`trips?id=eq.${A.tripId}&select=id`, { token: B.token });
check(viagemDireta.body?.length === 0, '17: B NÃO lê a viagem de A nem pedindo pelo id');

const editar = await rest(`trips?id=eq.${A.tripId}`, {
  token: B.token,
  method: 'PATCH',
  prefer: 'return=representation',
  body: { destination_city: 'Sequestrada' },
});
check(
  editar.status === 200 && Array.isArray(editar.body) && editar.body.length === 0,
  '18: B NÃO altera a viagem de A (0 linhas)',
);

const excluir = await rest(`trips?id=eq.${A.tripId}`, {
  token: B.token,
  method: 'DELETE',
  prefer: 'return=representation',
});
check(
  Array.isArray(excluir.body) && excluir.body.length === 0,
  '19: B NÃO exclui a viagem de A (0 linhas)',
);

// A entidade filha é o ponto que costuma escapar: a proteção precisa existir na
// tabela que pendura na viagem, e não só na viagem.
const itensDeB = await rest('itinerary_items?select=id,title', { token: B.token });
check(itensDeB.status === 200 && itensDeB.body?.length === 0, '20: B NÃO lê o itinerário de A');

const injetar = await rest('itinerary_items', {
  token: B.token,
  method: 'POST',
  body: { trip_id: A.tripId, date: '2026-09-03', type: 'outro', title: 'Injetado por B' },
});
check(injetar.status === 403 || injetar.status === 401, '21: B NÃO insere item na viagem de A');

const perfilDeA = await rest(`profiles?user_id=eq.${A.id}&select=user_id`, { token: B.token });
check(perfilDeA.body?.length === 0, '22: B NÃO lê o perfil de A');

// E o inverso, para não confundir isolamento com "B não enxerga nada".
const perfilProprioB = await rest('profiles?select=user_id', { token: B.token });
check(
  perfilProprioB.body?.length === 1 && perfilProprioB.body[0].user_id === B.id,
  '23: B lê o próprio perfil normalmente',
);

const viagemAIntacta = await rest(`trips?id=eq.${A.tripId}&select=destination_city`, {
  token: A.token,
});
check(
  viagemAIntacta.body?.[0]?.destination_city === 'Lisboa',
  '24: depois de tudo, a viagem de A continua intacta',
);

// =============================================================================
console.log('\n== 5. Escalada de privilégio ==');

const promover = await rest(`profiles?user_id=eq.${B.id}`, {
  token: B.token,
  method: 'PATCH',
  prefer: 'return=representation',
  body: { role: 'admin' },
});
check(promover.status >= 400, '25: conta comum NÃO consegue se promover a admin');

const papelDepois = await rest('profiles?select=role', { token: B.token });
check(papelDepois.body?.[0]?.role === 'user', '26: o papel continua `user` depois da tentativa');

// =============================================================================
console.log('\n== 6. Conteúdo editorial (F2/F3 não podem ter regredido) ==');

const ofertas = await rest('offers?select=id,status', { token: A.token });
check(
  ofertas.status === 200 && ofertas.body?.every((o) => o.status === 'published'),
  '27: conta comum lê só oferta publicada',
);

const artigos = await rest('articles?select=status', { token: A.token });
check(
  artigos.status === 200 && artigos.body?.every((a) => a.status === 'published'),
  '28: conta comum NÃO lê rascunho de artigo (P-01)',
);

const escreverOferta = await rest('offers', {
  token: A.token,
  method: 'POST',
  body: { destination: 'Pirata', description: 'x', cost_level: 'economy', image_url: 'https://x/1' },
});
check(escreverOferta.status >= 400, '29: conta comum NÃO escreve conteúdo editorial');

// =============================================================================
console.log('\n== 7. Sem sessão ==');

const semToken = await fetch(`${API}/rest/v1/trips?select=id`, { headers: { apikey: ANON } });
const semTokenBody = await semToken.json().catch(() => null);
check(
  !Array.isArray(semTokenBody) || semTokenBody.length === 0,
  '30: só com a anon key, sem JWT, não se lê viagem nenhuma',
);

const tokenFalso = await rest('trips?select=id', { token: `${A.token}corrompido` });
check(tokenFalso.status === 401, '31: JWT adulterado é recusado');

// =============================================================================
console.log('\n== 8. Logout ==');

const logout = await auth('logout', {}, A.token);
check(logout.status === 204, '32: logout aceito pelo servidor');

const renovar = await auth('token?grant_type=refresh_token', { refresh_token: A.refresh });
check(
  renovar.status >= 400 || !renovar.body?.access_token,
  '33: o refresh token da sessão encerrada não serve mais',
);

// =============================================================================
console.log(`\n${failures.length === 0 ? '=== F4: todos os cenários passaram ===' : '=== FALHAS ==='}`);
console.log(`${passed} verificações OK, ${failures.length} falhas`);
for (const failure of failures) console.log(`  - ${failure}`);
process.exit(failures.length === 0 ? 0 : 1);
