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
    `insert into public.offers (id, destination, description, price, price_currency, discount_type, discount_value, cost_level, image_url, weather_summary, best_time, things_to_do, partner_url) values (` +
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
        lit(o.partnerUrl),
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
    `insert into public.advisors (id, name, specialty, avatar_url, rating, status, bio) values (` +
      [
        `'${uuidFrom(a.id)}'`,
        lit(a.name),
        lit(a.specialty),
        lit(a.avatarUrl),
        lit(a.rating),
        lit(a.status),
        lit(a.bio),
      ].join(', ') +
      `) on conflict (id) do nothing;`,
  );
}
lines.push('');

mkdirSync(resolvePath(root, 'supabase'), { recursive: true });
writeFileSync(resolvePath(root, 'supabase/seed.sql'), lines.join('\n'), 'utf8');

console.log(
  `supabase/seed.sql written — ${OFFERS.length} offers, ${ARTICLES.length} articles, ${PLACES.length} places, ${ADVISORS.length} advisors`,
);

/**
 * Deterministic UUID from a slug, so seeding twice cannot duplicate rows and
 * the ids stay stable across regenerations.
 */
function uuidFrom(slug) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < slug.length; i++) {
    h1 = Math.imul(h1 ^ slug.charCodeAt(i), 0x01000193) >>> 0;
    h2 = Math.imul(h2 + slug.charCodeAt(i) + i, 0x85ebca6b) >>> 0;
  }
  const hex = (n) => n.toString(16).padStart(8, '0');
  const a = hex(h1);
  const b = hex(h2);
  const c = hex((h1 ^ h2) >>> 0);
  const d = hex((h1 + h2) >>> 0);
  // Shape it as a valid v4-looking UUID.
  return `${a}-${b.slice(0, 4)}-4${b.slice(5, 8)}-8${c.slice(1, 4)}-${c.slice(4)}${d}`;
}
