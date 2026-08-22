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
import { nowISO } from '@/lib/date';
import { createId } from '@/lib/id';
import { jsonStorage, secureStorage } from '@/lib/storage';
import { getSupabaseClient } from './supabase/client';
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

  private emit(session: AuthSession | null): void {
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
    this.emit(session);
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
    this.emit(session);
    // Sem servidor de e-mail não há o que confirmar: a conta local já entra.
    return { status: 'signed-in', session };
  }

  async signOut(): Promise<void> {
    await secureStorage.remove(SESSION_KEY);
    this.emit(null);
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
    this.emit(null);
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

class SupabaseAuthAdapter implements AuthAdapter {
  readonly kind = 'supabase' as const;
  /** A Edge Function `delete-account` apaga arquivos e conta, nesta ordem (P-02). */
  readonly ownsDataDeletion = true;

  onAuthStateChange(listener: (session: AuthSession | null) => void): () => void {
    const { data } = getSupabaseClient().auth.onAuthStateChange((_event, session) => {
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

  async signOut(): Promise<void> {
    await getSupabaseClient().auth.signOut();
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
    const { error } = await client.functions.invoke('delete-account');
    if (error) throw new AuthError('Não foi possível excluir a conta agora.', 'network');
    await client.auth.signOut();
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
