import { currencySymbol, formatMoney, parseMoneyInput } from '@/lib/currency';
import {
  compareTimezones,
  describeDifference,
  formatOffsetLabel,
  getOffsetMinutes,
  getZoneClock,
  timezoneCityLabel,
} from '@/services/timezone';

describe('money formatting (§39, §70)', () => {
  it('formats with the right symbol and decimals', () => {
    expect(formatMoney(1234.5, 'BRL')).toBe('R$ 1.234,50');
    expect(formatMoney(1234.5, 'USD')).toBe('US$ 1.234,50');
    // Yen is conventionally written without decimals.
    expect(formatMoney(22000, 'JPY')).toBe('¥ 22.000');
  });

  it('keeps the negative sign so an exceeded budget is visible', () => {
    expect(formatMoney(-250, 'BRL')).toBe('- R$ 250,00');
  });

  it('supports compact display for tiles', () => {
    expect(formatMoney(15000, 'BRL', { compact: true })).toBe('R$ 15 mil');
  });

  it('exposes symbols', () => {
    expect(currencySymbol('EUR')).toBe('€');
  });
});

describe('money parsing', () => {
  it('accepts pt-BR and plain formats', () => {
    expect(parseMoneyInput('1.234,56')).toBe(1234.56);
    expect(parseMoneyInput('1234.56')).toBe(1234.56);
    expect(parseMoneyInput('1,5')).toBe(1.5);
    expect(parseMoneyInput('R$ 89,90')).toBe(89.9);
    expect(parseMoneyInput('1,234.56')).toBe(1234.56);
  });

  it('returns null for unusable input', () => {
    expect(parseMoneyInput('')).toBeNull();
    expect(parseMoneyInput('abc')).toBeNull();
  });
});

describe('timezone helpers (§63)', () => {
  const instant = new Date('2026-08-17T12:00:00.000Z');

  it('computes whole-hour offsets from IANA zones', () => {
    expect(getOffsetMinutes('UTC', instant)).toBe(0);
    expect(getOffsetMinutes('Asia/Tokyo', instant)).toBe(540); // UTC+9, no DST
  });

  it('supports fractional offsets', () => {
    // These are exactly the cases a fixed-offset table gets wrong.
    expect(getOffsetMinutes('Asia/Kathmandu', instant)).toBe(345); // +05:45
    expect(getOffsetMinutes('Australia/Adelaide', instant)).toBe(570); // +09:30
  });

  it('respects daylight saving time', () => {
    const summer = new Date('2026-07-01T12:00:00.000Z');
    const winter = new Date('2026-01-01T12:00:00.000Z');
    expect(getOffsetMinutes('Europe/Paris', summer)).toBe(120); // CEST
    expect(getOffsetMinutes('Europe/Paris', winter)).toBe(60); // CET
  });

  it('formats offsets', () => {
    expect(formatOffsetLabel(540)).toBe('GMT+09:00');
    expect(formatOffsetLabel(345)).toBe('GMT+05:45');
    expect(formatOffsetLabel(-180)).toBe('GMT-03:00');
    expect(formatOffsetLabel(0)).toBe('GMT+00:00');
  });

  it('reads the wall clock in a zone', () => {
    const clock = getZoneClock('Asia/Tokyo', instant);
    expect(clock.time).toBe('21:00');
    expect(clock.offsetLabel).toBe('GMT+09:00');
    expect(clock.isDay).toBe(false); // 21:00 is night
  });

  it('describes differences in natural language', () => {
    expect(describeDifference(0)).toBe('Mesmo horário');
    expect(describeDifference(180)).toBe('3 horas à frente');
    expect(describeDifference(60)).toBe('1 hora à frente');
    expect(describeDifference(-90)).toBe('1h30 atrás');
    expect(describeDifference(45)).toBe('45 min à frente');
  });

  it('compares two zones', () => {
    const comparison = compareTimezones('America/Sao_Paulo', 'Asia/Tokyo', instant);
    // São Paulo is UTC-3, Tokyo UTC+9 → 12 hours ahead.
    expect(comparison.differenceMinutes).toBe(720);
    expect(comparison.differenceLabel).toBe('12 horas à frente');
  });

  it('labels cities from zone identifiers', () => {
    expect(timezoneCityLabel('America/Sao_Paulo')).toBe('Sao Paulo');
    expect(timezoneCityLabel('Europe/Paris')).toBe('Paris');
  });
});
