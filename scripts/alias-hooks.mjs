/**
 * O gancho de resolução em si. Ver `alias-loader.mjs` para o porquê.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const SRC = new URL('src/', ROOT).href;
const ASSETS = new URL('assets/', ROOT).href;

// A mesma ordem do Metro: o arquivo, depois o index do diretório.
const CANDIDATOS = ['', '.ts', '.tsx', '.js', '/index.ts', '/index.tsx'];

function comExtensao(base) {
  for (const sufixo of CANDIDATOS) {
    const url = base + sufixo;
    try {
      if (existsSync(fileURLToPath(url))) return url;
    } catch {
      /* url que não vira caminho: tenta a próxima */
    }
  }
  return base;
}

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('@/assets/')) {
    return next(comExtensao(ASSETS + specifier.slice('@/assets/'.length)), context);
  }
  if (specifier.startsWith('@/')) {
    return next(comExtensao(SRC + specifier.slice(2)), context);
  }
  if (
    (specifier.startsWith('./') || specifier.startsWith('../')) &&
    !/\.[a-z]+$/.test(specifier) &&
    context.parentURL
  ) {
    return next(comExtensao(new URL(specifier, context.parentURL).href), context);
  }
  return next(specifier, context);
}
