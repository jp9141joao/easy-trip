/**
 * A viagem que a **IA** está lendo — uma seleção própria, separada da viagem
 * ativa do resto do aplicativo.
 *
 * DUAS PERGUNTAS DIFERENTES
 *
 * `currentTripId` (`TripSelectionProvider`) responde "o que estou vendo?": é a
 * viagem que a Home abre, que os módulos carregam, que o dock leva. Este
 * arquivo responde outra coisa — "sobre o que estou perguntando?".
 *
 * Elas pareciam a mesma pergunta e não são. Enquanto a IA usava
 * `currentTripId` como pré-seleção, escolher Paris na Home mudava por baixo o
 * contexto de uma conversa sobre Tóquio: o usuário não pediu, não viu e a
 * resposta seguinte saía com os dados da viagem errada. A independência não é
 * preferência de arquitetura, é o que impede a troca silenciosa de contexto.
 *
 * Por isso **não existe fallback para `currentTripId` aqui**, e é deliberado.
 * Sem escolha anterior, a IA abre sem contexto e pede uma escolha — que é uma
 * pergunta honesta — em vez de adivinhar uma viagem e responder sobre ela.
 *
 * A chave é por conta: a seleção pertence a quem escolheu, e a conta seguinte
 * a entrar neste aparelho não herda o contexto da anterior (P-06).
 */

import { prefsStorage } from './storage';

const KEY_PREFIX = 'aiTripContextId:';

const keyFor = (userId: string) => `${KEY_PREFIX}${userId}`;

/** O último contexto escolhido **na IA** por esta conta, se houver. */
export async function readAITripContext(userId: string): Promise<string | null> {
  return prefsStorage.get<string | null>(keyFor(userId), null);
}

/** Grava a escolha; `null` apaga. */
export async function writeAITripContext(
  userId: string,
  tripId: string | null,
): Promise<void> {
  if (tripId) await prefsStorage.set(keyFor(userId), tripId);
  else await prefsStorage.remove(keyFor(userId));
}

/** Sai junto com a conta, como todo dado privado guardado no aparelho. */
export async function clearAITripContext(userId: string): Promise<void> {
  await prefsStorage.remove(keyFor(userId));
}
