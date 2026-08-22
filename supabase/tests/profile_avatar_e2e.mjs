/* global Buffer */
/**
 * F5 — perfil e avatar contra um Supabase de verdade (§20, §21, §22).
 *
 * Dois usuários reais, JWTs emitidos pelo GoTrue, chamadas ao PostgREST e ao
 * Storage. O que se mede aqui é a autorização do servidor: nenhuma linha de
 * TypeScript do aplicativo participa, então nada do que passa depende de a tela
 * ter chamado a função certa.
 *
 * Roda só contra o Supabase LOCAL.
 *
 *   npx supabase start
 *   node supabase/tests/profile_avatar_e2e.mjs
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

/** PNG 1×1 de verdade, para o Storage ter o que inspecionar. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function signUp(email, name) {
  const response = await fetch(`${API}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'senhaForte123', data: { name } }),
  }).then((r) => r.json());
  return { id: response.user?.id, token: response.access_token, email };
}

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

async function upload(path, token, bytes = PNG, contentType = 'image/png', method = 'POST') {
  const response = await fetch(`${API}/storage/v1/object/${path}`, {
    method,
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': contentType },
    body: bytes,
  });
  return response.status;
}

async function listAs(prefix, bucket = 'avatars') {
  return fetch(`${API}/storage/v1/object/list/${bucket}`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix, limit: 100 }),
  }).then((r) => r.json());
}

const A = await signUp(`f5-a-${stamp}@easytrip.test`, 'Ana');
const B = await signUp(`f5-b-${stamp}@easytrip.test`, 'Bruno');
check(Boolean(A.id && A.token && B.id && B.token), '0: duas contas reais criadas');

// =============================================================================
console.log('\n== §20 Escalação de privilégio ==');

const promocao = await rest(`profiles?user_id=eq.${A.id}`, {
  token: A.token,
  method: 'PATCH',
  prefer: 'return=representation',
  body: { role: 'admin' },
});
check(promocao.status >= 400, `1: PATCH role=admin recusado (HTTP ${promocao.status})`);

// A parte que engana: `role` escondido no meio de campos legítimos. Se o UPDATE
// fosse parcialmente aplicado, o nome mudaria e a promoção falharia em silêncio.
const disfarcada = await rest(`profiles?user_id=eq.${A.id}`, {
  token: A.token,
  method: 'PATCH',
  prefer: 'return=representation',
  body: { name: 'Ana Hacker', role: 'admin' },
});
check(disfarcada.status >= 400, '2: nome + role na mesma requisição também é recusado');

const depois = await rest('profiles?select=name,role', { token: A.token });
check(depois.body?.[0]?.role === 'user', '3: o papel continua `user`');
check(depois.body?.[0]?.name === 'Ana', '4: e o nome não foi alterado junto — nada passou');

const admin1 = await rest('offers', {
  token: A.token,
  method: 'POST',
  body: { destination: 'Pirata', description: 'x', cost_level: 'economy', image_url: 'https://x/1' },
});
check(admin1.status >= 400, `5: operação administrativa segue negada (HTTP ${admin1.status})`);

const admin2 = await rest('articles?select=id&status=eq.draft', { token: A.token });
check(
  Array.isArray(admin2.body) && admin2.body.length === 0,
  '6: e continua sem enxergar rascunho — `is_admin()` é falso',
);

const trocaId = await rest(`profiles?user_id=eq.${A.id}`, {
  token: A.token,
  method: 'PATCH',
  body: { user_id: B.id },
});
check(trocaId.status >= 400, '7: não consegue assumir o `user_id` de outra conta');

// =============================================================================
console.log('\n== §21 RLS do perfil ==');

const proprio = await rest('profiles?select=user_id,name', { token: A.token });
check(proprio.body?.length === 1 && proprio.body[0].user_id === A.id, '8: A lê o próprio perfil');

const edicao = await rest(`profiles?user_id=eq.${A.id}`, {
  token: A.token,
  method: 'PATCH',
  prefer: 'return=representation',
  body: { name: 'Ana Beatriz', phone: '+55 11 90000-0000', default_currency: 'EUR', travel_style: 'aventura' },
});
check(edicao.status === 200 && edicao.body?.[0]?.name === 'Ana Beatriz', '9: A edita os campos permitidos');
check(edicao.body?.[0]?.default_currency === 'EUR', '10: a moeda preferida persiste');
check(edicao.body?.[0]?.travel_style === 'aventura', '11: o estilo de viagem persiste');
check(edicao.body?.[0]?.phone === '+55 11 90000-0000', '12: o telefone persiste');

const alheio = await rest(`profiles?user_id=eq.${B.id}&select=user_id,name`, { token: A.token });
check(alheio.body?.length === 0, '13: A NÃO lê o perfil de B');

const edicaoAlheia = await rest(`profiles?user_id=eq.${B.id}`, {
  token: A.token,
  method: 'PATCH',
  prefer: 'return=representation',
  body: { name: 'Sequestrado' },
});
check(
  Array.isArray(edicaoAlheia.body) && edicaoAlheia.body.length === 0,
  '14: A NÃO edita o perfil de B (0 linhas)',
);

const bIntacto = await rest('profiles?select=name', { token: B.token });
check(bIntacto.body?.[0]?.name === 'Bruno', '15: o perfil de B continua como estava');

const listaGeral = await rest('profiles?select=user_id', { token: B.token });
check(listaGeral.body?.length === 1, '16: B enxerga um perfil só — o dele');

// =============================================================================
console.log('\n== §22 Storage do avatar ==');

// A — namespace próprio
check(await upload(`avatars/${A.id}/avatar-1.png`, A.token) === 200, 'A: A envia avatar para a própria pasta');

// B — namespace alheio
const foraDaPasta = await upload(`avatars/${B.id}/invasao.png`, A.token);
check(foraDaPasta >= 400, `B: A NÃO envia para a pasta de B (HTTP ${foraDaPasta})`);

// Caminho relativo tentando escapar do prefixo.
const travessia = await upload(`avatars/${A.id}/../${B.id}/travessia.png`, A.token);
check(travessia >= 400, `B2: `.concat(`caminho com ../ é recusado (HTTP ${travessia})`));

// C — sobrescrever o avatar de B
check(await upload(`avatars/${B.id}/avatar-b.png`, B.token) === 200, 'preparo: B tem o próprio avatar');
const sobrescrita = await upload(`avatars/${B.id}/avatar-b.png`, A.token, PNG, 'image/png', 'PUT');
check(sobrescrita >= 400, `C: A NÃO sobrescreve o avatar de B (HTTP ${sobrescrita})`);

// D — remover o avatar de B
const remocao = await fetch(`${API}/storage/v1/object/avatars/${B.id}/avatar-b.png`, {
  method: 'DELETE',
  headers: { apikey: ANON, Authorization: `Bearer ${A.token}` },
});
check(remocao.status >= 400, `D: A NÃO remove o avatar de B (HTTP ${remocao.status})`);
const bAindaTem = await listAs(`${B.id}/`);
check(
  Array.isArray(bAindaTem) && bAindaTem.some((o) => o.name === 'avatar-b.png'),
  'D2: o avatar de B continua no bucket',
);

// E/F — substituir o próprio avatar sem deixar lixo.
// A ordem (subir → apontar → remover a anterior) é do repositório e está coberta
// em `tests/unit/profile-avatar.test.ts`; aqui se prova que o servidor deixa
// cada passo acontecer e que o resultado final é uma pasta com um arquivo só.
check(await upload(`avatars/${A.id}/avatar-2.png`, A.token) === 200, 'E: A envia a foto nova');
await rest(`profiles?user_id=eq.${A.id}`, {
  token: A.token,
  method: 'PATCH',
  body: { avatar_path: `${A.id}/avatar-2.png` },
});
const removeuAntiga = await fetch(`${API}/storage/v1/object/avatars/${A.id}/avatar-1.png`, {
  method: 'DELETE',
  headers: { apikey: ANON, Authorization: `Bearer ${A.token}` },
});
check(removeuAntiga.status === 200, 'E2: A remove a própria foto anterior');

const pastaDeA = await listAs(`${A.id}/`);
check(
  Array.isArray(pastaDeA) && pastaDeA.length === 1 && pastaDeA[0].name === 'avatar-2.png',
  'F: sobrou exatamente um arquivo na pasta de A — sem órfão',
);

// G — o caminho gravado precisa existir de fato.
const perfilDeA = await rest('profiles?select=avatar_path', { token: A.token });
check(
  perfilDeA.body?.[0]?.avatar_path === `${A.id}/avatar-2.png`,
  'G: o perfil aponta para o arquivo que existe no bucket',
);

// H — tipo não permitido, barrado pelo próprio bucket (0006)
const pdf = await upload(`avatars/${A.id}/documento.pdf`, A.token, Buffer.from('%PDF-1.4'), 'application/pdf');
check(pdf >= 400, `H: tipo fora da lista é recusado pelo bucket (HTTP ${pdf})`);

// I — acima do limite de 5 MB (0006)
const grande = Buffer.alloc(6 * 1024 * 1024, 1);
const excedeu = await upload(`avatars/${A.id}/enorme.png`, A.token, grande, 'image/png');
check(excedeu >= 400, `I: arquivo acima de 5 MB é recusado pelo bucket (HTTP ${excedeu})`);

// J — a foto continua acessível por URL assinada depois de reler o perfil.
const assinada = await fetch(`${API}/storage/v1/object/sign/avatars/${A.id}/avatar-2.png`, {
  method: 'POST',
  headers: { apikey: ANON, Authorization: `Bearer ${A.token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ expiresIn: 3600 }),
}).then((r) => r.json());
check(Boolean(assinada?.signedURL), 'J: o dono gera URL assinada da própria foto');

const baixada = await fetch(`${API}/storage/v1${assinada?.signedURL ?? ''}`);
check(baixada.status === 200, 'J2: a URL assinada realmente entrega a imagem');

// E o bucket continua privado: sem assinatura, não se baixa.
const semAssinatura = await fetch(`${API}/storage/v1/object/public/avatars/${A.id}/avatar-2.png`);
check(semAssinatura.status >= 400, 'J3: o bucket é privado — sem assinatura não há leitura');

// A URL assinada de A não deve servir para pedir a foto de B.
const assinadaAlheia = await fetch(`${API}/storage/v1/object/sign/avatars/${B.id}/avatar-b.png`, {
  method: 'POST',
  headers: { apikey: ANON, Authorization: `Bearer ${A.token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ expiresIn: 3600 }),
});
check(assinadaAlheia.status >= 400, 'J4: A não consegue assinar a foto de B');

console.log(`\n${failures.length === 0 ? '=== F5: todos os cenários passaram ===' : '=== FALHAS ==='}`);
console.log(`${passed} verificações OK, ${failures.length} falhas`);
for (const failure of failures) console.log(`  - ${failure}`);
process.exit(failures.length === 0 ? 0 : 1);
