import {
  createNotificationRepository,
  createReminderRepository,
  createTravelReservationRepository,
  type CollaborationDeps,
} from '@/repositories/supabase/collaboration';

type DbError = {
  code: string;
  message: string;
};

function erroringDeps(error: DbError): CollaborationDeps {
  const result = { data: null, error };

  const query: Record<string, unknown> = {};
  const chain = () => query;
  for (const method of [
    'select',
    'eq',
    'is',
    'order',
    'limit',
    'update',
    'delete',
    'insert',
    'upsert',
  ]) {
    query[method] = jest.fn(chain);
  }
  query.single = jest.fn(async () => result);
  query.maybeSingle = jest.fn(async () => result);
  query.then = (
    resolve: (value: typeof result) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);

  const client = {
    from: jest.fn(() => query),
    rpc: jest.fn(async () => result),
    auth: {
      getSession: jest.fn(async () => ({ data: { session: null }, error: null })),
    },
  };

  return {
    db: () => client as never,
    unwrap: () => {
      throw new Error('The repository must classify the original backend error.');
    },
    unwrapList: () => {
      throw new Error('The repository must classify the original backend error.');
    },
    prune: (row) => row,
    openableUrl: async () => undefined,
    uploadAttachment: async () => ({ url: '', mimeType: '' }),
    attachmentsBucket: 'attachments',
  };
}

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('backend capability classification in collaboration repositories', () => {
  const notificationsTableMissing = {
    code: 'PGRST205',
    message: "Could not find the table 'public.notifications' in the schema cache",
  };

  it.each([
    ['list', (repository: ReturnType<typeof createNotificationRepository>) => repository.list('u1')],
    [
      'markRead',
      (repository: ReturnType<typeof createNotificationRepository>) => repository.markRead('n1'),
    ],
    [
      'markAllRead',
      (repository: ReturnType<typeof createNotificationRepository>) => repository.markAllRead('u1'),
    ],
    ['remove', (repository: ReturnType<typeof createNotificationRepository>) => repository.remove('n1')],
  ])('classifies a missing notifications table during %s', async (_name, operation) => {
    const repository = createNotificationRepository(erroringDeps(notificationsTableMissing));

    await expect(operation(repository)).rejects.toMatchObject({
      name: 'BackendCapabilityError',
      code: 'MISSING_NOTIFICATIONS',
    });
  });

  it('does not turn a missing reminder-delivery RPC into zero deliveries', async () => {
    const repository = createNotificationRepository(
      erroringDeps({
        code: 'PGRST202',
        message:
          "Could not find the function public.deliver_due_reminders without parameters in the schema cache",
      }),
    );

    await expect(repository.deliverDueReminders('u1')).rejects.toMatchObject({
      name: 'BackendCapabilityError',
      code: 'MISSING_NOTIFICATIONS',
    });
  });

  const remindersTableMissing = {
    code: 'PGRST205',
    message: "Could not find the table 'public.reminders' in the schema cache",
  };

  it.each([
    [
      'listByTrip',
      (repository: ReturnType<typeof createReminderRepository>) =>
        repository.listByTrip('trip-1', 'u1'),
    ],
    [
      'upsert',
      (repository: ReturnType<typeof createReminderRepository>) =>
        repository.upsert({
          userId: 'u1',
          tripId: 'trip-1',
          entityType: 'reservation',
          entityId: 'reservation-1',
          anchor: 'start',
          remindAt: '2026-09-01T10:00:00.000Z',
          title: 'Voo em uma hora',
          body: 'Prepare o embarque.',
        }),
    ],
    ['remove', (repository: ReturnType<typeof createReminderRepository>) => repository.remove('r1')],
    [
      'removeForEntity',
      (repository: ReturnType<typeof createReminderRepository>) =>
        repository.removeForEntity('u1', 'reservation-1', 'start'),
    ],
  ])('classifies a missing reminders table during %s', async (_name, operation) => {
    const repository = createReminderRepository(erroringDeps(remindersTableMissing));

    await expect(operation(repository)).rejects.toMatchObject({
      name: 'BackendCapabilityError',
      code: 'MISSING_NOTIFICATIONS',
    });
  });

  const reservationsTableMissing = {
    code: 'PGRST205',
    message: "Could not find the table 'public.tickets' in the schema cache",
  };

  it.each([
    [
      'listByTrip',
      (repository: ReturnType<typeof createTravelReservationRepository>) =>
        repository.listByTrip('trip-1'),
    ],
    [
      'create',
      (repository: ReturnType<typeof createTravelReservationRepository>) =>
        repository.create({ tripId: 'trip-1', type: 'flight', title: 'GRU → CDG' } as never),
    ],
    [
      'update',
      (repository: ReturnType<typeof createTravelReservationRepository>) =>
        repository.update('reservation-1', { title: 'Novo título' }),
    ],
    [
      'remove pre-read',
      (repository: ReturnType<typeof createTravelReservationRepository>) =>
        repository.remove('reservation-1'),
    ],
  ])('classifies a missing reservations schema during %s', async (_name, operation) => {
    const repository = createTravelReservationRepository(erroringDeps(reservationsTableMissing));

    await expect(operation(repository)).rejects.toMatchObject({
      name: 'BackendCapabilityError',
      code: 'MISSING_RESERVATIONS_SCHEMA',
    });
  });

  it('classifies a reservation column from 0009/0011 that is absent on the legacy schema', async () => {
    const repository = createTravelReservationRepository(
      erroringDeps({
        code: 'PGRST204',
        message: "Could not find the 'details' column of 'tickets' in the schema cache",
      }),
    );

    await expect(
      repository.create({
        tripId: 'trip-1',
        type: 'flight',
        title: 'GRU → CDG',
        details: { flightNumber: 'ET123' },
      } as never),
    ).rejects.toMatchObject({
      name: 'BackendCapabilityError',
      code: 'MISSING_RESERVATIONS_SCHEMA',
    });
  });
});
