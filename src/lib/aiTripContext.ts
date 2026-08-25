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
const ownerOperations = new Map<string, Promise<void>>();

const keyFor = (userId: string) => `${KEY_PREFIX}${userId}`;

function enqueueOwnerOperation(userId: string, operation: () => Promise<void>): Promise<void> {
  const previous = ownerOperations.get(userId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  ownerOperations.set(userId, current);
  void current.then(
    () => {
      if (ownerOperations.get(userId) === current) ownerOperations.delete(userId);
    },
    () => {
      if (ownerOperations.get(userId) === current) ownerOperations.delete(userId);
    },
  );
  return current;
}

/** O último contexto escolhido **na IA** por esta conta, se houver. */
export async function readAITripContext(userId: string): Promise<string | null> {
  await ownerOperations.get(userId)?.catch(() => undefined);
  return prefsStorage.get<string | null>(keyFor(userId), null);
}

/** Grava a escolha; `null` apaga. */
export async function writeAITripContext(
  userId: string,
  tripId: string | null,
): Promise<void> {
  await enqueueOwnerOperation(userId, () =>
    tripId ? prefsStorage.set(keyFor(userId), tripId) : prefsStorage.remove(keyFor(userId)),
  );
}

/** Sai junto com a conta, como todo dado privado guardado no aparelho. */
export async function clearAITripContext(userId: string): Promise<void> {
  await enqueueOwnerOperation(userId, () => prefsStorage.remove(keyFor(userId)));
}

/**
 * Apaga a escolha só quando ela aponta para a viagem que a pessoa perdeu.
 *
 * Perder acesso a Paris não pode zerar um contexto de IA que estava em Tóquio —
 * a independência descrita acima vale também para a limpeza. E deixar Paris
 * selecionada faria a próxima pergunta abrir uma conversa sobre uma viagem que
 * o backend vai recusar.
 */
export async function clearAITripContextForTrip(userId: string, tripId: string): Promise<void> {
  const current = await readAITripContext(userId);
  if (current !== tripId) return;
  await writeAITripContext(userId, null);
}
