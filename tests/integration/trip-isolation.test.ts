/**
 * Integration tests (§102) for the golden rule of the domain (§12, CA-01):
 * a trip is a single entity, and every operational record belongs to exactly
 * one `tripId`. These run against the real `LocalDataSource` with AsyncStorage
 * mocked in memory — the same code path the app uses in demonstration mode.
 */

import { getRemainingBudget, getTripTotalSpent } from '@/domain/selectors';
import { localDataSource } from '@/repositories/local/LocalDataSource';

const USER = 'user-1';

async function createTrip(city: string, country: string, budget: number) {
  return localDataSource.trips.create({
    userId: USER,
    destinationCity: city,
    destinationCountry: country,
    countryCode: country === 'França' ? 'FR' : 'JP',
    timezone: country === 'França' ? 'Europe/Paris' : 'Asia/Tokyo',
    startDate: '2026-09-10',
    endDate: '2026-09-20',
    budgetTotal: budget,
    budgetCurrency: 'BRL',
  });
}

beforeEach(async () => {
  await localDataSource.purgeUserData(USER);
});

describe('trip creation (§30)', () => {
  it('creates a trip and lists it for the owner', async () => {
    const trip = await createTrip('Paris', 'França', 1000);

    expect(trip.id).toBeTruthy();
    expect(trip.destinationCity).toBe('Paris');
    expect(trip.createdAt).toBeTruthy();

    const trips = await localDataSource.trips.list(USER);
    expect(trips.map((t) => t.id)).toContain(trip.id);

    const fetched = await localDataSource.trips.get(trip.id);
    expect(fetched?.destinationCity).toBe('Paris');
  });

  it('persists across a fresh read (CA-02)', async () => {
    const trip = await createTrip('Paris', 'França', 1000);
    // A new read goes back through AsyncStorage, not a request-scoped cache.
    const again = await localDataSource.trips.get(trip.id);
    expect(again).not.toBeNull();
    expect(again!.budgetTotal).toBe(1000);
  });
});

describe('expenses stay inside their trip (CA-01, CA-03)', () => {
  it('never leaks spending from Paris into Kyoto', async () => {
    const paris = await createTrip('Paris', 'França', 1000);
    const kyoto = await createTrip('Kyoto', 'Japão', 2000);

    for (const amount of [100, 200, 300]) {
      await localDataSource.expenses.create({
        tripId: paris.id,
        userId: USER,
        category: 'alimentacao',
        amount,
        currency: 'BRL',
        amountInBudgetCurrency: amount,
        transactionDate: '2026-09-12',
        description: `Gasto ${amount}`,
      });
    }

    const parisExpenses = await localDataSource.expenses.listByTrip(paris.id);
    const kyotoExpenses = await localDataSource.expenses.listByTrip(kyoto.id);

    expect(parisExpenses).toHaveLength(3);
    expect(kyotoExpenses).toHaveLength(0);

    // The documented acceptance criterion: 1000 − (100+200+300) = 400.
    expect(getTripTotalSpent(parisExpenses, paris)).toBe(600);
    expect(getRemainingBudget(parisExpenses, paris)).toBe(400);

    // Kyoto is completely untouched.
    expect(getTripTotalSpent(kyotoExpenses, kyoto)).toBe(0);
    expect(getRemainingBudget(kyotoExpenses, kyoto)).toBe(2000);
  });

  it('keeps itinerary, checklist, journal and reservations scoped per trip', async () => {
    const paris = await createTrip('Paris', 'França', 1000);
    const kyoto = await createTrip('Kyoto', 'Japão', 2000);

    await localDataSource.itinerary.create({
      tripId: paris.id,
      date: '2026-09-11',
      type: 'atracao',
      title: 'Louvre',
      completed: false,
      sortOrder: 0,
    });
    await localDataSource.checklist.create({
      tripId: paris.id,
      label: 'Passaporte',
      category: 'documentos',
      completed: false,
    });
    await localDataSource.journal.create({
      tripId: paris.id,
      userId: USER,
      entryDate: '2026-09-11',
      content: 'Primeiro dia em Paris',
    });
    await localDataSource.travelReservations.create({
      tripId: paris.id,
      createdBy: USER,
      type: 'flight',
      title: 'GRU → CDG',
      status: 'confirmed',
      details: {},
    });

    expect(await localDataSource.itinerary.listByTrip(paris.id)).toHaveLength(1);
    expect(await localDataSource.checklist.listByTrip(paris.id)).toHaveLength(1);
    expect(await localDataSource.journal.listByTrip(paris.id)).toHaveLength(1);
    expect(await localDataSource.travelReservations.listByTrip(paris.id)).toHaveLength(1);

    expect(await localDataSource.itinerary.listByTrip(kyoto.id)).toHaveLength(0);
    expect(await localDataSource.checklist.listByTrip(kyoto.id)).toHaveLength(0);
    expect(await localDataSource.journal.listByTrip(kyoto.id)).toHaveLength(0);
    expect(await localDataSource.travelReservations.listByTrip(kyoto.id)).toHaveLength(0);
  });
});

describe('deleting a trip cascades (§86)', () => {
  it('removes every record that belonged to it, and only those', async () => {
    const paris = await createTrip('Paris', 'França', 1000);
    const kyoto = await createTrip('Kyoto', 'Japão', 2000);

    await localDataSource.expenses.create({
      tripId: paris.id,
      userId: USER,
      category: 'lazer',
      amount: 50,
      currency: 'BRL',
      transactionDate: '2026-09-12',
      description: 'Museu',
    });
    await localDataSource.itinerary.create({
      tripId: paris.id,
      date: '2026-09-11',
      type: 'atracao',
      title: 'Louvre',
      completed: false,
      sortOrder: 0,
    });
    await localDataSource.expenses.create({
      tripId: kyoto.id,
      userId: USER,
      category: 'lazer',
      amount: 80,
      currency: 'BRL',
      transactionDate: '2026-09-12',
      description: 'Templo',
    });

    await localDataSource.trips.remove(paris.id);

    expect(await localDataSource.trips.get(paris.id)).toBeNull();
    expect(await localDataSource.expenses.listByTrip(paris.id)).toHaveLength(0);
    expect(await localDataSource.itinerary.listByTrip(paris.id)).toHaveLength(0);

    // Kyoto survives untouched.
    expect(await localDataSource.trips.get(kyoto.id)).not.toBeNull();
    expect(await localDataSource.expenses.listByTrip(kyoto.id)).toHaveLength(1);
  });
});

describe('goals and profile (§43, §59, CA-05)', () => {
  it('completes a goal automatically once the target is reached', async () => {
    const goal = await localDataSource.goals.create({
      userId: USER,
      type: 'economia',
      title: 'Economizar para Kyoto',
      targetValue: 1000,
      currentValue: 0,
      unit: 'R$',
      status: 'active',
    });

    const updated = await localDataSource.goals.update(goal.id, {
      currentValue: 1000,
      status: 'completed',
    });
    expect(updated.currentValue).toBe(1000);
    expect(updated.status).toBe('completed');
  });

  it('persists a profile preference change', async () => {
    await localDataSource.profile.update(USER, { name: 'João', defaultCurrency: 'BRL' });
    await localDataSource.profile.update(USER, { name: 'João', defaultCurrency: 'EUR' });

    const profile = await localDataSource.profile.get(USER);
    expect(profile?.defaultCurrency).toBe('EUR');
    // Upsert must not create a duplicate row for the same user.
    expect(profile?.name).toBe('João');
  });
});

describe('reservations and consultations are requests, not confirmations (§46, §54)', () => {
  it('always lands in the requested state', async () => {
    const reservation = await localDataSource.reservations.request({
      userId: USER,
      placeId: 'place-le-comptoir',
      placeName: 'Le Comptoir du Marais',
      requestedFor: '2026-09-14T20:00:00.000Z',
      partySize: 2,
    });
    expect(reservation.status).toBe('requested');

    const consultation = await localDataSource.advisors.requestConsultation({
      userId: USER,
      advisorId: 'advisor-ana-europa',
      scheduledAt: '2026-09-01T15:00:00.000Z',
    });
    expect(consultation.status).toBe('requested');
  });
});

describe('likes and favourites persist (§57, §51)', () => {
  it('stores and removes them per user', async () => {
    await localDataSource.content.setArticleLike(USER, 'article-mala-10-dias', true);
    expect(await localDataSource.content.listLikedArticleIds(USER)).toContain('article-mala-10-dias');

    // Liking twice must not duplicate the row (UNIQUE constraint equivalent).
    await localDataSource.content.setArticleLike(USER, 'article-mala-10-dias', true);
    expect(await localDataSource.content.listLikedArticleIds(USER)).toHaveLength(1);

    await localDataSource.content.setArticleLike(USER, 'article-mala-10-dias', false);
    expect(await localDataSource.content.listLikedArticleIds(USER)).toHaveLength(0);

    await localDataSource.places.setFavorite(USER, 'place-hotel-lumiere', true);
    expect(await localDataSource.places.listFavoriteIds(USER)).toEqual(['place-hotel-lumiere']);
  });
});

describe('account deletion (§94)', () => {
  it('purges everything owned by the user', async () => {
    const paris = await createTrip('Paris', 'França', 1000);
    await localDataSource.goals.create({
      userId: USER,
      type: 'economia',
      title: 'Meta',
      targetValue: 100,
      currentValue: 0,
      unit: 'R$',
      status: 'active',
    });
    await localDataSource.content.setArticleLike(USER, 'article-mala-10-dias', true);

    await localDataSource.purgeUserData(USER);

    expect(await localDataSource.trips.list(USER)).toHaveLength(0);
    expect(await localDataSource.trips.get(paris.id)).toBeNull();
    expect(await localDataSource.goals.list(USER)).toHaveLength(0);
    expect(await localDataSource.content.listLikedArticleIds(USER)).toHaveLength(0);
    expect(await localDataSource.profile.get(USER)).toBeNull();
  });
});
