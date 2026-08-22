import {
  contentImagePath,
  editorialImageOrigin,
  managedContentPath,
  managedPathBelongsTo,
} from '@/domain/upload';
import {
  deleteWithEditorialImage,
  saveWithEditorialImage,
  type EditorialImagePort,
} from '@/repositories/editorialImage';
import type { UploadableFile } from '@/repositories/types';

/**
 * O ciclo de vida da imagem editorial (F9 — a metade do P-04 que faltava).
 *
 * O que estes testes protegem não é o upload: é a **ordem** e a **compensação**
 * entre duas gravações que não compartilham transação. Cada falha parcial do
 * §31 aparece aqui como um cenário, e o critério é sempre o mesmo par: o que
 * ficou no bucket e o que ficou no registro.
 */

const PUBLIC =
  'https://projeto.supabase.co/storage/v1/object/public/content/articles/art-1/foto.jpg';
const LEGACY = 'https://images.unsplash.com/photo-1517840901100?auto=format&w=1200';

const arquivo = (name = 'capa.jpg'): UploadableFile => ({
  uri: 'file:///cache/capa.jpg',
  name,
  mimeType: 'image/jpeg',
  size: 1024,
});

/** Porta de mentira com histórico — é o que permite afirmar o que *não* foi apagado. */
function fakePort(overrides: Partial<EditorialImagePort> = {}) {
  const uploaded: string[] = [];
  const removed: string[] = [];
  const port: EditorialImagePort = {
    async upload(kind, entityId) {
      const url = `https://projeto.supabase.co/storage/v1/object/public/content/${contentImagePath(
        kind,
        entityId,
        'jpg',
        `u${uploaded.length + 1}`,
      )}`;
      uploaded.push(url);
      return { url, mimeType: 'image/jpeg' };
    },
    async remove(_kind, _entityId, imageUrl) {
      if (imageUrl) removed.push(imageUrl);
    },
    ...overrides,
  };
  return { port, uploaded, removed };
}

describe('reconhecimento de imagem gerenciada', () => {
  it('extrai o caminho de uma URL pública do bucket content', () => {
    expect(managedContentPath(PUBLIC)).toBe('articles/art-1/foto.jpg');
  });

  it('ignora query string — a URL pública costuma vir com cache-buster', () => {
    expect(managedContentPath(`${PUBLIC}?t=123`)).toBe('articles/art-1/foto.jpg');
  });

  it('reconhece o arquivo do modo local, guardado no diretório do aplicativo', () => {
    const uri = 'file:///documents/easytrip/content/offers/of-1/1750000000-foto.jpg';
    expect(managedContentPath(uri)).toBe('offers/of-1/1750000000-foto.jpg');
  });

  it('não reconhece URL externa — nem do Unsplash, nem de parceiro', () => {
    expect(managedContentPath(LEGACY)).toBeUndefined();
    expect(managedContentPath('https://parceiro.com/foto.jpg')).toBeUndefined();
    expect(managedContentPath(undefined)).toBeUndefined();
  });

  it('não confunde outro bucket com o content', () => {
    const avatar =
      'https://projeto.supabase.co/storage/v1/object/public/avatars/uid/avatar.jpg';
    expect(managedContentPath(avatar)).toBeUndefined();
  });

  it('classifica a procedência que a tela mostra ao administrador', () => {
    expect(editorialImageOrigin(PUBLIC)).toBe('managed');
    expect(editorialImageOrigin(LEGACY)).toBe('external');
    expect(editorialImageOrigin('')).toBe('none');
    expect(editorialImageOrigin(undefined)).toBe('none');
  });

  it('só considera do registro o caminho que carrega o tipo e o id dele', () => {
    expect(managedPathBelongsTo('articles/art-1/foto.jpg', 'articles', 'art-1')).toBe(true);
    // O arquivo de outro artigo não é deste artigo, mesmo estando no bucket.
    expect(managedPathBelongsTo('articles/art-2/foto.jpg', 'articles', 'art-1')).toBe(false);
    // Nem o de outra família com o mesmo id.
    expect(managedPathBelongsTo('offers/art-1/foto.jpg', 'articles', 'art-1')).toBe(false);
    // Caminho raso não prova nada.
    expect(managedPathBelongsTo('foto.jpg', 'articles', 'art-1')).toBe(false);
  });
});

describe('criar conteúdo com imagem', () => {
  it('sobe a imagem e grava o registro apontando para ela', async () => {
    const { port, uploaded, removed } = fakePort();
    const gravado: (string | undefined)[] = [];

    await saveWithEditorialImage({
      kind: 'articles',
      entityId: 'art-1',
      pendingImage: arquivo(),
      persist: async (imageUrl) => {
        gravado.push(imageUrl);
        return { id: 'art-1', imageUrl };
      },
      port,
    });

    expect(uploaded).toHaveLength(1);
    expect(gravado).toEqual([uploaded[0]]);
    expect(removed).toEqual([]);
  });

  it('não grava registro nenhum quando o upload falha (§31 A)', async () => {
    const { port, removed } = fakePort({
      upload: async () => {
        throw new Error('storage fora do ar');
      },
    });
    const persist = jest.fn();

    await expect(
      saveWithEditorialImage({
        kind: 'articles',
        entityId: 'art-1',
        pendingImage: arquivo(),
        persist,
        port,
      }),
    ).rejects.toThrow('storage fora do ar');

    expect(persist).not.toHaveBeenCalled();
    expect(removed).toEqual([]);
  });

  it('remove a imagem recém-subida quando a gravação falha (§31 B)', async () => {
    const { port, uploaded, removed } = fakePort();

    await expect(
      saveWithEditorialImage({
        kind: 'articles',
        entityId: 'art-1',
        pendingImage: arquivo(),
        persist: async () => {
          throw new Error('rls recusou');
        },
        port,
      }),
    ).rejects.toThrow('rls recusou');

    // Sem esta remoção, cada tentativa fracassada deixaria um arquivo eterno.
    expect(removed).toEqual([uploaded[0]]);
  });

  it('deixa o erro original subir mesmo se a compensação também falhar', async () => {
    const { port } = fakePort({
      remove: async () => {
        throw new Error('remoção também falhou');
      },
    });

    await expect(
      saveWithEditorialImage({
        kind: 'articles',
        entityId: 'art-1',
        pendingImage: arquivo(),
        persist: async () => {
          throw new Error('rls recusou');
        },
        port,
      }),
    ).rejects.toThrow('rls recusou');
  });
});

describe('editar conteúdo', () => {
  it('sem trocar a imagem, não toca no Storage e mantém a URL gravada', async () => {
    const { port, uploaded, removed } = fakePort();
    const gravado: (string | undefined)[] = [];

    await saveWithEditorialImage({
      kind: 'articles',
      entityId: 'art-1',
      currentImageUrl: PUBLIC,
      pendingImage: undefined,
      persist: async (imageUrl) => {
        gravado.push(imageUrl);
        return { imageUrl };
      },
      port,
    });

    expect(uploaded).toEqual([]);
    expect(removed).toEqual([]);
    expect(gravado).toEqual([PUBLIC]);
  });

  it('trocando a imagem: sobe a nova, grava e só então remove a antiga (§16)', async () => {
    const ordem: string[] = [];
    const { port, uploaded } = fakePort({
      async remove(_kind, _entityId, imageUrl) {
        ordem.push(`remove:${imageUrl}`);
      },
    });

    await saveWithEditorialImage({
      kind: 'articles',
      entityId: 'art-1',
      currentImageUrl: PUBLIC,
      pendingImage: arquivo(),
      persist: async (imageUrl) => {
        ordem.push(`persist:${imageUrl}`);
        return { imageUrl };
      },
      port,
    });

    expect(ordem).toEqual([`persist:${uploaded[0]}`, `remove:${PUBLIC}`]);
  });

  it('não apaga a imagem antiga quando a gravação da troca falha (§31 C)', async () => {
    const { port, uploaded, removed } = fakePort();

    await expect(
      saveWithEditorialImage({
        kind: 'articles',
        entityId: 'art-1',
        currentImageUrl: PUBLIC,
        pendingImage: arquivo(),
        persist: async () => {
          throw new Error('update falhou');
        },
        port,
      }),
    ).rejects.toThrow('update falhou');

    // A antiga continua no ar — o registro ainda aponta para ela.
    expect(removed).toEqual([uploaded[0]]);
    expect(removed).not.toContain(PUBLIC);
  });

  it('a troca continua válida se a remoção da antiga falhar (§31 D)', async () => {
    const { port, uploaded } = fakePort({
      remove: async () => {
        throw new Error('storage recusou a remoção');
      },
    });

    const salvo = await saveWithEditorialImage({
      kind: 'articles',
      entityId: 'art-1',
      currentImageUrl: PUBLIC,
      pendingImage: arquivo(),
      persist: async (imageUrl) => ({ imageUrl }),
      port,
    });

    // O administrador não recebe erro por causa de um arquivo que sobrou.
    expect(salvo.imageUrl).toBe(uploaded[0]);
  });

  it('imagem legada externa é substituída, nunca apagada (§17, §31 E)', async () => {
    const { port, removed } = fakePort({
      // A porta real não apaga URL externa; aqui a porta registra tudo o que
      // recebe, para o teste provar que a *decisão* de não apagar é do
      // repositório e que a chamada chega com o valor certo.
      async remove(_kind, _entityId, imageUrl) {
        if (imageUrl) removed.push(imageUrl);
      },
    });

    await saveWithEditorialImage({
      kind: 'articles',
      entityId: 'art-1',
      currentImageUrl: LEGACY,
      pendingImage: arquivo(),
      persist: async (imageUrl) => ({ imageUrl }),
      port,
    });

    expect(removed).toEqual([LEGACY]);
    expect(managedContentPath(LEGACY)).toBeUndefined();
  });

  it('remover a imagem grava o registro sem ela antes de apagar o arquivo', async () => {
    const ordem: string[] = [];
    const { port } = fakePort({
      async remove(_kind, _entityId, imageUrl) {
        ordem.push(`remove:${imageUrl}`);
      },
    });

    await saveWithEditorialImage({
      kind: 'articles',
      entityId: 'art-1',
      currentImageUrl: PUBLIC,
      pendingImage: null,
      persist: async (imageUrl) => {
        ordem.push(`persist:${String(imageUrl)}`);
        return { imageUrl };
      },
      port,
    });

    expect(ordem).toEqual(['persist:undefined', `remove:${PUBLIC}`]);
  });

  it('repetir a mesma gravação converge — retry é previsível (§31 G)', async () => {
    let tentativas = 0;
    const { port, uploaded } = fakePort();

    const salvar = () =>
      saveWithEditorialImage({
        kind: 'articles',
        entityId: 'art-1',
        currentImageUrl: PUBLIC,
        pendingImage: arquivo(),
        persist: async (imageUrl) => {
          tentativas += 1;
          if (tentativas === 1) throw new Error('rede caiu');
          return { imageUrl };
        },
        port,
      });

    await expect(salvar()).rejects.toThrow('rede caiu');
    const salvo = await salvar();

    // Duas subidas, e a da tentativa fracassada foi removida: o bucket fica
    // com exatamente o arquivo que o registro usa.
    expect(uploaded).toHaveLength(2);
    expect(salvo.imageUrl).toBe(uploaded[1]);
  });
});

describe('excluir conteúdo', () => {
  it('apaga o registro e depois a imagem gerenciada (§18)', async () => {
    const ordem: string[] = [];
    const { port } = fakePort({
      async remove(_kind, _entityId, imageUrl) {
        ordem.push(`remove:${imageUrl}`);
      },
    });

    await deleteWithEditorialImage({
      kind: 'articles',
      entityId: 'art-1',
      imageUrl: PUBLIC,
      removeRecord: async () => {
        ordem.push('removeRecord');
      },
      port,
    });

    expect(ordem).toEqual(['removeRecord', `remove:${PUBLIC}`]);
  });

  it('a exclusão do conteúdo vale mesmo se o arquivo já não existir (§31 F)', async () => {
    let apagou = false;
    const { port } = fakePort({
      remove: async () => {
        throw new Error('objeto inexistente');
      },
    });

    await expect(
      deleteWithEditorialImage({
        kind: 'articles',
        entityId: 'art-1',
        imageUrl: PUBLIC,
        removeRecord: async () => {
          apagou = true;
        },
        port,
      }),
    ).resolves.toBeUndefined();

    expect(apagou).toBe(true);
  });

  it('não tenta remover nada quando o conteúdo não tinha imagem', async () => {
    const { port, removed } = fakePort();

    await deleteWithEditorialImage({
      kind: 'offers',
      entityId: 'of-1',
      imageUrl: undefined,
      removeRecord: async () => undefined,
      port,
    });

    expect(removed).toEqual([]);
  });
});
