import { jsonStorage } from '@/lib/storage';
import { localDataSource as source } from '@/repositories/local/LocalDataSource';

/**
 * F6 — varredura em busca de outro P-05 silencioso.
 *
 * A pergunta é sempre a mesma, para cada repositório com escrita: depois de
 * criar, editar e apagar, **a leitura seguinte concorda?** Um método que
 * devolve sucesso e some na leitura passa despercebido em qualquer teste que
 * confie no retorno; aqui só o estado observado conta.
 *
 * Não substitui as suítes específicas de cada entidade — é a rede que pega o
 * caso que ninguém pensou em cobrir.
 */

const TRIP = {
  userId: 'usuario-ciclo',
  destinationCity: 'Lisboa',
  destinationCountry: 'Portugal',
  countryCode: 'PT',
  timezone: 'Europe/Lisbon',
  startDate: '2026-09-01',
  endDate: '2026-09-10',
  budgetTotal: 5000,
  budgetCurrency: 'BRL' as const,
};

beforeAll(async () => {
  await jsonStorage.clearAll();
});

describe('ciclo create → read → update → read → delete → read', () => {
  it('viagens', async () => {
    const criada = await source.trips.create(TRIP);
    expect((await source.trips.list(TRIP.userId)).map((t) => t.id)).toContain(criada.id);

    await source.trips.update(criada.id, { destinationCity: 'Porto' });
    expect((await source.trips.get(criada.id))?.destinationCity).toBe('Porto');

    await source.trips.remove(criada.id);
    expect(await source.trips.get(criada.id)).toBeNull();
  });

  it('itinerário', async () => {
    const trip = await source.trips.create(TRIP);
    const item = await source.itinerary.create({
      tripId: trip.id,
      date: '2026-09-02',
      type: 'atracao',
      title: 'Torre de Belém',
      completed: false,
      sortOrder: 0,
    });
    expect((await source.itinerary.listByTrip(trip.id)).map((i) => i.id)).toContain(item.id);

    await source.itinerary.update(item.id, { completed: true });
    expect((await source.itinerary.listByTrip(trip.id)).find((i) => i.id === item.id)?.completed).toBe(true);

    await source.itinerary.remove(item.id);
    expect((await source.itinerary.listByTrip(trip.id)).map((i) => i.id)).not.toContain(item.id);
  });

  it('checklist', async () => {
    const trip = await source.trips.create(TRIP);
    const item = await source.checklist.create({
      tripId: trip.id,
      label: 'Passaporte',
      category: 'documentos',
      completed: false,
    });
    expect((await source.checklist.listByTrip(trip.id)).map((c) => c.id)).toContain(item.id);

    await source.checklist.update(item.id, { completed: true });
    expect((await source.checklist.listByTrip(trip.id)).find((c) => c.id === item.id)?.completed).toBe(true);

    await source.checklist.remove(item.id);
    expect((await source.checklist.listByTrip(trip.id)).map((c) => c.id)).not.toContain(item.id);
  });

  it('despesas', async () => {
    const trip = await source.trips.create(TRIP);
    const gasto = await source.expenses.create({
      tripId: trip.id,
      userId: TRIP.userId,
      category: 'alimentacao',
      amount: 120,
      currency: 'EUR',
      transactionDate: '2026-09-02',
      description: 'Jantar',
    });
    expect((await source.expenses.listByTrip(trip.id)).map((e) => e.id)).toContain(gasto.id);

    await source.expenses.update(gasto.id, { amount: 150 });
    expect((await source.expenses.listByTrip(trip.id)).find((e) => e.id === gasto.id)?.amount).toBe(150);

    await source.expenses.remove(gasto.id);
    expect((await source.expenses.listByTrip(trip.id)).map((e) => e.id)).not.toContain(gasto.id);
  });

  it('reservas', async () => {
    const trip = await source.trips.create(TRIP);
    const reserva = await source.travelReservations.create({
      tripId: trip.id,
      createdBy: TRIP.userId,
      type: 'flight',
      title: 'TAP 1234',
      status: 'confirmed',
      details: { flightNumber: 'TP1234' },
    });
    expect((await source.travelReservations.listByTrip(trip.id)).map((t) => t.id)).toContain(
      reserva.id,
    );
    // Sem escolha explícita, a reserva nasce compartilhada (§11).
    expect(reserva.visibility).toBe('shared');

    await source.travelReservations.update(reserva.id, { title: 'TAP 5678' });
    expect(
      (await source.travelReservations.listByTrip(trip.id)).find((t) => t.id === reserva.id)?.title,
    ).toBe('TAP 5678');

    await source.travelReservations.remove(reserva.id);
    expect((await source.travelReservations.listByTrip(trip.id)).map((t) => t.id)).not.toContain(
      reserva.id,
    );
  });

  it('diário', async () => {
    const trip = await source.trips.create(TRIP);
    const entrada = await source.journal.create({
      tripId: trip.id,
      userId: TRIP.userId,
      entryDate: '2026-09-02',
      content: 'Primeiro dia.',
    });
    expect((await source.journal.listByTrip(trip.id)).map((j) => j.id)).toContain(entrada.id);

    await source.journal.update(entrada.id, { content: 'Primeiro dia, revisado.' });
    expect((await source.journal.listByTrip(trip.id)).find((j) => j.id === entrada.id)?.content).toBe(
      'Primeiro dia, revisado.',
    );

    await source.journal.remove(entrada.id);
    expect((await source.journal.listByTrip(trip.id)).map((j) => j.id)).not.toContain(entrada.id);
  });

  it('metas', async () => {
    const meta = await source.goals.create({
      userId: TRIP.userId,
      type: 'economia',
      title: 'Juntar para Lisboa',
      targetValue: 5000,
      currentValue: 0,
      unit: 'R$',
      status: 'active',
    });
    expect((await source.goals.list(TRIP.userId)).map((g) => g.id)).toContain(meta.id);

    await source.goals.update(meta.id, { currentValue: 2500 });
    expect((await source.goals.list(TRIP.userId)).find((g) => g.id === meta.id)?.currentValue).toBe(2500);

    await source.goals.remove(meta.id);
    expect((await source.goals.list(TRIP.userId)).map((g) => g.id)).not.toContain(meta.id);
  });

  it('seguros', async () => {
    const apolice = await source.insurance.create({
      userId: TRIP.userId,
      provider: 'Seguradora Teste',
      policyNumber: 'AP-123',
    });
    expect((await source.insurance.listByUser(TRIP.userId)).map((p) => p.id)).toContain(apolice.id);

    await source.insurance.remove(apolice.id);
    expect((await source.insurance.listByUser(TRIP.userId)).map((p) => p.id)).not.toContain(apolice.id);
  });

  it('lugares (CRUD administrativo já existente no contrato)', async () => {
    const lugar = await source.places.upsert({
      id: 'lugar-ciclo',
      name: 'Hotel Ciclo',
      type: 'hotel',
      city: 'Lisboa',
      country: 'Portugal',
    });
    expect((await source.places.get(lugar.id))?.name).toBe('Hotel Ciclo');

    await source.places.upsert({ ...lugar, name: 'Hotel Ciclo Renovado' });
    expect((await source.places.get(lugar.id))?.name).toBe('Hotel Ciclo Renovado');

    await source.places.remove(lugar.id);
    expect(await source.places.get(lugar.id)).toBeNull();
  });

  it('artigos (rascunho fora da listagem pública)', async () => {
    const rascunho = {
      id: 'artigo-ciclo',
      slug: 'artigo-ciclo',
      title: 'Rascunho do ciclo',
      category: 'Dicas',
      authorName: 'Equipe',
      content: 'x'.repeat(80),
      publishedAt: '2026-08-21T00:00:00.000Z',
      estimatedReadMinutes: 3,
      status: 'draft' as const,
    };
    await source.content.upsertArticle(rascunho);
    expect((await source.content.listArticles()).map((a) => a.id)).not.toContain(rascunho.id);
    expect((await source.content.listAllArticles()).map((a) => a.id)).toContain(rascunho.id);

    await source.content.upsertArticle({ ...rascunho, status: 'published' });
    expect((await source.content.listArticles()).map((a) => a.id)).toContain(rascunho.id);

    await source.content.removeArticle(rascunho.id);
    expect((await source.content.listAllArticles()).map((a) => a.id)).not.toContain(rascunho.id);
  });

  it('favoritos e curtidas (alternância é observável)', async () => {
    await source.places.setFavorite(TRIP.userId, 'lugar-favorito', true);
    expect(await source.places.listFavoriteIds(TRIP.userId)).toContain('lugar-favorito');
    await source.places.setFavorite(TRIP.userId, 'lugar-favorito', false);
    expect(await source.places.listFavoriteIds(TRIP.userId)).not.toContain('lugar-favorito');

    await source.content.setArticleLike(TRIP.userId, 'artigo-curtido', true);
    expect(await source.content.listLikedArticleIds(TRIP.userId)).toContain('artigo-curtido');
    await source.content.setArticleLike(TRIP.userId, 'artigo-curtido', false);
    expect(await source.content.listLikedArticleIds(TRIP.userId)).not.toContain('artigo-curtido');
  });

  it('reservas e consultas (cancelar muda o estado lido)', async () => {
    const reserva = await source.reservations.request({
      userId: TRIP.userId,
      placeId: 'lugar-reserva',
      placeName: 'Hotel Reserva',
      requestedFor: '2026-09-03T20:00:00.000Z',
      partySize: 2,
    });
    expect((await source.reservations.listByUser(TRIP.userId)).find((r) => r.id === reserva.id)?.status).toBe(
      'requested',
    );

    await source.reservations.cancel(reserva.id);
    expect((await source.reservations.listByUser(TRIP.userId)).find((r) => r.id === reserva.id)?.status).toBe(
      'cancelled',
    );
  });

  it('conversas de IA', async () => {
    const conversa = await source.ai.getOrCreateConversation(TRIP.userId);
    const mensagem = await source.ai.addMessage({
      conversationId: conversa.id,
      role: 'user',
      content: 'Oi',
    });
    expect((await source.ai.listMessages(conversa.id)).map((m) => m.id)).toContain(mensagem.id);

    await source.ai.clearConversation(conversa.id);
    expect(await source.ai.listMessages(conversa.id)).toHaveLength(0);
  });
});
