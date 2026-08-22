import { ADVISORS, ARTICLES, OFFERS, PLACES } from '@/data/catalog';
import { jsonStorage } from '@/lib/storage';
import { LocalCollection } from '@/repositories/local/collection';
import { localCollections, localDataSource } from '@/repositories/local/LocalDataSource';
import { AMANHA, ONTEM, advisor, offer, runCatalogContract } from '../contracts/catalogContract';

/**
 * F6 — fechamento do P-05.
 *
 * O contrato de catálogo roda contra a fonte local; o resto deste arquivo cobre
 * o que é específico dela: a semente não pode ser tocada e uma coleção não pode
 * contaminar outra.
 */

runCatalogContract({
  name: 'LocalDataSource',
  create: async () => {
    // `replaceAll` devolve as coleções ao catálogo entre um cenário e outro —
    // e ela copia em profundidade, então passar a constante aqui é seguro.
    await localCollections.offers.replaceAll(OFFERS);
    await localCollections.advisors.replaceAll(ADVISORS);
    return localDataSource;
  },
});

describe('a semente nunca é escrita', () => {
  const tamanhos = {
    offers: OFFERS.length,
    advisors: ADVISORS.length,
    articles: ARTICLES.length,
    places: PLACES.length,
  };

  it('criar conteúdo não acrescenta nada às constantes do catálogo', async () => {
    // Era exatamente isto que acontecia: `new LocalCollection('articles', () => ARTICLES)`
    // guardava o próprio array, e `insert` passava a escrever dentro dele.
    await localDataSource.content.upsertOffer(offer({ id: 'semente-oferta' }));
    await localDataSource.advisors.upsert(advisor({ id: 'semente-advisor' }));
    await localDataSource.content.upsertArticle({
      id: 'semente-artigo',
      slug: 'semente-artigo',
      title: 'Artigo de teste',
      category: 'Dicas',
      authorName: 'Equipe',
      content: 'x'.repeat(80),
      publishedAt: '2026-08-21T00:00:00.000Z',
      estimatedReadMinutes: 3,
      status: 'draft',
    });
    await localDataSource.places.upsert({
      id: 'semente-lugar',
      name: 'Hotel de teste',
      type: 'hotel',
      city: 'Lisboa',
      country: 'Portugal',
    });

    expect(OFFERS).toHaveLength(tamanhos.offers);
    expect(ADVISORS).toHaveLength(tamanhos.advisors);
    expect(ARTICLES).toHaveLength(tamanhos.articles);
    expect(PLACES).toHaveLength(tamanhos.places);

    expect(OFFERS.some((o) => o.id === 'semente-oferta')).toBe(false);
    expect(ADVISORS.some((a) => a.id === 'semente-advisor')).toBe(false);
    expect(ARTICLES.some((a) => a.id === 'semente-artigo')).toBe(false);
    expect(PLACES.some((p) => p.id === 'semente-lugar')).toBe(false);
  });

  it('editar conteúdo não altera o registro correspondente no catálogo', async () => {
    const original = OFFERS[0];
    await localDataSource.content.upsertOffer({ ...original, destination: 'Destino Sequestrado' });

    expect(OFFERS[0].destination).toBe(original.destination);
    expect(OFFERS.some((o) => o.destination === 'Destino Sequestrado')).toBe(false);
  });

  it('mexer no que a coleção devolveu não muda a coleção', async () => {
    // Sem cópia na saída, guardar o objeto lido e alterá-lo depois mudaria o
    // registro sem passar por `update` — e o disco ficaria para trás.
    const lida = await localDataSource.content.getOffer(OFFERS[0].id);
    lida!.destination = 'Alterado por fora';
    lida!.thingsToDo.push('Item injetado');

    const relida = await localDataSource.content.getOffer(OFFERS[0].id);
    expect(relida?.destination).not.toBe('Alterado por fora');
    expect(relida?.thingsToDo).not.toContain('Item injetado');
  });

  it('ordenar a listagem não reordena o catálogo', async () => {
    const ordemOriginal = OFFERS.map((o) => o.id);
    await localDataSource.content.listOffers();
    await localDataSource.content.listAllOffers();
    await localDataSource.advisors.list();

    expect(OFFERS.map((o) => o.id)).toEqual(ordemOriginal);
  });
});

describe('isolamento entre coleções', () => {
  beforeEach(async () => {
    await jsonStorage.clearAll();
  });

  it('duas coleções com a mesma semente não compartilham estado', async () => {
    const a = new LocalCollection('isolamento-a', () => [...OFFERS]);
    const b = new LocalCollection('isolamento-b', () => [...OFFERS]);

    await a.insert(offer({ id: 'so-em-a' }));

    expect((await a.all()).map((o) => o.id)).toContain('so-em-a');
    expect((await b.all()).map((o) => o.id)).not.toContain('so-em-a');
    expect(await b.all()).toHaveLength(OFFERS.length);
  });

  it('remover tudo de uma não esvazia a outra', async () => {
    const a = new LocalCollection('isolamento-c', () => [...OFFERS]);
    const b = new LocalCollection('isolamento-d', () => [...OFFERS]);

    await a.replaceAll([]);

    expect(await a.all()).toHaveLength(0);
    expect((await b.all()).length).toBe(OFFERS.length);
  });

  it('uma coleção recriada a partir da semente volta ao catálogo original', async () => {
    const primeira = new LocalCollection('isolamento-e', () => [...OFFERS]);
    await primeira.insert(offer({ id: 'temporaria' }));

    // Semente intacta é o que permite recomeçar limpo — se ela tivesse sido
    // escrita, a coleção nova já nasceria com o lixo da anterior.
    await jsonStorage.clearAll();
    const recriada = new LocalCollection('isolamento-e', () => [...OFFERS]);

    expect((await recriada.all()).map((o) => o.id)).not.toContain('temporaria');
    expect(await recriada.all()).toHaveLength(OFFERS.length);
  });
});

describe('paridade com a policy do PostgreSQL', () => {
  /**
   * Mesmas quatro ofertas e mesmos dois especialistas de
   * `supabase/tests/rls_content.test.sql`, que os exercita contra um Postgres
   * de verdade. Ali a policy `offers_read` devolve **uma** oferta para conta
   * comum; aqui a fonte local precisa devolver a mesma.
   *
   * Não se comparam implementações — compara-se a saída para a mesma entrada.
   */
  const MESMAS_OFERTAS = [
    offer({ id: 'par-lisboa', destination: 'Lisboa', status: 'published' }),
    offer({ id: 'par-roma', destination: 'Roma', status: 'draft' }),
    offer({ id: 'par-oslo', destination: 'Oslo', status: 'published', activeUntil: ONTEM }),
    offer({ id: 'par-hanoi', destination: 'Hanói', status: 'published', activeFrom: AMANHA }),
  ];

  const MESMOS_ESPECIALISTAS = [
    advisor({ id: 'par-ativa', name: 'Ativa Silva', status: 'offline', active: true }),
    advisor({ id: 'par-inativo', name: 'Inativo Souza', status: 'online', active: false }),
  ];

  beforeEach(async () => {
    await localCollections.offers.replaceAll(MESMAS_OFERTAS);
    await localCollections.advisors.replaceAll(MESMOS_ESPECIALISTAS);
  });

  it('ofertas: a conta comum enxerga exatamente a publicada e vigente', async () => {
    const publicas = await localDataSource.content.listOffers();
    expect(publicas.map((o) => o.id)).toEqual(['par-lisboa']);
  });

  it('ofertas: a administração enxerga as quatro', async () => {
    expect(await localDataSource.content.listAllOffers()).toHaveLength(4);
  });

  it('especialistas: só o ativo aparece, mesmo estando offline', async () => {
    const diretorio = await localDataSource.advisors.list();
    expect(diretorio.map((a) => a.id)).toEqual(['par-ativa']);
    expect(diretorio[0].status).toBe('offline');
  });

  it('especialistas: a administração enxerga o inativo', async () => {
    expect(await localDataSource.advisors.listAll()).toHaveLength(2);
  });
});
