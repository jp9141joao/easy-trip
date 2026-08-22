/**
 * Id determinístico do conteúdo editorial, derivado do slug do catálogo.
 *
 * Vive num módulo próprio porque **dois** scripts precisam da mesma resposta:
 * `generate-seed.mjs`, que escreve as linhas, e `seed-content-assets.mjs`, que
 * precisa achar a linha certa para apontar a imagem. Se cada um calculasse o
 * seu, bastaria uma diferença de um caractere para o segundo atualizar
 * nenhuma linha — em silêncio, porque um PATCH que não casa devolve 200.
 */

/**
 * Deterministic UUID from a slug, so seeding twice cannot duplicate rows and
 * the ids stay stable across regenerations.
 */
export function uuidFrom(slug) {
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
