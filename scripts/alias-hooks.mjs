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

/**
 * `expo-crypto` só quando pedido explicitamente.
 *
 * A avaliação da IA importa `@/domain/aiActions`, que importa `@/lib/id`, que
 * importa `expo-crypto` — e `expo-modules-core` não roda no `node` puro. A
 * troca acontece apenas com `EVAL_STUB_EXPO=1`, para que ela seja uma decisão
 * de quem executa e não um silêncio do arcabouço.
 */
const STUB_EXPO = process.env.EVAL_STUB_EXPO === '1';
const EXPO_CRYPTO_STUB = new URL('ai-eval/expo-crypto-stub.mjs', import.meta.url).href;

export async function resolve(specifier, context, next) {
  if (STUB_EXPO && specifier === 'expo-crypto') {
    return { url: EXPO_CRYPTO_STUB, shortCircuit: true };
  }
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
