import { localCollections, localDataSource } from '@/repositories/local/LocalDataSource';
import { DemoUnavailableError } from '@/repositories/local/collaboration';
import type { Trip } from '@/domain/types';

/**
 * Colaboração, reservas, lembretes e sugestões na fonte LOCAL (§68).
 *
 * O que este arquivo verifica não é só "as funções existem". É a fronteira que
 * o §68 desenha: no modo demonstração tudo o que depende de um aparelho só
 * funciona de verdade e persiste; o que exige uma segunda pessoa recusa com
 * `DemoUnavailableError`, para a tela dizer "Disponível quando conectado" em
 * vez de fingir que enviou um convite.
 */
const USER = 'user-local';

const TRIP: Omit<Trip, 'id' | 'createdAt' | 'updatedAt'> = {
  userId: USER,
  destinationCity: 'Paris',
  destinationCountry: 'França',
  countryCode: 'FR',
  timezone: 'Europe/Paris',
  startDate: '2026-08-22',
  endDate: '2026-08-31',
  budgetTotal: 12000,
  budgetCurrency: 'BRL',
};

beforeEach(async () => {
  for (const collection of Object.values(localCollections)) {
    await collection.replaceAll([]);
  }
});

describe('membros no modo demonstração', () => {
  it('a viagem tem um membro: quem a criou', async () => {
    const trip = await localDataSource.trips.create(TRIP);
    const members = await localDataSource.members.listMembers(trip.id);

    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ userId: USER, role: 'owner' });
  });

  it('o papel da sessão é owner na própria viagem e nada em outra', async () => {
    const trip = await localDataSource.trips.create(TRIP);
    expect(await localDataSource.members.myRole(trip.id, USER)).toBe('owner');
    expect(await localDataSource.members.myRole(trip.id, 'outra-pessoa')).toBeNull();
  });

  it('convidar RECUSA com erro próprio — nunca finge ter enviado', async () => {
    const trip = await localDataSource.trips.create(TRIP);

    await expect(
      localDataSource.members.invite(trip.id, 'maria@example.com', 'editor'),
    ).rejects.toBeInstanceOf(DemoUnavailableError);
  });

  it('aceitar, remover e alterar permissão também recusam', async () => {
    await expect(localDataSource.members.acceptInvite('x')).rejects.toBeInstanceOf(
      DemoUnavailableError,
    );
    await expect(localDataSource.members.removeMember('t', 'u')).rejects.toBeInstanceOf(
      DemoUnavailableError,
    );
    await expect(localDataSource.members.setRole('t', 'u', 'viewer')).rejects.toBeInstanceOf(
      DemoUnavailableError,
    );
  });

  it('a lista de convites é vazia, e não um erro — a tela abre normalmente', async () => {
    const trip = await localDataSource.trips.create(TRIP);
    expect(await localDataSource.members.listInvites(trip.id)).toEqual([]);
    expect(await localDataSource.members.listPendingInvitesForUser(USER)).toEqual([]);
  });
});

describe('reservas (cenário §74)', () => {
  it('cria as seis modalidades, persiste e reabre', async () => {
    const trip = await localDataSource.trips.create(TRIP);
    const tipos = ['flight', 'hotel', 'car', 'park_ticket', 'train', 'bus'] as const;

    for (const type of tipos) {
      await localDataSource.travelReservations.create({
        tripId: trip.id,
        createdBy: USER,
        type,
        title: `Reserva ${type}`,
        status: 'confirmed',
        details: {},
      });
    }

    const salvas = await localDataSource.travelReservations.listByTrip(trip.id);
    expect(salvas.map((r) => r.type).sort()).toEqual([...tipos].sort());
  });

  it('guarda os campos específicos da modalidade', async () => {
    const trip = await localDataSource.trips.create(TRIP);
    const voo = await localDataSource.travelReservations.create({
      tripId: trip.id,
      createdBy: USER,
      type: 'flight',
      title: 'GRU → CDG',
      provider: 'Air France',
      confirmationCode: 'ABC123',
      startAt: '2026-08-22T22:10:00.000Z',
      endAt: '2026-08-23T13:35:00.000Z',
      origin: 'GRU',
      destination: 'CDG',
      status: 'confirmed',
      details: { flightNumber: 'AF457', seat: '24A' },
    });

    const [lida] = await localDataSource.travelReservations.listByTrip(trip.id);
    expect(lida.id).toBe(voo.id);
    expect(lida.confirmationCode).toBe('ABC123');
    expect(lida.details).toMatchObject({ flightNumber: 'AF457', seat: '24A' });
  });

  it('reserva nasce compartilhada, e a escolha explícita vale', async () => {
    const trip = await localDataSource.trips.create(TRIP);

    const padrao = await localDataSource.travelReservations.create({
      tripId: trip.id,
      createdBy: USER,
      type: 'hotel',
      title: 'Hotel',
      status: 'confirmed',
      details: {},
    });
    const privada = await localDataSource.travelReservations.create({
      tripId: trip.id,
      createdBy: USER,
      type: 'hotel',
      title: 'Hotel privado',
      status: 'confirmed',
      details: {},
      visibility: 'private',
    });

    expect(padrao.visibility).toBe('shared');
    expect(privada.visibility).toBe('private');
  });

  it('excluir a viagem leva as reservas junto (§12)', async () => {
    const trip = await localDataSource.trips.create(TRIP);
    await localDataSource.travelReservations.create({
      tripId: trip.id,
      createdBy: USER,
      type: 'flight',
      title: 'GRU → CDG',
      status: 'confirmed',
      details: {},
    });

    await localDataSource.trips.remove(trip.id);
    expect(await localDataSource.travelReservations.listByTrip(trip.id)).toHaveLength(0);
  });
});

describe('lembretes e a Central (§31, §32, cenário §74)', () => {
  it('lembrete vencido vira notificação, e só uma vez', async () => {
    const trip = await localDataSource.trips.create(TRIP);
    const reserva = await localDataSource.travelReservations.create({
      tripId: trip.id,
      createdBy: USER,
      type: 'hotel',
      title: 'Hotel Example',
      status: 'confirmed',
      details: {},
    });

    await localDataSource.reminders.upsert({
      userId: USER,
      tripId: trip.id,
      entityType: 'reservation',
      entityId: reserva.id,
      anchor: 'start',
      remindAt: new Date(Date.now() - 60_000).toISOString(),
      title: 'Check-in amanhã',
      body: 'Hotel Example · Check-in às 15:00',
    });

    expect(await localDataSource.notifications.deliverDueReminders(USER)).toBe(1);
    // Segunda execução não reentrega: `sentAt` é o que garante.
    expect(await localDataSource.notifications.deliverDueReminders(USER)).toBe(0);

    const central = await localDataSource.notifications.list(USER);
    expect(central).toHaveLength(1);
    expect(central[0]).toMatchObject({
      type: 'reservation_reminder',
      title: 'Check-in amanhã',
    });
    expect(central[0].data).toMatchObject({ tripId: trip.id, entityId: reserva.id });
  });

  it('lembrete no futuro não é entregue antes da hora', async () => {
    const trip = await localDataSource.trips.create(TRIP);
    await localDataSource.reminders.upsert({
      userId: USER,
      tripId: trip.id,
      entityType: 'trip',
      entityId: trip.id,
      anchor: 'start',
      remindAt: new Date(Date.now() + 3_600_000).toISOString(),
      title: 'Ainda vai acontecer',
    });

    expect(await localDataSource.notifications.deliverDueReminders(USER)).toBe(0);
  });

  it('reajustar o intervalo substitui o lembrete em vez de somar outro', async () => {
    const trip = await localDataSource.trips.create(TRIP);
    const base = {
      userId: USER,
      tripId: trip.id,
      entityType: 'reservation' as const,
      entityId: 'reserva-1',
      anchor: 'start' as const,
      title: 'Check-in',
    };

    await localDataSource.reminders.upsert({
      ...base,
      remindAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    await localDataSource.reminders.upsert({
      ...base,
      remindAt: new Date(Date.now() + 7_200_000).toISOString(),
    });

    const lembretes = await localDataSource.reminders.listByTrip(trip.id, USER);
    expect(lembretes).toHaveLength(1);
  });

  it('excluir a reserva remove os lembretes que apontavam para ela', async () => {
    const trip = await localDataSource.trips.create(TRIP);
    const reserva = await localDataSource.travelReservations.create({
      tripId: trip.id,
      createdBy: USER,
      type: 'hotel',
      title: 'Hotel',
      status: 'confirmed',
      details: {},
    });
    await localDataSource.reminders.upsert({
      userId: USER,
      tripId: trip.id,
      entityType: 'reservation',
      entityId: reserva.id,
      anchor: 'start',
      remindAt: new Date(Date.now() + 3_600_000).toISOString(),
      title: 'Check-in',
    });

    await localDataSource.travelReservations.remove(reserva.id);
    expect(await localDataSource.reminders.listByTrip(trip.id, USER)).toHaveLength(0);
  });

  it('marcar como lida e limpar funcionam de verdade', async () => {
    const trip = await localDataSource.trips.create(TRIP);
    await localDataSource.reminders.upsert({
      userId: USER,
      tripId: trip.id,
      entityType: 'trip',
      entityId: trip.id,
      anchor: 'start',
      remindAt: new Date(Date.now() - 1000).toISOString(),
      title: 'Vencido',
    });
    await localDataSource.notifications.deliverDueReminders(USER);

    const [notificacao] = await localDataSource.notifications.list(USER);
    expect(notificacao.readAt).toBeUndefined();

    await localDataSource.notifications.markRead(notificacao.id);
    const [depois] = await localDataSource.notifications.list(USER);
    expect(depois.readAt).toBeTruthy();

    await localDataSource.notifications.remove(notificacao.id);
    expect(await localDataSource.notifications.list(USER)).toHaveLength(0);
  });
});

describe('sugestões locais (cenário §76)', () => {
  it('preenche a partir do catálogo embarcado do destino', async () => {
    const trip = await localDataSource.trips.create(TRIP);
    const sugestoes = await localDataSource.suggestions.ensure(trip.id);

    // O catálogo do Easy Trip cobre Paris; se um dia deixar de cobrir, este
    // teste avisa antes de o usuário abrir a tela vazia.
    expect(sugestoes.length).toBeGreaterThanOrEqual(3);
    expect(sugestoes.every((s) => s.source === 'catalog')).toBe(true);
  });

  it('não gera de novo quando já há o suficiente (§43)', async () => {
    const trip = await localDataSource.trips.create(TRIP);
    const primeira = await localDataSource.suggestions.ensure(trip.id);
    const segunda = await localDataSource.suggestions.ensure(trip.id);

    expect(segunda.map((s) => s.id).sort()).toEqual(primeira.map((s) => s.id).sort());
  });

  it('destino fora do catálogo devolve o que há, sem inventar', async () => {
    const trip = await localDataSource.trips.create({
      ...TRIP,
      destinationCity: 'Cidade Inexistente',
      destinationCountry: 'Nenhures',
    });
    const sugestoes = await localDataSource.suggestions.ensure(trip.id);
    expect(sugestoes).toEqual([]);
  });

  it('sugestão carrega coordenada quando o catálogo tem — é o que a leva ao mapa (§47)', async () => {
    const trip = await localDataSource.trips.create(TRIP);
    const sugestoes = await localDataSource.suggestions.ensure(trip.id);
    const comCoordenada = sugestoes.filter(
      (s) => typeof s.latitude === 'number' && typeof s.longitude === 'number',
    );
    expect(comCoordenada.length).toBeGreaterThan(0);
  });
});
