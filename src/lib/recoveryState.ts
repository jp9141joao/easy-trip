/**
 * A marca de "esta sessão é de recuperação de senha", gravada em disco.
 *
 * ## Por que precisa persistir
 *
 * A sessão que o link do e-mail cria é uma sessão de verdade: o supabase-js a
 * grava no armazenamento e a devolve no próximo `getSession()`. Se a única
 * coisa que a distinguia de uma entrada normal fosse um `useState`, fechar e
 * reabrir o aplicativo no meio da troca de senha reabriria o aplicativo
 * INTEIRO — "recebi um e-mail" viraria uma forma de entrar sem saber a senha.
 *
 * Por isso a marca acompanha a sessão no disco, e não a montagem do React. Ela
 * é escrita no instante em que o link é reconhecido — antes de trocar o código
 * por sessão, porque é justamente nessa janela que um evento antecipado do
 * provedor poderia abrir a Home por alguns quadros — e só sai quando a senha é
 * trocada ou quando a pessoa desiste com a saída local comprovada.
 *
 * ## Por que fica em `prefsStorage`
 *
 * O cache e a seleção de viagem são apagados na saída da conta; esta marca
 * não pode ser, porque ela precisa sobreviver exatamente ao caso em que nada
 * mais sobrevive — o aplicativo reiniciado no meio do fluxo. Preferências são o
 * único nível que a saída não toca (ver `src/lib/storage.ts`).
 */

import { prefsStorage } from './storage';

const RECOVERY_KEY = 'auth:recoveryPending:v1';

export interface RecoveryMark {
  /** Preenchido só depois do resgate: antes dele ninguém sabe de quem é. */
  userId?: string;
}

export async function readRecoveryMark(): Promise<RecoveryMark | null> {
  const stored = await prefsStorage.get<RecoveryMark | null>(RECOVERY_KEY, null);
  if (!stored || typeof stored !== 'object') return null;
  return { userId: typeof stored.userId === 'string' ? stored.userId : undefined };
}

export async function writeRecoveryMark(mark: RecoveryMark = {}): Promise<void> {
  await prefsStorage.set(RECOVERY_KEY, mark);
}

export async function clearRecoveryMark(): Promise<void> {
  await prefsStorage.remove(RECOVERY_KEY);
}
