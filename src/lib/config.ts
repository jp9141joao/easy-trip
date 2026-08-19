/**
 * Runtime configuration (§17).
 *
 * Only `EXPO_PUBLIC_*` values ever reach the bundle. Secrets
 * (GEMINI_API_KEY, service role, weather/currency private keys) live exclusively
 * on the BFF — see `supabase/functions/`.
 */

const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? '';
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? '';
const bffUrl = process.env.EXPO_PUBLIC_BFF_URL?.trim() ?? '';

/**
 * True when a real backend is wired up. When false the app runs on the local
 * adapter (`LocalDataSource`) — still fully persistent, but device-only, and
 * labelled as such in the UI. It never pretends a remote call happened.
 */
export const hasSupabase = Boolean(url && anonKey);

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
