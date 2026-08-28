// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: [
      'dist/*',
      'coverage/*',
      '.expo/*',
      // Supabase Edge Functions run on Deno, not React Native: they use JSR
      // specifiers and the Deno global, which this config cannot resolve.
      'supabase/functions/**',
      // Gerado pelo `supabase start` (já está no .gitignore). É código do
      // próprio CLI, minificado, e só existe enquanto a pilha local roda —
      // sem esta linha o lint falha durante os testes de integração.
      'supabase/.temp/**',
      // O diretório de trabalho da pilha de ponta a ponta, montado por
      // `scripts/e2e/e2e-start.sh`. É uma cópia do `supabase/` mais o que o
      // CLI gera dentro dele — inclusive o mesmo `.temp` minificado de cima.
      // Existe só enquanto a pilha de teste está de pé, e já está no
      // .gitignore; sem esta linha, rodar o lint depois dos testes de ponta a
      // ponta reprova por causa de código que não é do projeto.
      '.e2e/**',
      'scripts/*.mjs',
      'scripts/e2e/**',
    ],
  },
]);
