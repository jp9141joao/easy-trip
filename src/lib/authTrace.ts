/**
 * Safe, development-only auth lifecycle tracing.
 *
 * Markers deliberately carry no payload: no token, e-mail, user id or other
 * personal data can accidentally end up in Metro/adb logs.
 */
type AuthEventName =
  | 'INITIAL_SESSION'
  | 'SIGNED_IN'
  | 'SIGNED_OUT'
  | 'PASSWORD_RECOVERY'
  | 'TOKEN_REFRESHED'
  | 'USER_UPDATED'
  | 'MFA_CHALLENGE_VERIFIED';

type AuthTraceMarker =
  | 'SIGNOUT_CLICK'
  | 'SIGNOUT_BEGIN'
  | 'SUPABASE_SIGNOUT_BEGIN'
  | 'SUPABASE_SIGNOUT_END'
  | 'SUPABASE_SIGNOUT_ERROR'
  | 'LOCAL_SESSION_REMOVE'
  | 'APPLY_SESSION_NULL'
  | 'LOGIN_SCREEN_MOUNT'
  | 'CLEANUP_BEGIN'
  | 'CLEANUP_END'
  | `AUTH_STATE_CHANGE:${AuthEventName}`
  | `AUTH_IS_AUTHENTICATED:${boolean}`
  | `PRIVATE_TREE_VISIBLE:${boolean}`;

export function traceAuth(marker: AuthTraceMarker): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__ && process.env.NODE_ENV !== 'test') {
    console.info(`[AUTH] ${marker}`);
  }
}
