/**
 * Remoção de todos os arquivos de um usuário nos buckets do Easy Trip (P-02).
 *
 * Este módulo existe separado da Edge Function por dois motivos. O primeiro é
 * poder ser testado sem Deno e sem rede — a função recebe um cliente mínimo, e o
 * teste passa um dublê em memória. O segundo é que a regra aqui é delicada
 * demais para ficar embutida num handler HTTP: ela apaga arquivo, e apagar
 * arquivo errado é irreversível.
 *
 * O defeito que este módulo corrige: `storage.list(uid)` **não é recursivo**.
 * Os anexos ficam em `{uid}/{tripId}/arquivo` e as fotos do diário em
 * `{uid}/{entryId}/arquivo`; listando `{uid}` a API devolve os *prefixos*
 * (`tripId`, `entryId`), não os objetos. Passar esses prefixos para `remove()`
 * não apaga nada — e a exclusão de conta terminava dizendo que tinha dado certo.
 */

/** Uma entrada devolvida pelo `list`. `id: null` identifica um prefixo/pasta. */
export interface StorageEntry {
  name: string;
  id?: string | null;
}

export interface StorageResult<T> {
  data: T | null;
  error: { message: string } | null;
}

export interface StorageBucketClient {
  list(
    prefix: string,
    options: { limit: number; offset: number },
  ): Promise<StorageResult<StorageEntry[]>>;
  remove(paths: string[]): Promise<StorageResult<unknown>>;
}

export interface StorageClient {
  from(bucket: string): StorageBucketClient;
}

export interface PurgeReport {
  /** Caminhos efetivamente removidos. */
  deleted: string[];
  /** Caminhos que ainda existiam na verificação final — sobra é falha. */
  remaining: string[];
  /** Falhas legíveis, sem token nem caminho de outro usuário. */
  errors: string[];
  get ok(): boolean;
}

/** A API do Storage pagina; 100 é o passo usado tanto para listar quanto para apagar. */
const PAGE_SIZE = 100;

/**
 * Profundidade máxima percorrida.
 *
 * Os caminhos reais têm 3 níveis (`uid/trip/arquivo`), mas o nome do arquivo vem
 * do seletor de documentos do aparelho e não é higienizado no upload — um nome
 * com barra criaria um nível a mais. O limite é generoso o bastante para
 * qualquer caso real e impede que um bug de paginação vire recursão infinita.
 */
const MAX_DEPTH = 12;

/**
 * Lista recursivamente todos os objetos sob um prefixo.
 *
 * Distingue objeto de pasta por `id`: o Storage devolve `id: null` para
 * prefixos. Objetos entram no resultado; prefixos são visitados.
 */
export async function listAllObjects(
  bucket: StorageBucketClient,
  prefix: string,
  depth = 0,
): Promise<{ paths: string[]; errors: string[] }> {
  const paths: string[] = [];
  const errors: string[] = [];

  if (depth >= MAX_DEPTH) {
    errors.push(`Profundidade máxima atingida em "${prefix}".`);
    return { paths, errors };
  }

  let offset = 0;
  for (;;) {
    const { data, error } = await bucket.list(prefix, { limit: PAGE_SIZE, offset });

    if (error) {
      // Uma listagem que falhou não é uma pasta vazia. Tratá-las igual é
      // exatamente como a versão anterior concluía que não havia nada a apagar.
      errors.push(`Falha ao listar "${prefix}": ${error.message}`);
      return { paths, errors };
    }

    const entries = data ?? [];
    for (const entry of entries) {
      const child = `${prefix}/${entry.name}`;
      if (entry.id === null || entry.id === undefined) {
        const nested = await listAllObjects(bucket, child, depth + 1);
        paths.push(...nested.paths);
        errors.push(...nested.errors);
      } else {
        paths.push(child);
      }
    }

    // Página incompleta significa fim da lista.
    if (entries.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return { paths, errors };
}

/**
 * Apaga todos os arquivos do usuário nos buckets informados e **confere**.
 *
 * A conferência final não é zelo excessivo: `remove()` pode devolver sucesso
 * parcial, e a pergunta que a exclusão de conta precisa responder não é "a
 * chamada retornou", é "sobrou alguma coisa?".
 */
export async function purgeUserFiles(
  storage: StorageClient,
  buckets: readonly string[],
  userId: string,
): Promise<PurgeReport> {
  const deleted: string[] = [];
  const remaining: string[] = [];
  const errors: string[] = [];

  // Um `userId` vazio ou com barra transformaria o prefixo em algo que alcança
  // arquivo de terceiro. O id vem do JWT verificado, mas isto custa uma linha e
  // fecha a porta de vez.
  if (!/^[A-Za-z0-9-]{1,64}$/.test(userId)) {
    return report(deleted, remaining, ['Identificador de usuário inválido.']);
  }

  const prefix = userId;

  for (const bucketName of buckets) {
    const bucket = storage.from(bucketName);
    const listed = await listAllObjects(bucket, prefix);
    errors.push(...listed.errors.map((message) => `[${bucketName}] ${message}`));

    // Cinto e suspensório: só sai daqui o que está comprovadamente sob o
    // prefixo do próprio usuário.
    const owned = listed.paths.filter((path) => path.startsWith(`${prefix}/`));
    if (owned.length !== listed.paths.length) {
      errors.push(`[${bucketName}] Caminho fora do prefixo do usuário foi ignorado.`);
    }

    for (let index = 0; index < owned.length; index += PAGE_SIZE) {
      const batch = owned.slice(index, index + PAGE_SIZE);
      const { error } = await bucket.remove(batch);
      if (error) {
        errors.push(`[${bucketName}] Falha ao remover ${batch.length} arquivo(s): ${error.message}`);
      } else {
        deleted.push(...batch.map((path) => `${bucketName}/${path}`));
      }
    }

    // Verificação: relistar e ver o que sobrou.
    const after = await listAllObjects(bucket, prefix);
    errors.push(...after.errors.map((message) => `[${bucketName}] verificação: ${message}`));
    remaining.push(...after.paths.map((path) => `${bucketName}/${path}`));
  }

  return report(deleted, remaining, errors);
}

function report(deleted: string[], remaining: string[], errors: string[]): PurgeReport {
  return {
    deleted,
    remaining,
    errors,
    get ok() {
      return this.remaining.length === 0 && this.errors.length === 0;
    },
  };
}
