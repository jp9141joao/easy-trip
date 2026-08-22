import { ADVISORS, OFFERS } from '@/data/catalog';
import { dataSource } from '@/repositories';

/**
 * F3 — Ofertas e Especialistas passam a ter estado de publicação.
 *
 * A regra de acesso mora na RLS (`0004`, provada em
 * `supabase/tests/rls_content.test.sql`). O que estes testes cobrem é o lado do
 * aplicativo: a fonte local precisa responder as mesmas perguntas que o
 * PostgREST responderia, ou o modo demonstração mostraria uma coisa e o modo
 * Supabase outra.
 */

describe('ofertas', () => {
  it('publica todo o catálogo atual — nada some com as colunas novas', async () => {
    // O ponto do `default 'published'` na migration: o conteúdo que já existia
    // continua exatamente onde estava.
    expect(OFFERS.every((o) => o.status === 'published')).toBe(true);
    expect(await dataSource.content.listOffers()).toHaveLength(OFFERS.length);
  });

  it('só entrega oferta publicada', async () => {
    const listadas = await dataSource.content.listOffers();
    expect(listadas.every((o) => o.status === 'published')).toBe(true);
  });

  it('respeita a ordem editorial, e não a ordem em que foram cadastradas', async () => {
    const ordens = (await dataSource.content.listOffers()).map((o) => o.sortOrder);
    expect(ordens).toEqual([...ordens].sort((a, b) => a - b));
  });

  it('não reordena o catálogo compartilhado ao ordenar a listagem', async () => {
    // `Array.prototype.sort` ordena no lugar. Se a listagem ordenasse `OFFERS`
    // direto, a primeira chamada mudaria o módulo para todo o resto do
    // aplicativo — o tipo de efeito colateral que só aparece em outra tela.
    const antes = OFFERS.map((o) => o.id);
    await dataSource.content.listOffers();
    expect(OFFERS.map((o) => o.id)).toEqual(antes);
  });
});

describe('especialistas', () => {
  it('mantém todo o time atual ativo', async () => {
    expect(ADVISORS.every((a) => a.active)).toBe(true);
    expect(await dataSource.advisors.list()).toHaveLength(ADVISORS.length);
  });

  it('só entrega especialista ativo', async () => {
    expect((await dataSource.advisors.list()).every((a) => a.active)).toBe(true);
  });

  it('separa presença de cadastro', async () => {
    // `status` é "pode atender agora"; `active` é "faz parte do time". Quem
    // está offline continua no diretório — se as duas colunas tivessem virado
    // uma só, esta linha sumiria da lista sempre que alguém saísse do ar.
    const offline = (await dataSource.advisors.list()).filter((a) => a.status === 'offline');
    expect(offline.length).toBeGreaterThan(0);
  });
});
