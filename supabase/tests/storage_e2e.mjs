/* global Buffer */
/**
 * F7 — Storage e filtros do PostgREST contra um Supabase de verdade.
 *
 * Fecha P-09 (limites de `attachments` e `journal`), P-04 (bucket `content`) e
 * P-08 (filtro montado por interpolação). Dois usuários reais, JWTs emitidos
 * pelo GoTrue, chamadas diretas ao Storage e ao PostgREST: nenhuma linha de
 * TypeScript do aplicativo participa, então nada do que passa aqui depende de a
 * tela ter chamado a função certa.
 *
 * Roda só contra o Supabase LOCAL.
 *
 *   npx supabase start
 *   node supabase/tests/storage_e2e.mjs
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
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

async function signUp(email) {
  const r = await fetch(`${API}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'senhaForte123' }),
  }).then((x) => x.json());
  return { id: r.user?.id, token: r.access_token };
}

async function upload(path, token, bytes = PNG, contentType = 'image/png', method = 'POST') {
  const r = await fetch(`${API}/storage/v1/object/${path}`, {
    method,
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': contentType },
    body: bytes,
  });
  return { status: r.status, body: await r.text() };
}

async function signUrl(bucket, path, token) {
  const r = await fetch(`${API}/storage/v1/object/sign/${bucket}/${path}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: 60 }),
  });
  return { status: r.status, body: await r.text() };
}

async function removeObject(bucket, path, token) {
  const r = await fetch(`${API}/storage/v1/object/${bucket}/${path}`, {
    method: 'DELETE',
    headers: { apikey: ANON, Authorization: `Bearer ${token}` },
  });
  return r.status;
}

/** Existe mesmo? Serve para não confundir "proibido" com "nunca foi criado". */
async function existsAsService(bucket, path) {
  const r = await fetch(`${API}/storage/v1/object/list/${bucket}`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: path.split('/').slice(0, -1).join('/'), limit: 100 }),
  });
  const rows = await r.json();
  const alvo = path.split('/').pop();
  return Array.isArray(rows) && rows.some((o) => o.name === alvo);
}

const svc = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };

const A = await signUp(`f7-a-${stamp}@easytrip.test`);
const B = await signUp(`f7-b-${stamp}@easytrip.test`);
check(Boolean(A.id && A.token && B.id && B.token), '0: duas contas reais criadas');

const TRIP = '77777777-0000-4000-8000-000000000001';
const ENTRADA = '77777777-0000-4000-8000-000000000002';

// =============================================================================
console.log('\n== §3 P-09: a configuração dos buckets ==');

const buckets = await fetch(`${API}/rest/v1/buckets?select=*`, {
  headers: svc,
}).then(() => null); // PostgREST não expõe `storage`; a conferência real é a do bloco `do $$` da 0007.

const cfg = await fetch(`${API}/storage/v1/bucket`, { headers: svc }).then((r) => r.json());
const porId = Object.fromEntries((Array.isArray(cfg) ? cfg : []).map((b) => [b.id, b]));
void buckets;

check(porId.attachments?.public === false, '1: `attachments` é privado');
check(porId.journal?.public === false, '2: `journal` é privado');
check(porId.avatars?.public === false, '3: `avatars` continua privado (F5)');
check(porId.attachments?.file_size_limit === 10485760, '4: `attachments` limitado a 10 MB');
check(porId.journal?.file_size_limit === 10485760, '5: `journal` limitado a 10 MB');
check(
  (porId.attachments?.allowed_mime_types ?? []).includes('application/pdf'),
  '6: `attachments` aceita PDF — é como a companhia aérea entrega o bilhete',
);
check(
  !(porId.journal?.allowed_mime_types ?? []).includes('application/pdf'),
  '7: `journal` NÃO aceita PDF — a galeria só renderiza imagem',
);
check(
  !(porId.attachments?.allowed_mime_types ?? []).includes('application/octet-stream'),
  '8: nenhum bucket privado aceita o curinga `application/octet-stream`',
);

// =============================================================================
console.log('\n== §15 A–J: attachments, USER_A contra USER_B ==');

const pathA = `${A.id}/${TRIP}/f7-a.pdf`;
const pathB = `${B.id}/${TRIP}/f7-b.pdf`;

check((await upload(`attachments/${pathA}`, A.token, PDF, 'application/pdf')).status === 200, 'A: A sobe o próprio PDF');
check((await upload(`attachments/${pathB}`, B.token, PDF, 'application/pdf')).status === 200, 'B: B sobe o próprio PDF');

// §16 — antes de acreditar em qualquer "proibido", provar que o alvo existe.
check(await existsAsService('attachments', pathB), 'B2: o arquivo de B existe mesmo (senão o resto passaria por vacuidade)');

check((await signUrl('attachments', pathA, A.token)).status === 200, 'C: A assina o próprio arquivo');
check((await signUrl('attachments', pathB, A.token)).status >= 400, 'D: A NÃO consegue assinar o arquivo de B');
check((await upload(`attachments/${pathB}`, A.token, PDF, 'application/pdf', 'PUT')).status >= 400, 'E: A NÃO sobrescreve o arquivo de B');
check((await removeObject('attachments', pathB, A.token)) >= 400, 'F: A NÃO remove o arquivo de B');
check(await existsAsService('attachments', pathB), 'F2: e o arquivo de B continua lá depois das três tentativas');

const grande = Buffer.alloc(10 * 1024 * 1024 + 1024, 0x41);
check(
  (await upload(`attachments/${A.id}/${TRIP}/grande.pdf`, A.token, grande, 'application/pdf')).status >= 400,
  'G: acima de 10 MB é recusado pelo servidor',
);
check(
  (await upload(`attachments/${A.id}/${TRIP}/malicioso.exe`, A.token, PDF, 'application/x-msdownload')).status >= 400,
  'H: tipo fora da lista é recusado pelo servidor',
);
check(
  (await upload(`attachments/${A.id}/${TRIP}/qualquer.bin`, A.token, PDF, 'application/octet-stream')).status >= 400,
  'H2: `application/octet-stream` também é recusado',
);

// §7 — caminho forjado.
check(
  (await upload(`attachments/${B.id}/${TRIP}/forjado.pdf`, A.token, PDF, 'application/pdf')).status >= 400,
  'I: A escrevendo sob o prefixo de B é recusado',
);
check(
  (await upload(`attachments/forjado.pdf`, A.token, PDF, 'application/pdf')).status >= 400,
  'I2: caminho sem prefixo de usuário é recusado',
);
check(
  (await upload(`attachments/${A.id}/../${B.id}/travessia.pdf`, A.token, PDF, 'application/pdf')).status >= 400 ||
    !(await existsAsService('attachments', `${B.id}/travessia.pdf`)),
  'I3: `../` não leva o arquivo para a pasta de B',
);
check(
  (await upload(`avatars/${A.id}/documento.pdf`, A.token, PDF, 'application/pdf')).status >= 400,
  'I4: PDF no bucket de avatares é recusado — cada bucket com sua lista',
);

check(
  (await upload(`attachments/${A.id}/${TRIP}/valido.jpg`, A.token, PNG, 'image/jpeg')).status === 200,
  'J: a operação legítima continua funcionando',
);

// =============================================================================
console.log('\n== §5 journal: mesma bateria, política mais estreita ==');

const jA = `${A.id}/${ENTRADA}/foto-a.png`;
const jB = `${B.id}/${ENTRADA}/foto-b.png`;

check((await upload(`journal/${jA}`, A.token, PNG, 'image/png')).status === 200, 'K: A sobe a própria foto');
check((await upload(`journal/${jB}`, B.token, PNG, 'image/png')).status === 200, 'L: B sobe a própria foto');
check(await existsAsService('journal', jB), 'L2: a foto de B existe mesmo');
check((await signUrl('journal', jA, A.token)).status === 200, 'M: A assina a própria foto');
check((await signUrl('journal', jB, A.token)).status >= 400, 'N: A NÃO assina a foto de B');
check((await removeObject('journal', jB, A.token)) >= 400, 'O: A NÃO remove a foto de B');
check(await existsAsService('journal', jB), 'O2: e ela continua lá');
check(
  (await upload(`journal/${A.id}/${ENTRADA}/doc.pdf`, A.token, PDF, 'application/pdf')).status >= 400,
  'P: PDF no diário é recusado pelo servidor, não só pela tela',
);
check(
  (await upload(`journal/${B.id}/${ENTRADA}/forjado.png`, A.token, PNG, 'image/png')).status >= 400,
  'Q: A escrevendo sob o prefixo de B é recusado',
);

// =============================================================================
console.log('\n== §4 P-04: o bucket `content` ==');

check(porId.content?.public === true, 'R: `content` existe e é público — é imagem editorial, não dado de ninguém');
check(porId.content?.file_size_limit === 5242880, 'S: limitado a 5 MB');
check(
  !(porId.content?.allowed_mime_types ?? []).includes('application/pdf'),
  'T: só imagem',
);

const capa = `articles/${ENTRADA}/capa.png`;
check((await upload(`content/${capa}`, A.token, PNG, 'image/png')).status >= 400, 'U: conta comum NÃO escreve no bucket público');
check(!(await existsAsService('content', capa)), 'U2: e nada foi gravado');

// Promoção pelo caminho documentado na 0003: fora de sessão, com privilégio.
await fetch(`${API}/rest/v1/profiles?user_id=eq.${A.id}`, {
  method: 'PATCH',
  headers: { ...svc, Prefer: 'return=representation' },
  body: JSON.stringify({ role: 'admin' }),
});
// O JWT antigo continua valendo — `is_admin()` lê a tabela, não o token.
check((await upload(`content/${capa}`, A.token, PNG, 'image/png')).status === 200, 'V: administração escreve');
check(await existsAsService('content', capa), 'V2: e o arquivo está lá');

const publica = await fetch(`${API}/storage/v1/object/public/content/${capa}`);
check(publica.status === 200, 'W: a imagem editorial abre sem sessão nenhuma — é o que "público" significa');

const privadaSemSessao = await fetch(`${API}/storage/v1/object/public/attachments/${pathA}`);
check(privadaSemSessao.status >= 400, 'X: e o bucket privado continua fechado pela mesma rota pública');

check(
  (await upload(`content/${ENTRADA}/x.pdf`, A.token, PDF, 'application/pdf')).status >= 400,
  'Y: nem a administração sobe PDF no bucket de imagem',
);

// Devolve A ao papel comum, para o resto do arquivo não medir um admin.
await fetch(`${API}/rest/v1/profiles?user_id=eq.${A.id}`, {
  method: 'PATCH',
  headers: svc,
  body: JSON.stringify({ role: 'user' }),
});
check((await upload(`content/${ENTRADA}/depois.png`, A.token, PNG, 'image/png')).status >= 400, 'Z: rebaixado, deixa de escrever');

// =============================================================================
console.log('\n== §10 P-08: o filtro do PostgREST ==');

const artigos = [
  {
    id: '0e000000-0000-4000-8000-0000000000a1',
    slug: `publicado-${stamp}`,
    title: 'Publicado',
    category: 'Dicas',
    author_name: 'Equipe',
    content: 'x'.repeat(80),
    published_at: '2026-01-01T00:00:00Z',
    estimated_read_minutes: 3,
    status: 'published',
  },
  {
    id: '0e000000-0000-4000-8000-0000000000a2',
    slug: `rascunho-${stamp}`,
    title: 'Rascunho',
    category: 'Dicas',
    author_name: 'Equipe',
    content: 'x'.repeat(80),
    published_at: '2026-01-01T00:00:00Z',
    estimated_read_minutes: 3,
    status: 'draft',
  },
];
const semeado = await fetch(`${API}/rest/v1/articles`, {
  method: 'POST',
  headers: { ...svc, Prefer: 'resolution=merge-duplicates' },
  body: JSON.stringify(artigos),
});
check(semeado.status === 201, `AA: os dois artigos de teste foram criados (HTTP ${semeado.status})`);

const comoAntes = (valor) => {
  const u = new URL(`${API}/rest/v1/articles`);
  u.searchParams.set('select', 'id,slug,status');
  u.searchParams.append('or', `(id.eq.${valor},slug.eq.${valor})`);
  return u;
};
const comoAgora = (valor) => {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(valor);
  const u = new URL(`${API}/rest/v1/articles`);
  u.searchParams.set('select', 'id,slug,status');
  u.searchParams.set(uuid ? 'id' : 'slug', `eq.${valor}`);
  return u;
};
const comoAdmin = (u) => fetch(u, { headers: svc }).then(async (r) => ({ status: r.status, body: await r.json() }));

// A demonstração do defeito: com o filtro antigo e sem RLS no caminho, uma
// carga na rota traz um rascunho que ninguém pediu.
const CARGA = '00000000-0000-4000-8000-000000000000,status.eq.draft';
const antes = await comoAdmin(comoAntes(CARGA));
check(
  antes.status === 200 && antes.body.some((a) => a.status === 'draft'),
  'AB: o filtro ANTIGO, sem RLS, devolve rascunho a partir de uma carga na rota — o defeito existe',
);

const agora = await comoAdmin(comoAgora(CARGA));
check(
  agora.status === 200 && agora.body.length === 0,
  'AC: o filtro NOVO, com a mesma carga e o mesmo privilégio, não devolve nada',
);

// E o slug — que com o filtro antigo nunca funcionou, porque `id.eq.<texto>`
// estoura o cast de uuid e derruba a consulta inteira.
const slugAntes = await comoAdmin(comoAntes(artigos[0].slug));
check(slugAntes.status === 400, `AD: o filtro ANTIGO quebrava com slug (HTTP ${slugAntes.status}, 22P02)`);

const slugAgora = await comoAdmin(comoAgora(artigos[0].slug));
check(
  slugAgora.status === 200 && slugAgora.body[0]?.slug === artigos[0].slug,
  'AE: o filtro NOVO abre o artigo por slug — passou a funcionar',
);

const buscaPorId = await comoAdmin(comoAgora(artigos[0].id));
check(buscaPorId.body[0]?.id === artigos[0].id, 'AF: e por id também');

// A camada de baixo continua de pé: mesmo com o filtro antigo, sessão comum não
// via rascunho. É o P-01, corrigido na F2 — e é o motivo de o P-08 ser Baixo.
const comoUsuario = await fetch(comoAntes(CARGA), {
  headers: { apikey: ANON, Authorization: `Bearer ${B.token}` },
}).then((r) => r.json());
check(
  Array.isArray(comoUsuario) && comoUsuario.length === 0,
  'AG: e a policy `articles_read` (P-01) segurava mesmo o filtro antigo — a defesa é em camadas',
);

// =============================================================================
console.log('\n== §9 busca de lugares: mesma classe, valor digitado ==');

const lugares = [
  { id: '0a000000-0000-4000-8000-0000000000b1', name: `Hotel 50% Off ${stamp}`, type: 'hotel', city: 'Lisboa', country: 'PT' },
  { id: '0a000000-0000-4000-8000-0000000000b2', name: `Bar a_b ${stamp}`, type: 'restaurant', city: 'Porto', country: 'PT' },
  // O par que discrimina: `aXb` casa com o curinga `a_b`, mas não com o `a_b`
  // literal. Sem esta linha, "escapado" e "não escapado" devolveriam o mesmo
  // resultado e a asserção passaria sem provar nada.
  { id: '0a000000-0000-4000-8000-0000000000b3', name: `Cafe aXb ${stamp}`, type: 'restaurant', city: 'Faro', country: 'PT' },
];
const semeadoL = await fetch(`${API}/rest/v1/places`, {
  method: 'POST',
  headers: { ...svc, Prefer: 'resolution=merge-duplicates' },
  body: JSON.stringify(lugares),
});
check(semeadoL.status === 201, `AH: os três lugares de teste foram criados (HTTP ${semeadoL.status})`);

// Conta só as linhas deste teste. O diretório tem o catálogo semeado, e uma
// asserção sobre o total mediria o seed junto — passaria ou falharia por
// motivos que não têm nada a ver com o escape.
const busca = async (filtro) => {
  const u = new URL(`${API}/rest/v1/places`);
  u.searchParams.set('select', 'name');
  u.searchParams.append('or', `(name.ilike.${filtro},city.ilike.${filtro})`);
  const r = await fetch(u, { headers: svc });
  const linhas = await r.json();
  return Array.isArray(linhas) ? linhas.filter((l) => l.name.endsWith(stamp)) : [];
};
const quote = (v) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const likeContains = (t) => quote(`%${t.replace(/([\\%_])/g, '\\$1')}%`);

check((await busca(likeContains('a_b'))).length === 1, 'AI: `_` digitado casa só com o `_` literal, não com qualquer caractere');
check((await busca(quote('%a_b%'))).length === 2, 'AI2: sem o escape, `a_b` também casaria com `aXb` — o escape é o que decide');
check((await busca(likeContains('50%Off'))).length === 0, 'AJ: `%` digitado é literal — não casa com "50% Off"');
check((await busca(quote('%50%Off%'))).length === 1, 'AJ2: sem o escape, casaria — de novo, o escape é o que decide');
check((await busca(likeContains('zznaoexiste'))).length === 0, 'AK: controle — termo inexistente devolve vazio');
check((await busca(likeContains(`Hotel 50% Off ${stamp}`))).length === 1, 'AL: e a busca legítima pelo nome inteiro funciona');

// =============================================================================
// Limpeza.
for (const [bucket, caminho] of [
  ['attachments', pathA], ['attachments', pathB], ['attachments', `${A.id}/${TRIP}/valido.jpg`],
  ['journal', jA], ['journal', jB], ['content', capa],
]) {
  await fetch(`${API}/storage/v1/object/${bucket}/${caminho}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
}
await fetch(`${API}/rest/v1/articles?id=in.(${artigos.map((a) => a.id).join(',')})`, { method: 'DELETE', headers: svc });
await fetch(`${API}/rest/v1/places?id=in.(${lugares.map((l) => l.id).join(',')})`, { method: 'DELETE', headers: svc });

console.log(`\n${failures.length === 0 ? '=== F7: Storage e filtros ===' : '=== FALHAS ==='}`);
console.log(`${passed} verificações OK, ${failures.length} falhas`);
for (const f of failures) console.log(`  - ${f}`);
process.exit(failures.length === 0 ? 0 : 1);
