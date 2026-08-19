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
      'scripts/*.mjs',
    ],
  },
]);
