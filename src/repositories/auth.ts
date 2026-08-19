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
      | 'not-found'
      | 'network'
      | 'unknown' = 'unknown',
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface AuthAdapter {
  readonly kind: 'supabase' | 'local';
  restore(): Promise<AuthSession | null>;
  signIn(email: string, password: string): Promise<AuthSession>;
  signUp(email: string, password: string, name: string): Promise<AuthSession>;
  signOut(): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  deleteAccount(session: AuthSession): Promise<void>;
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
    return {
      user: {
        id: account.id,
        email: account.email,
        createdAt: account.createdAt,
        updatedAt: account.createdAt,
      },
    };
  }

  async signUp(email: string, password: string): Promise<AuthSession> {
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

    return {
      user: {
        id: account.id,
        email: account.email,
        createdAt: account.createdAt,
        updatedAt: account.createdAt,
      },
    };
  }

  async signOut(): Promise<void> {
    await secureStorage.remove(SESSION_KEY);
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
  }
}

/* ---------------------------- supabase adapter ---------------------------- */

class SupabaseAuthAdapter implements AuthAdapter {
  readonly kind = 'supabase' as const;

  async restore(): Promise<AuthSession | null> {
    const client = getSupabaseClient();
    const { data, error } = await client.auth.getSession();
    if (error || !data.session) return null;
    return toSession(data.session);
  }

  async signIn(email: string, password: string): Promise<AuthSession> {
    const client = getSupabaseClient();
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      throw new AuthError('E-mail ou senha incorretos.', 'invalid-credentials');
    }
    return toSession(data.session);
  }

  async signUp(email: string, password: string, name: string): Promise<AuthSession> {
    const client = getSupabaseClient();
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: { data: { name } },
    });
    if (error) {
      const taken = error.message.toLowerCase().includes('already');
      throw new AuthError(
        taken ? 'Já existe uma conta com esse e-mail.' : error.message,
        taken ? 'email-taken' : 'unknown',
      );
    }
    if (!data.session) {
      // Project requires e-mail confirmation before a session exists.
      throw new AuthError(
        'Conta criada. Confirme o e-mail enviado para concluir o acesso.',
        'not-found',
      );
    }
    return toSession(data.session);
  }

  async signOut(): Promise<void> {
    await getSupabaseClient().auth.signOut();
  }

  async requestPasswordReset(email: string): Promise<void> {
    const { error } = await getSupabaseClient().auth.resetPasswordForEmail(email);
    if (error) throw new AuthError(error.message, 'unknown');
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
