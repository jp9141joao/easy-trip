import {
  checklistItemSchema,
  expenseSchema,
  goalSchema,
  itineraryItemSchema,
  loginSchema,
  registerSchema,
  reservationRequestSchema,
  tripSchema,
} from '@/domain/schemas';

const validTrip = {
  destinationCity: 'Paris',
  destinationCountry: 'França',
  countryCode: 'fr',
  timezone: 'Europe/Paris',
  startDate: '2026-09-10',
  endDate: '2026-09-20',
  budgetTotal: 1000,
  budgetCurrency: 'BRL',
};

describe('trip schema (§30)', () => {
  it('accepts a valid trip and upper-cases the country code', () => {
    const result = tripSchema.safeParse(validTrip);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.countryCode).toBe('FR');
  });

  it('rejects a return date before the departure date', () => {
    const result = tripSchema.safeParse({ ...validTrip, endDate: '2026-09-01' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['endDate']);
      expect(result.error.issues[0].message).toMatch(/posterior/);
    }
  });

  it('allows a same-day trip', () => {
    expect(tripSchema.safeParse({ ...validTrip, endDate: validTrip.startDate }).success).toBe(true);
  });

  it('rejects a negative budget but allows zero', () => {
    expect(tripSchema.safeParse({ ...validTrip, budgetTotal: -1 }).success).toBe(false);
    expect(tripSchema.safeParse({ ...validTrip, budgetTotal: 0 }).success).toBe(true);
  });

  it('rejects an invalid calendar date', () => {
    expect(tripSchema.safeParse({ ...validTrip, startDate: '2026-02-30' }).success).toBe(false);
  });
});

describe('auth schemas (§25, §26)', () => {
  it('normalises the e-mail to lowercase', () => {
    const result = loginSchema.safeParse({ email: '  Joao@Example.COM ', password: 'x' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe('joao@example.com');
  });

  it('requires matching passwords', () => {
    const base = {
      name: 'João',
      email: 'joao@example.com',
      password: 'senha1234',
      defaultCurrency: 'BRL',
    };
    expect(registerSchema.safeParse({ ...base, confirmPassword: 'outra1234' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, confirmPassword: 'senha1234' }).success).toBe(true);
  });

  it('enforces password strength', () => {
    const base = {
      name: 'João',
      email: 'joao@example.com',
      defaultCurrency: 'BRL',
    };
    // Too short
    expect(registerSchema.safeParse({ ...base, password: 'ab1', confirmPassword: 'ab1' }).success).toBe(false);
    // No digit
    expect(
      registerSchema.safeParse({ ...base, password: 'somenteletras', confirmPassword: 'somenteletras' })
        .success,
    ).toBe(false);
  });

  it('produces messages in pt-BR', () => {
    const result = loginSchema.safeParse({ email: 'nao-e-email', password: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(' ');
      expect(messages).toMatch(/inválido|Informe/i);
      expect(messages).not.toMatch(/Invalid input/);
    }
  });
});

describe('expense schema (§40)', () => {
  it('requires a positive amount', () => {
    const base = {
      description: 'Jantar',
      category: 'alimentacao',
      currency: 'EUR',
      transactionDate: '2026-09-12',
    };
    expect(expenseSchema.safeParse({ ...base, amount: 45 }).success).toBe(true);
    expect(expenseSchema.safeParse({ ...base, amount: 0 }).success).toBe(false);
    expect(expenseSchema.safeParse({ ...base, amount: -5 }).success).toBe(false);
  });
});

describe('itinerary schema (§35)', () => {
  const base = { date: '2026-09-11', type: 'atracao', title: 'Louvre' };

  it('requires a title', () => {
    expect(itineraryItemSchema.safeParse({ ...base, title: 'a' }).success).toBe(false);
  });

  it('rejects an end time before the start time', () => {
    const result = itineraryItemSchema.safeParse({ ...base, startTime: '18:00', endTime: '09:00' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].path).toEqual(['endTime']);
  });

  it('accepts empty times as undefined', () => {
    const result = itineraryItemSchema.safeParse({ ...base, startTime: '', endTime: '' });
    expect(result.success).toBe(true);
  });

  it('rejects malformed times', () => {
    expect(itineraryItemSchema.safeParse({ ...base, startTime: '25:00' }).success).toBe(false);
  });
});

describe('checklist and goal schemas (§36, §43)', () => {
  it('validates a checklist item', () => {
    expect(checklistItemSchema.safeParse({ label: 'Passaporte', category: 'documentos' }).success).toBe(
      true,
    );
    expect(checklistItemSchema.safeParse({ label: 'x', category: 'documentos' }).success).toBe(false);
  });

  it('requires targetValue > 0 and currentValue >= 0', () => {
    const base = { type: 'economia', title: 'Kyoto', unit: 'R$' };
    expect(goalSchema.safeParse({ ...base, targetValue: 5000, currentValue: 0 }).success).toBe(true);
    expect(goalSchema.safeParse({ ...base, targetValue: 0, currentValue: 0 }).success).toBe(false);
    expect(goalSchema.safeParse({ ...base, targetValue: 100, currentValue: -1 }).success).toBe(false);
  });
});

describe('reservation schema (§54)', () => {
  it('requires a sensible party size', () => {
    const base = { requestedFor: '20/09 às 20h' };
    expect(reservationRequestSchema.safeParse({ ...base, partySize: 2 }).success).toBe(true);
    expect(reservationRequestSchema.safeParse({ ...base, partySize: 0 }).success).toBe(false);
    expect(reservationRequestSchema.safeParse({ ...base, partySize: 2.5 }).success).toBe(false);
  });
});
