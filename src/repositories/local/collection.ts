import { jsonStorage } from '@/lib/storage';

/**
 * A persistent array collection backed by AsyncStorage.
 *
 * This is real persistence, not an in-memory mock: records survive the app
 * being closed (CA-02). An in-memory copy is kept so reads stay synchronous-fast
 * after the first hydration, and every mutation writes through immediately.
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
          this.cache = this.seed();
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
    return [...(await this.load())];
  }

  async find(predicate: (item: T) => boolean): Promise<T[]> {
    return (await this.load()).filter(predicate);
  }

  async byId(id: string): Promise<T | null> {
    return (await this.load()).find((item) => item.id === id) ?? null;
  }

  async insert(item: T): Promise<T> {
    const items = await this.load();
    items.push(item);
    await this.persist();
    return item;
  }

  async update(id: string, patch: Partial<T>): Promise<T> {
    const items = await this.load();
    const index = items.findIndex((item) => item.id === id);
    if (index === -1) throw new Error(`Registro não encontrado (${this.key}/${id})`);
    const next = { ...items[index], ...patch, id } as T;
    items[index] = next;
    await this.persist();
    return next;
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
    this.cache = items;
    await this.persist();
  }
}
