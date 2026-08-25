/**
 * Backend features that the current client expects to exist.
 *
 * These errors are deliberately separate from authorization failures. A 404
 * from PostgREST because a migration has not reached the server must never be
 * interpreted as "the current member is a viewer".
 */
export const BACKEND_CAPABILITY_CODES = [
  'MISSING_TRIP_MEMBERS',
  'MISSING_VISIBILITY',
  'MISSING_NOTIFICATIONS',
  'MISSING_RESERVATIONS_SCHEMA',
  'MISSING_SUGGESTIONS_SCHEMA',
] as const;

export type BackendCapabilityCode = (typeof BACKEND_CAPABILITY_CODES)[number];

export interface BackendErrorDetails {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
  status?: number;
}

const EXPECTED_IDENTIFIERS: Record<BackendCapabilityCode, readonly string[]> = {
  MISSING_TRIP_MEMBERS: [
    'trip_members',
    'trip_invites',
    'trip_member_profiles',
    'create_trip_invite',
    'accept_trip_invite',
    'decline_trip_invite',
    'cancel_trip_invite',
    'set_trip_member_role',
    'remove_trip_member',
    'leave_trip',
  ],
  MISSING_VISIBILITY: ['visibility', 'created_by', 'paid_by'],
  MISSING_NOTIFICATIONS: ['notifications', 'reminders', 'deliver_due_reminders'],
  MISSING_RESERVATIONS_SCHEMA: [
    'tickets',
    'start_date_time',
    'end_date_time',
    'file_path',
    'mime_type',
    'visibility',
    'created_by',
    'details',
    'status',
    'address',
    'updated_at',
    'legacy_type',
  ],
  MISSING_SUGGESTIONS_SCHEMA: [
    'trip_suggestions',
    'suggestions_refreshed_at',
    'title_key',
  ],
};

/** PostgREST/Postgres codes that mean an expected table, function or column is absent. */
const MISSING_OBJECT_CODES = new Set([
  'PGRST202', // function not found in the schema cache
  'PGRST204', // column not found in the schema cache
  'PGRST205', // table not found in the schema cache
  '42P01', // undefined_table
  '42703', // undefined_column
  '42883', // undefined_function
]);

export class BackendCapabilityError extends Error {
  readonly name = 'BackendCapabilityError';

  constructor(
    readonly code: BackendCapabilityCode,
    readonly backend?: BackendErrorDetails,
  ) {
    super(code);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function errorDetails(error: unknown): BackendErrorDetails | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = error as Record<string, unknown>;
  return {
    code: typeof value.code === 'string' ? value.code : undefined,
    message: typeof value.message === 'string' ? value.message : undefined,
    details: typeof value.details === 'string' || value.details === null ? value.details : undefined,
    hint: typeof value.hint === 'string' || value.hint === null ? value.hint : undefined,
    status: typeof value.status === 'number' ? value.status : undefined,
  };
}

/**
 * Turns a known missing-schema response into a typed capability error.
 *
 * The identifier check matters: `42703` for an unrelated optional column must
 * not suddenly claim that collaboration is missing. PostgREST's documented
 * missing-table response is `PGRST205`; direct Postgres/RPC paths can surface
 * the SQLSTATE equivalents instead.
 */
export function toBackendCapabilityError(
  error: unknown,
  capability: BackendCapabilityCode,
): BackendCapabilityError | null {
  if (error instanceof BackendCapabilityError) return error;

  const backend = errorDetails(error);
  if (!backend?.code || !MISSING_OBJECT_CODES.has(backend.code)) return null;

  const diagnostic = [backend.message, backend.details, backend.hint]
    .filter((part): part is string => Boolean(part))
    .join(' ')
    .toLowerCase();
  const expected = EXPECTED_IDENTIFIERS[capability];

  return expected.some((identifier) => diagnostic.includes(identifier.toLowerCase()))
    ? new BackendCapabilityError(capability, backend)
    : null;
}

/**
 * Re-throws a backend response, promoting only proven schema incompatibility.
 * Callers keep normal permission/network errors as ordinary failures.
 */
export function throwBackendError(
  error: unknown,
  capability: BackendCapabilityCode,
  fallback = 'Não foi possível concluir a operação.',
): never {
  const capabilityError = toBackendCapabilityError(error, capability);
  if (capabilityError) {
    if (process.env.NODE_ENV !== 'production') {
      // No payload or user data is logged: only schema diagnostics returned by
      // PostgREST/Postgres for the expected object.
      console.warn('BACKEND_CAPABILITY_ERROR', {
        code: capabilityError.code,
        backendCode: capabilityError.backend?.code,
        message: capabilityError.backend?.message,
        details: capabilityError.backend?.details,
        hint: capabilityError.backend?.hint,
      });
    }
    throw capabilityError;
  }

  if (error instanceof Error) throw error;
  const backend = errorDetails(error);
  throw new Error(backend?.message || fallback);
}

export function isBackendCapabilityError(error: unknown): error is BackendCapabilityError {
  return error instanceof BackendCapabilityError;
}

/** Friendly production copy; internal schema names stay in DEV diagnostics. */
export function describeBackendCapability(error: unknown): string | undefined {
  if (!isBackendCapabilityError(error)) return undefined;

  switch (error.code) {
    case 'MISSING_TRIP_MEMBERS':
      return 'Os recursos de colaboração ainda não estão disponíveis neste servidor. Sua permissão não foi alterada; a equipe precisa atualizar o backend antes que esta viagem possa ser aberta com segurança.';
    case 'MISSING_VISIBILITY':
      return 'A privacidade dos itens ainda não está disponível neste servidor. Atualize o backend antes de criar ou alterar conteúdo.';
    case 'MISSING_NOTIFICATIONS':
      return 'Notificações e lembretes ainda não estão disponíveis neste servidor.';
    case 'MISSING_RESERVATIONS_SCHEMA':
      return 'Reservas ainda não estão disponíveis neste servidor. A equipe precisa atualizar o backend.';
    case 'MISSING_SUGGESTIONS_SCHEMA':
      return 'Sugestões ainda não estão disponíveis neste servidor. A equipe precisa atualizar o backend.';
  }
}
