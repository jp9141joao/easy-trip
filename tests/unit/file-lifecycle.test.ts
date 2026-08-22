import { readMirror, writeMirrorFromFile } from '@/lib/fileMirror';
import {
  OrphanFileError,
  deleteWithFiles,
  ownsPath,
  removeObjects,
} from '@/repositories/supabase/fileLifecycle';

/**
 * F8 — P-07.
 *
 * O dublê imita a resposta que o Storage do Supabase **realmente** dá, medida
 * contra a pilha local: `remove` devolve 200 com lista vazia tanto quando a
 * policy barra quanto quando o objeto já não existia. É por isso que não basta
 * checar `error` — a evidência é o que voltou na lista.
 */

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const TRIP = 'viagem';

/** Storage de mentira com a semântica real: policy por prefixo, sem erro. */
function fakeStorage(inicial: string[], opcoes: { indelevel?: string[] } = {}) {
  const objetos = new Set(inicial);
  const chamadas = { remove: [] as string[][], list: 0 };

  const from = () => ({
    async remove(paths: string[]) {
      chamadas.remove.push(paths);
      const removidos: { name: string }[] = [];
      for (const p of paths) {
        // A policy `*_owner` compara o primeiro segmento com o auth.uid().
        if (!p.startsWith(`${A}/`)) continue;
        if (opcoes.indelevel?.includes(p)) continue; // falha "silenciosa"
        if (objetos.delete(p)) removidos.push({ name: p });
      }
      // Nunca `error`. É esse o ponto.
      return { data: removidos, error: null };
    },
    async list(prefix: string, params: { search?: string }) {
      chamadas.list += 1;
      const alvo = `${prefix}/${params.search}`;
      return { data: objetos.has(alvo) ? [{ name: params.search }] : [], error: null };
    },
  });

  return {
    deps: { db: () => ({ storage: { from } }) as never, userId: A },
    objetos,
    chamadas,
  };
}

const caminhoA = `${A}/${TRIP}/bilhete.pdf`;
const caminhoB = `${B}/${TRIP}/de-b.pdf`;

/* eslint-disable @typescript-eslint/no-require-imports */
beforeEach(() => (require('expo-file-system') as { __reset: () => void }).__reset());

describe('propriedade do caminho', () => {
  it('o caminho do próprio usuário é aceito', () => {
    expect(ownsPath(A, caminhoA)).toBe(true);
  });

  it('o caminho de outro usuário é recusado', () => {
    // §47: o `file_path` gravado na linha não autoriza nada. Sem esta barreira,
    // adulterar a própria linha viraria "apagar o documento do vizinho".
    expect(ownsPath(A, caminhoB)).toBe(false);
  });

  it('sem sessão, nada é aceito', () => {
    expect(ownsPath(null, caminhoA)).toBe(false);
  });
});

describe('A: caminho feliz — arquivo e linha somem', () => {
  it('remove o objeto e chama o delete da linha', async () => {
    const { deps, objetos } = fakeStorage([caminhoA]);
    await writeMirrorFromFile('attachments', caminhoA, 'file:///cache/x.pdf');
    const apagou = jest.fn(async () => undefined);

    await deleteWithFiles(deps, 'attachments', [caminhoA], apagou);

    expect(objetos.has(caminhoA)).toBe(false);
    expect(apagou).toHaveBeenCalledTimes(1);
    // "A exclusão precisa remover as duas" (D-04).
    expect(readMirror('attachments', caminhoA)).toBeUndefined();
  });
});

describe('D: o arquivo já não existe', () => {
  it('não é erro, e a linha é apagada assim mesmo', async () => {
    const { deps } = fakeStorage([]);
    const apagou = jest.fn(async () => undefined);

    await deleteWithFiles(deps, 'attachments', [caminhoA], apagou);

    expect(apagou).toHaveBeenCalledTimes(1);
  });

  it('registro sem arquivo nenhum não chama o Storage', async () => {
    const { deps, chamadas } = fakeStorage([]);
    const apagou = jest.fn(async () => undefined);

    await deleteWithFiles(deps, 'attachments', [undefined, null], apagou);

    expect(chamadas.remove).toHaveLength(0);
    expect(apagou).toHaveBeenCalledTimes(1);
  });
});

describe('B: a remoção do arquivo falha', () => {
  it('a linha NÃO é apagada — nada vira lixo invisível', async () => {
    const { deps, objetos } = fakeStorage([caminhoA], { indelevel: [caminhoA] });
    const apagou = jest.fn(async () => undefined);

    await expect(deleteWithFiles(deps, 'attachments', [caminhoA], apagou)).rejects.toThrow(
      OrphanFileError,
    );

    // O ponto do P-07: em vez de linha apagada + arquivo órfão, fica tudo como
    // estava. Visível, recuperável, e a tentativa seguinte recomeça do zero.
    expect(apagou).not.toHaveBeenCalled();
    expect(objetos.has(caminhoA)).toBe(true);
  });

  it('F: repetir depois da falha funciona quando a causa passa', async () => {
    const storage = fakeStorage([caminhoA], { indelevel: [caminhoA] });
    const apagou = jest.fn(async () => undefined);

    await expect(
      deleteWithFiles(storage.deps, 'attachments', [caminhoA], apagou),
    ).rejects.toThrow(OrphanFileError);

    // A causa passou (permissão restabelecida, rede voltou).
    const segunda = fakeStorage([caminhoA]);
    await deleteWithFiles(segunda.deps, 'attachments', [caminhoA], apagou);

    expect(apagou).toHaveBeenCalledTimes(1);
    expect(segunda.objetos.has(caminhoA)).toBe(false);
  });
});

describe('C: o delete da linha falha', () => {
  it('o erro sobe, e repetir é seguro', async () => {
    const { deps } = fakeStorage([caminhoA]);
    const apagou = jest.fn(async () => {
      throw new Error('falha no banco');
    });

    await expect(deleteWithFiles(deps, 'attachments', [caminhoA], apagou)).rejects.toThrow(
      'falha no banco',
    );

    // O arquivo já foi. A segunda tentativa encontra a remoção como no-op e
    // segue para a linha — convergindo em vez de travar.
    const apagouDeNovo = jest.fn(async () => undefined);
    await deleteWithFiles(deps, 'attachments', [caminhoA], apagouDeNovo);
    expect(apagouDeNovo).toHaveBeenCalledTimes(1);
  });
});

describe('G: arquivo de outro usuário', () => {
  it('nunca é sequer enviado ao Storage, e a exclusão é interrompida', async () => {
    const { deps, objetos, chamadas } = fakeStorage([caminhoB]);
    const apagou = jest.fn(async () => undefined);

    await expect(deleteWithFiles(deps, 'attachments', [caminhoB], apagou)).rejects.toThrow(
      OrphanFileError,
    );

    expect(chamadas.remove).toHaveLength(0);
    expect(objetos.has(caminhoB)).toBe(true);
    expect(apagou).not.toHaveBeenCalled();
  });
});

describe('F: várias mídias na mesma entrada', () => {
  const midias = [`${A}/e1/a.jpg`, `${A}/e1/b.jpg`, `${A}/e1/c.jpg`];

  it('todas somem', async () => {
    const { deps, objetos } = fakeStorage([...midias]);
    const apagou = jest.fn(async () => undefined);

    await deleteWithFiles(deps, 'journal', midias, apagou);

    expect([...objetos]).toHaveLength(0);
    expect(apagou).toHaveBeenCalledTimes(1);
  });

  it('uma ausente entre as presentes não atrapalha', async () => {
    const { deps, objetos } = fakeStorage([midias[0], midias[2]]);
    const apagou = jest.fn(async () => undefined);

    await deleteWithFiles(deps, 'journal', midias, apagou);

    expect([...objetos]).toHaveLength(0);
    expect(apagou).toHaveBeenCalledTimes(1);
  });

  it('se UMA falhar, a linha não é apagada e o erro diz qual', async () => {
    const { deps, objetos } = fakeStorage([...midias], { indelevel: [midias[1]] });
    const apagou = jest.fn(async () => undefined);

    await expect(deleteWithFiles(deps, 'journal', midias, apagou)).rejects.toMatchObject({
      paths: [midias[1]],
    });

    expect(apagou).not.toHaveBeenCalled();
    expect(objetos.has(midias[1])).toBe(true);
  });

  it('entrada sem mídia nenhuma apaga direto', async () => {
    const { deps, chamadas } = fakeStorage([]);
    const apagou = jest.fn(async () => undefined);

    await deleteWithFiles(deps, 'journal', [], apagou);

    expect(chamadas.remove).toHaveLength(0);
    expect(apagou).toHaveBeenCalledTimes(1);
  });
});

describe('a lista só é consultada quando a resposta é ambígua', () => {
  it('no caminho feliz não há chamada extra', async () => {
    const { deps, chamadas } = fakeStorage([caminhoA]);
    await removeObjects(deps, 'attachments', [caminhoA]);
    expect(chamadas.list).toBe(0);
  });

  it('quando nada volta na lista, confere se o objeto sumiu', async () => {
    const { deps, chamadas } = fakeStorage([]);
    const sobreviventes = await removeObjects(deps, 'attachments', [caminhoA]);

    expect(chamadas.list).toBe(1);
    expect(sobreviventes).toEqual([]);
  });
});
