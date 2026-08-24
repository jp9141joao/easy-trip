import {
  isActionableInvite,
  isUnread,
  notificationHref,
  unreadCount,
  type AppNotification,
} from '@/domain/notifications';

/**
 * A Central de notificações (§7, §54, §64).
 */
const notificacao = (over: Partial<AppNotification> = {}): AppNotification => ({
  id: Math.random().toString(36).slice(2),
  userId: 'u1',
  type: 'trip_invite',
  title: 'João convidou você para Paris',
  data: {},
  createdAt: '2026-08-24T10:00:00.000Z',
  ...over,
});

describe('badge', () => {
  it('conta só as não lidas', () => {
    const lista = [
      notificacao(),
      notificacao({ readAt: '2026-08-24T11:00:00.000Z' }),
      notificacao(),
    ];
    expect(unreadCount(lista)).toBe(2);
  });

  it('lista vazia é zero, não indefinido', () => {
    expect(unreadCount([])).toBe(0);
  });

  it('uma notificação lida deixa de contar', () => {
    expect(isUnread(notificacao({ readAt: '2026-08-24T11:00:00.000Z' }))).toBe(false);
    expect(isUnread(notificacao())).toBe(true);
  });
});

describe('convite acionável de dentro da notificação (§6)', () => {
  it('convite com id é acionável', () => {
    expect(isActionableInvite(notificacao({ data: { inviteId: 'inv-1' } }))).toBe(true);
  });

  it('convite sem id não oferece botões que dariam erro', () => {
    expect(isActionableInvite(notificacao({ data: {} }))).toBe(false);
  });

  it('outros tipos nunca mostram aceitar/recusar', () => {
    expect(
      isActionableInvite(notificacao({ type: 'trip_role_changed', data: { inviteId: 'x' } })),
    ).toBe(false);
  });
});

describe('para onde a notificação leva', () => {
  it('lembrete de reserva abre as Reservas da viagem', () => {
    expect(
      notificationHref(
        notificacao({ type: 'reservation_reminder', data: { tripId: 't1', entityType: 'reservation' } }),
      ),
    ).toBe('/trip/t1/reservations');
  });

  it('lembrete de atividade abre o roteiro', () => {
    expect(
      notificationHref(
        notificacao({ type: 'trip_reminder', data: { tripId: 't1', entityType: 'itinerary_item' } }),
      ),
    ).toBe('/trip/t1/itinerary');
  });

  it('briefing abre o roteiro do dia', () => {
    expect(
      notificationHref(notificacao({ type: 'trip_daily_briefing', data: { tripId: 't1' } })),
    ).toBe('/trip/t1/itinerary');
  });

  it('mudança de permissão abre os viajantes', () => {
    expect(
      notificationHref(notificacao({ type: 'trip_role_changed', data: { tripId: 't1' } })),
    ).toBe('/trip/t1/members');
  });

  it('remoção NÃO leva a lugar nenhum — a viagem não é mais alcançável', () => {
    // Levar para lá daria um 404 com cara de defeito, quando a informação é
    // justamente que o acesso acabou.
    expect(
      notificationHref(notificacao({ type: 'trip_member_removed', data: { tripId: 't1' } })),
    ).toBeUndefined();
  });

  it('sem viagem no payload, não há para onde ir', () => {
    expect(notificationHref(notificacao({ type: 'trip_daily_briefing', data: {} }))).toBeUndefined();
  });
});
