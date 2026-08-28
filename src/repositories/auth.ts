/**
 * Authentication (§18).
 *
 * Two adapters behind one interface:
 *
 *  - `SupabaseAuthAdapter` — real hosted auth. Password handling, session
 *    refresh and recovery e-mails are the provider's job, never ours.
 *  - `LocalAuthAdapter`    — device-only accounts for the demonstration mode,
 *    used when no Supabase project is configured. Passwords are salted and
 *    hashed with SHA-256 rather than stored in clear text, but this mode is
 *    explicitly labelled in the UI as local-only; it is not a security claim.
 */

import * as Crypto from 'expo-crypto';

import type { User } from '@/domain/types';
import { traceAuth } from '@/lib/authTrace';
import { nowISO } from '@/lib/date';
import { createId } from '@/lib/id';
import { jsonStorage, secureStorage } from '@/lib/storage';
import {
  beginSupabaseLocalSignOutSession,
  getSupabaseClient,
  isSupabaseLocalSessionRemoved,
} from './supabase/client';
import { config } from '@/lib/config';

export interface AuthSession {
  user: User;
  /** Present only for hosted auth — the BFF validates it. */
  accessToken?: string;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'invalid-credentials'
      | 'email-taken'
      | 'weak-password'
      | 'email-not-confirmed'
      | 'rate-limited'
      | 'not-found'
      | 'network'
      | 'unsupported'
      | 'unknown' = 'unknown',
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * Cadastrar tem dois finais legítimos, e qual deles acontece depende de uma
 * configuração do projeto que o aplicativo não controla — "Confirm email"
 * ligado ou desligado no Supabase.
 *
 * Por isso os dois são retorno, e não exceção: "confirme seu e-mail" é um
 * cadastro que deu certo. Tratá-lo como erro faria a tela pintar de vermelho o
 * caminho feliz, e obrigaria a UI a ler a mensagem para adivinhar o que houve.
 */
export type SignUpOutcome =
  | { status: 'signed-in'; session: AuthSession }
  | { status: 'confirmation-required'; email: string };

/** Dados que o link de recuperação carrega de volta para dentro do aplicativo. */
export type RecoveryGrant =
  | { kind: 'tokens'; accessToken: string; refreshToken: string }
  | { kind: 'code'; code: string };

export interface AuthAdapter {
  readonly kind: 'supabase' | 'local';
  /**
   * Se `false`, os registros do usuário precisam ser apagados pelo aplicativo
   * antes de encerrar a conta. Em modo Supabase é `true`: quem apaga é a Edge
   * Function `delete-account`, em ordem e com verificação (P-02).
   */
  readonly ownsDataDeletion: boolean;
  restore(): Promise<AuthSession | null>;
  /**
   * Avisa toda vez que a sessão muda — inclusive por fora do aplicativo
   * (token renovado, token revogado, sessão encerrada em outro aparelho).
   * Devolve a função que cancela a inscrição.
   */
  onAuthStateChange(listener: (session: AuthSession | null) => void): () => void;
  signIn(email: string, password: string): Promise<AuthSession>;
  signUp(email: string, password: string, name: string): Promise<SignUpOutcome>;
  signOut(): Promise<void>;
  requestPasswordReset(email: string, redirectTo?: string): Promise<void>;
  /** Troca o material do link de recuperação por uma sessão utilizável. */
  redeemRecovery(grant: RecoveryGrant): Promise<AuthSession>;
  /** Só faz sentido com sessão ativa — inclusive a que veio da recuperação. */
  updatePassword(password: string): Promise<void>;
  deleteAccount(session: AuthSession): Promise<void>;
}

/**
 * A conta não pode ser excluída porque destruiria dado alheio.
 *
 * `trips.user_id` referencia `auth.users` com `on delete cascade` (0001): se o
 * proprietário de uma viagem compartilhada sumir, a viagem some junto — com as
 * despesas, o diário e o roteiro dos OUTROS membros. A Edge Function recusa, e
 * este erro carrega a lista de viagens para a tela poder dizer quais são.
 *
 * Não é uma falha de rede nem um "tente de novo": é uma condição que a pessoa
 * resolve transferindo a propriedade ou encerrando a colaboração.
 */
export class AccountDeletionBlockedError extends Error {
  readonly code = 'ownership-blocked' as const;
  readonly trips: { tripId: string; destinationCity: string; otherMembers: number }[];

  constructor(trips: AccountDeletionBlockedError['trips']) {
    const nomes = trips.map((t) => t.destinationCity).join(', ');
    super(
      trips.length === 1
        ? `Você é proprietário da viagem ${nomes}, que tem outros viajantes. ` +
          'Transfira a propriedade ou remova os demais antes de excluir a conta.'
        : `Você é proprietário de ${trips.length} viagens com outros viajantes (${nomes}). ` +
          'Transfira a propriedade ou remova os demais antes de excluir a conta.',
    );
    this.name = 'AccountDeletionBlockedError';
    this.trips = trips;
  }
}

/**
 * Traduz a resposta do provedor para algo que uma pessoa entenda.
 *
 * Duas regras: a mensagem do Supabase nunca chega crua à tela (ela é em inglês,
 * fala de implementação e às vezes revela se um e-mail existe), e o padrão é
 * genérico — um caso não previsto vira uma frase útil, não um vazamento.
 */
function describeAuthFailure(raw: string, fallback: string): AuthError {
  const message = raw.toLowerCase();

  if (message.includes('invalid login') || message.includes('invalid credentials')) {
    return new AuthError('E-mail ou senha incorretos.', 'invalid-credentials');
  }
  if (message.includes('email not confirmed')) {
    return new AuthError(
      'Confirme o e-mail enviado no cadastro antes de entrar.',
      'email-not-confirmed',
    );
  }
  if (message.includes('already registered') || message.includes('already been registered')) {
    return new AuthError('Já existe uma conta com esse e-mail.', 'email-taken');
  }
  if (message.includes('password should be') || message.includes('weak password')) {
    return new AuthError('Escolha uma senha mais forte, com pelo menos 8 caracteres.', 'weak-password');
  }
  if (message.includes('rate limit') || message.includes('too many')) {
    return new AuthError(
      'Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.',
      'rate-limited',
    );
  }
  if (message.includes('network') || message.includes('fetch') || message.includes('timeout')) {
    return new AuthError('Sem conexão com o servidor. Verifique sua internet.', 'network');
  }
  return new AuthError(fallback, 'unknown');
}

/* ------------------------------ local adapter ----------------------------- */

interface LocalCredential {
  id: string;
  email: string;
  salt: string;
  hash: string;
  createdAt: string;
}

const CREDENTIALS_KEY = 'auth:credentials';
const SESSION_KEY = 'easytrip.session';

async function hashPassword(password: string, salt: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${password}`);
}

class LocalAuthAdapter implements AuthAdapter {
  readonly kind = 'local' as const;
  /** Não há servidor para apagar nada: quem limpa os registros é o aplicativo. */
  readonly ownsDataDeletion = false;

  private readonly listeners = new Set<(session: AuthSession | null) => void>();

  /**
   * O modo local emite os mesmos avisos que o Supabase emitiria. Sem isso o
   * provider precisaria de dois caminhos — um que escuta e outro que confia no
   * retorno da chamada — e passariam a existir duas versões da verdade.
   */
  onAuthStateChange(listener: (session: AuthSession | null) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(session: AuthSession | null, event: 'SIGNED_IN' | 'SIGNED_OUT'): void {
    traceAuth(`AUTH_STATE_CHANGE:${event}`);
    for (const listener of this.listeners) listener(session);
  }

  private async readCredentials(): Promise<LocalCredential[]> {
    return jsonStorage.get<LocalCredential[]>(CREDENTIALS_KEY, []);
  }

  async restore(): Promise<AuthSession | null> {
    const raw = await secureStorage.get(SESSION_KEY);
    if (!raw) return null;
    try {
      const stored = JSON.parse(raw) as { userId: string };
      const credentials = await this.readCredentials();
      const found = credentials.find((c) => c.id === stored.userId);
      if (!found) return null;
      return {
        user: {
          id: found.id,
          email: found.email,
          createdAt: found.createdAt,
          updatedAt: found.createdAt,
        },
      };
    } catch {
      return null;
    }
  }

  async signIn(email: string, password: string): Promise<AuthSession> {
    const credentials = await this.readCredentials();
    const account = credentials.find((c) => c.email === email.toLowerCase());
    if (!account) {
      throw new AuthError('Não encontramos uma conta com esse e-mail.', 'invalid-credentials');
    }

    const hash = await hashPassword(password, account.salt);
    if (hash !== account.hash) {
      throw new AuthError('E-mail ou senha incorretos.', 'invalid-credentials');
    }

    await secureStorage.set(SESSION_KEY, JSON.stringify({ userId: account.id }));
    const session: AuthSession = {
      user: {
        id: account.id,
        email: account.email,
        createdAt: account.createdAt,
        updatedAt: account.createdAt,
      },
    };
    this.emit(session, 'SIGNED_IN');
    return session;
  }

  async signUp(email: string, password: string): Promise<SignUpOutcome> {
    const credentials = await this.readCredentials();
    const normalized = email.toLowerCase();
    if (credentials.some((c) => c.email === normalized)) {
      throw new AuthError('Já existe uma conta com esse e-mail.', 'email-taken');
    }

    const salt = createId();
    const account: LocalCredential = {
      id: createId(),
      email: normalized,
      salt,
      hash: await hashPassword(password, salt),
      createdAt: nowISO(),
    };

    await jsonStorage.set(CREDENTIALS_KEY, [...credentials, account]);
    await secureStorage.set(SESSION_KEY, JSON.stringify({ userId: account.id }));

    const session: AuthSession = {
      user: {
        id: account.id,
        email: account.email,
        createdAt: account.createdAt,
        updatedAt: account.createdAt,
      },
    };
    this.emit(session, 'SIGNED_IN');
    // Sem servidor de e-mail não há o que confirmar: a conta local já entra.
    return { status: 'signed-in', session };
  }

  async signOut(): Promise<void> {
    await secureStorage.remove(SESSION_KEY);
    traceAuth('LOCAL_SESSION_REMOVE');
    this.emit(null, 'SIGNED_OUT');
  }

  async requestPasswordReset(email: string): Promise<void> {
    const credentials = await this.readCredentials();
    if (!credentials.some((c) => c.email === email.toLowerCase())) {
      throw new AuthError('Não encontramos uma conta com esse e-mail.', 'not-found');
    }
    // There is no mail server in local mode. Saying "enviamos um e-mail" would
    // be a lie (§8), so the screen renders a mode-specific explanation instead.
    throw new AuthError(
      'A recuperação por e-mail exige o backend configurado. Neste modo, os dados ficam apenas neste dispositivo.',
      'network',
    );
  }

  async deleteAccount(session: AuthSession): Promise<void> {
    const credentials = await this.readCredentials();
    await jsonStorage.set(
      CREDENTIALS_KEY,
      credentials.filter((c) => c.id !== session.user.id),
    );
    await secureStorage.remove(SESSION_KEY);
    traceAuth('LOCAL_SESSION_REMOVE');
    this.emit(null, 'SIGNED_OUT');
  }

  async redeemRecovery(): Promise<AuthSession> {
    // Não existe link de recuperação sem e-mail. Recusar é a resposta honesta;
    // devolver uma sessão qualquer seria autenticar sem prova de identidade.
    throw new AuthError(
      'A recuperação por e-mail exige o backend configurado.',
      'unsupported',
    );
  }

  async updatePassword(): Promise<void> {
    throw new AuthError(
      'A troca de senha exige o backend configurado. Neste modo, os dados ficam apenas neste dispositivo.',
      'unsupported',
    );
  }
}

/* ---------------------------- supabase adapter ---------------------------- */

/** Safety net above the transport deadline configured in `supabase/client`. */
const SIGN_OUT_OPERATION_BUDGET_MS = 2_000;

/** A disk read should be quick, but it must not hold the UI forever either. */
const SIGN_OUT_CHECK_MS = 1_000;

/** Marca de "o prazo estourou", distinguível de um `null` legítimo. */
const TIMED_OUT: unique symbol = Symbol('timed-out');
type TimedOut = typeof TIMED_OUT;

/**
 * Espera `promise` por no máximo `ms`, devolvendo `TIMED_OUT` quando estoura.
 *
 * This is a final safety net for initialization/storage/subscriber failures.
 * The `/logout` fetch itself is actively aborted by the client transport.
 */
async function withDeadline<T>(promise: PromiseLike<T>, ms: number): Promise<T | TimedOut> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<TimedOut>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), ms);
    });
    return await Promise.race([Promise.resolve(promise), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

class SupabaseAuthAdapter implements AuthAdapter {
  readonly kind = 'supabase' as const;
  /** A Edge Function `delete-account` apaga arquivos e conta, nesta ordem (P-02). */
  readonly ownsDataDeletion = true;

  onAuthStateChange(listener: (session: AuthSession | null) => void): () => void {
    const { data } = getSupabaseClient().auth.onAuthStateChange((event, session) => {
      traceAuth(`AUTH_STATE_CHANGE:${event}`);
      listener(session ? toSession(session) : null);
    });
    return () => data.subscription.unsubscribe();
  }

  async restore(): Promise<AuthSession | null> {
    const client = getSupabaseClient();
    const { data, error } = await client.auth.getSession();
    if (error || !data.session) return null;
    return toSession(data.session);
  }

  async signIn(email: string, password: string): Promise<AuthSession> {
    const client = getSupabaseClient();
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw describeAuthFailure(error.message, 'Não foi possível entrar agora.');
    if (!data.session) {
      throw new AuthError('E-mail ou senha incorretos.', 'invalid-credentials');
    }
    return toSession(data.session);
  }

  async signUp(email: string, password: string, name: string): Promise<SignUpOutcome> {
    const client = getSupabaseClient();
    const { data, error } = await client.auth.signUp({
      email,
      password,
      // O nome viaja nos metadados porque é ali que o gatilho `handle_new_user`
      // (0001) o lê para criar o perfil. O aplicativo não insere o perfil.
      options: { data: { name } },
    });
    if (error) {
      throw describeAuthFailure(error.message, 'Não foi possível criar a conta agora.');
    }
    // Sem sessão significa "Confirm email" ligado no projeto. É sucesso, e a
    // tela precisa poder dizer isso — não é o mesmo que uma falha de cadastro.
    if (!data.session) return { status: 'confirmation-required', email };
    return { status: 'signed-in', session: toSession(data.session) };
  }

  /**
   * Encerrar **esta** sessão, neste aparelho, agora.
   *
   * auth-js 2.112.3 owns the removal. Even when `/logout` is aborted or returns
   * a retryable error it calls its private `_removeSession()`, which both
   * clears AsyncStorage and advances the SDK's refresh-race epoch. Removing the
   * key behind its back and launching a second `signOut()` (the previous
   * hotfix) skipped that invariant and left an uncancelled request behind.
   *
   * The result object is not proof of logout: a remote error can accompany a
   * successful local removal. Conversely, `{ error: null }` is not accepted if
   * storage still contains the session. The direct storage read is the commit
   * point, and a read/removal failure never becomes fake success.
   */
  async signOut(): Promise<void> {
    const client = getSupabaseClient();
    traceAuth('SUPABASE_SIGNOUT_BEGIN');

    let outcome: Awaited<ReturnType<typeof client.auth.signOut>> | TimedOut = TIMED_OUT;
    let failure: unknown;
    const releaseLogoutSessionRead = beginSupabaseLocalSignOutSession();
    try {
      outcome = await withDeadline(
        client.auth.signOut({ scope: 'local' }),
        SIGN_OUT_OPERATION_BUDGET_MS,
      );
    } catch (error) {
      failure = error;
    } finally {
      // A deadline não cancela uma promessa arbitrária da SDK. Libere a
      // projeção mesmo se um subscriber/initialize defeituoso ficar pendurado
      // para sempre; futuras leituras não pertencem à operação antiga.
      releaseLogoutSessionRead();
    }

    let removed: boolean | TimedOut = TIMED_OUT;
    try {
      removed = await withDeadline(isSupabaseLocalSessionRemoved(), SIGN_OUT_CHECK_MS);
    } catch (error) {
      failure ??= error;
    }

    if (removed === true) {
      traceAuth('LOCAL_SESSION_REMOVE');
      traceAuth('SUPABASE_SIGNOUT_END');
      return;
    }

    traceAuth('SUPABASE_SIGNOUT_ERROR');
    const raw =
      outcome !== TIMED_OUT
        ? (outcome.error?.message ?? '')
        : failure instanceof Error
          ? failure.message
          : '';
    throw describeAuthFailure(
      raw,
      'Não foi possível sair da conta. Tente novamente.',
    );
  }

  async requestPasswordReset(email: string, redirectTo?: string): Promise<void> {
    const { error } = await getSupabaseClient().auth.resetPasswordForEmail(
      email,
      redirectTo ? { redirectTo } : undefined,
    );
    // A mensagem crua do provedor pode diferenciar "e-mail não existe" de
    // "e-mail existe", e isso transforma a tela de recuperação num verificador
    // de cadastro. A tela mostra sempre a mesma frase.
    if (error) throw describeAuthFailure(error.message, 'Não foi possível enviar agora.');
  }

  async redeemRecovery(grant: RecoveryGrant): Promise<AuthSession> {
    const client = getSupabaseClient();

    if (grant.kind === 'code') {
      const { data, error } = await client.auth.exchangeCodeForSession(grant.code);
      if (error || !data.session) {
        throw describeAuthFailure(
          error?.message ?? '',
          'Este link de recuperação expirou ou já foi usado. Peça um novo.',
        );
      }
      return toSession(data.session);
    }

    const { data, error } = await client.auth.setSession({
      access_token: grant.accessToken,
      refresh_token: grant.refreshToken,
    });
    if (error || !data.session) {
      throw describeAuthFailure(
        error?.message ?? '',
        'Este link de recuperação expirou ou já foi usado. Peça um novo.',
      );
    }
    return toSession(data.session);
  }

  async updatePassword(password: string): Promise<void> {
    const { error } = await getSupabaseClient().auth.updateUser({ password });
    if (error) throw describeAuthFailure(error.message, 'Não foi possível salvar a nova senha.');
  }

  async deleteAccount(): Promise<void> {
    // Deleting an auth user requires the service role key, which must never be
    // in the bundle (§17). The Edge Function `delete-account` does it with the
    // caller's own JWT.
    const client = getSupabaseClient();
    const { data, error } = await client.functions.invoke('delete-account');

    // Recusa por propriedade não é falha: é a resposta certa, e a tela precisa
    // dizer POR QUE e o que fazer. `functions.invoke` entrega qualquer status
    // não-2xx como `error` com o corpo fora de alcance, então a função responde
    // 200 com `{ ok: false, reason }` justamente para este caso — ver o
    // cabeçalho de `supabase/functions/delete-account/index.ts`.
    const blocked = readDeletionBlock(data);
    if (blocked) throw new AccountDeletionBlockedError(blocked);

    if (error) throw new AuthError('Não foi possível excluir a conta agora.', 'network');
    // A conta já não existe do outro lado: revogar remotamente não tem alvo, e
    // uma falha de rede aqui não pode deixar o aparelho autenticado numa conta
    // apagada. Vale a mesma saída local do botão "Sair".
    await this.signOut().catch(() => undefined);
  }
}

function toSession(session: { access_token: string; user: { id: string; email?: string; created_at?: string } }): AuthSession {
  return {
    accessToken: session.access_token,
    user: {
      id: session.user.id,
      email: session.user.email ?? '',
      createdAt: session.user.created_at ?? nowISO(),
      updatedAt: nowISO(),
    },
  };
}

export const authAdapter: AuthAdapter = config.hasSupabase
  ? new SupabaseAuthAdapter()
  : new LocalAuthAdapter();

/**
 * Lê a recusa por propriedade da resposta da Edge Function.
 *
 * Defensiva de propósito: uma versão antiga da função publicada responde
 * `{ ok: true }` e cai fora daqui sem erro. O contrário — tratar ausência de
 * campo como bloqueio — impediria de excluir a conta contra um backend que
 * ainda não conhece a regra.
 */
function readDeletionBlock(
  data: unknown,
): AccountDeletionBlockedError['trips'] | null {
  if (!data || typeof data !== 'object') return null;
  const body = data as { ok?: unknown; reason?: unknown; trips?: unknown };
  if (body.ok !== false || body.reason !== 'ownership-blocked') return null;
  if (!Array.isArray(body.trips)) return [];
  return body.trips.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const t = row as Record<string, unknown>;
    return typeof t.tripId === 'string' && typeof t.destinationCity === 'string'
      ? [{
          tripId: t.tripId,
          destinationCity: t.destinationCity,
          otherMembers: typeof t.otherMembers === 'number' ? t.otherMembers : 0,
        }]
      : [];
  });
}
