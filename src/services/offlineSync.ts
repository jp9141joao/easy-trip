/**
 * O executor da fila offline (§33).
 *
 * Traduz um item da fila numa chamada de repositório e classifica o que voltar.
 * É a única parte do mecanismo que conhece as duas pontas — por isso é fina, e
 * por isso não decide nada: quem decide o que fazer com uma falha é
 * `classifyFailure`, em `src/domain/offlineQueue.ts`.
 *
 * O `id` VEM DA FILA, E ISSO É A IDEMPOTÊNCIA
 *
 * Uma criação enfileirada já carrega o id que a linha terá. Reenviar o mesmo
 * item — porque a resposta se perdeu, porque o aplicativo morreu no meio —
 * esbarra na chave primária e volta como 23505, que `classifyFailure` lê como
 * "já está feito". Sem isso, cada reenvio criaria uma despesa nova, e o jeito
 * de descobrir seria a soma do orçamento não fechar.
 */

import type { OfflineQueue, QueuedMutation, SyncFailure } from '@/domain/offlineQueue';
import {
  drainableFor,
  markFailed,
  markSucceeded,
  markSyncing,
} from '@/domain/offlineQueue';
import type { DataSource } from '@/repositories/types';

/**
 * Extrai da exceção o que `classifyFailure` precisa.
 *
 * O supabase-js embrulha o erro do PostgREST de formas diferentes conforme o
 * caminho (tabela, RPC, Storage). Esta função procura `status` e `code` onde
 * eles costumam estar, e — importante — devolve os DOIS indefinidos quando não
 * acha nenhum. É essa ausência que distingue "o servidor recusou" de "a
 * requisição não chegou", e as duas levam a tratamentos opostos.
 */
export function describeFailure(error: unknown): SyncFailure {
  if (!error || typeof error !== 'object') {
    return { message: typeof error === 'string' ? error : undefined };
  }
  const e = error as Record<string, unknown>;
  const status =
    typeof e.status === 'number'
      ? e.status
      : typeof e.statusCode === 'number'
        ? e.statusCode
        : undefined;
  const code = typeof e.code === 'string' ? e.code : undefined;
  const message = typeof e.message === 'string' ? e.message : undefined;

  // `TypeError: Network request failed` é o que o fetch do React Native levanta
  // sem sinal. Sem status e sem código, que é exatamente como deve chegar.
  return { status, code, message };
}

type Executor = (source: DataSource, item: QueuedMutation) => Promise<unknown>;

/**
 * O mapa de entidade → repositório.
 *
 * Explícito, e não montado por reflexão sobre o nome: um `dataSource[item.entity]`
 * transformaria um valor inesperado vindo do disco numa chamada arbitrária.
 * A fila é dado persistido, e dado persistido é entrada não confiável.
 */
const EXECUTORS: Record<string, Executor> = {
  'itinerary:create': (s, i) => s.itinerary.create({ id: i.targetId, ...i.payload } as never),
  'itinerary:update': (s, i) => s.itinerary.update(i.targetId, i.payload as never),
  'itinerary:remove': (s, i) => s.itinerary.remove(i.targetId),

  'checklist:create': (s, i) => s.checklist.create({ id: i.targetId, ...i.payload } as never),
  'checklist:update': (s, i) => s.checklist.update(i.targetId, i.payload as never),
  'checklist:remove': (s, i) => s.checklist.remove(i.targetId),

  'expense:create': (s, i) => s.expenses.create({ id: i.targetId, ...i.payload } as never),
  'expense:update': (s, i) => s.expenses.update(i.targetId, i.payload as never),
  'expense:remove': (s, i) => s.expenses.remove(i.targetId),

  'journal:create': (s, i) => s.journal.create({ id: i.targetId, ...i.payload } as never),
  'journal:update': (s, i) => s.journal.update(i.targetId, i.payload as never),
  'journal:remove': (s, i) => s.journal.remove(i.targetId),

  'goal:create': (s, i) => s.goals.create({ id: i.targetId, ...i.payload } as never),
  'goal:update': (s, i) => s.goals.update(i.targetId, i.payload as never),
  'goal:remove': (s, i) => s.goals.remove(i.targetId),
};

export interface DrainResult {
  queue: OfflineQueue;
  succeeded: number;
  failed: number;
  /** Itens que passaram a exigir uma decisão nesta drenagem. */
  needsResolution: number;
}

/**
 * Drena a fila desta sessão, um item por vez.
 *
 * SEQUENCIAL, E NÃO EM PARALELO. Duas mutações da mesma linha em voo ao mesmo
 * tempo chegariam ao servidor em ordem indeterminada, e o resultado seria o de
 * quem chegou por último — que não é o que a pessoa escreveu por último. A fila
 * é curta por natureza (o que coube num período sem rede) e a ordem vale mais
 * do que os milissegundos.
 *
 * `onProgress` recebe a fila depois de CADA item, e é ele que dá durabilidade:
 * o chamador grava em disco a cada passo, e um encerramento abrupto no meio da
 * drenagem perde no máximo o resultado do item em curso — que será reenviado e
 * reconhecido como repetição.
 */
export async function drainQueue(
  source: DataSource,
  queue: OfflineQueue,
  userId: string,
  options: {
    now?: () => string;
    onProgress?: (queue: OfflineQueue) => void | Promise<void>;
    /** Guarda da sessão ativa; deve ser reavaliada após cada espera. */
    canSync?: () => boolean;
  } = {},
): Promise<DrainResult> {
  const agora = options.now ?? (() => new Date().toISOString());
  let atual = queue;
  let succeeded = 0;
  let failed = 0;
  let needsResolution = 0;

  // A lista é tirada UMA vez, no começo. Um item que a própria drenagem
  // acrescentasse não entraria nesta volta — o que evita uma drenagem que nunca
  // termina porque o aplicativo continua escrevendo enquanto ela roda.
  const pendentes = drainableFor(atual, userId, agora());

  for (const item of pendentes) {
    if (options.canSync && !options.canSync()) break;
    const executor = EXECUTORS[`${item.entity}:${item.operation}`];
    if (!executor) {
      // Entidade ou operação que este aplicativo não conhece — uma fila gravada
      // por uma versão mais nova, por exemplo. Não é para tentar adivinhar.
      atual = markFailed(
        atual,
        item.id,
        { code: 'UNSUPPORTED', message: 'Operação não suportada nesta versão.' },
        agora(),
      );
      needsResolution += 1;
      await options.onProgress?.(atual);
      continue;
    }

    const antesDoEnvio = atual;
    atual = markSyncing(atual, item.id, agora());
    await options.onProgress?.(atual);

    // A conta pode mudar enquanto o estado é gravado em disco. Não iniciar
    // uma requisição com a identidade nova; preservar a pendência da antiga.
    if (options.canSync && !options.canSync()) {
      atual = antesDoEnvio;
      await options.onProgress?.(atual);
      break;
    }

    try {
      await executor(source, item);
      atual = markSucceeded(atual, item.id);
      succeeded += 1;
    } catch (error) {
      const antes = atual.find((i) => i.id === item.id);
      atual = markFailed(atual, item.id, describeFailure(error), agora());
      const depois = atual.find((i) => i.id === item.id);
      if (!depois) {
        // `classifyFailure` devolveu `done`: a operação já estava feita.
        succeeded += 1;
      } else if (depois.status === 'needs_resolution' && antes?.status !== 'needs_resolution') {
        needsResolution += 1;
      } else {
        failed += 1;
      }
    }

    await options.onProgress?.(atual);
  }

  return { queue: atual, succeeded, failed, needsResolution };
}
