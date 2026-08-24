import type { QueryClient } from '@tanstack/react-query';

import { cacheStorage } from './storage';

/**
 * Cache de leitura que sobrevive ao fechamento do aplicativo (D-04).
 *
 * ## Por que isto é parte da D-04, e não escopo extra
 *
 * A decisão pede que "reservas, passagens e documentos abram sem
 * internet", e o plano define o teste de aceitação: *"modo avião: abrir um
 * ticket já baixado — tem de funcionar"*. A cópia local do arquivo (ver
 * `fileMirror.ts`) resolve metade. A outra metade é chegar até ele: sem os
 * metadados em cache, a tela de documentos abre **vazia** em modo avião e não
 * há o que tocar. Espelhar o arquivo sem persistir a lista fecharia o requisito
 * pela metade.
 *
 * ## O que isto NÃO é
 *
 * Não é fila de sincronização. O plano decidiu contra ela, com justificativa
 * técnica (§21): *"uma fila de mutações offline exige resolução de conflitos,
 * idempotência e reconciliação de ids — semanas de trabalho e uma classe
 * inteira de bugs difíceis. O uso real do aplicativo tolera 'tente de novo
 * quando tiver sinal'."* Escrita offline continua fora de escopo; o que se
 * persiste aqui é **só leitura**.
 *
 * ## Uma arquitetura, não duas
 *
 * O plano também é explícito: *"Não criar segunda arquitetura de estado. O
 * React Query já é a camada de cache."* Por isso isto não é um store paralelo:
 * é o cache do próprio React Query, serializado para o `cacheStorage` que já
 * existe — o mesmo que `clearPrivateState()` já limpa na saída e na exclusão de
 * conta. Sai de graça o isolamento entre contas.
 */

/**
 * A versão do formato. Mudou o formato, o que está gravado é descartado.
 *
 * Sem isto, um cache gravado por uma versão anterior seria reidratado como se
 * ainda fizesse sentido, e o erro apareceria longe da causa — numa tela, com um
 * campo faltando.
 */
const VERSION = 1;

const CACHE_KEY = 'queries:v1';

/**
 * Só dado operacional de viagem, e só o que a pessoa precisa sem rede.
 *
 * Ficam de fora, deliberadamente:
 *
 *  - conteúdo editorial (`offers`, `articles`, `places`, `advisors`) — muda no
 *    servidor, não é urgente sem rede, e encheria o AsyncStorage com texto e
 *    URLs de imagem que não abririam offline de qualquer forma;
 *  - `admin*` — rascunho não publicado não tem por que existir em disco;
 *  - `weather`, `fx` — já têm cache próprio com carimbo de validade;
 *  - `ai*` — conversa com o modelo não funciona sem rede, e as mensagens são
 *    justamente o tipo de texto pessoal que não precisa estar em claro no
 *    disco (§49, §50).
 */
const PERSISTED_PREFIXES = new Set([
  'trips',
  'trip',
  'itinerary',
  'checklist',
  'expenses',
  'tripReservations',
  'journal',
  'journalMedia',
  'goals',
  'profile',
  'insurance',
]);

interface PersistedQuery {
  key: readonly unknown[];
  data: unknown;
}

interface Snapshot {
  version: number;
  /** De quem é este cache. A reidratação exige que bata com a sessão atual. */
  userId: string;
  queries: PersistedQuery[];
}

function isPersisted(key: readonly unknown[]): boolean {
  return typeof key[0] === 'string' && PERSISTED_PREFIXES.has(key[0]);
}

/** Grava o estado atual das queries que valem a pena guardar. */
export async function persistQueries(client: QueryClient, userId: string): Promise<void> {
  const queries: PersistedQuery[] = [];

  for (const query of client.getQueryCache().getAll()) {
    if (query.state.status !== 'success') continue;
    if (!isPersisted(query.queryKey)) continue;
    if (query.state.data === undefined) continue;
    queries.push({ key: query.queryKey as readonly unknown[], data: query.state.data });
  }

  const snapshot: Snapshot = { version: VERSION, userId, queries };
  await cacheStorage.set(CACHE_KEY, snapshot);
}

/**
 * Repõe o cache gravado, **se** ele for desta conta e deste formato.
 *
 * Devolve quantas queries foram repostas — zero quando não havia nada, quando
 * o formato mudou, quando o conteúdo estava corrompido, ou quando o cache é de
 * outra conta. Nos quatro casos a resposta certa é a mesma: começar vazio.
 */
export async function hydrateQueries(client: QueryClient, userId: string): Promise<number> {
  let snapshot: Snapshot | null = null;
  try {
    const envelope = await cacheStorage.get<Snapshot>(CACHE_KEY);
    snapshot = envelope?.value ?? null;
  } catch {
    snapshot = null;
  }

  if (!snapshot || typeof snapshot !== 'object') return 0;
  if (snapshot.version !== VERSION) {
    await cacheStorage.remove(CACHE_KEY);
    return 0;
  }
  // O ponto crítico: cache de A jamais aparece para B. Além de `clearPrivateState()`
  // apagar na saída, a reidratação confere o dono — para o caso de a limpeza
  // não ter acontecido (app encerrado à força no meio da saída, por exemplo).
  if (snapshot.userId !== userId) {
    await cacheStorage.remove(CACHE_KEY);
    return 0;
  }
  if (!Array.isArray(snapshot.queries)) {
    await cacheStorage.remove(CACHE_KEY);
    return 0;
  }

  let reidratadas = 0;
  for (const entry of snapshot.queries) {
    if (!entry || !Array.isArray(entry.key) || entry.data === undefined) continue;
    if (!isPersisted(entry.key)) continue; // a allowlist vale na volta também
    client.setQueryData(entry.key, entry.data);
    reidratadas += 1;
  }
  return reidratadas;
}

/** Esquece o que está gravado. Chamado junto do resto do estado privado. */
export async function clearPersistedQueries(): Promise<void> {
  await cacheStorage.remove(CACHE_KEY);
}
