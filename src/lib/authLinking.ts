/**
 * O caminho de volta do e-mail de recuperação para dentro do aplicativo (§9).
 *
 * No navegador o supabase-js lê a sessão da barra de endereços sozinho. No
 * React Native não existe barra de endereços: o que chega é uma URL de deep
 * link (`easytrip://…`), e por isso o cliente é criado com
 * `detectSessionInUrl: false`. Alguém precisa abrir esse envelope — é o que
 * este módulo faz.
 *
 * Só interpreta a URL. Não fala com o Supabase, não guarda nada e não decide
 * nada: assim a parte que erra fácil (formato de link) é testável sem rede.
 */

import type { RecoveryGrant } from '@/repositories';

export type RecoveryLink =
  | { kind: 'tokens'; accessToken: string; refreshToken: string }
  | { kind: 'code'; code: string }
  | { kind: 'error'; message: string };

/** Os dois formatos que o Supabase pode devolver, mais o de falha. */
function readParams(url: string): URLSearchParams {
  // O material vem no fragmento (`#`) no fluxo implícito e na query (`?`) no
  // PKCE. Ler os dois evita depender de qual `flowType` o projeto usa — o
  // aplicativo não controla essa configuração.
  const [beforeHash, afterHash = ''] = url.split('#');
  const query = beforeHash.includes('?') ? beforeHash.slice(beforeHash.indexOf('?') + 1) : '';
  return new URLSearchParams([
    ...new URLSearchParams(query),
    ...new URLSearchParams(afterHash),
  ]);
}

/**
 * Devolve `null` para qualquer URL que não seja de recuperação — o aplicativo
 * recebe deep links por outros motivos, e reagir ao link errado mandaria o
 * usuário para uma tela de trocar senha que ele não pediu.
 */
export function parseRecoveryLink(url: string | null | undefined): RecoveryLink | null {
  if (!url) return null;

  const params = readParams(url);

  const error = params.get('error') ?? params.get('error_code');
  if (error) {
    // O motivo pode vir em qualquer um dos três campos, e nem sempre nos três:
    // `otp_expired` costuma aparecer só em `error_code`, com `error` genérico.
    const expired = [
      params.get('error'),
      params.get('error_code'),
      params.get('error_description'),
    ]
      .join(' ')
      .toLowerCase()
      .includes('expired');
    return {
      kind: 'error',
      message: expired
        ? 'Este link de recuperação expirou. Peça um novo e-mail.'
        : 'Não foi possível validar este link. Peça um novo e-mail.',
    };
  }

  // `type=recovery` é o que distingue recuperação de confirmação de cadastro ou
  // convite. Sem essa checagem, confirmar um e-mail cairia na tela de senha.
  if (params.get('type') && params.get('type') !== 'recovery') return null;

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (accessToken && refreshToken) return { kind: 'tokens', accessToken, refreshToken };

  const code = params.get('code');
  if (code && params.get('type') === 'recovery') return { kind: 'code', code };

  return null;
}

/** Converte o que veio do link no que o adaptador sabe resgatar. */
export function toRecoveryGrant(link: RecoveryLink): RecoveryGrant | null {
  if (link.kind === 'tokens') {
    return { kind: 'tokens', accessToken: link.accessToken, refreshToken: link.refreshToken };
  }
  if (link.kind === 'code') return { kind: 'code', code: link.code };
  return null;
}

/** Caminho que o e-mail de recuperação deve reabrir. */
export const RECOVERY_PATH = 'redefinir-senha';
