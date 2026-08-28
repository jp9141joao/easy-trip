/**
 * A fila de mutações offline, em disco (§33).
 *
 * A camada fina entre `src/domain/offlineQueue.ts` — que tem a lógica toda e
 * não sabe o que é disco — e o AsyncStorage.
 *
 * UMA CHAVE POR CONTA, E NÃO UMA FILA COM UM CAMPO `userId`
 *
 * A fila mora em `et:data:offline-queue:{userId}`. Duas contas no mesmo
 * aparelho têm duas chaves, e ler a de uma não alcança a da outra.
 *
 * O campo `userId` dentro de cada item continua existindo, e as duas coisas
 * juntas não são redundância: a chave separa o ARMAZENAMENTO, o campo protege o
 * ENVIO. Um erro que fizesse a fila errada ser carregada — um `userId` velho
 * numa closure, uma troca de conta no meio de um `await` — passaria pela chave,
 * e `drainableFor` pararia ali.
 *
 * SAIR DA CONTA NÃO APAGA A FILA
 *
 * Uma escrita que a pessoa fez e que ainda não subiu é dela, e sair do
 * aplicativo não é desistir dela. A fila fica onde está e volta a drenar quando
 * a mesma conta entrar de novo. Quem apaga é a exclusão de conta, junto com o
 * resto — e `clearQueue` existe para isso.
 */

import {
  recoverInterrupted,
  type OfflineQueue,
} from '@/domain/offlineQueue';
import { jsonStorage } from './storage';

const KEY = (userId: string) => `offline-queue:${userId}`;

/**
 * Lê a fila e recupera o que ficou pela metade.
 *
 * `recoverInterrupted` roda AQUI, e não no drenador, porque este é o único
 * ponto por onde a fila entra vinda de uma execução anterior. Um item em
 * `syncing` no disco só pode ter chegado assim de um aplicativo que morreu no
 * meio do envio.
 */
export async function loadQueue(userId: string, now = new Date().toISOString()): Promise<OfflineQueue> {
  const raw = await jsonStorage.get<OfflineQueue>(KEY(userId), []);
  if (!Array.isArray(raw)) return [];
  // Um item de outro dono nesta chave só pode ser resultado de um defeito.
  // Descartar é mais seguro do que carregar: nada aqui deveria ser de mais
  // ninguém, e enviá-lo com a sessão errada é o pior desfecho possível.
  const meus = raw.filter((item) => item?.userId === userId);
  return recoverInterrupted(meus, now);
}

export async function saveQueue(userId: string, queue: OfflineQueue): Promise<void> {
  await jsonStorage.set(KEY(userId), queue);
}

export async function clearQueue(userId: string): Promise<void> {
  await jsonStorage.remove(KEY(userId));
}
