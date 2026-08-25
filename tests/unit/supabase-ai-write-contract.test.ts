import { BackendCapabilityError } from '@/repositories/backendCapabilities';
import { supabaseDataSource } from '@/repositories/supabase/SupabaseDataSource';

const mockSingle = jest.fn();
const mockSelect = jest.fn(() => ({ single: mockSingle }));
const mockInsert = jest.fn((_payload: Record<string, unknown>) => ({ select: mockSelect }));
const mockFrom = jest.fn((_relation: string) => ({ insert: mockInsert }));

jest.mock('@/repositories/supabase/client', () => ({
  getSupabaseClient: () => ({ from: mockFrom }),
}));

beforeEach(() => {
  mockSingle.mockReset();
  mockSelect.mockClear();
  mockInsert.mockClear();
  mockFrom.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('payload de despesa para 0009+', () => {
  it('preserva visibility e paid_by, mas autoria continua sendo do trigger', async () => {
    mockSingle.mockResolvedValue({
      data: {
        id: 'expense-1',
        trip_id: 'trip-1',
        user_id: 'user-1',
        category: 'alimentacao',
        amount: 120,
        currency: 'BRL',
        amount_in_budget_currency: 120,
        exchange_rate: null,
        exchange_rate_timestamp: null,
        transaction_date: '2026-08-23',
        description: 'Almoço',
        visibility: 'shared',
        created_by: 'user-1',
        paid_by: 'traveler-2',
        created_at: '2026-08-22T10:00:00.000Z',
      },
      error: null,
    });

    await supabaseDataSource.expenses.create({
      tripId: 'trip-1',
      userId: 'user-1',
      category: 'alimentacao',
      amount: 120,
      currency: 'BRL',
      amountInBudgetCurrency: 120,
      transactionDate: '2026-08-23',
      description: 'Almoço',
      visibility: 'shared',
      createdBy: 'forged-author-must-not-travel',
      paidBy: 'traveler-2',
    });

    expect(mockFrom).toHaveBeenCalledWith('expenses');
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: 'shared', paid_by: 'traveler-2' }),
    );
    expect(mockInsert.mock.calls[0][0]).not.toHaveProperty('created_by');
  });
});

describe('payload de roteiro para 0009/0011+', () => {
  it('preserva localização e visibilidade sem aceitar autoria do cliente', async () => {
    mockSingle.mockResolvedValue({
      data: {
        id: 'item-1',
        trip_id: 'trip-1',
        date: '2026-08-23',
        start_time: '09:00',
        end_time: null,
        type: 'atracao',
        title: 'Louvre',
        description: null,
        place_name: 'Museu do Louvre',
        latitude: 48.8606,
        longitude: 2.3376,
        address: 'Rue de Rivoli',
        place_source: 'catalog',
        reservation_reference: null,
        completed: false,
        sort_order: 0,
        visibility: 'shared',
        created_by: 'user-1',
        updated_at: '2026-08-22T10:00:00.000Z',
      },
      error: null,
    });

    await supabaseDataSource.itinerary.create({
      tripId: 'trip-1',
      date: '2026-08-23',
      startTime: '09:00',
      type: 'atracao',
      title: 'Louvre',
      placeName: 'Museu do Louvre',
      latitude: 48.8606,
      longitude: 2.3376,
      address: 'Rue de Rivoli',
      placeSource: 'catalog',
      completed: false,
      sortOrder: 0,
      visibility: 'shared',
      createdBy: 'forged-author-must-not-travel',
    });

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        place_name: 'Museu do Louvre',
        latitude: 48.8606,
        longitude: 2.3376,
        address: 'Rue de Rivoli',
        place_source: 'catalog',
        visibility: 'shared',
      }),
    );
    expect(mockInsert.mock.calls[0][0]).not.toHaveProperty('created_by');
  });
});

describe('backend 0007 incompatível', () => {
  const missingVisibility = (relation: string) => ({
    data: null,
    error: {
      code: 'PGRST204',
      message: `Could not find the 'visibility' column of '${relation}' in the schema cache`,
      details: null,
      hint: null,
    },
  });

  it.each([
    {
      relation: 'itinerary_items',
      create: () =>
        supabaseDataSource.itinerary.create({
          tripId: 'trip-1',
          date: '2026-08-23',
          type: 'atracao',
          title: 'Louvre',
          completed: false,
          sortOrder: 0,
          visibility: 'shared',
        }),
    },
    {
      relation: 'checklist_items',
      create: () =>
        supabaseDataSource.checklist.create({
          tripId: 'trip-1',
          label: 'Passaporte',
          category: 'documentos',
          completed: false,
          visibility: 'shared',
        }),
    },
    {
      relation: 'expenses',
      create: () =>
        supabaseDataSource.expenses.create({
          tripId: 'trip-1',
          userId: 'user-1',
          category: 'alimentacao',
          amount: 120,
          currency: 'BRL',
          amountInBudgetCurrency: 120,
          transactionDate: '2026-08-23',
          description: 'Almoço',
          visibility: 'private',
          paidBy: 'user-1',
        }),
    },
  ])('promove INSERT em $relation sem remover campos novos', async ({ relation, create }) => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockSingle.mockResolvedValue(missingVisibility(relation));

    const error = await create().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BackendCapabilityError);
    expect(error).toMatchObject({
      code: 'MISSING_VISIBILITY',
      backend: {
        code: 'PGRST204',
        message: `Could not find the 'visibility' column of '${relation}' in the schema cache`,
        details: null,
        hint: null,
      },
    });
    expect(mockFrom).toHaveBeenCalledWith(relation);
    expect(mockInsert.mock.calls[0][0]).toHaveProperty('visibility');
  });

  it('não mascara como capability um PGRST204 de coluna não relacionada', async () => {
    mockSingle.mockResolvedValue({
      data: null,
      error: {
        code: 'PGRST204',
        message: "Could not find the 'unrelated_column' column of 'itinerary_items' in the schema cache",
        details: 'schema cache is stale',
        hint: 'reload schema',
      },
    });

    const error = await supabaseDataSource.itinerary
      .create({
        tripId: 'trip-1',
        date: '2026-08-23',
        type: 'atracao',
        title: 'Louvre',
        completed: false,
        sortOrder: 0,
        visibility: 'shared',
      })
      .catch((caught: unknown) => caught);

    expect(error).not.toBeInstanceOf(BackendCapabilityError);
    expect(error).toMatchObject({
      name: 'SupabaseRepositoryError',
      code: 'PGRST204',
      details: 'schema cache is stale',
      hint: 'reload schema',
      operation: 'insert',
      relation: 'itinerary_items',
    });
  });
});
