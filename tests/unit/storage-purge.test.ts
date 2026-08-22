import {
  purgeUserFiles,
  type StorageClient,
  type StorageEntry,
  type StorageResult,
} from '../../supabase/functions/_shared/storagePurge';

/**
 * Exclusão recursiva dos arquivos de um usuário (P-02).
 *
 * O dublê abaixo reproduz a semântica que causou o defeito: `list(prefix)`
 * devolve apenas os **filhos imediatos** do prefixo, e uma pasta aparece como
 * entrada com `id: null`. É por isso que `list('uid')` num caminho
 * `uid/trip/arquivo.pdf` devolvia `trip` — um prefixo, não o arquivo — e o
 * `remove(['uid/trip'])` da versão anterior não apagava nada.
 */

const PAGE = 100;

interface FakeOptions {
  /** Buckets cujo `list` deve falhar, para exercitar o §13. */
  failListOn?: string[];
  /** Buckets cujo `remove` deve falhar. */
  failRemoveOn?: string[];
}

function fakeStorage(files: Record<string, string[]>, options: FakeOptions = {}) {
  const store: Record<string, Set<string>> = {};
  for (const [bucket, paths] of Object.entries(files)) store[bucket] = new Set(paths);

  const calls = { list: 0, remove: 0, removedBatches: [] as number[] };

  const client: StorageClient = {
    from(bucket: string) {
      return {
        async list(prefix: string, opts: { limit: number; offset: number }) {
          calls.list += 1;
          if (options.failListOn?.includes(bucket)) {
            return { data: null, error: { message: 'storage indisponível' } } as StorageResult<
              StorageEntry[]
            >;
          }

          // Filhos imediatos de `prefix`, como a API real devolve.
          const children = new Map<string, boolean>(); // nome -> é arquivo
          for (const path of store[bucket] ?? []) {
            if (!path.startsWith(`${prefix}/`)) continue;
            const rest = path.slice(prefix.length + 1);
            const slash = rest.indexOf('/');
            if (slash === -1) children.set(rest, true);
            else children.set(rest.slice(0, slash), false);
          }

          const sorted = [...children.entries()].sort(([a], [b]) => a.localeCompare(b));
          const page = sorted.slice(opts.offset, opts.offset + opts.limit);
          return {
            data: page.map(([name, isFile]) => ({ name, id: isFile ? `id-${name}` : null })),
            error: null,
          } as StorageResult<StorageEntry[]>;
        },

        async remove(paths: string[]) {
          calls.remove += 1;
          calls.removedBatches.push(paths.length);
          if (options.failRemoveOn?.includes(bucket)) {
            return { data: null, error: { message: 'permissão negada' } };
          }
          for (const path of paths) store[bucket]?.delete(path);
          return { data: null, error: null };
        },
      };
    },
  };

  return { client, store, calls };
}

const UID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const BUCKETS = ['attachments', 'journal', 'avatars'] as const;

const remaining = (store: Record<string, Set<string>>) =>
  Object.values(store).flatMap((set) => [...set]);

describe('purgeUserFiles', () => {
  it('removes a flat avatar (caso 1)', async () => {
    const { client, store } = fakeStorage({
      attachments: [],
      journal: [],
      avatars: [`${UID}/avatar-1.jpg`],
    });

    const report = await purgeUserFiles(client, BUCKETS, UID);

    expect(report.ok).toBe(true);
    expect(remaining(store)).toEqual([]);
  });

  it('removes a nested document — the exact bug (caso 2)', async () => {
    // Era isto que sobrevivia: `list(uid)` devolvia o prefixo `trip-abc`, e o
    // `remove(['uid/trip-abc'])` da versão anterior não apagava o PDF.
    const { client, store } = fakeStorage({
      attachments: [`${UID}/trip-abc/passport.pdf`],
      journal: [],
      avatars: [],
    });

    const report = await purgeUserFiles(client, BUCKETS, UID);

    expect(report.ok).toBe(true);
    expect(report.deleted).toContain(`attachments/${UID}/trip-abc/passport.pdf`);
    expect(remaining(store)).toEqual([]);
  });

  it('removes a journal photo (caso 3)', async () => {
    const { client, store } = fakeStorage({
      attachments: [],
      journal: [`${UID}/entry-9/photo.jpg`],
      avatars: [],
    });

    expect((await purgeUserFiles(client, BUCKETS, UID)).ok).toBe(true);
    expect(remaining(store)).toEqual([]);
  });

  it('descends arbitrarily deep (caso 4)', async () => {
    // O nome do arquivo vem do seletor do aparelho e não é higienizado no
    // upload; um nome com barra cria um nível a mais que ninguém previu.
    const { client, store } = fakeStorage({
      attachments: [`${UID}/a/b/c/d/file.jpg`],
      journal: [],
      avatars: [],
    });

    const report = await purgeUserFiles(client, BUCKETS, UID);

    expect(report.ok).toBe(true);
    expect(remaining(store)).toEqual([]);
  });

  it('paginates and batches with many files (caso 5)', async () => {
    // 250 arquivos numa pasta força três páginas de listagem e três lotes de
    // remoção — os dois pontos onde um limite fixo silencioso deixaria sobra.
    const many = Array.from({ length: 250 }, (_, i) => `${UID}/trip-1/doc-${String(i).padStart(3, '0')}.pdf`);
    const { client, store, calls } = fakeStorage({ attachments: many, journal: [], avatars: [] });

    const report = await purgeUserFiles(client, BUCKETS, UID);

    expect(report.ok).toBe(true);
    expect(report.deleted).toHaveLength(250);
    expect(remaining(store)).toEqual([]);
    expect(Math.max(...calls.removedBatches)).toBeLessThanOrEqual(PAGE);
  });

  it('never touches another user (caso 6)', async () => {
    const { client, store } = fakeStorage({
      attachments: [`${UID}/trip-1/meu.pdf`, `${OTHER}/trip-9/dele.pdf`],
      journal: [`${OTHER}/entry-1/foto.jpg`],
      avatars: [`${OTHER}/avatar.jpg`],
    });

    const report = await purgeUserFiles(client, BUCKETS, UID);

    expect(report.ok).toBe(true);
    // O do dono saiu; os três do outro continuam intactos.
    expect(remaining(store).sort()).toEqual(
      [`${OTHER}/trip-9/dele.pdf`, `${OTHER}/entry-1/foto.jpg`, `${OTHER}/avatar.jpg`].sort(),
    );
    expect(report.deleted.every((path) => path.includes(UID))).toBe(true);
  });

  it('does not report success when removal fails (caso 7)', async () => {
    const { client, store } = fakeStorage(
      { attachments: [`${UID}/trip-1/doc.pdf`], journal: [], avatars: [] },
      { failRemoveOn: ['attachments'] },
    );

    const report = await purgeUserFiles(client, BUCKETS, UID);

    // O ponto do teste: a versão anterior descartava o erro e seguia para
    // apagar a conta, respondendo `ok: true` com o arquivo ainda lá.
    expect(report.ok).toBe(false);
    expect(report.remaining).toContain(`attachments/${UID}/trip-1/doc.pdf`);
    expect(remaining(store)).toHaveLength(1);
  });

  it('does not treat a failed listing as an empty folder (caso 7b)', async () => {
    // Uma listagem que falha devolvia zero arquivos, e zero arquivos parecia
    // "não havia nada a apagar".
    const { client } = fakeStorage(
      { attachments: [`${UID}/trip-1/doc.pdf`], journal: [], avatars: [] },
      { failListOn: ['attachments'] },
    );

    const report = await purgeUserFiles(client, BUCKETS, UID);

    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.includes('attachments'))).toBe(true);
  });

  it('refuses an identifier that could escape the prefix', async () => {
    const { client, store } = fakeStorage({
      attachments: [`${OTHER}/trip-9/dele.pdf`],
      journal: [],
      avatars: [],
    });

    for (const bad of ['', '..', 'a/../b', `${UID}/..`, '*']) {
      const report = await purgeUserFiles(client, BUCKETS, bad);
      expect(report.ok).toBe(false);
      expect(report.deleted).toEqual([]);
    }
    expect(remaining(store)).toHaveLength(1);
  });

  it('sweeps all three buckets in one pass', async () => {
    const { client, store } = fakeStorage({
      attachments: [`${UID}/trip-1/a.pdf`],
      journal: [`${UID}/entry-1/b.jpg`],
      avatars: [`${UID}/avatar.jpg`],
    });

    const report = await purgeUserFiles(client, BUCKETS, UID);

    expect(report.ok).toBe(true);
    expect(report.deleted).toHaveLength(3);
    expect(remaining(store)).toEqual([]);
  });
});
