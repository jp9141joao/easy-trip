import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import 'react-native-url-polyfill/auto';

import { config } from '@/lib/config';

let client: SupabaseClient | null = null;

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
        autoRefreshToken: true,
        persistSession: true,
        // React Native has no URL bar to parse a session out of.
        detectSessionInUrl: false,
      },
    });
  }

  return client;
}
