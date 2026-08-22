/**
 * Generates `supabase/seed.sql` from the same catalogue the app ships with
 * (`src/data/catalog.ts`), so the demonstration content and the database
 * content can never drift apart.
 *
 * Run with:  npm run seed:generate
 *
 * Node 24 strips TypeScript types natively; the resolve hook below just lets
 * extensionless relative imports (Metro's convention) work under Node ESM.
 */

import { registerHooks } from 'node:module';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

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

const { OFFERS, ARTICLES, PLACES, ADVISORS } = await import(
  pathToFileURL(resolvePath(root, 'src/data/catalog.ts')).href
);

/** Escapes a value into a SQL literal. */
const lit = (value) => {
  if (value === undefined || value === null) return 'null';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return `'${String(value).replace(/'/g, "''")}'`;
};

/** Renders a JS string array as a Postgres text[] literal. */
const arr = (values) => {
  if (!values || values.length === 0) return `'{}'`;
  const inner = values.map((v) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  return `'{${inner.join(',')}}'`;
};

const lines = [];
lines.push('-- =============================================================================');
lines.push('-- Easy Trip 2.0 — editorial seed content (§95)');
lines.push('--');
lines.push('-- GENERATED FILE — do not edit by hand.');
lines.push('-- Source: src/data/catalog.ts   Regenerate: npm run seed:generate');
lines.push('--');
lines.push('-- This is product content (offers, articles, the place directory, advisors),');
lines.push('-- not fake user data. Ids are deterministic so re-running is idempotent.');
lines.push('-- =============================================================================');
lines.push('');

/* --------------------------------- offers --------------------------------- */
lines.push('-- Offers ---------------------------------------------------------------------');
for (const o of OFFERS) {
  lines.push(
    `insert into public.offers (id, destination, description, price, price_currency, discount_type, discount_value, cost_level, image_url, weather_summary, best_time, things_to_do, active_from, active_until, partner_url, status, sort_order) values (` +
      [
        `'${uuidFrom(o.id)}'`,
        lit(o.destination),
        lit(o.description),
        lit(o.price),
        lit(o.priceCurrency),
        lit(o.discountType),
        lit(o.discountValue === undefined ? null : String(o.discountValue)),
        lit(o.costLevel),
        lit(o.imageUrl),
        lit(o.weatherSummary),
        lit(o.bestTime),
        arr(o.thingsToDo),
        // Vigência e ordem editorial vieram com a `0004`. Deixá-las de fora
        // fazia o seed nascer com `sort_order = 0` em todas as ofertas — a
        // faixa Em Alta perdia a ordem que o catálogo declara.
        lit(o.activeFrom),
        lit(o.activeUntil),
        lit(o.partnerUrl),
        lit(o.status),
        lit(o.sortOrder),
      ].join(', ') +
      `) on conflict (id) do nothing;`,
  );
}
lines.push('');

/* -------------------------------- articles -------------------------------- */
lines.push('-- Articles -------------------------------------------------------------------');
for (const a of ARTICLES) {
  lines.push(
    `insert into public.articles (id, slug, title, category, image_url, author_name, content, published_at, estimated_read_minutes, status) values (` +
      [
        `'${uuidFrom(a.id)}'`,
        lit(a.slug),
        lit(a.title),
        lit(a.category),
        lit(a.imageUrl),
        lit(a.authorName),
        lit(a.content),
        lit(a.publishedAt),
        lit(a.estimatedReadMinutes),
        lit(a.status),
      ].join(', ') +
      `) on conflict (id) do nothing;`,
  );
}
lines.push('');

/* --------------------------------- places --------------------------------- */
lines.push('-- Places ---------------------------------------------------------------------');
for (const p of PLACES) {
  lines.push(
    `insert into public.places (id, name, type, rating, price_level, average_price, currency, city, country, address, phone, opening_hours, description, latitude, longitude, image_url, amenities, partner_url) values (` +
      [
        `'${uuidFrom(p.id)}'`,
        lit(p.name),
        lit(p.type),
        lit(p.rating),
        lit(p.priceLevel),
        lit(p.averagePrice),
        lit(p.currency),
        lit(p.city),
        lit(p.country),
        lit(p.address),
        lit(p.phone),
        p.openingHours ? arr(p.openingHours) : 'null',
        lit(p.description),
        lit(p.latitude),
        lit(p.longitude),
        lit(p.imageUrl),
        p.amenities ? arr(p.amenities) : 'null',
        lit(p.partnerUrl),
      ].join(', ') +
      `) on conflict (id) do nothing;`,
  );
}
lines.push('');

/* -------------------------------- advisors -------------------------------- */
lines.push('-- Advisors -------------------------------------------------------------------');
for (const a of ADVISORS) {
  lines.push(
    `insert into public.advisors (id, name, specialty, avatar_url, rating, status, bio, active) values (` +
      [
        `'${uuidFrom(a.id)}'`,
        lit(a.name),
        lit(a.specialty),
        lit(a.avatarUrl),
        lit(a.rating),
        lit(a.status),
        lit(a.bio),
        // `active` é cadastro (faz parte do time?), diferente de `status`, que
        // é presença. A coluna nasceu na `0004`.
        lit(a.active),
      ].join(', ') +
      `) on conflict (id) do nothing;`,
  );
}
lines.push('');

mkdirSync(resolvePath(root, 'supabase'), { recursive: true });
writeFileSync(resolvePath(root, 'supabase/seed.sql'), lines.join('\n'), 'utf8');

/* ========================================================================== */
/* Seed de produção (F10)                                                     */
/* ========================================================================== */

/**
 * O mesmo catálogo, filtrado pelo que pode ser apresentado a um usuário real.
 *
 * `seed.sql` é o conteúdo de **demonstração**: ele povoa o ambiente local e o
 * modo demo, onde nada é apresentado como compromisso. O arquivo de produção
 * existe porque três coisas desse catálogo não sobrevivem ao contato com um
 * usuário de verdade — e a diferença entre os dois arquivos é a lista dessas
 * três coisas, explicitada aqui em vez de confiada à memória de quem for
 * rodar o primeiro seed remoto.
 *
 * **Especialistas: fora (D-05).** São cinco pessoas inventadas, com nome,
 * biografia, especialidade e nota. Um usuário que abre a Assessoria não tem
 * como saber que "Ana Beatriz Correia" não existe — ele agendaria uma consulta
 * com ela. O diretório nasce vazio no ambiente real (a tela já tem estado
 * vazio próprio) e se enche pelo painel, com pessoas reais.
 *
 * **Ofertas: fora.** Preço, desconto e vigência são compromisso comercial. O
 * próprio formulário de oferta diz isso na tela: "os valores são digitados por
 * quem os assume". `R$ 8.990` com 15% de desconto que ninguém honra é uma
 * promessa falsa, não um dado de exemplo.
 *
 * **Lugares: sem telefone e sem nota.** O texto e a localização são úteis, mas
 * `phone` vira um botão "Ligar" — e um número de oito dígitos inventado para
 * um bistrô em Paris toca no telefone de algum estranho. `rating` é uma nota
 * sem fonte, num produto que exibe um aviso fixo dizendo que ainda não mostra
 * avaliações. Os dois saem; o resto fica.
 *
 * Nada aqui é inventado para substituir o que sai: o que não pode ser
 * apresentado como real simplesmente não é apresentado.
 */
const prod = [];
prod.push('-- =============================================================================');
prod.push('-- Easy Trip — seed de PRODUÇÃO');
prod.push('--');
prod.push('-- ARQUIVO GERADO — não edite à mão.');
prod.push('-- Origem: src/data/catalog.ts   Regenerar: npm run seed:generate');
prod.push('--');
prod.push('-- Diferenças em relação a `seed.sql` (que é o seed de DEMONSTRAÇÃO):');
prod.push('--   • especialistas  → não entram (D-05: são pessoas fictícias)');
prod.push('--   • ofertas        → não entram (preço/desconto são compromisso comercial)');
prod.push('--   • artigos        → assinatura institucional, não nomes inventados');
prod.push('--   • lugares        → sem telefone e sem nota (dados não verificáveis)');
prod.push('--');
prod.push('-- As imagens continuam sendo URLs externas enquanto os arquivos originais não');
prod.push('-- existirem em assets/content/ (P-04). Ver scripts/seed-content-assets.mjs.');
prod.push('--');
prod.push('-- Este arquivo NÃO é aplicado por `supabase db push`, que só roda migrations.');
prod.push('-- Aplicação manual e deliberada — ver GO_LIVE_SUPABASE.md.');
prod.push('-- =============================================================================');
prod.push('');

/** Assinatura institucional: o conteúdo é da equipe, e é isso que o crédito diz. */
const AUTOR_INSTITUCIONAL = 'Equipe Easy Trip';

prod.push('-- Articles -------------------------------------------------------------------');
for (const a of ARTICLES) {
  prod.push(
    `insert into public.articles (id, slug, title, category, image_url, author_name, content, published_at, estimated_read_minutes, status) values (` +
      [
        `'${uuidFrom(a.id)}'`,
        lit(a.slug),
        lit(a.title),
        lit(a.category),
        lit(a.imageUrl),
        lit(AUTOR_INSTITUCIONAL),
        lit(a.content),
        lit(a.publishedAt),
        lit(a.estimatedReadMinutes),
        lit(a.status),
      ].join(', ') +
      `) on conflict (id) do nothing;`,
  );
}
prod.push('');

prod.push('-- Places ---------------------------------------------------------------------');
for (const p of PLACES) {
  prod.push(
    `insert into public.places (id, name, type, rating, price_level, average_price, currency, city, country, address, phone, opening_hours, description, latitude, longitude, image_url, amenities, partner_url) values (` +
      [
        `'${uuidFrom(p.id)}'`,
        lit(p.name),
        lit(p.type),
        'null', // rating — nota sem fonte verificável
        lit(p.priceLevel),
        lit(p.averagePrice),
        lit(p.currency),
        lit(p.city),
        lit(p.country),
        lit(p.address),
        'null', // phone — número não verificado vira botão "Ligar"
        p.openingHours ? arr(p.openingHours) : 'null',
        lit(p.description),
        lit(p.latitude),
        lit(p.longitude),
        lit(p.imageUrl),
        p.amenities ? arr(p.amenities) : 'null',
        lit(p.partnerUrl),
      ].join(', ') +
      `) on conflict (id) do nothing;`,
  );
}
prod.push('');
prod.push('-- Offers e Advisors: deliberadamente ausentes. Cadastre pelo painel.');
prod.push('');

writeFileSync(resolvePath(root, 'supabase/seed.production.sql'), prod.join('\n'), 'utf8');

console.log(
  `supabase/seed.sql written — ${OFFERS.length} offers, ${ARTICLES.length} articles, ${PLACES.length} places, ${ADVISORS.length} advisors`,
);
console.log(
  `supabase/seed.production.sql written — ${ARTICLES.length} articles, ${PLACES.length} places, 0 offers, 0 advisors`,
);
