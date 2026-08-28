import AsyncStorage from '@react-native-async-storage/async-storage';

import { enqueue, summarize, type OfflineQueue } from '@/domain/offlineQueue';
import { clearQueue, loadQueue, saveQueue } from '@/lib/offlineQueue';
import { drainQueue, describeFailure } from '@/services/offlineSync';
import type { DataSource } from '@/repositories/types';

/**
 * O ciclo inteiro da fila offline (§33), do jeito que ele acontece.
 *
 * O roteiro é o do plano: *cria sem rede → edita → fecha o aplicativo → abre →
 * conecta → sincroniza → erro temporário → tenta de novo → sai da conta → troca
 * de conta*. Cada `describe` é um trecho dele, e a fila atravessa o disco entre
 * um e outro — que é onde os defeitos deste tipo de mecanismo moram.
 *
 * "Fechar o aplicativo" aqui é literal: a fila é gravada, as variáveis em
 * memória são descartadas, e a leitura seguinte vem do AsyncStorage. Um teste
 * que segurasse a fila numa variável não mediria durabilidade nenhuma.
 */

const ALICE = 'u-alice';
const BENTO = 'u-bento';
const T0 = '2026-08-28T12:00:00.000Z';
const em = (s: number) => new Date(new Date(T0).getTime() + s * 1000).toISOString();

/** O servidor, com um interruptor — como em `offline-airplane.test.ts`. */
class Servidor {
  online = false;
  /** Recusa por permissão: não melhora com o tempo. */
  recusaPermissao = false;
  readonly criadas: { id: string; payload: unknown }[] = [];
  readonly editadas: { id: string; payload: unknown }[] = [];
  readonly removidas: string[] = [];

  private guarda() {
    if (this.recusaPermissao) {
      throw Object.assign(new Error('Sem permissão nesta viagem.'), { status: 403 });
    }
    if (!this.online) {
      // Sem status e sem código: é assim que o fetch do React Native falha sem
      // sinal, e é essa ausência que a fila lê como "pode melhorar sozinho".
      throw new TypeError('Network request failed');
    }
  }

  source(): DataSource {
    const repo = (nome: 'criadas' | 'editadas') => ({
      create: async (input: { id?: string } & Record<string, unknown>) => {
        this.guarda();
        const { id, ...payload } = input;
        // A chave primária do servidor: recriar o mesmo id é 23505.
        if (this.criadas.some((c) => c.id === id)) {
          throw Object.assign(new Error('duplicate key'), { code: '23505' });
        }
        this.criadas.push({ id: id!, payload });
        return { id, ...payload };
      },
      update: async (id: string, payload: Record<string, unknown>) => {
        this.guarda();
        this.editadas.push({ id, payload });
        return { id, ...payload };
      },
      remove: async (id: string) => {
        this.guarda();
        this.removidas.push(id);
      },
      listByTrip: async () => [],
      list: async () => [],
      listMedia: async () => [],
      addMedia: async () => ({}) as never,
      removeMedia: async () => undefined,
      ...(nome === 'criadas' ? {} : {}),
    });

    return {
      itinerary: repo('criadas'),
      checklist: repo('criadas'),
      expenses: repo('criadas'),
      journal: repo('criadas'),
      goals: repo('criadas'),
    } as unknown as DataSource;
  }
}

const despesa = (over: Record<string, unknown> = {}) => ({
  entity: 'expense' as const,
  operation: 'create' as const,
  targetId: 'e1',
  tripId: 't1',
  payload: { amount: 42, description: 'almoço' },
  ...over,
});

async function gravar(userId: string, fila: OfflineQueue) {
  await saveQueue(userId, fila);
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

/* ------------------------------------------------------------------ */

describe('sem rede, a escrita não se perde', () => {
  it('cria offline, edita, fecha o aplicativo e a fila continua lá', async () => {
    let fila = enqueue([], { id: 'q1', userId: ALICE, ...despesa() }, T0);
    fila = enqueue(
      fila,
      { id: 'q2', userId: ALICE, ...despesa({ operation: 'update', payload: { amount: 55 } }) },
      em(60),
    );
    await gravar(ALICE, fila);

    // --- o aplicativo fecha aqui. Nada mais em memória. ---

    const recuperada = await loadQueue(ALICE, em(3600));
    expect(recuperada).toHaveLength(1);
    expect(recuperada[0].operation).toBe('create');
    expect(recuperada[0].payload).toEqual({ amount: 55, description: 'almoço' });
  });

  it('a fila de uma conta não aparece na outra', async () => {
    await gravar(ALICE, enqueue([], { id: 'q1', userId: ALICE, ...despesa() }, T0));
    expect(await loadQueue(BENTO)).toEqual([]);
  });

  it('um item de outro dono gravado por engano é descartado na leitura', async () => {
    // A chave separa o armazenamento; o campo protege o envio. As duas juntas.
    await gravar(ALICE, [
      { ...enqueue([], { id: 'q1', userId: BENTO, ...despesa() }, T0)[0] },
    ]);
    expect(await loadQueue(ALICE)).toEqual([]);
  });
});

describe('a conexão volta', () => {
  it('a criação sobe uma vez só', async () => {
    const servidor = new Servidor();
    let fila = enqueue([], { id: 'q1', userId: ALICE, ...despesa() }, T0);
    fila = enqueue(
      fila,
      { id: 'q2', userId: ALICE, ...despesa({ operation: 'update', payload: { amount: 55 } }) },
      em(60),
    );
    await gravar(ALICE, fila);

    servidor.online = true;
    const resultado = await drainQueue(
      servidor.source(),
      await loadQueue(ALICE, em(120)),
      ALICE,
      { now: () => em(120), onProgress: (q) => gravar(ALICE, q) },
    );

    // Duas mutações do usuário, UMA escrita no servidor.
    expect(servidor.criadas).toHaveLength(1);
    expect(servidor.criadas[0]).toEqual({ id: 'e1', payload: { amount: 55, description: 'almoço' } });
    expect(resultado.succeeded).toBe(1);
    expect(resultado.queue).toEqual([]);
    expect(await loadQueue(ALICE)).toEqual([]);
  });

  it('o id da linha é o que o aparelho escolheu', async () => {
    const servidor = new Servidor();
    servidor.online = true;
    await gravar(ALICE, enqueue([], { id: 'q1', userId: ALICE, ...despesa({ targetId: 'escolhido-no-aparelho' }) }, T0));

    await drainQueue(servidor.source(), await loadQueue(ALICE), ALICE, { now: () => em(1) });

    expect(servidor.criadas[0].id).toBe('escolhido-no-aparelho');
  });

  it('reenviar o mesmo item não cria uma segunda linha', async () => {
    // O caso da resposta perdida: o servidor gravou, o aparelho não soube.
    const servidor = new Servidor();
    servidor.online = true;
    const fila = enqueue([], { id: 'q1', userId: ALICE, ...despesa() }, T0);

    await drainQueue(servidor.source(), fila, ALICE, { now: () => em(1) });
    // A fila "não soube" e tenta de novo com o mesmo item.
    const segunda = await drainQueue(servidor.source(), fila, ALICE, { now: () => em(2) });

    expect(servidor.criadas).toHaveLength(1);
    // 23505 é lido como "já está feito", e o item sai da fila.
    expect(segunda.succeeded).toBe(1);
    expect(segunda.queue).toEqual([]);
  });
});

describe('erro temporário e nova tentativa', () => {
  it('sem rede o item fica, com a espera contada', async () => {
    const servidor = new Servidor(); // offline
    await gravar(ALICE, enqueue([], { id: 'q1', userId: ALICE, ...despesa() }, T0));

    const r = await drainQueue(servidor.source(), await loadQueue(ALICE), ALICE, {
      now: () => em(1),
      onProgress: (q) => gravar(ALICE, q),
    });

    expect(r.failed).toBe(1);
    expect(r.queue[0].status).toBe('failed');
    expect(r.queue[0].attempts).toBe(1);
    expect(servidor.criadas).toEqual([]);

    // E sobreviveu ao disco.
    const doDisco = await loadQueue(ALICE, em(2));
    expect(doDisco).toHaveLength(1);
    expect(doDisco[0].attempts).toBe(1);
  });

  it('quando a rede volta, o mesmo item sobe', async () => {
    const servidor = new Servidor();
    await gravar(ALICE, enqueue([], { id: 'q1', userId: ALICE, ...despesa() }, T0));

    await drainQueue(servidor.source(), await loadQueue(ALICE), ALICE, {
      now: () => em(1),
      onProgress: (q) => gravar(ALICE, q),
    });

    servidor.online = true;
    // Passada a espera de 5 s da primeira falha.
    const r = await drainQueue(servidor.source(), await loadQueue(ALICE, em(10)), ALICE, {
      now: () => em(10),
      onProgress: (q) => gravar(ALICE, q),
    });

    expect(r.succeeded).toBe(1);
    expect(servidor.criadas).toHaveLength(1);
    expect(await loadQueue(ALICE)).toEqual([]);
  });

  it('uma recusa de permissão para de tentar e pede decisão', async () => {
    const servidor = new Servidor();
    servidor.online = true;
    servidor.recusaPermissao = true;
    await gravar(ALICE, enqueue([], { id: 'q1', userId: ALICE, ...despesa() }, T0));

    const r = await drainQueue(servidor.source(), await loadQueue(ALICE), ALICE, {
      now: () => em(1),
      onProgress: (q) => gravar(ALICE, q),
    });

    expect(r.needsResolution).toBe(1);
    expect(r.queue[0].status).toBe('needs_resolution');
    expect(r.queue[0].lastError).toContain('permissão');
    expect(summarize(r.queue, ALICE).blocked).toBe(true);
  });

  it('uma drenagem seguinte não insiste no que precisa de decisão', async () => {
    const servidor = new Servidor();
    servidor.online = true;
    servidor.recusaPermissao = true;
    await gravar(ALICE, enqueue([], { id: 'q1', userId: ALICE, ...despesa() }, T0));
    await drainQueue(servidor.source(), await loadQueue(ALICE), ALICE, {
      now: () => em(1),
      onProgress: (q) => gravar(ALICE, q),
    });

    servidor.recusaPermissao = false;
    const r = await drainQueue(servidor.source(), await loadQueue(ALICE, em(9999)), ALICE, {
      now: () => em(9999),
    });

    // Esperar não resolvia; o item espera um toque, não um relógio.
    expect(r.succeeded).toBe(0);
    expect(servidor.criadas).toEqual([]);
  });
});

describe('o aplicativo morre no meio de um envio', () => {
  it('o item volta a ser tentado, e não vira uma segunda linha', async () => {
    const servidor = new Servidor();
    servidor.online = true;

    // A drenagem grava `syncing` antes de tentar. Simulamos o encerramento
    // gravando esse estado e descartando tudo o mais.
    let fila = enqueue([], { id: 'q1', userId: ALICE, ...despesa() }, T0);
    fila = [{ ...fila[0], status: 'syncing', attempts: 1 }];
    await gravar(ALICE, fila);
    // O envio TINHA chegado ao servidor.
    servidor.criadas.push({ id: 'e1', payload: { amount: 42, description: 'almoço' } });

    // --- abre de novo ---
    const recuperada = await loadQueue(ALICE, em(60));
    expect(recuperada[0].status).toBe('queued');

    const r = await drainQueue(servidor.source(), recuperada, ALICE, { now: () => em(60) });

    expect(servidor.criadas).toHaveLength(1);
    expect(r.succeeded).toBe(1);
    expect(r.queue).toEqual([]);
  });

  it('e sobe, se o envio NÃO tinha chegado', async () => {
    const servidor = new Servidor();
    servidor.online = true;
    let fila = enqueue([], { id: 'q1', userId: ALICE, ...despesa() }, T0);
    fila = [{ ...fila[0], status: 'syncing', attempts: 1 }];
    await gravar(ALICE, fila);

    const r = await drainQueue(servidor.source(), await loadQueue(ALICE, em(60)), ALICE, {
      now: () => em(60),
    });

    expect(servidor.criadas).toHaveLength(1);
    expect(r.succeeded).toBe(1);
  });
});

describe('sair da conta e trocar de conta', () => {
  it('sair NÃO apaga o que ainda não subiu', async () => {
    // A escrita é da pessoa; sair do aplicativo não é desistir dela.
    await gravar(ALICE, enqueue([], { id: 'q1', userId: ALICE, ...despesa() }, T0));
    // "Sair" não chama `clearQueue`.
    expect(await loadQueue(ALICE)).toHaveLength(1);
  });

  it('a sessão do Bento não drena a fila da Alice', async () => {
    const servidor = new Servidor();
    servidor.online = true;
    await gravar(ALICE, enqueue([], { id: 'q1', userId: ALICE, ...despesa() }, T0));

    // O Bento entra: a fila dele é a dele, e está vazia.
    const r = await drainQueue(servidor.source(), await loadQueue(BENTO), BENTO, {
      now: () => em(1),
    });

    expect(r.succeeded).toBe(0);
    expect(servidor.criadas).toEqual([]);
    // A da Alice continua intacta, esperando a Alice.
    expect(await loadQueue(ALICE)).toHaveLength(1);
  });

  it('nem mesmo com a fila da Alice carregada por engano', async () => {
    const servidor = new Servidor();
    servidor.online = true;
    const daAlice = enqueue([], { id: 'q1', userId: ALICE, ...despesa() }, T0);

    // O erro que este teste descreve: a fila certa, a sessão errada.
    const r = await drainQueue(servidor.source(), daAlice, BENTO, { now: () => em(1) });

    expect(r.succeeded).toBe(0);
    expect(servidor.criadas).toEqual([]);
  });

  it('excluir a conta apaga a fila', async () => {
    await gravar(ALICE, enqueue([], { id: 'q1', userId: ALICE, ...despesa() }, T0));
    await clearQueue(ALICE);
    expect(await loadQueue(ALICE)).toEqual([]);
  });
});

describe('a falha é descrita como ela chega', () => {
  it('sem sinal não tem status nem código', () => {
    expect(describeFailure(new TypeError('Network request failed'))).toEqual({
      status: undefined,
      code: undefined,
      message: 'Network request failed',
    });
  });

  it('a recusa do PostgREST traz o código', () => {
    expect(describeFailure({ code: '42501', message: 'permission denied' })).toMatchObject({
      code: '42501',
    });
  });

  it('a resposta HTTP traz o status', () => {
    expect(describeFailure({ status: 403 })).toMatchObject({ status: 403 });
  });
});

describe('ordem', () => {
  it('as mutações sobem uma por vez, na ordem em que foram feitas', async () => {
    // Em paralelo, a ordem de chegada seria indeterminada — e o resultado seria
    // o de quem chegou por último, que não é o que a pessoa escreveu por último.
    const servidor = new Servidor();
    servidor.online = true;
    let fila = enqueue([], { id: 'q1', userId: ALICE, ...despesa({ targetId: 'e1' }) }, T0);
    fila = enqueue(fila, { id: 'q2', userId: ALICE, ...despesa({ targetId: 'e2' }) }, em(1));
    fila = enqueue(fila, { id: 'q3', userId: ALICE, ...despesa({ targetId: 'e3' }) }, em(2));

    await drainQueue(servidor.source(), fila, ALICE, { now: () => em(10) });

    expect(servidor.criadas.map((c) => c.id)).toEqual(['e1', 'e2', 'e3']);
  });
});
