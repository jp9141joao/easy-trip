import type { CurrencyCode } from '@/domain/types';

const SYMBOLS: Record<CurrencyCode, string> = {
  BRL: 'R$',
  USD: 'US$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  CHF: 'CHF',
  CAD: 'C$',
  AUD: 'A$',
  ARS: 'AR$',
};

/** Currencies conventionally written without decimal places. */
const ZERO_DECIMAL: CurrencyCode[] = ['JPY'];

export function currencySymbol(currency: CurrencyCode): string {
  return SYMBOLS[currency] ?? currency;
}

/**
 * Formats money for display. Negative values keep their sign so an exceeded
 * budget reads `- R$ 250` rather than being hidden (§39).
 */
export function formatMoney(
  value: number,
  currency: CurrencyCode,
  options: { showSymbol?: boolean; compact?: boolean } = {},
): string {
  const { showSymbol = true, compact = false } = options;
  const fractionDigits = ZERO_DECIMAL.includes(currency) ? 0 : 2;
  const negative = value < 0;
  const abs = Math.abs(value);

  let body: string;
  if (compact && abs >= 1000) {
    body = `${trimZero(abs / 1000)} mil`;
  } else {
    body = abs.toLocaleString('pt-BR', {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
  }

  const withSymbol = showSymbol ? `${currencySymbol(currency)} ${body}` : body;
  return negative ? `- ${withSymbol}` : withSymbol;
}

function trimZero(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/**
 * Parses user money input accepting both `1.234,56` (pt-BR) and `1234.56`.
 * Returns `null` when the text is not a usable number.
 */
export function parseMoneyInput(input: string): number | null {
  const cleaned = input.replace(/[^\d.,-]/g, '').trim();
  if (!cleaned) return null;

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  let normalized: string;

  if (lastComma > lastDot) {
    // pt-BR: dots are thousand separators, comma is the decimal mark.
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    normalized = cleaned.replace(/,/g, '');
  }

  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}
