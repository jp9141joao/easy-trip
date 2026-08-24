import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import 'react-native-url-polyfill/auto';

import { config } from '@/lib/config';

let client: SupabaseClient | null = null;

/**
 * A chave sob a qual o supabase-js guarda a sessão neste aparelho.
 *
 * O valor é exatamente o padrão que o `SupabaseClient` calcularia sozinho
 * (`sb-<ref>-auth-token`, com `<ref>` sendo o primeiro rótulo do host do
 * projeto). Passá-lo explicitamente não muda nada em disco — muda quem *sabe*
 * o nome da chave. Sem isso, `forgetLocalSession()` teria de adivinhar um
 * detalhe interno da biblioteca, e uma mudança de versão a transformaria em
 * um logout que não apaga nada e não avisa.
 */
export function supabaseAuthStorageKey(): string {
  const host = new URL(config.supabaseUrl).hostname;
  return `sb-${host.split('.')[0]}-auth-token`;
}

/**
 * Lazily-created Supabase client.
 *
 * Only the anon key reaches the device — authorisation is enforced by Row Level
 * Security on the server, so a leaked anon key grants nothing (§17, §93).
 */
export function getSupabaseClient(): SupabaseClient {
  if (!config.hasSupabase) {
    throw new Error(
      'Supabase não está configurado. Defina EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_ANON_KEY.',
    );
  }

  if (!client) {
    client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        storage: AsyncStorage,
        storageKey: supabaseAuthStorageKey(),
        autoRefreshToken: true,
        persistSession: true,
        // React Native has no URL bar to parse a session out of.
        detectSessionInUrl: false,
      },
    });
  }

  return client;
}

/**
 * Apaga a sessão deste aparelho **sem tocar na rede**.
 *
 * Existe porque `auth.signOut()` — em qualquer `scope`, inclusive `'local'` —
 * é uma operação de rede antes de ser uma operação local: ela vai ao
 * `/logout`, e só depois de a resposta voltar (ou de o erro ser classificado)
 * é que o supabase-js remove o token do disco. Quando essa ida fica pendurada,
 * ou quando o token já venceu e a renovação embutida em `signOut()` falha, a
 * sessão **sobrevive** à tentativa de sair. Era daí que vinha o "só sai depois
 * de fechar e abrir o app": o aplicativo continuava com uma sessão de pé.
 *
 * O botão "Sair" não pede revogação em outros aparelhos. Ele pede uma coisa
 * só: encerrar aqui. Isso é local, e por isso tem de ser possível fazer
 * localmente — sem rede, sem prazo, sem depender de servidor nenhum.
 *
 * A sessão do supabase-js vive inteira no armazenamento (não há cópia em
 * memória: `__loadSession` relê o disco a cada chamada), então remover estas
 * chaves é remover a sessão. Quem reconcilia a contabilidade interna da
 * biblioteca depois é um `signOut({ scope: 'local' })` — que, sem token no
 * disco, não sai para a rede.
 */
export async function forgetLocalSession(): Promise<void> {
  const key = supabaseAuthStorageKey();
  // `getAllKeys` cobre os satélites que a versão instalada cria ao lado da
  // chave principal (`-user`, verificadores PKCE) sem este arquivo precisar
  // manter uma lista que envelhece em silêncio.
  const keys = await AsyncStorage.getAllKeys();
  const owned = keys.filter((candidate) => candidate === key || candidate.startsWith(`${key}-`));
  await AsyncStorage.multiRemove(owned.length > 0 ? owned : [key]);
}

/** Testes: derruba o cliente memoizado para o próximo `getSupabaseClient()`. */
export function resetSupabaseClientForTests(): void {
  client = null;
}
