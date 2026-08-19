import {
  addDays,
  daysBetween,
  formatDateRange,
  formatRelativeTime,
  formatShortDate,
  isValidISODate,
  isWithin,
  normalizeTime,
  parseISODate,
  toISODate,
  todayISO,
} from '@/lib/date';

describe('ISO date validation (§92)', () => {
  it('accepts real dates and rejects impossible ones', () => {
    expect(isValidISODate('2026-02-28')).toBe(true);
    expect(isValidISODate('2024-02-29')).toBe(true); // leap year
    expect(isValidISODate('2026-02-30')).toBe(false);
    expect(isValidISODate('2026-13-01')).toBe(false);
    expect(isValidISODate('2026-00-10')).toBe(false);
    expect(isValidISODate('26-01-01')).toBe(false);
    expect(isValidISODate('')).toBe(false);
  });
});

describe('date arithmetic', () => {
  it('counts whole days in both directions', () => {
    expect(daysBetween('2026-09-10', '2026-09-20')).toBe(10);
    expect(daysBetween('2026-09-20', '2026-09-10')).toBe(-10);
    expect(daysBetween('2026-09-10', '2026-09-10')).toBe(0);
  });

  it('crosses month and year boundaries correctly', () => {
    expect(daysBetween('2026-12-30', '2027-01-02')).toBe(3);
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('is immune to DST because dates are parsed at UTC noon', () => {
    // Brazil and Europe shift clocks in these windows; the day count must not.
    expect(daysBetween('2026-10-17', '2026-10-19')).toBe(2);
    expect(daysBetween('2026-03-14', '2026-03-16')).toBe(2);
  });

  it('checks inclusive ranges', () => {
    expect(isWithin('2026-09-10', '2026-09-10', '2026-09-20')).toBe(true);
    expect(isWithin('2026-09-20', '2026-09-10', '2026-09-20')).toBe(true);
    expect(isWithin('2026-09-21', '2026-09-10', '2026-09-20')).toBe(false);
  });

  it('round-trips through parse and format', () => {
    const iso = '2026-07-04';
    expect(toISODate(new Date(2026, 6, 4))).toBe(iso);
    expect(parseISODate(iso).getUTCDate()).toBe(4);
  });

  it('returns today in the local calendar', () => {
    expect(isValidISODate(todayISO())).toBe(true);
  });
});

describe('formatting', () => {
  it('formats single dates and ranges in pt-BR', () => {
    expect(formatShortDate('2026-03-04')).toBe('4 de mar');
    expect(formatDateRange('2026-03-04', '2026-03-11')).toBe('4 – 11 de mar');
    expect(formatDateRange('2026-03-28', '2026-04-02')).toBe('28 de mar – 2 de abr');
    expect(formatDateRange('2026-12-28', '2027-01-02')).toBe('28 de dez de 2026 – 2 de jan de 2027');
  });

  it('describes cache freshness', () => {
    const now = new Date('2026-08-17T12:00:00.000Z');
    expect(formatRelativeTime('2026-08-17T11:59:30.000Z', now)).toBe('agora');
    expect(formatRelativeTime('2026-08-17T11:30:00.000Z', now)).toBe('há 30 min');
    expect(formatRelativeTime('2026-08-17T10:00:00.000Z', now)).toBe('há 2h');
    expect(formatRelativeTime('2026-08-15T12:00:00.000Z', now)).toBe('há 2 dias');
  });
});

describe('time normalisation', () => {
  it('accepts common inputs and rejects nonsense', () => {
    expect(normalizeTime('9:05')).toBe('09:05');
    expect(normalizeTime('0930')).toBe('09:30');
    expect(normalizeTime('23:59')).toBe('23:59');
    expect(normalizeTime('24:00')).toBeNull();
    expect(normalizeTime('12:75')).toBeNull();
    expect(normalizeTime('abc')).toBeNull();
  });
});
