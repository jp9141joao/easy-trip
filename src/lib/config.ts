/**
 * Runtime configuration (§17).
 *
 * Only `EXPO_PUBLIC_*` values ever reach the bundle. Secrets
 * (GEMINI_API_KEY, service role, weather/currency private keys) live exclusively
 * on the BFF — see `supabase/functions/`.
 */

const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? '';
const rawAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? '';
const bffUrl = process.env.EXPO_PUBLIC_BFF_URL?.trim() ?? '';

/**
 * A chave que veio é uma chave **secreta**? (F10)
 *
 * As duas se parecem no dashboard e ficam lado a lado. Colar a errada aqui não
 * quebra nada visível: o aplicativo funciona, entra em modo produção e roda
 * normalmente — com a Row Level Security **desligada para todo mundo**, porque
 * `service_role` a ignora por definição. Qualquer pessoa com o APK passaria a
 * ler o banco inteiro. É a pior falha possível deste arquivo e a mais fácil de
 * cometer, então ela é detectada aqui.
 *
 * Duas formas: o formato atual (`sb_secret_…`) e o legado (JWT cujo payload traz
 * `"role":"service_role"`). O JWT é lido sem verificar assinatura de propósito —
 * o que interessa é o que ele **afirma** ser, não se é válido.
 */
function isSecretKey(value: string): boolean {
  if (value.startsWith('sb_secret_')) return true;
  const parts = value.split('.');
  if (parts.length !== 3) return false;
  try {
    // `atob` existe no Hermes e no Node; o payload é base64url.
    const payload = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(payload).role === 'service_role';
  } catch {
    return false;
  }
}

const anonKeyIsSecret = Boolean(rawAnonKey) && isSecretKey(rawAnonKey);

/**
 * Uma chave secreta é **descartada**, não usada com um aviso.
 *
 * Usá-la deixaria o aplicativo funcionando com o banco exposto; ignorá-la faz o
 * aplicativo cair em modo demonstração, que a tela de Ajustes já anuncia. Entre
 * "funciona e vaza" e "não conecta e diz por quê", a segunda é a única aceitável.
 */
const anonKey = anonKeyIsSecret ? '' : rawAnonKey;

/**
 * True when a real backend is wired up. When false the app runs on the local
 * adapter (`LocalDataSource`) — still fully persistent, but device-only, and
 * labelled as such in the UI. It never pretends a remote call happened.
 */
export const hasSupabase = Boolean(url && anonKey);

/**
 * Problemas de configuração que o operador precisa ver — não o usuário final.
 *
 * A lista existe porque o modo demonstração tem duas causas muito diferentes:
 * "ninguém configurou nada" (esperado, e a tela já explica) e "alguém
 * configurou pela metade ou colou a chave errada" (um erro que, sem isto,
 * apareceria como um aplicativo silenciosamente offline). A tela de Ajustes
 * mostra a lista quando ela não está vazia.
 *
 * Configuração **opcional** não entra aqui: BFF, WhatsApp e convite da
 * comunidade ausentes desabilitam a própria funcionalidade, com texto próprio,
 * e não são defeito de instalação.
 */
export const configIssues: readonly string[] = [
  anonKeyIsSecret
    ? 'EXPO_PUBLIC_SUPABASE_ANON_KEY contém uma chave SECRETA (service_role). Ela foi ignorada: publicá-la no aplicativo desliga a segurança do banco. Use a chave pública (anon/publishable).'
    : null,
  url && !anonKey && !anonKeyIsSecret
    ? 'EXPO_PUBLIC_SUPABASE_URL foi definida, mas EXPO_PUBLIC_SUPABASE_ANON_KEY não. O aplicativo continua em modo demonstração.'
    : null,
  !url && rawAnonKey
    ? 'EXPO_PUBLIC_SUPABASE_ANON_KEY foi definida, mas EXPO_PUBLIC_SUPABASE_URL não. O aplicativo continua em modo demonstração.'
    : null,
].filter((issue): issue is string => issue !== null);

/** True when the BFF is reachable — gates AI, weather and FX. */
export const hasBff = Boolean(bffUrl);

export const config = {
  supabaseUrl: url,
  supabaseAnonKey: anonKey,
  bffUrl,
  hasSupabase,
  hasBff,
  /** Operating mode, surfaced honestly in Settings and the AI screen. */
  mode: (hasSupabase ? 'production' : 'demo') as 'production' | 'demo',
} as const;

export type AppMode = typeof config.mode;
