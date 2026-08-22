import { parseRecoveryLink, toRecoveryGrant, RECOVERY_PATH } from '@/lib/authLinking';

/**
 * F4 — leitura do link de recuperação.
 *
 * No celular não há barra de endereços, então o supabase-js não extrai a sessão
 * da URL sozinho (`detectSessionInUrl: false`). Quem abre o envelope é este
 * módulo — e um erro aqui aparece como "o link não funciona", sem nada no log
 * que explique por quê. Daí valer o teste minucioso.
 */

const BASE = `easytrip://${RECOVERY_PATH}`;

describe('link de recuperação', () => {
  it('lê tokens do fragmento, que é o formato do fluxo implícito', () => {
    expect(parseRecoveryLink(`${BASE}#access_token=abc&refresh_token=def&type=recovery`)).toEqual({
      kind: 'tokens',
      accessToken: 'abc',
      refreshToken: 'def',
    });
  });

  it('lê o código da query, que é o formato do fluxo PKCE', () => {
    expect(parseRecoveryLink(`${BASE}?code=xyz&type=recovery`)).toEqual({
      kind: 'code',
      code: 'xyz',
    });
  });

  it('aceita a URL do Expo Go, que não usa o esquema do aplicativo', () => {
    // Em desenvolvimento o retorno é `exp://192.168.0.10:8081/--/redefinir-senha`.
    // Depender do esquema `easytrip://` faria o fluxo funcionar só em build.
    const url = `exp://192.168.0.10:8081/--/${RECOVERY_PATH}#access_token=abc&refresh_token=def&type=recovery`;
    expect(parseRecoveryLink(url)).toMatchObject({ kind: 'tokens' });
  });

  it('reconhece o link vencido e diz isso', () => {
    const link = parseRecoveryLink(`${BASE}#error=access_denied&error_code=otp_expired`);
    expect(link).toMatchObject({ kind: 'error' });
    expect((link as { message: string }).message).toMatch(/expirou/i);
  });

  it('explica sem chutar quando o motivo do erro é outro', () => {
    const link = parseRecoveryLink(`${BASE}#error=server_error`);
    expect(link).toMatchObject({ kind: 'error' });
    expect((link as { message: string }).message).not.toMatch(/expirou/i);
  });

  describe('não confunde outros links com recuperação', () => {
    it.each([
      ['confirmação de cadastro', `${BASE}#access_token=abc&refresh_token=def&type=signup`],
      ['convite', `${BASE}#access_token=abc&refresh_token=def&type=invite`],
      ['deep link comum', 'easytrip://trip/123'],
      ['sem material nenhum', `${BASE}`],
      ['código sem tipo declarado', `${BASE}?code=xyz`],
      ['url vazia', ''],
    ])('%s', (_caso, url) => {
      // Reagir ao link errado levaria o usuário a uma tela de trocar senha que
      // ele não pediu — e, no caso do `signup`, no lugar de simplesmente entrar.
      expect(parseRecoveryLink(url)).toBeNull();
    });

    it('nulo e indefinido', () => {
      expect(parseRecoveryLink(null)).toBeNull();
      expect(parseRecoveryLink(undefined)).toBeNull();
    });
  });

  it('converte o que dá para resgatar, e recusa o que não dá', () => {
    expect(toRecoveryGrant({ kind: 'tokens', accessToken: 'a', refreshToken: 'b' })).toEqual({
      kind: 'tokens',
      accessToken: 'a',
      refreshToken: 'b',
    });
    expect(toRecoveryGrant({ kind: 'code', code: 'c' })).toEqual({ kind: 'code', code: 'c' });
    expect(toRecoveryGrant({ kind: 'error', message: 'x' })).toBeNull();
  });
});
