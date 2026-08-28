import {
  MAX_ATTEMPTS,
  backoffDelayMs,
  classifyFailure,
  discard,
  drainableFor,
  enqueue,
  idempotencyKeyFor,
  isQueueable,
  markFailed,
  markSucceeded,
  markSyncing,
  queueLabel,
  recoverInterrupted,
  retryAll,
  retryNow,
  summarize,
  type OfflineQueue,
} from '@/domain/offlineQueue';

/**
 * A fila de mutações offline (§33).
 *
 * Este arquivo exercita a lógica pura. O que ela promete, e o que aqui se mede:
 *
 *   · o que entra na fila é só conteúdo de viagem;
 *   · editar quatro vezes sem rede produz UMA escrita, não quatro;
 *   · criar e apagar sem rede produz NENHUMA;
 *   · a fila de uma conta nunca é drenada pela sessão de outra;
 *   · uma falha que não melhora sozinha para de tentar e pede uma decisão;
 *   · um encerramento abrupto no meio de um envio não perde a escrita.
 */

const T0 = '2026-08-28T12:00:00.000Z';
const em = (segundos: number) =>
  new Date(new Date(T0).getTime() + segundos * 1000).toISOString();

const ALICE = 'u-alice';
const BENTO = 'u-bento';

const item = (over: Partial<Parameters<typeof enqueue>[1]> = {}) => ({
  id: 'q1',
  userId: ALICE,
  entity: 'expense' as const,
  operation: 'create' as const,
  targetId: 'e1',
  tripId: 't1',
  payload: { amount: 10 },
  ...over,
});

/* ------------------------------ o que entra ------------------------------- */

describe('o que pode ser enfileirado', () => {
  it.each(['itinerary', 'checklist', 'expense', 'journal', 'goal'])(
    '%s aceita create, update e remove',
    (entity) => {
      for (const op of ['create', 'update', 'remove']) {
        expect(isQueueable(entity, op)).toBe(true);
      }
    },
  );

  it.each([
    ['account', 'remove'],
    ['membership', 'update'],
    ['ownership', 'transfer'],
    ['trip', 'remove'],
    ['admin', 'create'],
    ['file', 'create'],
  ])('%s/%s NÃO entra na fila', (entity, op) => {
    // Cada um destes precisaria de um desenho próprio. Enfileirá-los "junto"
    // seria escolher não pensar neles — ver o comentário sobre QUEUEABLE.
    expect(isQueueable(entity, op)).toBe(false);
  });

  it('uma operação recusada não altera a fila', () => {
    const fila: OfflineQueue = [];
    expect(enqueue(fila, item({ entity: 'trip' as never, operation: 'remove' }), T0)).toBe(fila);
  });

  it('a chave de idempotência não depende do momento', () => {
    // Se dependesse, reenviar o mesmo item depois de uma resposta perdida
    // pareceria uma operação nova.
    expect(idempotencyKeyFor('expense', 'create', 'e1')).toBe(
      idempotencyKeyFor('expense', 'create', 'e1'),
    );
    expect(idempotencyKeyFor('expense', 'create', 'e1')).not.toBe(
      idempotencyKeyFor('expense', 'update', 'e1'),
    );
  });
});

/* --------------------------------- dobra ---------------------------------- */

describe('dobrar mutações da mesma linha', () => {
  it('criar e depois editar produz UM create com os campos mesclados', () => {
    let fila = enqueue([], item({ payload: { amount: 10, description: 'café' } }), T0);
    fila = enqueue(fila, item({ id: 'q2', operation: 'update', payload: { amount: 25 } }), em(60));

    expect(fila).toHaveLength(1);
    expect(fila[0].operation).toBe('create');
    expect(fila[0].payload).toEqual({ amount: 25, description: 'café' });
  });

  it('criar e depois apagar não produz escrita nenhuma', () => {
    let fila = enqueue([], item(), T0);
    fila = enqueue(fila, item({ id: 'q2', operation: 'remove' }), em(60));

    // Criar para apagar em seguida é trabalho que ninguém precisa ver.
    expect(fila).toEqual([]);
  });

  it('quatro edições seguidas produzem UMA', () => {
    let fila = enqueue([], item({ operation: 'update', payload: { amount: 1 } }), T0);
    for (const [i, amount] of [2, 3, 4].entries()) {
      fila = enqueue(
        fila,
        item({ id: `q${i + 2}`, operation: 'update', payload: { amount } }),
        em(60 * (i + 1)),
      );
    }

    expect(fila).toHaveLength(1);
    expect(fila[0].payload).toEqual({ amount: 4 });
  });

  it('editar e depois apagar é apagar', () => {
    let fila = enqueue([], item({ operation: 'update', payload: { amount: 5 } }), T0);
    fila = enqueue(fila, item({ id: 'q2', operation: 'remove' }), em(60));

    expect(fila).toHaveLength(1);
    expect(fila[0].operation).toBe('remove');
  });

  it('a dobra preserva o baseUpdatedAt da PRIMEIRA edição', () => {
    // É contra o estado que a pessoa VIU que o conflito deve ser medido, não
    // contra o de uma edição intermediária que ela nunca comparou com nada.
    let fila = enqueue(
      [],
      item({ operation: 'update', payload: { a: 1 }, baseUpdatedAt: '2026-01-01T00:00:00.000Z' }),
      T0,
    );
    fila = enqueue(
      fila,
      item({ id: 'q2', operation: 'update', payload: { b: 2 }, baseUpdatedAt: '2026-06-01T00:00:00.000Z' }),
      em(60),
    );

    expect(fila[0].baseUpdatedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('linhas diferentes não se dobram', () => {
    let fila = enqueue([], item({ targetId: 'e1' }), T0);
    fila = enqueue(fila, item({ id: 'q2', targetId: 'e2' }), em(1));
    expect(fila).toHaveLength(2);
  });

  it('entidades diferentes com o mesmo id não se dobram', () => {
    let fila = enqueue([], item({ entity: 'expense', targetId: 'x' }), T0);
    fila = enqueue(fila, item({ id: 'q2', entity: 'goal', targetId: 'x' }), em(1));
    expect(fila).toHaveLength(2);
  });

  it('um item EM VOO não é dobrado', () => {
    // Mesclar por cima mudaria o que está sendo enviado neste instante.
    let fila = enqueue([], item({ operation: 'update', payload: { a: 1 } }), T0);
    fila = markSyncing(fila, 'q1', em(1));
    fila = enqueue(fila, item({ id: 'q2', operation: 'update', payload: { a: 2 } }), em(2));

    expect(fila).toHaveLength(2);
    expect(fila[0].status).toBe('syncing');
  });

  it('a dobra devolve o item ao começo da espera', () => {
    let fila = enqueue([], item({ operation: 'update', payload: { a: 1 } }), T0);
    fila = markSyncing(fila, 'q1', em(1));
    fila = markFailed(fila, 'q1', {}, em(2));
    expect(fila[0].status).toBe('failed');
    expect(fila[0].attempts).toBe(1);

    fila = enqueue(fila, item({ id: 'q2', operation: 'update', payload: { a: 2 } }), em(3));
    // A espera acumulada era de uma tentativa que já não descreve o que será
    // enviado.
    expect(fila[0].status).toBe('queued');
    expect(fila[0].attempts).toBe(0);
    expect(fila[0].nextAttemptAt).toBe(em(3));
  });
});

/* ------------------------------- isolamento ------------------------------- */

describe('duas contas no mesmo aparelho', () => {
  const mista = (): OfflineQueue => {
    let fila = enqueue([], item({ id: 'a1', userId: ALICE, targetId: 'e1' }), T0);
    fila = enqueue(fila, item({ id: 'b1', userId: BENTO, targetId: 'e2' }), T0);
    return fila;
  };

  it('a sessão da Alice só drena o que é da Alice', () => {
    // Sem este filtro, trocar de conta drenaria a fila anterior com o token da
    // nova: as escritas de uma pessoa apareceriam como de outra.
    const drenavel = drainableFor(mista(), ALICE, em(1));
    expect(drenavel.map((i) => i.id)).toEqual(['a1']);
  });

  it('a sessão do Bento só drena o que é do Bento', () => {
    expect(drainableFor(mista(), BENTO, em(1)).map((i) => i.id)).toEqual(['b1']);
  });

  it('uma sessão desconhecida não drena nada', () => {
    expect(drainableFor(mista(), 'u-estranho', em(1))).toEqual([]);
  });

  it('a mesma linha em duas contas não se dobra', () => {
    let fila = enqueue([], item({ id: 'a1', userId: ALICE, targetId: 'e1' }), T0);
    fila = enqueue(fila, item({ id: 'b1', userId: BENTO, targetId: 'e1' }), em(1));
    expect(fila).toHaveLength(2);
  });

  it('tentar tudo de novo não mexe na fila da outra conta', () => {
    let fila = mista();
    fila = markSyncing(fila, 'b1', em(1));
    fila = markFailed(fila, 'b1', {}, em(2));

    const depois = retryAll(fila, ALICE, em(3));
    expect(depois.find((i) => i.id === 'b1')?.status).toBe('failed');
  });

  it('o resumo conta só o que é da sessão', () => {
    expect(summarize(mista(), ALICE).total).toBe(1);
    expect(summarize(mista()).total).toBe(2);
  });
});

/* --------------------------- falha e recuperação -------------------------- */

describe('classificação de falhas', () => {
  it.each([
    [{}, 'create', 'retry'],
    [{ message: 'Network request failed' }, 'update', 'retry'],
    [{ status: 500 }, 'create', 'retry'],
    [{ status: 503 }, 'update', 'retry'],
    [{ status: 401 }, 'create', 'resolve'],
    [{ status: 403 }, 'update', 'resolve'],
    [{ code: '42501' }, 'update', 'resolve'],
    [{ status: 400 }, 'create', 'resolve'],
    [{ status: 422 }, 'update', 'resolve'],
  ] as const)('%p em %s → %s', (failure, op, esperado) => {
    expect(classifyFailure(failure, op)).toBe(esperado);
  });

  it('apagar o que já não existe é sucesso, não erro', () => {
    expect(classifyFailure({ status: 404 }, 'remove')).toBe('done');
    expect(classifyFailure({ code: 'PGRST116' }, 'remove')).toBe('done');
  });

  it('criar o que já existe com o mesmo id é sucesso', () => {
    // É a resposta do servidor a um reenvio. A idempotência funcionando.
    expect(classifyFailure({ code: '23505' }, 'create')).toBe('done');
  });

  it('editar uma linha que sumiu NÃO é sucesso — é uma decisão', () => {
    // Recriar em silêncio seria inventar dado que o servidor apagou.
    expect(classifyFailure({ status: 404 }, 'update')).toBe('resolve');
  });
});

describe('espera entre tentativas', () => {
  it('cresce exponencialmente', () => {
    expect(backoffDelayMs(1)).toBe(5_000);
    expect(backoffDelayMs(2)).toBe(10_000);
    expect(backoffDelayMs(3)).toBe(20_000);
    expect(backoffDelayMs(4)).toBe(40_000);
  });

  it('tem teto', () => {
    expect(backoffDelayMs(50)).toBe(30 * 60_000);
  });

  it('não é sorteada — a mesma tentativa dá sempre a mesma espera', () => {
    expect(backoffDelayMs(3)).toBe(backoffDelayMs(3));
  });

  it('um item que falhou não é drenado antes da hora', () => {
    let fila = enqueue([], item(), T0);
    fila = markSyncing(fila, 'q1', T0);
    fila = markFailed(fila, 'q1', {}, T0);

    expect(drainableFor(fila, ALICE, em(1))).toEqual([]);
    expect(drainableFor(fila, ALICE, em(5))).toHaveLength(1);
  });
});

describe('desistir de tentar sozinho', () => {
  it('uma falha que não melhora vira decisão na primeira vez', () => {
    let fila = enqueue([], item(), T0);
    fila = markSyncing(fila, 'q1', T0);
    fila = markFailed(fila, 'q1', { status: 403, message: 'Sem permissão.' }, em(1));

    expect(fila[0].status).toBe('needs_resolution');
    expect(fila[0].lastError).toBe('Sem permissão.');
  });

  it('uma falha de rede insiste, mas não para sempre', () => {
    let fila = enqueue([], item(), T0);
    for (let n = 1; n <= MAX_ATTEMPTS; n += 1) {
      fila = markSyncing(fila, 'q1', em(n * 100));
      fila = markFailed(fila, 'q1', {}, em(n * 100 + 1));
    }
    // Insistir para sempre esconderia do usuário que há algo a decidir.
    expect(fila[0].status).toBe('needs_resolution');
    expect(fila[0].attempts).toBe(MAX_ATTEMPTS);
  });

  it('needs_resolution não volta a ser drenado pelo relógio', () => {
    let fila = enqueue([], item(), T0);
    fila = markSyncing(fila, 'q1', T0);
    fila = markFailed(fila, 'q1', { status: 403 }, T0);

    expect(drainableFor(fila, ALICE, em(86_400))).toEqual([]);
  });

  it('mas volta com um toque, e zera a contagem', () => {
    let fila = enqueue([], item(), T0);
    fila = markSyncing(fila, 'q1', T0);
    fila = markFailed(fila, 'q1', { status: 403 }, T0);
    fila = retryNow(fila, 'q1', em(10));

    expect(fila[0].status).toBe('queued');
    expect(fila[0].attempts).toBe(0);
    expect(fila[0].lastError).toBeUndefined();
    expect(drainableFor(fila, ALICE, em(10))).toHaveLength(1);
  });

  it('"tentar de novo" não interrompe um envio em curso', () => {
    let fila = enqueue([], item(), T0);
    fila = markSyncing(fila, 'q1', T0);
    fila = retryNow(fila, 'q1', em(1));
    expect(fila[0].status).toBe('syncing');
  });

  it('descartar remove o item de vez', () => {
    const fila = enqueue([], item(), T0);
    expect(discard(fila, 'q1')).toEqual([]);
  });
});

/* ------------------------------- durabilidade ----------------------------- */

describe('encerramento abrupto', () => {
  it('um item que ficou em syncing volta a ser tentado', () => {
    // O envio pode ter chegado ao servidor ou não — daqui não há como saber.
    // Reenviar é seguro (o id vem do aparelho); deixar em `syncing` para
    // sempre não é, porque nada mais tocaria no item.
    let fila = enqueue([], item(), T0);
    fila = markSyncing(fila, 'q1', T0);

    const depoisDeAbrir = recoverInterrupted(fila, em(3600));
    expect(depoisDeAbrir[0].status).toBe('queued');
    expect(depoisDeAbrir[0].nextAttemptAt).toBe(em(3600));
  });

  it('a contagem de tentativas sobrevive à recuperação', () => {
    // Zerá-la faria um item condenado tentar para sempre, um crash por vez.
    let fila = enqueue([], item(), T0);
    fila = markSyncing(fila, 'q1', T0);
    expect(recoverInterrupted(fila, em(10))[0].attempts).toBe(1);
  });

  it('quem estava esperando continua esperando', () => {
    let fila = enqueue([], item(), T0);
    fila = markSyncing(fila, 'q1', T0);
    fila = markFailed(fila, 'q1', {}, T0);

    const depois = recoverInterrupted(fila, em(1));
    expect(depois[0].status).toBe('failed');
    expect(depois[0].nextAttemptAt).toBe(em(5));
  });
});

/* --------------------------------- resumo --------------------------------- */

describe('o que o indicador mostra', () => {
  it('nada, quando não há nada', () => {
    expect(queueLabel(summarize([]))).toBeNull();
  });

  it('o número de alterações esperando', () => {
    let fila = enqueue([], item({ id: 'q1', targetId: 'e1' }), T0);
    fila = enqueue(fila, item({ id: 'q2', targetId: 'e2' }), T0);
    expect(queueLabel(summarize(fila, ALICE))).toBe('2 alterações aguardando conexão');
  });

  it('singular quando é uma', () => {
    const fila = enqueue([], item(), T0);
    expect(queueLabel(summarize(fila, ALICE))).toBe('1 alteração aguardando conexão');
  });

  it('o que precisa de decisão tem prioridade sobre o que só espera', () => {
    let fila = enqueue([], item({ id: 'q1', targetId: 'e1' }), T0);
    fila = enqueue(fila, item({ id: 'q2', targetId: 'e2' }), T0);
    fila = markSyncing(fila, 'q1', T0);
    fila = markFailed(fila, 'q1', { status: 403 }, T0);

    expect(summarize(fila, ALICE).blocked).toBe(true);
    expect(queueLabel(summarize(fila, ALICE))).toBe('1 alteração precisa da sua atenção');
  });

  it('sucesso tira o item da fila', () => {
    const fila = enqueue([], item(), T0);
    expect(markSucceeded(fila, 'q1')).toEqual([]);
  });
});
