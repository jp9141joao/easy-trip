/**
 * A database error with the PostgREST diagnostics kept intact.
 *
 * `supabase-js` deliberately returns `code`, `details`, `hint`, and `message`.
 * Converting that object to `new Error(message)` destroys the fields that tell
 * a missing column from RLS, validation, or connectivity. Repository callers
 * may show the human message, while DEV diagnostics can branch on the stable
 * code without logging request payloads.
 */
export interface SupabaseErrorLike {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
  status?: number;
}

export interface RepositoryOperation {
  operation?: 'select' | 'insert' | 'update' | 'upsert' | 'delete' | 'rpc';
  relation?: string;
}

export class SupabaseRepositoryError extends Error {
  readonly name = 'SupabaseRepositoryError';
  readonly code?: string;
  readonly details?: string | null;
  readonly hint?: string | null;
  readonly status?: number;
  readonly operation?: RepositoryOperation['operation'];
  readonly relation?: string;

  constructor(error: SupabaseErrorLike, context: RepositoryOperation = {}) {
    super(error.message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
    this.status = error.status;
    this.operation = context.operation;
    this.relation = context.relation;
  }
}

export function toSupabaseRepositoryError(
  error: SupabaseErrorLike,
  context?: RepositoryOperation,
): SupabaseRepositoryError {
  return error instanceof SupabaseRepositoryError
    ? error
    : new SupabaseRepositoryError(error, context);
}

export function throwSupabaseRepositoryError(
  error: SupabaseErrorLike,
  context?: RepositoryOperation,
): never {
  throw toSupabaseRepositoryError(error, context);
}
