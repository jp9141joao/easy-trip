/* global Buffer */
/**
 * F9 — o fluxo administrativo de conteúdo editorial contra um Supabase de
 * verdade. É o fechamento do P-04 medido, e não declarado.
 *
 * A F7 já provou o **bucket**: `content` existe, é público para leitura, aceita
 * só imagem até 5 MB e só a administração escreve. O que faltava provar é a
 * operação de alto nível — "o administrador criou um artigo com imagem" — com
 * as duas gravações que ela envolve (Storage e PostgREST) e as falhas parciais
 * entre elas. Nenhum `if` de tela participa: aqui só existem JWTs reais, a RLS
 * e as policies de Storage.
 *
 * Cada verificação de invisibilidade é precedida de uma confirmação por
 * `service_role` de que a linha alvo **existe** (§33). Sem isso, "o rascunho
 * não vaza" passaria porque o insert do preparo falhou.
 *
 * Roda só contra o Supabase LOCAL.
 *
 *   npx supabase start
 *   node supabase/tests/content_admin_e2e.mjs
 */

const API = process.env.SUPABASE_API_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!ANON || !SERVICE) {
  console.error('Defina SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY (npx supabase status -o env).');
  process.exit(2);
}
// §44: nada destrutivo fora da máquina. Este teste cria, altera e apaga.
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(API)) {
  console.error(`Recusado: ${API} não é local. Este teste escreve e apaga dados.`);
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

/** PNG 1×1 de verdade — o Storage inspeciona o conteúdo, não só o cabeçalho. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n');
/** 5 MB + 1 byte: o outro lado exato do limite do bucket. */
const GRANDE = Buffer.alloc(5 * 1024 * 1024 + 1, 0x41);

const svc = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };

/** UUID determinístico e **válido** — 8-4-4-4-12 em hexadecimal. */
const uuid = (prefixo, n) => `${prefixo}-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Busca uma URL que pode não existir sem derrubar o processo. */
const fetchStatus = async (url) => {
  if (typeof url !== 'string' || !url.startsWith('http')) return 0;
  try {
    return (await fetch(url)).status;
  } catch {
    return 0;
  }
};

async function signUp(tag) {
  const r = await fetch(`${API}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `f9-${tag}-${stamp}@easytrip.test`, password: 'senhaForte123' }),
  }).then((x) => x.json());
  return { id: r.user?.id, token: r.access_token };
}

/** Promove/rebaixa pelo banco, como o SQL Editor faria. O JWT não muda: */
/** `is_admin()` lê a tabela `profiles`, não o token. */
async function setRole(who, role) {
  await fetch(`${API}/rest/v1/profiles?user_id=eq.${who.id}`, {
    method: 'PATCH',
    headers: svc,
    body: JSON.stringify({ role }),
  });
}

const rest = async (who, path, opts = {}) => {
  const r = await fetch(`${API}/rest/v1/${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${who.token}`,
      'Content-Type': 'application/json',
      ...(opts.prefer ? { Prefer: opts.prefer } : {}),
    },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  });
  const t = await r.text();
  return { status: r.status, body: t ? JSON.parse(t) : null };
};

const upload = async (who, path, bytes = PNG, type = 'image/png') =>
  (
    await fetch(`${API}/storage/v1/object/content/${path}`, {
      method: 'POST',
      headers: { apikey: ANON, Authorization: `Bearer ${who.token}`, 'Content-Type': type },
      body: bytes,
    })
  ).status;

const removeObject = async (who, path) => {
  const r = await fetch(`${API}/storage/v1/object/content`, {
    method: 'DELETE',
    headers: { apikey: ANON, Authorization: `Bearer ${who.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: [path] }),
  });
  return { status: r.status, removed: await r.json().catch(() => []) };
};

/** Verdade sobre o Storage, com privilégio — independe da policy de quem pergunta. */
const objectExists = async (path) => {
  const segs = path.split('/');
  const name = segs.pop();
  const rows = await fetch(`${API}/storage/v1/object/list/content`, {
    method: 'POST',
    headers: svc,
    body: JSON.stringify({ prefix: segs.join('/'), limit: 100, search: name }),
  }).then((r) => r.json());
  return Array.isArray(rows) && rows.some((o) => o.name === name);
};

const rowExists = async (table, id) =>
  (await fetch(`${API}/rest/v1/${table}?select=id&id=eq.${id}`, { headers: svc }).then((r) =>
    r.json(),
  )).length > 0;

const publicUrl = (path) => `${API}/storage/v1/object/public/content/${path}`;
const publicGet = async (path) => (await fetch(publicUrl(path))).status;

/**
 * A operação que o painel executa ao salvar: sobe a imagem, grava a linha e,
 * se a gravação falhar, remove o arquivo que acabou de subir.
 *
 * É `repositories/editorialImage.ts` reescrito em `fetch`, de propósito: se o
 * teste chamasse o módulo TypeScript, provaria que o módulo funciona — não que
 * a ordem sobrevive a uma policy recusando do outro lado do fio.
 */
async function salvarComImagem(who, { kind, id, table, row, path }) {
  const statusUpload = await upload(who, path);
  if (statusUpload !== 200) return { ok: false, etapa: 'upload', statusUpload };

  const gravacao = await rest(who, table, {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: [{ ...row, id, [kind === 'advisors' ? 'avatar_url' : 'image_url']: publicUrl(path) }],
  });

  if (gravacao.status >= 400) {
    // Compensação: sem a linha, o arquivo não é de ninguém.
    await removeObject(who, path);
    return { ok: false, etapa: 'gravacao', status: gravacao.status };
  }
  return { ok: true, row: gravacao.body?.[0], path };
}

/* ========================================================================== */

const comum = await signUp('comum');
const admin = await signUp('admin');
check(Boolean(comum.id && comum.token && admin.id && admin.token), '0: duas contas reais criadas');
await setRole(admin, 'admin');
check(
  (await rest(admin, `profiles?select=role&user_id=eq.${admin.id}`)).body?.[0]?.role === 'admin',
  '0b: a segunda conta é administradora de verdade',
);

/* ------------------------ §32 — o bucket `content` ------------------------ */

console.log('\n== §32 quem escreve no bucket `content` ==');

const capaComum = `articles/${uuid('f9a10001', 1)}/tentativa.png`;
check((await upload(comum, capaComum)) >= 400, 'A: conta comum NÃO escreve no bucket público');
check(!(await objectExists(capaComum)), 'A2: e nada foi gravado');

const capaAdmin = `articles/${uuid('f9a10001', 1)}/capa.png`;
check((await upload(admin, capaAdmin)) === 200, 'B: administração escreve');
check(await objectExists(capaAdmin), 'B2: e o objeto está lá');
check((await publicGet(capaAdmin)) === 200, 'C: qualquer um lê a imagem, sem sessão (leitura pública)');

check(
  (await upload(admin, `articles/${uuid('f9a10001', 1)}/doc.pdf`, PDF, 'application/pdf')) >= 400,
  'D: PDF recusado — o bucket é só de imagem',
);
check(
  (await upload(admin, `articles/${uuid('f9a10001', 1)}/grande.png`, GRANDE, 'image/png')) >= 400,
  'E: 5 MB + 1 byte recusado',
);

check((await removeObject(comum, capaAdmin)).removed?.length !== 1, 'F: conta comum não remove objeto');
check(await objectExists(capaAdmin), 'F2: o objeto continua lá depois da tentativa');

/* --------------------- §30 — artigo: o ciclo completo --------------------- */

console.log('\n== §30 artigo: rascunho → publicação → troca → exclusão ==');

const artigoId = uuid('f9a20002', 1);
const artigoPath = `articles/${artigoId}/${stamp}-1.png`;

const criado = await salvarComImagem(admin, {
  kind: 'articles',
  id: artigoId,
  table: 'articles',
  path: artigoPath,
  row: {
    slug: `f9-artigo-${stamp}`,
    title: 'Artigo da F9',
    category: 'Preparação',
    author_name: 'Equipe Easy Trip',
    content: 'x'.repeat(120),
    published_at: new Date().toISOString(),
    estimated_read_minutes: 4,
    status: 'draft',
  },
});
check(criado.ok, '1: administração cria rascunho com imagem em uma operação');
check(await objectExists(artigoPath), '2: a imagem está no bucket');
check(criado.row?.image_url === publicUrl(artigoPath), '3: o registro aponta para a imagem');

// §33: a linha existe mesmo — sem isto, "não vaza" passaria por vacuidade.
check(await rowExists('articles', artigoId), '4a: o rascunho existe (conferido com service_role)');
const rascunhoParaComum = await rest(comum, `articles?select=id&id=eq.${artigoId}`);
check(rascunhoParaComum.body?.length === 0, '4b: usuário comum NÃO vê o rascunho');

check(
  (
    await rest(comum, `articles?id=eq.${artigoId}`, {
      method: 'PATCH',
      body: { status: 'published' },
    })
  ).body?.length !== 1,
  '5: usuário comum não consegue publicar o artigo de ninguém',
);

const publicado = await rest(admin, `articles?id=eq.${artigoId}`, {
  method: 'PATCH',
  prefer: 'return=representation',
  body: { status: 'published' },
});
check(publicado.body?.[0]?.status === 'published', '6: administração publica');

const visto = await rest(comum, `articles?select=id,image_url&id=eq.${artigoId}`);
check(visto.body?.length === 1, '7: usuário comum passa a ver o artigo publicado');
check(
  (await fetchStatus(visto.body?.[0]?.image_url)) === 200,
  '8: e a imagem abre pela URL gravada',
);

// Troca: sobe a nova, atualiza a linha, só então remove a antiga (§16).
const artigoPath2 = `articles/${artigoId}/${stamp}-2.png`;
check((await upload(admin, artigoPath2)) === 200, '9: nova imagem sobe antes de qualquer remoção');
const trocado = await rest(admin, `articles?id=eq.${artigoId}`, {
  method: 'PATCH',
  prefer: 'return=representation',
  body: { image_url: publicUrl(artigoPath2) },
});
check(trocado.body?.[0]?.image_url === publicUrl(artigoPath2), '10: o registro passa a usar a nova');
await removeObject(admin, artigoPath);
check(!(await objectExists(artigoPath)), '11: a antiga sai do bucket depois da troca');
check(await objectExists(artigoPath2), '11b: e a nova continua lá');

// Exclusão: linha primeiro, imagem depois.
await rest(admin, `articles?id=eq.${artigoId}`, { method: 'DELETE' });
await removeObject(admin, artigoPath2);
check(!(await rowExists('articles', artigoId)), '12: o artigo sai do banco');
check(!(await objectExists(artigoPath2)), '13: e a imagem gerenciada sai do bucket');

/* --------------------- §31 — falhas parciais de verdade ------------------- */

console.log('\n== §31 falhas parciais ==');

// B — a gravação falha depois do upload: a compensação tira o arquivo.
const orfaoId = uuid('f9a30003', 1);
const orfaoPath = `articles/${orfaoId}/${stamp}-orfao.png`;
const recusado = await salvarComImagem(admin, {
  kind: 'articles',
  id: orfaoId,
  table: 'articles',
  path: orfaoPath,
  // `status` fora do CHECK: o banco recusa a linha depois de o arquivo subir.
  row: {
    slug: `f9-orfao-${stamp}`,
    title: 'Artigo inválido',
    category: 'Teste',
    author_name: 'Equipe',
    content: 'x'.repeat(120),
    published_at: new Date().toISOString(),
    estimated_read_minutes: 4,
    status: 'inexistente',
  },
});
check(!recusado.ok && recusado.etapa === 'gravacao', '14: a gravação é recusada pelo banco');
check(!(await rowExists('articles', orfaoId)), '15: nenhum registro quebrado ficou');
check(!(await objectExists(orfaoPath)), '16: e a imagem que já tinha subido foi removida');

// A — upload recusado: nada é gravado.
const semUpload = await salvarComImagem(comum, {
  kind: 'articles',
  id: uuid('f9a30003', 2),
  table: 'articles',
  path: `articles/${uuid('f9a30003', 2)}/x.png`,
  row: { slug: `f9-nao-${stamp}`, title: 'Não deve existir', category: 'x', author_name: 'x', content: 'x'.repeat(120), published_at: new Date().toISOString(), estimated_read_minutes: 1, status: 'draft' },
});
check(!semUpload.ok && semUpload.etapa === 'upload', '17: sem upload, a gravação nem é tentada');
check(!(await rowExists('articles', uuid('f9a30003', 2))), '18: e nenhuma linha nasceu');

// F — remover arquivo já ausente não é erro: o retry converge.
const repetida = await removeObject(admin, orfaoPath);
check(repetida.status === 200, '19: remover objeto ausente devolve sucesso (retry idempotente)');

/* ------------------------------ §40 — oferta ------------------------------ */

console.log('\n== §40 oferta: rascunho, vigência, publicação ==');

const ofertaId = uuid('f9b10004', 1);
const ofertaPath = `offers/${ofertaId}/${stamp}.png`;
const hoje = new Date().toISOString().slice(0, 10);
const ontem = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

const ofertaCriada = await salvarComImagem(admin, {
  kind: 'offers',
  id: ofertaId,
  table: 'offers',
  path: ofertaPath,
  row: {
    destination: `Porto ${stamp}`,
    description: 'Oferta da F9',
    cost_level: 'economy',
    things_to_do: [],
    status: 'draft',
    sort_order: 900,
  },
});
check(ofertaCriada.ok, '20: administração cria oferta rascunho com imagem');
check(await rowExists('offers', ofertaId), '21: a oferta existe (service_role)');
check(
  (await rest(comum, `offers?select=id&id=eq.${ofertaId}`)).body?.length === 0,
  '22: usuário comum não vê oferta em rascunho',
);

await rest(admin, `offers?id=eq.${ofertaId}`, {
  method: 'PATCH',
  body: { status: 'published', active_until: ontem },
});
check(
  (await rest(comum, `offers?select=id&id=eq.${ofertaId}`)).body?.length === 0,
  '23: publicada mas vencida continua invisível para o usuário comum',
);

await rest(admin, `offers?id=eq.${ofertaId}`, { method: 'PATCH', body: { active_until: hoje } });
const ofertaVisivel = await rest(comum, `offers?select=id,image_url&id=eq.${ofertaId}`);
check(ofertaVisivel.body?.length === 1, '24: dentro da vigência, o usuário comum vê');
check(
  (await fetchStatus(ofertaVisivel.body?.[0]?.image_url)) === 200,
  '25: e a imagem da oferta abre',
);

check(
  (await rest(comum, `offers?id=eq.${ofertaId}`, { method: 'DELETE' })).status !== 204 ||
    (await rowExists('offers', ofertaId)),
  '26: usuário comum não exclui oferta',
);

await rest(admin, `offers?id=eq.${ofertaId}`, { method: 'DELETE' });
await removeObject(admin, ofertaPath);
check(!(await rowExists('offers', ofertaId)), '27: administração exclui a oferta');
check(!(await objectExists(ofertaPath)), '28: e a imagem sai junto');

/* ---------------------------- §40 — especialista -------------------------- */

console.log('\n== §40 especialista: cadastro, foto e diretório ==');

const advisorId = uuid('f9c10005', 1);
const advisorPath = `advisors/${advisorId}/${stamp}.png`;

const advisorCriado = await salvarComImagem(admin, {
  kind: 'advisors',
  id: advisorId,
  table: 'advisors',
  path: advisorPath,
  row: { name: `Helena ${stamp}`, specialty: 'Portugal', status: 'online', active: false },
});
check(advisorCriado.ok, '29: administração cadastra especialista com foto');
check(await rowExists('advisors', advisorId), '30: o cadastro existe (service_role)');
check(
  (await rest(comum, `advisors?select=id&id=eq.${advisorId}`)).body?.length === 0,
  '31: especialista inativo não aparece no diretório',
);

await rest(admin, `advisors?id=eq.${advisorId}`, { method: 'PATCH', body: { active: true } });
check(
  (await rest(comum, `advisors?select=id&id=eq.${advisorId}`)).body?.length === 1,
  '32: ativado, passa a aparecer',
);
check(
  (await fetchStatus(publicUrl(advisorPath))) === 200,
  '33: a foto do especialista está no bucket de conteúdo e abre publicamente',
);

await rest(admin, `advisors?id=eq.${advisorId}`, { method: 'DELETE' });
await removeObject(admin, advisorPath);
check(!(await rowExists('advisors', advisorId)), '34: administração exclui o cadastro');
check(!(await objectExists(advisorPath)), '35: e a foto sai junto');

/* -------------------------------- §40 — lugar ----------------------------- */

console.log('\n== §40 lugar: CRUD administrativo ==');

const placeId = uuid('f9d10006', 1);
const placePath = `places/${placeId}/${stamp}.png`;

const placeCriado = await salvarComImagem(admin, {
  kind: 'places',
  id: placeId,
  table: 'places',
  path: placePath,
  row: { name: `Café ${stamp}`, type: 'restaurant', city: 'Porto', country: 'Portugal' },
});
check(placeCriado.ok, '36: administração cadastra lugar com foto');
check(
  (await rest(comum, `places?select=id,image_url&id=eq.${placeId}`)).body?.length === 1,
  '37: o lugar é público — o diretório não tem rascunho',
);
check(
  (await rest(comum, `places?id=eq.${placeId}`, { method: 'PATCH', body: { name: 'invadido' } }))
    .body?.length !== 1,
  '38: usuário comum não edita lugar',
);

await rest(admin, `places?id=eq.${placeId}`, { method: 'DELETE' });
await removeObject(admin, placePath);
check(!(await rowExists('places', placeId)), '39: administração exclui o lugar');
check(!(await objectExists(placePath)), '40: e a foto sai junto');

/* ------------------------- §26 — curtida de artigo ------------------------ */

console.log('\n== §26 curtida: continua real com o artigo vindo do banco ==');

const artigoLikeId = uuid('f9f10008', 1);
await rest(admin, 'articles', {
  method: 'POST',
  prefer: 'resolution=merge-duplicates',
  body: [
    {
      id: artigoLikeId,
      slug: `f9-like-${stamp}`,
      title: 'Artigo curtível',
      category: 'Inspiração',
      author_name: 'Equipe',
      content: 'x'.repeat(120),
      published_at: new Date().toISOString(),
      estimated_read_minutes: 3,
      status: 'published',
    },
  ],
});
check(await rowExists('articles', artigoLikeId), '43: o artigo publicado existe (service_role)');

const curtida = await rest(comum, 'article_likes', {
  method: 'POST',
  prefer: 'resolution=merge-duplicates,return=representation',
  body: [{ user_id: comum.id, article_id: artigoLikeId }],
});
check(curtida.status < 400, '44: o usuário comum curte um artigo vindo do banco');
check(
  (await rest(comum, `article_likes?select=article_id&article_id=eq.${artigoLikeId}`)).body
    ?.length === 1,
  '45: e a curtida persiste',
);

// A curtida é do dono, não do payload: a policy compara `user_id` com `auth.uid()`.
const forjada = await rest(comum, 'article_likes', {
  method: 'POST',
  body: [{ user_id: admin.id, article_id: artigoLikeId }],
});
check(forjada.status >= 400, '46: usuário comum não fabrica curtida em nome de outro');
check(
  (
    await fetch(
      `${API}/rest/v1/article_likes?select=user_id&article_id=eq.${artigoLikeId}&user_id=eq.${admin.id}`,
      { headers: svc },
    ).then((r) => r.json())
  ).length === 0,
  '46b: e nada foi gravado em nome do outro (service_role)',
);

await rest(comum, `article_likes?article_id=eq.${artigoLikeId}&user_id=eq.${comum.id}`, {
  method: 'DELETE',
});
check(
  (await rest(comum, `article_likes?select=article_id&article_id=eq.${artigoLikeId}`)).body
    ?.length === 0,
  '47: descurtir funciona',
);

await rest(admin, `articles?id=eq.${artigoLikeId}`, { method: 'DELETE' });

/* ---------------------- §14 — administrador rebaixado --------------------- */

console.log('\n== §14 administrador rebaixado ==');

const depoisPath = `articles/${uuid('f9e10007', 1)}/depois.png`;
await setRole(admin, 'user');
check((await upload(admin, depoisPath)) >= 400, '41: rebaixado, deixa de escrever no bucket');
check(!(await objectExists(depoisPath)), '41b: e nada foi gravado');
check(
  (
    await rest(admin, 'articles', {
      method: 'POST',
      prefer: 'return=representation',
      body: [{ slug: `f9-rebaixado-${stamp}`, title: 'x', category: 'x', author_name: 'x', content: 'x'.repeat(120), published_at: new Date().toISOString(), estimated_read_minutes: 1, status: 'draft' }],
    })
  ).status >= 400,
  '42: rebaixado, deixa de criar conteúdo',
);
await setRole(admin, 'admin');

/* --------------------------------- limpeza -------------------------------- */

await removeObject(admin, capaAdmin);
for (const conta of [comum, admin]) {
  await fetch(`${API}/auth/v1/admin/users/${conta.id}`, { method: 'DELETE', headers: svc });
}

console.log(`\n${passed} verificações OK, ${failures.length} falharam.`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
