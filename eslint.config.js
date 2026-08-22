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
      'scripts/*.mjs',
    ],
  },
]);
