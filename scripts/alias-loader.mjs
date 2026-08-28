/**
 * Resolve `@/…` para `src/…`, com extensão, fora do Metro.
 *
 * O aplicativo importa por alias e SEM extensão (`@/lib/date`), que é o que o
 * Metro e o `jest-expo` resolvem por configuração. O `node` puro não faz nem
 * uma coisa nem outra — e o benchmark roda no `node` puro de propósito, para
 * medir as funções sem o ambiente de teste em volta delas.
 *
 *   node --experimental-strip-types --import ./scripts/alias-loader.mjs scripts/benchmark.mjs
 */
import { register } from 'node:module';

register('./alias-hooks.mjs', import.meta.url);
