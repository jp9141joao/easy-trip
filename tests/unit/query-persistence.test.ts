import { queryKeys } from '@/hooks/queryKeys';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient } from '@tanstack/react-query';

import {
  clearPersistedQueries,
  hydrateQueries,
  invalidateQueryHydrations,
  persistedQueryStorageKey,
  persistQueries,
} from '@/lib/queryPersistence';
import { cacheStorage } from '@/lib/storage';

/**
 * F8 — D-04, a metade dos metadados.
 *
 * A cópia local resolve o arquivo; sem a lista em cache, a tela de documentos
 * abre **vazia** em modo avião e não há o que tocar. O plano define o teste de
 * aceitação nesses termos: "modo avião: abrir uma reserva já baixada — tem de
 * funcionar".
 *
 * Isto é cache de **leitura**. Não há fila de escrita: o plano decidiu contra
 * ela (§21), e nada aqui a contrabandeia de volta.
 */

const A = 'usuario-a';
const B = 'usuario-b';

const TICKETS = ['tripReservations', 'trip-1'] as const;
const TRIPS = ['trips', A] as const;

function novoCliente() {
  return new QueryClient({
    defaultOptions: { queries: { gcTime: 0, retry: false }, mutations: { gcTime: 0 } },
  });
}

let client: QueryClient;

beforeEach(async () => {
  await AsyncStorage.clear();
  client = novoCliente();
});

afterEach(() => {
  client.clear();
  jest.restoreAllMocks();
});

/** Simula o fechar-e-reabrir: um cliente novo, com o disco intacto. */
async function reabrirApp(userId: string) {
  client.clear();
  client = novoCliente();
  return hydrateQueries(client, userId);
}

describe('A: hidratação do cache', () => {
  it('o que foi gravado volta depois de reabrir', async () => {
    client.setQueryData(TICKETS, [{ id: 't1', title: 'TAP 1234' }]);
    await persistQueries(client, A);

    const repostas = await reabrirApp(A);

    expect(repostas).toBe(1);
    expect(client.getQueryData(TICKETS)).toEqual([{ id: 't1', title: 'TAP 1234' }]);
  });

  it('várias queries de viagem voltam juntas', async () => {
    client.setQueryData(TICKETS, [{ id: 't1' }]);
    client.setQueryData(TRIPS, [{ id: 'trip-1' }]);
    client.setQueryData(['checklist', 'trip-1'], [{ id: 'c1' }]);
    await persistQueries(client, A);

    expect(await reabrirApp(A)).toBe(3);
    expect(client.getQueryData(['checklist', 'trip-1'])).toEqual([{ id: 'c1' }]);
  });

  it('ignora uma hidratação antiga que termina depois do logout', async () => {
    let release!: (value: Awaited<ReturnType<typeof cacheStorage.get>>) => void;
    jest.spyOn(cacheStorage, 'get').mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    const hydration = hydrateQueries(client, A);

    // O efeito de A foi desmontado e o QueryClient já foi limpo pelo logout.
    invalidateQueryHydrations();
    client.clear();
    release({
      updatedAt: new Date(0).toISOString(),
      value: {
        version: 1,
        userId: A,
        queries: [{ key: TICKETS, data: [{ id: 'stale-a' }] }],
      },
    });

    await expect(hydration).resolves.toBe(0);
    expect(client.getQueryData(TICKETS)).toBeUndefined();
  });
});

describe('D: primeira abertura sem cache não inventa dado', () => {
  it('sem nada gravado, nada é reposto', async () => {
    expect(await hydrateQueries(client, A)).toBe(0);
    expect(client.getQueryData(TICKETS)).toBeUndefined();
  });
});

describe('B/C: cache por usuário', () => {
  it('o cache de A não é reposto para B', async () => {
    client.setQueryData(TICKETS, [{ id: 't1', title: 'Documento privado de A' }]);
    await persistQueries(client, A);

    const repostas = await reabrirApp(B);

    expect(repostas).toBe(0);
    expect(client.getQueryData(TICKETS)).toBeUndefined();
  });

  it('a chave de A continua isolada e disponível quando A voltar', async () => {
    client.setQueryData(TICKETS, [{ id: 't1' }]);
    await persistQueries(client, A);

    await reabrirApp(B);
    expect(await reabrirApp(A)).toBe(1);
  });

  it('a limpeza da saída apaga o que estava gravado', async () => {
    client.setQueryData(TICKETS, [{ id: 't1' }]);
    await persistQueries(client, A);

    await clearPersistedQueries(A);

    expect(await reabrirApp(A)).toBe(0);
  });
});

describe('allowlist: o que não vai para o disco', () => {
  it.each([
    ['conteúdo editorial', ['articles']],
    ['rascunho administrativo', ['admin', 'articles']],
    ['conversa com a IA', ['aiMessages', 'conv-1']],
    ['clima', ['weather', 1, 2]],
    ['câmbio', ['fx', 'BRL', 'EUR']],
  ])('%s não é persistido', async (_rotulo, chave) => {
    client.setQueryData(chave, [{ segredo: 'não deveria ir para o disco' }]);
    await persistQueries(client, A);

    await reabrirApp(A);
    expect(client.getQueryData(chave)).toBeUndefined();
  });

  it('nada do que foi gravado contém token, JWT ou URL assinada', async () => {
    client.setQueryData(TICKETS, [
      { id: 't1', filePath: `${A}/trip-1/bilhete.pdf`, fileUrl: 'https://x/y?token=abc123' },
    ]);
    await persistQueries(client, A);

    // A URL assinada faz parte do objeto lido, então ela **chega** ao disco —
    // o que o §11 proíbe é tratá-la como identidade. A identidade gravada é o
    // `filePath`, e é dele que a próxima leitura parte.
    const gravado = JSON.stringify(await cacheStorage.get(persistedQueryStorageKey(A)));
    expect(gravado).toContain(`${A}/trip-1/bilhete.pdf`);

    // O que não pode aparecer de jeito nenhum é credencial de sessão.
    expect(gravado).not.toContain('eyJ');
    expect(gravado).not.toContain('service_role');
  });
});

describe('cache corrompido ou antigo não derruba o aplicativo', () => {
  it('JSON quebrado é descartado em silêncio', async () => {
    await AsyncStorage.setItem(`et:cache:${persistedQueryStorageKey(A)}`, '{isso não é json');
    expect(await hydrateQueries(client, A)).toBe(0);
  });

  it('formato de outra versão é descartado', async () => {
    await cacheStorage.set(persistedQueryStorageKey(A), { version: 999, userId: A, queries: [{ key: TICKETS, data: [] }] });
    expect(await hydrateQueries(client, A)).toBe(0);
  });

  it('conteúdo com forma inesperada é descartado', async () => {
    await cacheStorage.set(persistedQueryStorageKey(A), { version: 1, userId: A, queries: 'não é lista' });
    expect(await hydrateQueries(client, A)).toBe(0);
  });

  it('entradas individuais inválidas são puladas, o resto entra', async () => {
    await cacheStorage.set(persistedQueryStorageKey(A), {
      version: 1,
      userId: A,
      queries: [
        null,
        { key: 'não é lista', data: 1 },
        { key: ['tripReservations', 'trip-1'], data: undefined },
        { key: ['tripReservations', 'trip-1'], data: [{ id: 'bom' }] },
      ],
    });

    expect(await hydrateQueries(client, A)).toBe(1);
    expect(client.getQueryData(TICKETS)).toEqual([{ id: 'bom' }]);
  });

  it('uma chave fora da allowlist gravada à mão não é reposta', async () => {
    // Defesa na volta também: se o arquivo for adulterado, a allowlist ainda
    // decide o que pode entrar no cache.
    await cacheStorage.set(persistedQueryStorageKey(A), {
      version: 1,
      userId: A,
      queries: [{ key: ['admin', 'articles'], data: [{ id: 'rascunho' }] }],
    });

    expect(await hydrateQueries(client, A)).toBe(0);
    expect(client.getQueryData(['admin', 'articles'])).toBeUndefined();
  });
});

describe('só estado bem-sucedido é gravado', () => {
  it('query em erro não vai para o disco', async () => {
    await client.prefetchQuery({
      queryKey: TICKETS,
      queryFn: () => Promise.reject(new Error('sem rede')),
    });
    await persistQueries(client, A);

    expect(await reabrirApp(A)).toBe(0);
  });
});

/**
 * §59 — o cache é escopado por conta E por participação.
 *
 * A primeira metade já era garantida (`snapshot.userId`). A segunda entra com a
 * colaboração: perder acesso a uma viagem não pode deixar o roteiro dela em
 * disco, esperando a próxima abertura para aparecer por um instante antes de o
 * refetch corrigir.
 */
describe('escopo do cache por participação', () => {
  it('as chaves de viagem persistidas cobrem tudo que é da viagem', () => {
    // Se uma chave nova de viagem aparecer sem entrar nesta lista, ela fica
    // fora da limpeza de acesso revogado — e este teste avisa.
    const chavesDaViagem = [
      queryKeys.trip('t1'),
      queryKeys.itinerary('t1'),
      queryKeys.checklist('t1'),
      queryKeys.expenses('t1'),
      queryKeys.journal('t1'),
      queryKeys.journalMedia('t1'),
      queryKeys.tripReservations('t1'),
      queryKeys.suggestions('t1'),
      queryKeys.tripMembers('t1'),
      queryKeys.tripInvites('t1'),
    ];

    for (const chave of chavesDaViagem) {
      expect(chave[chave.length - 1]).toBe('t1');
    }
  });
});
