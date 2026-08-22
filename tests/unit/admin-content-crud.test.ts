import type { Article, Place } from '@/domain/types';
import { dataSource } from '@/repositories';

/**
 * Persistência do conteúdo administrativo (§52).
 *
 * A regra que estes testes protegem: o que o painel salva é o que o aplicativo
 * mostra. Rascunho não vaza para a área pública, publicar faz aparecer,
 * despublicar faz sumir — e o catálogo original continua servindo de base para
 * o aplicativo não nascer vazio.
 */

const article = (overrides: Partial<Article> = {}): Article => ({
  id: 'art-teste',
  slug: 'artigo-de-teste',
  title: 'Por que viajar faz bem',
  category: 'Inspiração',
  authorName: 'Equipe Easy Trip',
  content: 'x'.repeat(200),
  publishedAt: '2026-08-20T12:00:00.000Z',
  estimatedReadMinutes: 6,
  status: 'draft',
  ...overrides,
});

const place = (overrides: Partial<Place> = {}): Place => ({
  id: 'place-teste',
  name: 'Hotel Teste',
  type: 'hotel',
  city: 'Paris',
  country: 'França',
  ...overrides,
});

describe('articles', () => {
  it('seeds from the catalog so the public app is never empty', async () => {
    // §37 da etapa anterior: o conteúdo atual continua de pé enquanto os
    // cadastros são construídos.
    expect((await dataSource.content.listArticles()).length).toBeGreaterThan(0);
  });

  it('keeps a draft out of the public list but visible in the panel', async () => {
    await dataSource.content.upsertArticle(article());

    const publicIds = (await dataSource.content.listArticles()).map((a) => a.id);
    const adminIds = (await dataSource.content.listAllArticles()).map((a) => a.id);

    expect(publicIds).not.toContain('art-teste');
    expect(adminIds).toContain('art-teste');
  });

  it('publishes and unpublishes through the public list', async () => {
    await dataSource.content.upsertArticle(article({ status: 'published' }));
    expect((await dataSource.content.listArticles()).map((a) => a.id)).toContain('art-teste');

    await dataSource.content.upsertArticle(article({ status: 'draft' }));
    expect((await dataSource.content.listArticles()).map((a) => a.id)).not.toContain('art-teste');
    // Despublicar não é apagar: continua editável no painel.
    expect((await dataSource.content.listAllArticles()).map((a) => a.id)).toContain('art-teste');
  });

  it('updates in place instead of duplicating', async () => {
    await dataSource.content.upsertArticle(article({ status: 'published' }));
    await dataSource.content.upsertArticle(article({ status: 'published', title: 'Novo título' }));

    const rows = (await dataSource.content.listAllArticles()).filter((a) => a.id === 'art-teste');
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Novo título');
  });

  it('is reachable by id and by slug, as the public screen resolves it', async () => {
    await dataSource.content.upsertArticle(article({ status: 'published' }));
    expect((await dataSource.content.getArticle('art-teste'))?.title).toBeTruthy();
    expect((await dataSource.content.getArticle('artigo-de-teste'))?.id).toBe('art-teste');
  });

  it('removes an article from every list', async () => {
    await dataSource.content.upsertArticle(article({ status: 'published' }));
    await dataSource.content.removeArticle('art-teste');

    expect((await dataSource.content.listArticles()).map((a) => a.id)).not.toContain('art-teste');
    expect((await dataSource.content.listAllArticles()).map((a) => a.id)).not.toContain('art-teste');
  });
});

describe('places', () => {
  it('seeds from the catalog', async () => {
    expect((await dataSource.places.list()).length).toBeGreaterThan(0);
  });

  it('saves a place and serves it to the public directory', async () => {
    await dataSource.places.upsert(place({ partnerUrl: 'https://hotelteste.fr/' }));

    const listed = (await dataSource.places.list()).find((p) => p.id === 'place-teste');
    expect(listed?.name).toBe('Hotel Teste');
    // O link é o que decide se o botão "Ver site" existirá na tela pública.
    expect(listed?.partnerUrl).toBe('https://hotelteste.fr/');
    expect((await dataSource.places.get('place-teste'))?.city).toBe('Paris');
  });

  it('respects the public filters after an admin edit', async () => {
    await dataSource.places.upsert(place({ type: 'restaurant', name: 'Bistrô Teste' }));

    const hotels = await dataSource.places.list({ type: 'hotel' });
    expect(hotels.map((p) => p.id)).not.toContain('place-teste');

    const found = await dataSource.places.list({ search: 'Bistrô' });
    expect(found.map((p) => p.id)).toContain('place-teste');
  });

  it('removes a place from the directory', async () => {
    await dataSource.places.upsert(place());
    await dataSource.places.remove('place-teste');

    expect(await dataSource.places.get('place-teste')).toBeNull();
    expect((await dataSource.places.list()).map((p) => p.id)).not.toContain('place-teste');
  });
});
