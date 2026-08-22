import type { Advisor, Article, Offer } from '@/domain/types';
import { dataSource } from '@/repositories';
import {
  deleteWithEditorialImage,
  saveWithEditorialImage,
} from '@/repositories/editorialImage';
import type { UploadableFile } from '@/repositories/types';

/**
 * O fluxo administrativo inteiro, ponta a ponta, contra a fonte de dados de
 * verdade (F9, §30 e §40 — fechamento do P-04).
 *
 * Diferente de `editorial-image.test.ts`, aqui não há porta de mentira: a
 * imagem é gravada pelo repositório, o registro vai para a coleção persistida e
 * o arquivo é procurado no sistema de arquivos. É o que prova que a operação
 * de alto nível — "o administrador salvou" — produz o par certo, e não só que
 * o coordenador chama as funções na ordem certa.
 *
 * A fonte exercitada é a local, que é a que roda em teste. A remota é coberta
 * pela bateria E2E (`supabase/tests/content_admin_e2e.mjs`), onde a policy
 * `content_write` e a RLS participam de verdade — coisas que nenhum teste em
 * Node consegue simular sem mentir.
 */

const fs = () => require('expo-file-system') as { __reset: () => void; __files: Map<string, unknown> };

const arquivo = (name: string): UploadableFile => ({
  uri: `file:///cache/${name}`,
  name,
  mimeType: 'image/jpeg',
  size: 2048,
});

const existe = (uri?: string) => Boolean(uri && fs().__files.has(uri));

const artigo = (overrides: Partial<Article> = {}): Article => ({
  id: 'f9-art',
  slug: 'artigo-da-f9',
  title: 'Como escolher a próxima viagem',
  category: 'Inspiração',
  authorName: 'Equipe Easy Trip',
  content: 'x'.repeat(200),
  publishedAt: '2026-08-21T12:00:00.000Z',
  estimatedReadMinutes: 5,
  status: 'draft',
  ...overrides,
});

const oferta = (overrides: Partial<Offer> = {}): Offer => ({
  id: 'f9-of',
  destination: 'Porto, Portugal',
  description: 'Cinco noites na Ribeira com café da manhã.',
  costLevel: 'economy',
  imageUrl: '',
  thingsToDo: ['Livraria Lello'],
  status: 'draft',
  sortOrder: 5,
  ...overrides,
});

const especialista = (overrides: Partial<Advisor> = {}): Advisor => ({
  id: 'f9-adv',
  name: 'Helena Braga',
  specialty: 'Portugal',
  status: 'online',
  active: true,
  ...overrides,
});

/** Salva como o formulário salva: registro + imagem, na mesma operação. */
async function salvarArtigo(record: Article, pendingImage?: UploadableFile | null, atual?: string) {
  return saveWithEditorialImage({
    kind: 'articles',
    entityId: record.id,
    currentImageUrl: atual,
    pendingImage,
    persist: (imageUrl) => dataSource.content.upsertArticle({ ...record, imageUrl }),
  });
}

beforeEach(() => fs().__reset());

describe('artigo: rascunho → publicação → troca de imagem → exclusão', () => {
  it('percorre o ciclo inteiro com a imagem acompanhando o registro', async () => {
    /* 1–3. rascunho com imagem: o arquivo sobe e o registro aponta para ele. */
    const criado = await salvarArtigo(artigo(), arquivo('capa-1.jpg'));
    expect(criado.imageUrl).toContain('/content/articles/f9-art/');
    expect(existe(criado.imageUrl)).toBe(true);

    /* 4. rascunho não vaza para a Comunidade — mas existe no painel. */
    expect((await dataSource.content.listArticles()).map((a) => a.id)).not.toContain('f9-art');
    expect((await dataSource.content.listAllArticles()).map((a) => a.id)).toContain('f9-art');

    /* 5–7. publicado: aparece na lista pública, com a mesma imagem. */
    const publicado = await salvarArtigo(
      artigo({ status: 'published' }),
      undefined,
      criado.imageUrl,
    );
    const publico = await dataSource.content.listArticles();
    expect(publico.map((a) => a.id)).toContain('f9-art');
    expect(publico.find((a) => a.id === 'f9-art')?.imageUrl).toBe(criado.imageUrl);
    expect(publicado.imageUrl).toBe(criado.imageUrl);

    /* 8–10. troca: nova no ar, antiga removida do armazenamento. */
    const trocado = await salvarArtigo(
      artigo({ status: 'published' }),
      arquivo('capa-2.jpg'),
      criado.imageUrl,
    );
    expect(trocado.imageUrl).not.toBe(criado.imageUrl);
    expect(existe(trocado.imageUrl)).toBe(true);
    expect(existe(criado.imageUrl)).toBe(false);

    /* 11–12. exclusão: some do público e leva a imagem junto. */
    await deleteWithEditorialImage({
      kind: 'articles',
      entityId: 'f9-art',
      imageUrl: trocado.imageUrl,
      removeRecord: () => dataSource.content.removeArticle('f9-art'),
    });

    expect((await dataSource.content.listAllArticles()).map((a) => a.id)).not.toContain('f9-art');
    expect(existe(trocado.imageUrl)).toBe(false);
  });

  it('editar sem trocar a imagem não mexe no arquivo', async () => {
    const criado = await salvarArtigo(artigo(), arquivo('capa.jpg'));

    const editado = await salvarArtigo(
      artigo({ title: 'Outro título' }),
      undefined,
      criado.imageUrl,
    );

    expect(editado.imageUrl).toBe(criado.imageUrl);
    expect(existe(criado.imageUrl)).toBe(true);
  });

  it('não apaga imagem externa legada ao substituí-la (§17)', async () => {
    const legado = 'https://images.unsplash.com/photo-1517840901100?auto=format&w=1200';
    await dataSource.content.upsertArticle(artigo({ imageUrl: legado }));

    const trocado = await salvarArtigo(artigo(), arquivo('propria.jpg'), legado);

    // A nova é gerenciada; a antiga era de terceiro e continua sendo só uma URL
    // — nada foi pedido ao armazenamento a respeito dela.
    expect(trocado.imageUrl).toContain('/content/articles/');
    expect(existe(trocado.imageUrl)).toBe(true);
    await expect(
      dataSource.content.removeEditorialImage('articles', 'f9-art', legado),
    ).resolves.toBeUndefined();
  });

  it('não remove o arquivo de outro registro, mesmo se a coluna apontar para ele', async () => {
    const outro = await salvarArtigo(artigo({ id: 'f9-outro' }), arquivo('do-outro.jpg'));

    // Cenário defensivo: alguém grava em `f9-art` a URL da imagem de `f9-outro`
    // e manda excluir `f9-art`. O caminho não é de `f9-art`, então nada sai.
    await deleteWithEditorialImage({
      kind: 'articles',
      entityId: 'f9-art',
      imageUrl: outro.imageUrl,
      removeRecord: async () => undefined,
    });

    expect(existe(outro.imageUrl)).toBe(true);
  });

  it('a gravação recusada não deixa arquivo órfão', async () => {
    const antes = fs().__files.size;

    await expect(
      saveWithEditorialImage({
        kind: 'articles',
        entityId: 'f9-art',
        pendingImage: arquivo('capa.jpg'),
        persist: async () => {
          throw new Error('banco recusou');
        },
      }),
    ).rejects.toThrow('banco recusou');

    expect(fs().__files.size).toBe(antes);
  });

  it('recusa o arquivo que o bucket recusaria, antes de gravar qualquer coisa', async () => {
    // Id próprio: as coleções locais persistem entre os cenários deste arquivo,
    // e reaproveitar `f9-art` faria a asserção medir o resto do teste anterior.
    await expect(
      salvarArtigo(artigo({ id: 'f9-art-recusado' }), {
        ...arquivo('doc.pdf'),
        mimeType: 'application/pdf',
      }),
    ).rejects.toThrow(/JPG, PNG ou WEBP/);

    expect((await dataSource.content.listAllArticles()).map((a) => a.id)).not.toContain(
      'f9-art-recusado',
    );
  });
});

describe('oferta: rascunho, vigência e imagem', () => {
  const salvarOferta = (record: Offer, pendingImage?: UploadableFile | null, atual?: string) =>
    saveWithEditorialImage({
      kind: 'offers',
      entityId: record.id,
      currentImageUrl: atual,
      pendingImage,
      persist: (imageUrl) =>
        dataSource.content.upsertOffer({ ...record, imageUrl: imageUrl ?? '' }),
    });

  it('rascunho não chega à Home; publicada e vigente, sim', async () => {
    const criada = await salvarOferta(oferta(), arquivo('oferta.jpg'));
    expect(criada.imageUrl).toContain('/content/offers/f9-of/');

    expect((await dataSource.content.listOffers()).map((o) => o.id)).not.toContain('f9-of');
    expect((await dataSource.content.listAllOffers()).map((o) => o.id)).toContain('f9-of');

    await salvarOferta(oferta({ status: 'published' }), undefined, criada.imageUrl);
    expect((await dataSource.content.listOffers()).map((o) => o.id)).toContain('f9-of');
  });

  it('oferta vencida some da Home sem sair do painel', async () => {
    const criada = await salvarOferta(
      oferta({ status: 'published', activeUntil: '2020-01-01' }),
      arquivo('oferta.jpg'),
    );

    expect((await dataSource.content.listOffers()).map((o) => o.id)).not.toContain('f9-of');
    expect((await dataSource.content.listAllOffers()).map((o) => o.id)).toContain('f9-of');
    expect(existe(criada.imageUrl)).toBe(true);
  });

  it('trocar e excluir mantêm o par registro/arquivo consistente', async () => {
    const criada = await salvarOferta(oferta({ status: 'published' }), arquivo('a.jpg'));
    const trocada = await salvarOferta(
      oferta({ status: 'published' }),
      arquivo('b.jpg'),
      criada.imageUrl,
    );

    expect(existe(criada.imageUrl)).toBe(false);
    expect(existe(trocada.imageUrl)).toBe(true);

    await deleteWithEditorialImage({
      kind: 'offers',
      entityId: 'f9-of',
      imageUrl: trocada.imageUrl,
      removeRecord: () => dataSource.content.removeOffer('f9-of'),
    });

    expect((await dataSource.content.listAllOffers()).map((o) => o.id)).not.toContain('f9-of');
    expect(existe(trocada.imageUrl)).toBe(false);
  });
});

describe('especialista: cadastro, foto e diretório', () => {
  const salvarAdvisor = (record: Advisor, pendingImage?: UploadableFile | null, atual?: string) =>
    saveWithEditorialImage({
      kind: 'advisors',
      entityId: record.id,
      currentImageUrl: atual,
      pendingImage,
      persist: (imageUrl) => dataSource.advisors.upsert({ ...record, avatarUrl: imageUrl }),
    });

  it('a foto vai para o prefixo de conteúdo, não para o bucket de avatar', async () => {
    const salvo = await salvarAdvisor(especialista(), arquivo('foto.jpg'));

    expect(salvo.avatarUrl).toContain('/content/advisors/f9-adv/');
    expect(salvo.avatarUrl).not.toContain('/avatars/');
    expect(existe(salvo.avatarUrl)).toBe(true);
  });

  it('inativo sai do diretório público e continua no painel', async () => {
    await salvarAdvisor(especialista(), arquivo('foto.jpg'));
    expect((await dataSource.advisors.list()).map((a) => a.id)).toContain('f9-adv');

    await salvarAdvisor(especialista({ active: false }), undefined);
    expect((await dataSource.advisors.list()).map((a) => a.id)).not.toContain('f9-adv');
    expect((await dataSource.advisors.listAll()).map((a) => a.id)).toContain('f9-adv');
  });

  it('excluir o cadastro leva a foto junto', async () => {
    const salvo = await salvarAdvisor(especialista(), arquivo('foto.jpg'));

    await deleteWithEditorialImage({
      kind: 'advisors',
      entityId: 'f9-adv',
      imageUrl: salvo.avatarUrl,
      removeRecord: () => dataSource.advisors.remove('f9-adv'),
    });

    expect((await dataSource.advisors.listAll()).map((a) => a.id)).not.toContain('f9-adv');
    expect(existe(salvo.avatarUrl)).toBe(false);
  });
});

describe('lugar: paridade com as demais entidades', () => {
  it('sobe a foto no prefixo do lugar e a remove ao excluir', async () => {
    const salvo = await saveWithEditorialImage({
      kind: 'places',
      entityId: 'f9-place',
      pendingImage: arquivo('lugar.jpg'),
      persist: (imageUrl) =>
        dataSource.places.upsert({
          id: 'f9-place',
          name: 'Café da Ribeira',
          type: 'restaurant',
          city: 'Porto',
          country: 'Portugal',
          imageUrl,
        }),
    });

    expect(salvo.imageUrl).toContain('/content/places/f9-place/');
    expect((await dataSource.places.list()).map((p) => p.id)).toContain('f9-place');

    await deleteWithEditorialImage({
      kind: 'places',
      entityId: 'f9-place',
      imageUrl: salvo.imageUrl,
      removeRecord: () => dataSource.places.remove('f9-place'),
    });

    expect((await dataSource.places.list()).map((p) => p.id)).not.toContain('f9-place');
    expect(existe(salvo.imageUrl)).toBe(false);
  });
});
