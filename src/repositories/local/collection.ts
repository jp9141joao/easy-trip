import { jsonStorage } from '@/lib/storage';

/**
 * Cópia profunda dos registros que entram e saem da coleção.
 *
 * Existe por causa de um defeito real: as coleções semeadas recebiam o próprio
 * array de `catalog.ts` (`() => ARTICLES`), e `insert`/`update` passavam a
 * escrever **dentro da constante do módulo**. Criar um artigo em modo local
 * acrescentava uma linha ao catálogo compartilhado — invisível, permanente
 * enquanto o módulo vivesse, e vazando de um teste para o seguinte.
 *
 * `structuredClone` quando existe (Node e Hermes recentes); volta ao JSON onde
 * não existir. O domínio guarda datas como string ISO, nunca como `Date`, então
 * a volta pelo JSON não perde tipo nenhum.
 */
function deepCopy<V>(value: V): V {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as V;
}

/**
 * A persistent array collection backed by AsyncStorage.
 *
 * This is real persistence, not an in-memory mock: records survive the app
 * being closed (CA-02). An in-memory copy is kept so reads stay synchronous-fast
 * after the first hydration, and every mutation writes through immediately.
 *
 * Nada atravessa a fronteira desta classe por referência. Quem lê recebe uma
 * cópia, quem escreve entrega uma cópia — de outro modo, guardar o objeto
 * devolvido e alterá-lo depois mudaria a coleção sem passar por `update`, e a
 * gravação em disco ficaria para trás do que está em memória.
 */
export class LocalCollection<T extends { id: string }> {
  private cache: T[] | null = null;
  private hydrating: Promise<T[]> | null = null;

  constructor(
    private readonly key: string,
    private readonly seed: () => T[] = () => [],
  ) {}

  private async load(): Promise<T[]> {
    if (this.cache) return this.cache;
    // Collapse concurrent hydrations into one read.
    if (!this.hydrating) {
      this.hydrating = (async () => {
        const stored = await jsonStorage.get<T[] | null>(this.key, null);
        if (stored) {
          this.cache = stored;
        } else {
          // `deepCopy` aqui é o ponto: sem ela, `this.cache` passa a ser o
          // próprio array do catálogo.
          this.cache = deepCopy(this.seed());
          if (this.cache.length) await jsonStorage.set(this.key, this.cache);
        }
        return this.cache;
      })();
    }
    const result = await this.hydrating;
    this.hydrating = null;
    return result;
  }

  private async persist(): Promise<void> {
    await jsonStorage.set(this.key, this.cache ?? []);
  }

  async all(): Promise<T[]> {
    return deepCopy(await this.load());
  }

  async find(predicate: (item: T) => boolean): Promise<T[]> {
    return deepCopy((await this.load()).filter(predicate));
  }

  async byId(id: string): Promise<T | null> {
    const found = (await this.load()).find((item) => item.id === id);
    return found ? deepCopy(found) : null;
  }

  async insert(item: T): Promise<T> {
    const items = await this.load();
    const stored = deepCopy(item);
    items.push(stored);
    await this.persist();
    return deepCopy(stored);
  }

  async update(id: string, patch: Partial<T>): Promise<T> {
    const items = await this.load();
    const index = items.findIndex((item) => item.id === id);
    if (index === -1) throw new Error(`Registro não encontrado (${this.key}/${id})`);
    // `id` por último: um patch não troca a identidade do registro, nem por
    // engano nem de propósito.
    const next = deepCopy({ ...items[index], ...patch, id }) as T;
    items[index] = next;
    await this.persist();
    return deepCopy(next);
  }

  async remove(id: string): Promise<void> {
    const items = await this.load();
    const index = items.findIndex((item) => item.id === id);
    if (index === -1) return;
    items.splice(index, 1);
    await this.persist();
  }

  async removeWhere(predicate: (item: T) => boolean): Promise<void> {
    const items = await this.load();
    const kept = items.filter((item) => !predicate(item));
    if (kept.length === items.length) return;
    this.cache = kept;
    await this.persist();
  }

  /** Replaces the whole collection — used by seeding and account deletion. */
  async replaceAll(items: T[]): Promise<void> {
    this.cache = deepCopy(items);
    await this.persist();
  }
}
