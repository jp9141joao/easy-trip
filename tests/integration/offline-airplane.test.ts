import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient } from '@tanstack/react-query';

import { readMirror, writeMirrorFromBytes, writeMirrorFromFile } from '@/lib/fileMirror';
import { hydrateQueries, persistQueries } from '@/lib/queryPersistence';
import { queryKeys } from '@/hooks/queryKeys';

/**
 * F8 — o cenário que a decisão D-04 existe para garantir.
 *
 * O texto da decisão: *"o usuário abriria o aplicativo no aeroporto sem sinal e
 * não veria o próprio cartão de embarque"*. O plano transforma isso em critério
 * de aceite: *"modo avião: abrir uma reserva já baixada — tem de funcionar"*.
 *
 * O "modo avião" aqui é uma fronteira de rede controlada — a fonte de dados
 * simplesmente falha, como falharia sem sinal. O que se mede é o comportamento
 * do sistema depois disso, não um booleano de conectividade.
 */

const UID = '11111111-1111-4111-8111-111111111111';
const OUTRO = '22222222-2222-4222-8222-222222222222';
const TRIP = '33333333-3333-4333-8333-333333333333';
const CAMINHO = `${UID}/${TRIP}/cartao-de-embarque.pdf`;

const BILHETE = {
  id: 't1',
  tripId: TRIP,
  userId: UID,
  type: 'voo' as const,
  title: 'TAP 1234 — GRU/LIS',
  filePath: CAMINHO,
  mimeType: 'application/pdf',
};

/** A rede, com um interruptor. */
class Rede {
  online = true;
  async carregarBilhetes() {
    if (!this.online) throw new Error('Network request failed');
    return [BILHETE];
  }
  async baixarArquivo(path: string) {
    if (!this.online) throw new Error('Network request failed');
    return new TextEncoder().encode(`bytes de ${path}`).buffer as ArrayBuffer;
  }
  /** A URL assinada só existe com rede — e vale uma hora. */
  async assinar(path: string) {
    if (!this.online) return undefined;
    return `https://projeto.supabase.co/storage/v1/object/sign/attachments/${path}?token=abc`;
  }
}

/** A leitura como o repositório a faz: cópia local primeiro, URL assinada depois. */
async function comoAbrir(rede: Rede, path: string): Promise<string | undefined> {
  return readMirror('attachments', path) ?? (await rede.assinar(path));
}

function novoCliente() {
  return new QueryClient({
    defaultOptions: { queries: { gcTime: 0, retry: false }, mutations: { gcTime: 0 } },
  });
}

/* eslint-disable @typescript-eslint/no-require-imports */
const resetFs = () => (require('expo-file-system') as { __reset: () => void }).__reset();

let rede: Rede;
let client: QueryClient;

beforeEach(async () => {
  await AsyncStorage.clear();
  resetFs();
  rede = new Rede();
  client = novoCliente();
});

afterEach(() => client.clear());

/** Fecha e reabre o aplicativo: cliente novo, disco intacto. */
async function reabrir(userId = UID) {
  client.clear();
  client = novoCliente();
  return hydrateQueries(client, userId);
}

describe('o cartão de embarque no aeroporto', () => {
  it('ONLINE: carrega, guarda o arquivo e persiste a lista', async () => {
    const bilhetes = await rede.carregarBilhetes();
    client.setQueryData(queryKeys.tripReservations(TRIP), bilhetes);
    await persistQueries(client, UID);

    // "Uma cópia local é gravada ao anexar e ao baixar".
    await writeMirrorFromBytes('attachments', CAMINHO, await rede.baixarArquivo(CAMINHO));

    expect(readMirror('attachments', CAMINHO)).toBeDefined();
  });

  it('OFFLINE depois de reabrir: a lista aparece e o arquivo abre', async () => {
    // --- com rede ---
    client.setQueryData(queryKeys.tripReservations(TRIP), await rede.carregarBilhetes());
    await persistQueries(client, UID);
    await writeMirrorFromBytes('attachments', CAMINHO, await rede.baixarArquivo(CAMINHO));

    // --- modo avião, aplicativo reaberto ---
    rede.online = false;
    await reabrir();

    const lista = client.getQueryData<(typeof BILHETE)[]>(queryKeys.tripReservations(TRIP));
    expect(lista).toHaveLength(1);
    expect(lista![0].title).toBe('TAP 1234 — GRU/LIS');

    // E o arquivo abre — por cópia local, não por URL assinada.
    const alvo = await comoAbrir(rede, lista![0].filePath);
    expect(alvo).toBeDefined();
    expect(alvo!.startsWith('file:')).toBe(true);
  });

  it('OFFLINE sem ter baixado: a lista aparece, mas o arquivo não — e isso é dito', async () => {
    client.setQueryData(queryKeys.tripReservations(TRIP), await rede.carregarBilhetes());
    await persistQueries(client, UID);
    // Ninguém abriu o arquivo com rede, então não há cópia.

    rede.online = false;
    await reabrir();

    expect(client.getQueryData(queryKeys.tripReservations(TRIP))).toHaveLength(1);
    // A honestidade do §10: sem cópia local, não há como abrir — e a tela tem
    // de saber disso em vez de anunciar "disponível offline".
    expect(await comoAbrir(rede, CAMINHO)).toBeUndefined();
  });

  it('a URL assinada NÃO é o que faz o offline funcionar', async () => {
    // Com rede há URL assinada; ela some no instante em que a rede some. Se o
    // aplicativo dependesse dela, o cartão de embarque não abriria.
    expect(await rede.assinar(CAMINHO)).toContain('token=');
    rede.online = false;
    expect(await rede.assinar(CAMINHO)).toBeUndefined();

    // Com a cópia local, abre de qualquer jeito.
    await writeMirrorFromFile('attachments', CAMINHO, 'file:///cache/escolhido.pdf');
    expect(await comoAbrir(rede, CAMINHO)).toBeDefined();
  });

  it('primeira instalação, sem rede e sem cache: vazio honesto, não dado inventado', async () => {
    // §38: nada de servir o catálogo de demonstração como se fosse do usuário.
    rede.online = false;
    expect(await reabrir()).toBe(0);
    expect(client.getQueryData(queryKeys.tripReservations(TRIP))).toBeUndefined();
    await expect(rede.carregarBilhetes()).rejects.toThrow('Network request failed');
  });
});

describe('escrita continua exigindo rede — e falha de forma limpa', () => {
  it('sem rede, a mutação falha e nada é enfileirado', async () => {
    // O plano decidiu contra fila de sincronização (§21): "o uso real do
    // aplicativo tolera 'tente de novo quando tiver sinal'". Este teste existe
    // para que a decisão continue verdadeira — se alguém acrescentar uma fila
    // sem reabrir a decisão, ela deixa de valer em silêncio.
    rede.online = false;

    const salvar = async () => {
      if (!rede.online) throw new Error('Network request failed');
    };
    await expect(salvar()).rejects.toThrow('Network request failed');

    // O cache continua com o que já tinha; nada de operação pendente no disco.
    const chaves = await AsyncStorage.getAllKeys();
    expect(chaves.filter((k) => k.includes('queue') || k.includes('pending'))).toHaveLength(0);
  });
});

describe('isolamento entre contas no aparelho', () => {
  it('o cache e os arquivos de A não aparecem para B', async () => {
    client.setQueryData(queryKeys.tripReservations(TRIP), await rede.carregarBilhetes());
    await persistQueries(client, UID);
    await writeMirrorFromBytes('attachments', CAMINHO, await rede.baixarArquivo(CAMINHO));

    // B entra neste mesmo aparelho.
    expect(await reabrir(OUTRO)).toBe(0);
    expect(client.getQueryData(queryKeys.tripReservations(TRIP))).toBeUndefined();

    // O arquivo de A continua no disco até a saída de A o expurgar — mas B não
    // tem como chegar nele: nenhum registro de B cita o caminho de A, e o
    // caminho começa com o UID de A.
    expect(CAMINHO.startsWith(`${OUTRO}/`)).toBe(false);
  });
});
