/**
 * Picks the data source at startup (§119).
 *
 * The UI is identical either way — this is the only place that knows which
 * adapter is in play.
 */

import { config } from '@/lib/config';
import { localDataSource } from './local/LocalDataSource';
import { supabaseDataSource } from './supabase/SupabaseDataSource';
import type { DataSource } from './types';

export const dataSource: DataSource = config.hasSupabase ? supabaseDataSource : localDataSource;

export * from './types';
export {
  authAdapter,
  AuthError,
  type AuthSession,
  type RecoveryGrant,
  type SignUpOutcome,
} from './auth';
