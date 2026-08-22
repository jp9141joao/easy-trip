/**
 * Migra as imagens editoriais do catálogo para o bucket `content` (F9, §21–§22).
 *
 * ## Por que este script existe separado do seed do banco
 *
 * `supabase/seed.sql` é gerado de `src/data/catalog.ts` e continua sendo
 * puramente SQL: `supabase db reset` não pode depender de rede, senão deixa de
 * ser reproduzível — e um `curl` dentro de uma migration seria a pior versão
 * disso. As imagens são a única parte do conteúdo editorial que não cabe em
 * SQL, então elas viram uma **segunda etapa, explícita e opcional**:
 *
 *     npx supabase start
 *     npm run seed:generate          # DB seed — sem rede
 *     npx supabase db reset          # aplica migrations + seed.sql
 *     node scripts/seed-content-assets.mjs   # content asset seed — esta etapa
 *
 * ## O que ele faz
 *
 * Para cada registro do catálogo cuja imagem ainda é uma URL de terceiro
 * (`images.unsplash.com`, o defeito P-04), procura o arquivo correspondente em
 * `assets/content/{kind}/{id}.{jpg|png|webp}`, envia para
 * `content/{kind}/{id}/{arquivo}` — o mesmo padrão de caminho que o painel usa
 * — e aponta a coluna para a URL pública do bucket.
 *
 * ## O que ele deliberadamente NÃO faz
 *
 * - **Não baixa nada da internet.** Se o arquivo não estiver no repositório, o
 *   script falha dizendo quais faltam. Baixar do Unsplash aqui apenas mudaria
 *   *quando* o produto depende do host de terceiro, não *se*.
 * - **Não inventa imagem.** Nem gera, nem repete a mesma foto em tudo: um
 *   catálogo com a mesma imagem em 22 lugares é pior do que um catálogo
 *   honestamente sem imagem.
 * - **Não escreve em servidor remoto.** O host é conferido antes de qualquer
 *   requisição, e um endereço que não seja local aborta a execução.
 *
 * Enquanto os arquivos não existirem, o seed continua apontando para o
 * Unsplash — e é isso que mantém a migração do conteúdo legado registrada como
 * pendência de asset, em vez de declarada como resolvida.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { uuidFrom } from './seedIds.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolvePath(here, '..');

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
      const parentPath = fileURLToPath(context.parentURL);
      for (const ext of ['.ts', '.tsx', '.js']) {
        const candidate = resolvePath(dirname(parentPath), specifier + ext);
        if (existsSync(candidate)) {
          return { url: pathToFileURL(candidate).href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

const API = process.env.SUPABASE_API_URL ?? 'http://127.0.0.1:54321';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

// §44: escrever conteúdo é operação de administração. Fora da máquina, não.
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(API)) {
  console.error(`Recusado: ${API} não é local. Este script grava imagens e altera linhas.`);
  process.exit(2);
}
if (!SERVICE) {
  console.error('Defina SUPABASE_SERVICE_ROLE_KEY (npx supabase status -o env).');
  process.exit(2);
}

const { OFFERS, ARTICLES, PLACES, ADVISORS } = await import(
  pathToFileURL(resolvePath(root, 'src/data/catalog.ts')).href
);

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * As quatro famílias, com a coluna de imagem de cada uma.
 *
 * `advisors` guarda em `avatar_url` — nome herdado da `0001`. Continua sendo
 * conteúdo editorial no bucket `content`, não foto de conta no bucket
 * `avatars`; o nome da coluna não muda a natureza do dado, e renomeá-la agora
 * custaria uma migration só por estética (§19, §34).
 */
const FAMILIAS = [
  { kind: 'articles', table: 'articles', column: 'image_url', rows: ARTICLES, get: (r) => r.imageUrl, producao: true },
  { kind: 'offers', table: 'offers', column: 'image_url', rows: OFFERS, get: (r) => r.imageUrl, producao: false },
  { kind: 'places', table: 'places', column: 'image_url', rows: PLACES, get: (r) => r.imageUrl, producao: true },
  { kind: 'advisors', table: 'advisors', column: 'avatar_url', rows: ADVISORS, get: (r) => r.avatarUrl, producao: false },
];

const svc = {
  apikey: SERVICE,
  Authorization: `Bearer ${SERVICE}`,
};

/** `assets/content/{kind}/{id}.{ext}` — o arquivo que o operador precisa pôr aqui. */
function localizarAsset(kind, id) {
  const pasta = resolvePath(root, 'assets', 'content', kind);
  if (!existsSync(pasta)) return undefined;
  const arquivo = readdirSync(pasta).find((nome) => {
    const [base, ext] = [nome.slice(0, nome.lastIndexOf('.')), nome.slice(nome.lastIndexOf('.') + 1)];
    return base === id && MIME[ext.toLowerCase()];
  });
  if (!arquivo) return undefined;
  const ext = arquivo.slice(arquivo.lastIndexOf('.') + 1).toLowerCase();
  return { caminho: resolvePath(pasta, arquivo), ext, mime: MIME[ext] };
}

const pendentes = [];
const enviados = [];
const jaGerenciados = [];

for (const familia of FAMILIAS) {
  for (const registro of familia.rows) {
    const atual = familia.get(registro);

    // Já está no bucket: nada a migrar. Isto vale para quando o próprio
    // catálogo passar a apontar para o bucket. Rodar o script duas vezes com o
    // catálogo antigo também é seguro: o caminho é derivado do id, então a
    // segunda passada reescreve o mesmo objeto com o mesmo endereço.
    if (typeof atual === 'string' && atual.includes('/storage/v1/object/public/content/')) {
      jaGerenciados.push(`${familia.kind}/${registro.id}`);
      continue;
    }

    // O catálogo identifica por slug legível; o banco, pelo uuid determinístico
    // que `uuidFrom` deriva dele. O arquivo é procurado pelo slug (é o que um
    // humano reconhece na pasta) e o caminho no bucket usa o uuid — que é o
    // `entityId` do padrão `content/{kind}/{entityId}/…` que o painel também usa.
    const entityId = uuidFrom(registro.id);
    const asset = localizarAsset(familia.kind, registro.id);
    if (!asset) {
      pendentes.push({
        kind: familia.kind,
        id: registro.id,
        rotulo: registro.title ?? registro.destination ?? registro.name,
        entityId,
        // Ofertas e especialistas não entram no seed de produção (D-05 e
        // compromisso comercial), então a foto deles só faz falta na
        // demonstração. Marcar isso aqui evita que alguém procure 29 fotos
        // quando 18 resolvem o ambiente real.
        producao: familia.producao,
        origem: atual,
        esperado: `assets/content/${familia.kind}/${registro.id}.{jpg|png|webp}`,
      });
      continue;
    }

    const bytes = readFileSync(asset.caminho);
    if (bytes.byteLength > MAX_BYTES) {
      console.error(
        `Recusado: ${asset.caminho} tem ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB — o bucket aceita 5 MB.`,
      );
      process.exit(1);
    }

    const path = `${familia.kind}/${entityId}/catalogo.${asset.ext}`;
    const envio = await fetch(`${API}/storage/v1/object/content/${path}`, {
      method: 'POST',
      headers: { ...svc, 'Content-Type': asset.mime, 'x-upsert': 'true' },
      body: bytes,
    });
    if (!envio.ok) {
      console.error(`Falhou o envio de ${path}: HTTP ${envio.status} ${await envio.text()}`);
      process.exit(1);
    }

    const url = `${API}/storage/v1/object/public/content/${path}`;
    const patch = await fetch(`${API}/rest/v1/${familia.table}?id=eq.${entityId}`, {
      method: 'PATCH',
      headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ [familia.column]: url }),
    });
    // Um PATCH que não casa com linha nenhuma devolve 200 e zero linhas. Sem
    // `return=representation` o script comemoraria uma migração que não houve.
    const linhas = patch.ok ? await patch.json().catch(() => []) : [];
    if (!patch.ok || linhas.length !== 1) {
      // Compensação: sem a linha apontando para ele, o objeto seria órfão.
      await fetch(`${API}/storage/v1/object/content`, {
        method: 'DELETE',
        headers: { ...svc, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: [path] }),
      });
      console.error(
        `Falhou a atualização de ${familia.table}/${entityId}: HTTP ${patch.status}, ${linhas.length} linha(s).` +
          ' O banco foi semeado? Rode `npx supabase db reset` antes.',
      );
      process.exit(1);
    }

    enviados.push(path);
  }
}

/**
 * O manifesto é escrito a cada execução, com ou sem falha (F10, §7).
 *
 * É o inverso da mensagem de erro: a mensagem serve a quem está rodando o
 * script agora; o arquivo serve a quem vai **conseguir as fotografias** e não
 * está no terminal. Sai do mesmo laço que decidiu o que falta, então não tem
 * como divergir da realidade — e não carrega segredo nenhum: só entidade, id,
 * nome de arquivo esperado e formatos aceitos.
 */
const manifesto = {
  gerado: 'scripts/seed-content-assets.mjs',
  bucket: 'content',
  formatosAceitos: ['jpg', 'jpeg', 'png', 'webp'],
  tamanhoMaximoMB: 5,
  caminhoDosArquivos: 'assets/content/{entidade}/{slug}.{ext}',
  totalPendentes: pendentes.length,
  totalPendentesProducao: pendentes.filter((p) => p.producao).length,
  pendentes: pendentes.map((p) => ({
    entidade: p.kind,
    slug: p.id,
    id: p.entityId,
    rotulo: p.rotulo,
    arquivoEsperado: `assets/content/${p.kind}/${p.id}.{jpg|png|webp}`,
    necessarioEmProducao: p.producao,
  })),
};
mkdirSync(resolvePath(root, 'assets', 'content'), { recursive: true });
writeFileSync(
  resolvePath(root, 'assets', 'content', 'manifest.json'),
  `${JSON.stringify(manifesto, null, 2)}\n`,
  'utf8',
);

console.log(`Imagens migradas para o bucket: ${enviados.length}`);
console.log('Manifesto atualizado: assets/content/manifest.json');
if (jaGerenciados.length) console.log(`Já estavam no bucket: ${jaGerenciados.length}`);

if (pendentes.length) {
  console.error(`\nFaltam ${pendentes.length} arquivos. Nenhum deles pode ser baixado por este script.`);
  for (const p of pendentes) {
    console.error(`  ${p.esperado}`);
    console.error(`    ${p.kind} · ${p.rotulo}`);
    console.error(`    hoje aponta para: ${p.origem ?? '(sem imagem)'}`);
  }
  console.error(
    '\nPonha os arquivos correspondentes em assets/content/ e rode de novo. Enquanto isso, o\n' +
      'conteúdo do seed continua apontando para o host externo — a migração do conteúdo legado\n' +
      'do P-04 permanece pendente de asset.',
  );
  process.exit(1);
}

console.log('Todo o conteúdo editorial do catálogo está hospedado pelo próprio Easy Trip.');
