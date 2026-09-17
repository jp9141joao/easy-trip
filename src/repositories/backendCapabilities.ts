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
  'MISSING_PUSH_TOKENS',
  'MISSING_TRIP_GOAL_SCHEMA',
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
  MISSING_PUSH_TOKENS: [
    'push_tokens',
    'register_push_token',
    'unregister_push_token',
  ],
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
    // 0017: sem estas colunas o servidor ainda gasta a janela de seis horas
    // numa geração que falhou, e o aplicativo não tem como distinguir as duas
    // esperas. A leitura da viagem já as pede, então a ausência aparece aqui
    // como incompatibilidade de backend — e não como uma falha sem explicação.
    'suggestions_retry_after',
    'suggestions_attempt_at',
    'settle_trip_suggestion_refresh',
  ],
  /*
   * As duas colunas da 0013 — meta de gasto diário e capa própria da viagem.
   *
   * POR QUE ESTA CAPACIDADE EXISTE.
   *
   * `trips.update` classificava qualquer recusa do PostgREST como erro comum, e
   * a tela traduzia isso em "Não foi possível salvar a meta diária." — uma
   * mensagem que descreve o sintoma e esconde a única informação útil: o
   * servidor não tem a coluna. Medido contra o projeto remoto, o `update` da
   * meta responde `42703 column trips.daily_spending_goal does not exist`, e
   * esse código já estava em `MISSING_OBJECT_CODES` sem nenhuma capacidade que
   * o reivindicasse.
   *
   * As duas colunas dividem a MESMA capacidade porque dividem a mesma
   * migration: um servidor que tem uma tem a outra, e separá-las criaria dois
   * códigos que nunca aparecem sozinhos.
   *
   * O bucket `trip-covers` NÃO está nesta lista. Ele também nasce na 0013, mas
   * a recusa dele vem do Storage e não do PostgREST — chega por outro caminho,
   * com outro formato, e não passa por `toBackendCapabilityError`. Listá-lo aqui
   * sugeriria uma classificação que não acontece.
   */
  MISSING_TRIP_GOAL_SCHEMA: ['daily_spending_goal', 'cover_image_path'],
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

/**
 * Códigos de AUTORIZAÇÃO — o pedido chegou, foi entendido e foi recusado.
 *
 * São o oposto de uma capacidade ausente: o objeto existe no servidor, e quem
 * chamou é que não podia chamar (ou chamou sem sessão válida). Distinguir os
 * dois importa porque a resposta do produto é diferente — capacidade ausente
 * pede publicação de migration, recusa de autorização pede sessão.
 *
 *   42501      insufficient_privilege — inclui o `raise ... using errcode`
 *              que as funções da 0010 usam para "Sessão obrigatória."
 *   PGRST301   JWT ausente, expirado ou inválido.
 *   PGRST302   credencial anônima onde se exige autenticação.
 */
const AUTHORIZATION_CODES = new Set(['42501', 'PGRST301', 'PGRST302']);

/**
 * Uma recusa do backend que NÃO é incompatibilidade de schema — com o
 * diagnóstico preservado.
 *
 * POR QUE ESTA CLASSE EXISTE.
 *
 * O caminho de fallback de `throwBackendError` fazia `new Error(message)`, e
 * isso apagava `code`, `details`, `hint` e `status`. O efeito foi medido: o
 * aviso `REMINDER_DELIVERY_FAILED {"kind":"Error"}` do Android é literalmente
 * o `name` desse `Error` genérico — um log incapaz de nomear a própria causa,
 * porque a causa tinha sido descartada uma camada antes.
 *
 * O erro do PostgREST chega como OBJETO SIMPLES, e não como `Error`: com
 * `shouldThrowOnError` desligado (que é como todo este repositório o usa),
 * `postgrest-js` devolve `JSON.parse` do corpo. Por isso o `instanceof Error`
 * logo abaixo não pegava esses casos, e por isso eles caíam no `new Error`.
 *
 * A mensagem continua idêntica — quem só lê `error.message` não muda de
 * comportamento.
 */
export class BackendRequestError extends Error {
  readonly name = 'BackendRequestError';

  constructor(
    message: string,
    readonly backend?: BackendErrorDetails,
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

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
  // `BackendRequestError`, e não `Error`: ver a nota da classe. O diagnóstico
  // do PostgREST é justamente o que permite separar "sem sessão" de "objeto
  // ausente" de "defeito nosso" — e ele morria exatamente aqui.
  throw new BackendRequestError(backend?.message || fallback, backend);
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
    case 'MISSING_PUSH_TOKENS':
      // Sem 0016, os avisos continuam existindo na Central — o que falta é a
      // entrega pelo sistema operacional. A mensagem diz isso, e não "as
      // notificações não funcionam".
      return 'Os avisos fora do aplicativo ainda não estão disponíveis neste servidor. As notificações continuam aparecendo na Central.';
    case 'MISSING_TRIP_GOAL_SCHEMA':
      // O que a pessoa precisa saber é que não errou o valor e que tentar de
      // novo não vai ajudar. O nome da coluna fica no diagnóstico de DEV.
      return 'A meta de gasto diário e a capa própria da viagem ainda não estão disponíveis neste servidor. O valor informado não foi salvo; a equipe precisa atualizar o backend.';
  }
}

/** O código que o backend devolveu, quando ele sobreviveu até aqui. */
export function readBackendErrorCode(error: unknown): string | undefined {
  if (error instanceof BackendCapabilityError) return error.backend?.code;
  if (error instanceof BackendRequestError) return error.backend?.code;
  return errorDetails(error)?.code;
}

/**
 * A recusa é de autorização/sessão?
 *
 * Separada de `isBackendCapabilityError` de propósito. As duas descrevem
 * situações esperadas e não-defeituosas, mas por motivos opostos: aquela diz
 * "este servidor ainda não tem o recurso", esta diz "este chamador não podia
 * chamar agora". Confundi-las mandaria procurar o problema no lugar errado.
 */
export function isBackendAuthorizationError(error: unknown): boolean {
  if (error instanceof BackendCapabilityError) return false;
  const code = readBackendErrorCode(error);
  if (code && AUTHORIZATION_CODES.has(code)) return true;
  const status = error instanceof BackendRequestError ? error.backend?.status : undefined;
  return status === 401 || status === 403;
}
