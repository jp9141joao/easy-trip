/**
 * Fila durável de mutações feitas sem rede (§33).
 *
 * O QUE ESTE ARQUIVO É, E O QUE NÃO É
 *
 * É a lógica inteira da fila, e nada mais: nenhuma leitura de disco, nenhuma
 * chamada de rede, nenhum React. Recebe uma fila e devolve outra. Isso não é
 * purismo — é o que permite exercitar "criou offline, editou, fechou o
 * aplicativo, abriu, reconectou, o servidor recusou, tentou de novo" como uma
 * sequência de funções, sem simular sistema de arquivos nem cronômetro.
 *
 * Quem guarda em disco é `src/lib/offlineQueue.ts`. Quem drena é
 * `src/hooks/useOfflineQueue.ts`.
 *
 * O ESCOPO É DELIBERADAMENTE ESTREITO
 *
 * Só conteúdo de viagem: roteiro, checklist, despesas, diário e metas. O que
 * fica de fora está listado em `QUEUEABLE` e o motivo está lá — resumindo:
 * enfileirar uma operação cujo resultado depende de quem mais mexeu no meio
 * tempo é pior do que recusá-la enquanto não há rede.
 *
 * A POLÍTICA DE CONFLITO, DITA UMA VEZ
 *
 * Último a escrever vence, para campo simples. É a política honesta para este
 * produto: duas pessoas editando a mesma despesa é raro, e resolver isso com
 * CRDT custaria mais complexidade do que o problema tem. O que NÃO se faz é
 * sobrescrever em silêncio o que não dá para reconciliar — linha apagada no
 * servidor, permissão recusada, dado inválido. Esses viram `needs_resolution`,
 * ficam visíveis, e esperam uma decisão de quem escreveu.
 */

/* ------------------------------- vocabulário ------------------------------ */

export const QUEUEABLE_ENTITIES = [
  'itinerary',
  'checklist',
  'expense',
  'journal',
  'goal',
] as const;

export type QueueableEntity = (typeof QUEUEABLE_ENTITIES)[number];

export type QueueOperation = 'create' | 'update' | 'remove';

/**
 * Os estados, e por que são estes quatro.
 *
 *   queued           esperando a vez. É o estado de repouso.
 *   syncing          uma tentativa está em curso AGORA.
 *   failed           a tentativa falhou por algo que pode melhorar sozinho
 *                    (rede, servidor fora do ar). Volta a `queued` quando o
 *                    tempo de espera passa.
 *   needs_resolution a tentativa falhou por algo que NÃO melhora sozinho:
 *                    a linha sumiu, a permissão foi negada, o dado é inválido.
 *                    Tentar de novo daria o mesmo resultado, então a fila para
 *                    de tentar e mostra o item.
 *
 * Não existe `succeeded`: item que deu certo sai da fila. Guardá-lo faria a
 * fila crescer para sempre com registros que ninguém lê — e a pergunta que ela
 * responde é "o que ainda falta subir?", não "o que já subiu".
 */
export type QueueItemStatus = 'queued' | 'syncing' | 'failed' | 'needs_resolution';

export interface QueuedMutation {
  /** Identidade do item DENTRO da fila. */
  id: string;
  /**
   * De quem é esta mutação.
   *
   * Está gravado no item, e não só na chave de armazenamento, de propósito: é a
   * segunda barreira contra sincronizar a escrita de uma conta na sessão de
   * outra. `drainableFor` compara os dois, e um item de outro dono nunca é
   * enviado — nem quando a fila é carregada da chave errada por engano.
   */
  userId: string;
  entity: QueueableEntity;
  operation: QueueOperation;
  /**
   * O id da LINHA. Para `create`, é gerado no aparelho antes de haver rede, e é
   * o mesmo id que a linha terá no servidor — é isso que faz a criação ser
   * idempotente sem precisar de negociação.
   */
  targetId: string;
  tripId?: string;
  payload: Record<string, unknown>;
  /**
   * Chave de idempotência. Deriva de entidade + operação + alvo, e não do
   * momento: reenviar o MESMO item depois de uma resposta perdida tem de ser
   * reconhecido como repetição, e não virar uma segunda linha.
   */
  idempotencyKey: string;
  status: QueueItemStatus;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  /** Antes deste instante, o item não é tentado de novo. */
  nextAttemptAt: string;
  lastError?: string;
  /**
   * `updatedAt` da linha no momento em que a edição foi feita offline.
   *
   * É a base da comparação de conflito: se o servidor mostrar algo mais novo,
   * houve escrita de outra pessoa no meio. Ausente em `create`, que não tem
   * versão anterior.
   */
  baseUpdatedAt?: string;
}

export type OfflineQueue = QueuedMutation[];

/* ----------------------------- o que entra ------------------------------- */

/**
 * A lista de permissões, e ela é uma lista de PERMISSÕES — não uma lista de
 * proibições com exceções.
 *
 * O que está fora, e por quê:
 *
 *   exclusão de conta        destrói dado. Uma confirmação dada há três dias,
 *                            executada agora sem que a pessoa esteja olhando,
 *                            não é consentimento.
 *   transferência de viagem  o destinatário pode ter saído da viagem no meio
 *                            tempo. A operação precisa da lista de membros de
 *                            AGORA, não da de ontem.
 *   papel de membro          idem: promover alguém que já foi removido.
 *   convidar/remover         o mesmo, e com efeito sobre terceiros.
 *   qualquer coisa de admin  publicação de conteúdo tem revisão humana; adiá-la
 *                            para "quando houver rede" quebra a revisão.
 *   arquivos                 o binário pode não existir mais no aparelho quando
 *                            a fila drenar. Fila de bytes é outro problema, com
 *                            outro desenho.
 *
 * Nada disso é impossível de enfileirar — é que cada um precisaria de um
 * desenho próprio, e enfileirá-los "junto" seria escolher não pensar neles.
 */
const QUEUEABLE: Record<QueueableEntity, QueueOperation[]> = {
  itinerary: ['create', 'update', 'remove'],
  checklist: ['create', 'update', 'remove'],
  expense: ['create', 'update', 'remove'],
  journal: ['create', 'update', 'remove'],
  goal: ['create', 'update', 'remove'],
};

export function isQueueable(entity: string, operation: string): boolean {
  const allowed = QUEUEABLE[entity as QueueableEntity];
  return Boolean(allowed?.includes(operation as QueueOperation));
}

export function idempotencyKeyFor(
  entity: QueueableEntity,
  operation: QueueOperation,
  targetId: string,
): string {
  return `${entity}:${operation}:${targetId}`;
}

/* -------------------------------- backoff -------------------------------- */

/** Depois disto, o item para de tentar sozinho e passa a pedir uma decisão. */
export const MAX_ATTEMPTS = 6;

const BASE_DELAY_MS = 5_000;
const MAX_DELAY_MS = 30 * 60_000;

/**
 * Espera exponencial, sem sorteio.
 *
 * Sem `Math.random`: um atraso sorteado tornaria o teste da própria espera
 * impossível de escrever sem interceptar o gerador. O sorteio existe para
 * dessincronizar clientes que falham juntos, e este produto não tem escala para
 * o problema que ele resolve — um aparelho, uma fila.
 *
 *   1ª falha →  5 s      4ª → 40 s
 *   2ª      → 10 s      5ª → 80 s
 *   3ª      → 20 s      6ª → 160 s   (teto: 30 min)
 */
export function backoffDelayMs(attempts: number): number {
  const exponent = Math.max(0, attempts - 1);
  return Math.min(BASE_DELAY_MS * 2 ** exponent, MAX_DELAY_MS);
}

/* ------------------------------ classificação ----------------------------- */

/**
 * O que fazer com uma falha depende inteiramente de ela poder melhorar sozinha.
 *
 *   retry   rede, tempo esgotado, 5xx. Esperar resolve, ou pelo menos pode.
 *   resolve permissão, dado inválido, linha inexistente. Esperar não resolve —
 *           tentar de novo por seis horas produziria a mesma recusa e
 *           esconderia do usuário que há uma decisão a tomar.
 *   done    a operação já está feita do outro lado. Não é falha: é a
 *           idempotência funcionando, e o item sai da fila.
 */
export type FailureKind = 'retry' | 'resolve' | 'done';

export interface SyncFailure {
  /** Código HTTP, quando houve resposta. */
  status?: number;
  /** Código do PostgREST/Postgres, quando houve. */
  code?: string;
  message?: string;
}

export function classifyFailure(
  failure: SyncFailure,
  operation: QueueOperation,
): FailureKind {
  const { status, code } = failure;

  // Apagar o que já não existe é o resultado desejado, não um erro. Só para
  // `remove`: um `update` numa linha que sumiu é outra história (abaixo).
  if (operation === 'remove' && (status === 404 || code === 'PGRST116')) return 'done';

  // Criação repetida: a linha já está lá com o mesmo id. É a resposta do
  // servidor a um reenvio, e o item cumpriu seu papel.
  if (operation === 'create' && code === '23505') return 'done';

  // Sem status e sem código é falha de transporte — o `fetch` nem chegou a
  // receber resposta.
  if (status === undefined && code === undefined) return 'retry';

  if (status === 401 || status === 403 || code === '42501') return 'resolve';
  if (status === 404 || code === 'PGRST116') return 'resolve';
  if (status === 409 || code === '23505') return 'resolve';
  if (status !== undefined && status >= 400 && status < 500) return 'resolve';
  if (status !== undefined && status >= 500) return 'retry';
  if (code) return 'resolve';

  return 'retry';
}

/* -------------------------------- operações ------------------------------- */

export interface EnqueueInput {
  id: string;
  userId: string;
  entity: QueueableEntity;
  operation: QueueOperation;
  targetId: string;
  tripId?: string;
  payload?: Record<string, unknown>;
  baseUpdatedAt?: string;
}

/**
 * Acrescenta uma mutação — ou dobra-a sobre uma que já estava lá.
 *
 * A DOBRA É O PONTO. Editar o mesmo campo quatro vezes sem rede tem de produzir
 * UMA escrita, não quatro; e apagar algo que ainda nem subiu tem de produzir
 * NENHUMA, não duas. Sem isso, um voo de dez horas mexendo no roteiro viraria
 * uma avalanche de requisições no momento em que o avião pousa, várias delas
 * corrigindo umas às outras — e o servidor veria estados intermediários que
 * nunca foram a intenção de ninguém.
 *
 * As quatro combinações que importam:
 *
 *   create + update  → um `create` com o payload mesclado. A linha nunca
 *                      existiu no servidor; mandá-la já certa é mais simples e
 *                      mais barato do que criar errado e corrigir.
 *   create + remove  → nada. Os dois somem. Criar para apagar em seguida é
 *                      trabalho que ninguém precisa ver.
 *   update + update  → um `update` com os campos mesclados, o mais novo por
 *                      cima. `baseUpdatedAt` fica o da PRIMEIRA edição: é
 *                      contra o estado que a pessoa viu que o conflito deve ser
 *                      medido.
 *   update + remove  → só o `remove`. Editar e depois apagar é apagar.
 *
 * Um item em `syncing` NÃO é dobrado: ele já está no ar, e mesclar por cima
 * mudaria o que está sendo enviado neste instante. A mutação nova entra
 * separada e a ordem cuida do resto.
 */
export function enqueue(
  queue: OfflineQueue,
  input: EnqueueInput,
  now: string,
): OfflineQueue {
  if (!isQueueable(input.entity, input.operation)) return queue;

  const pending = queue.findIndex(
    (item) =>
      item.userId === input.userId &&
      item.entity === input.entity &&
      item.targetId === input.targetId &&
      item.status !== 'syncing',
  );

  const fresh: QueuedMutation = {
    id: input.id,
    userId: input.userId,
    entity: input.entity,
    operation: input.operation,
    targetId: input.targetId,
    tripId: input.tripId,
    payload: input.payload ?? {},
    idempotencyKey: idempotencyKeyFor(input.entity, input.operation, input.targetId),
    status: 'queued',
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    nextAttemptAt: now,
    baseUpdatedAt: input.baseUpdatedAt,
  };

  if (pending === -1) return [...queue, fresh];

  const anterior = queue[pending];
  const resto = queue.filter((_, index) => index !== pending);

  if (anterior.operation === 'create' && input.operation === 'remove') {
    return resto;
  }

  if (anterior.operation === 'create' && input.operation === 'update') {
    return [
      ...resto,
      {
        ...anterior,
        payload: { ...anterior.payload, ...fresh.payload },
        updatedAt: now,
        // Uma dobra devolve o item ao começo: a espera acumulada era de uma
        // tentativa que já não descreve o que será enviado.
        status: 'queued',
        attempts: 0,
        nextAttemptAt: now,
        lastError: undefined,
      },
    ];
  }

  if (input.operation === 'remove') {
    return [...resto, { ...fresh, createdAt: anterior.createdAt }];
  }

  if (anterior.operation === 'update' && input.operation === 'update') {
    return [
      ...resto,
      {
        ...anterior,
        payload: { ...anterior.payload, ...fresh.payload },
        updatedAt: now,
        status: 'queued',
        attempts: 0,
        nextAttemptAt: now,
        lastError: undefined,
        baseUpdatedAt: anterior.baseUpdatedAt ?? input.baseUpdatedAt,
      },
    ];
  }

  return [...resto, fresh];
}

/**
 * O que pode ser enviado agora, para ESTA sessão.
 *
 * Três filtros, e o primeiro é o que importa: `item.userId === userId`. Sem
 * ele, trocar de conta no mesmo aparelho drenaria a fila da conta anterior com
 * o token da nova — as escritas de uma pessoa apareceriam como escritas de
 * outra, o que a RLS provavelmente recusaria e, onde não recusasse, seria pior.
 *
 * `needs_resolution` não sai daqui: ele espera uma decisão, não um relógio.
 */
export function drainableFor(
  queue: OfflineQueue,
  userId: string,
  now: string,
): OfflineQueue {
  return queue.filter(
    (item) =>
      item.userId === userId &&
      (item.status === 'queued' || item.status === 'failed') &&
      item.nextAttemptAt <= now,
  );
}

export function markSyncing(
  queue: OfflineQueue,
  id: string,
  now: string,
): OfflineQueue {
  return queue.map((item) =>
    item.id === id
      ? { ...item, status: 'syncing' as const, attempts: item.attempts + 1, updatedAt: now }
      : item,
  );
}

/** Deu certo: o item sai. Ver o comentário sobre a ausência de `succeeded`. */
export function markSucceeded(queue: OfflineQueue, id: string): OfflineQueue {
  return queue.filter((item) => item.id !== id);
}

export function markFailed(
  queue: OfflineQueue,
  id: string,
  failure: SyncFailure,
  now: string,
): OfflineQueue {
  return queue.flatMap((item) => {
    if (item.id !== id) return [item];

    const kind = classifyFailure(failure, item.operation);
    if (kind === 'done') return [];

    const esgotou = item.attempts >= MAX_ATTEMPTS;
    if (kind === 'resolve' || esgotou) {
      return [{
        ...item,
        status: 'needs_resolution' as const,
        updatedAt: now,
        lastError: failure.message,
      }];
    }

    return [{
      ...item,
      status: 'failed' as const,
      updatedAt: now,
      lastError: failure.message,
      nextAttemptAt: new Date(
        new Date(now).getTime() + backoffDelayMs(item.attempts),
      ).toISOString(),
    }];
  });
}

/**
 * "Tentar de novo", vindo de um toque.
 *
 * Zera a espera E as tentativas. A pessoa tocando o botão é informação nova —
 * ela provavelmente resolveu o que travava, ou ao menos quer ver o erro de
 * novo agora, e não daqui a meia hora.
 */
export function retryNow(queue: OfflineQueue, id: string, now: string): OfflineQueue {
  return queue.map((item) =>
    item.id === id && item.status !== 'syncing'
      ? {
          ...item,
          status: 'queued' as const,
          attempts: 0,
          nextAttemptAt: now,
          lastError: undefined,
          updatedAt: now,
        }
      : item,
  );
}

/** O mesmo, para tudo o que é desta sessão. Não toca a fila de outra conta. */
export function retryAll(queue: OfflineQueue, userId: string, now: string): OfflineQueue {
  return queue.map((item) =>
    item.userId === userId && item.status !== 'syncing'
      ? {
          ...item,
          status: 'queued' as const,
          attempts: 0,
          nextAttemptAt: now,
          lastError: undefined,
          updatedAt: now,
        }
      : item,
  );
}

/** Descartar um item que a pessoa decidiu abandonar. */
export function discard(queue: OfflineQueue, id: string): OfflineQueue {
  return queue.filter((item) => item.id !== id);
}

/**
 * Recuperação depois de um encerramento abrupto.
 *
 * `syncing` gravado em disco significa que o aplicativo morreu no meio de uma
 * tentativa. O envio pode ter chegado ao servidor ou não — daqui não há como
 * saber. Reenviar é seguro porque a chave de idempotência e o id gerado no
 * aparelho fazem a repetição ser reconhecida; deixar em `syncing` para sempre
 * não é, porque nada mais tocaria no item e a escrita ficaria perdida em
 * silêncio.
 *
 * Chamada ao carregar a fila do disco.
 */
export function recoverInterrupted(queue: OfflineQueue, now: string): OfflineQueue {
  return queue.map((item) =>
    item.status === 'syncing'
      ? { ...item, status: 'queued' as const, nextAttemptAt: now, updatedAt: now }
      : item,
  );
}

/* -------------------------------- resumo --------------------------------- */

export interface QueueSummary {
  total: number;
  pending: number;
  syncing: number;
  needsResolution: number;
  /** Há algo que a pessoa precisa decidir. */
  blocked: boolean;
}

export function summarize(queue: OfflineQueue, userId?: string): QueueSummary {
  const meus = userId ? queue.filter((item) => item.userId === userId) : queue;
  const needsResolution = meus.filter((i) => i.status === 'needs_resolution').length;
  return {
    total: meus.length,
    pending: meus.filter((i) => i.status === 'queued' || i.status === 'failed').length,
    syncing: meus.filter((i) => i.status === 'syncing').length,
    needsResolution,
    blocked: needsResolution > 0,
  };
}

/** O rótulo do indicador. Uma frase, e ela diz o número. */
export function queueLabel(summary: QueueSummary): string | null {
  if (summary.total === 0) return null;
  if (summary.needsResolution > 0) {
    return summary.needsResolution === 1
      ? '1 alteração precisa da sua atenção'
      : `${summary.needsResolution} alterações precisam da sua atenção`;
  }
  if (summary.syncing > 0) return 'Sincronizando…';
  return summary.pending === 1
    ? '1 alteração aguardando conexão'
    : `${summary.pending} alterações aguardando conexão`;
}
