/**
 * Foreign exchange (§41).
 *
 * Real ECB reference rates via Frankfurter (keyless). The banned behaviour is
 * a hardcoded `BRL × 0.20` presented as "tempo real" — so when a pair is not
 * available we return `null` and the UI says **Cotação indisponível** instead
 * of inventing a number.
 */

import type { CurrencyCode } from '@/domain/types';
import { cacheStorage } from '@/lib/storage';
import { getJson, ServiceError } from './http';

export interface ExchangeRate {
  from: CurrencyCode;
  to: CurrencyCode;
  rate: number;
  /** When the rate was published/fetched — persisted with each expense. */
  timestamp: string;
  source: string;
  stale: boolean;
}

export interface CurrencyService {
  /** Returns `null` when no trustworthy rate exists for the pair. */
  getRate(from: CurrencyCode, to: CurrencyCode): Promise<ExchangeRate | null>;
  convert(amount: number, from: CurrencyCode, to: CurrencyCode): Promise<{ value: number; rate: ExchangeRate } | null>;
}

/** Currencies Frankfurter (ECB) publishes. ARS is deliberately absent. */
const SUPPORTED = new Set<CurrencyCode>(['BRL', 'USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD']);

export function isRateSupported(currency: CurrencyCode): boolean {
  return SUPPORTED.has(currency);
}

const SOURCE = 'Banco Central Europeu (Frankfurter)';

interface FrankfurterResponse {
  amount: number;
  base: string;
  date: string;
  rates: Record<string, number>;
}

class FrankfurterCurrencyService implements CurrencyService {
  async getRate(from: CurrencyCode, to: CurrencyCode): Promise<ExchangeRate | null> {
    if (from === to) {
      return { from, to, rate: 1, timestamp: new Date().toISOString(), source: 'Mesma moeda', stale: false };
    }
    // Honest failure beats a fabricated rate.
    if (!SUPPORTED.has(from) || !SUPPORTED.has(to)) return null;

    const cacheKey = `fx:${from}:${to}`;

    try {
      const data = await getJson<FrankfurterResponse>(
        `https://api.frankfurter.app/latest?base=${from}&symbols=${to}`,
      );
      const rate = data.rates?.[to];
      if (typeof rate !== 'number') throw new ServiceError('parse', 'Cotação ausente na resposta.');

      const result: ExchangeRate = {
        from,
        to,
        rate,
        timestamp: new Date().toISOString(),
        source: SOURCE,
        stale: false,
      };
      await cacheStorage.set(cacheKey, result);
      return result;
    } catch {
      const cached = await cacheStorage.get<ExchangeRate>(cacheKey);
      // A stale rate is still a real rate — but it is labelled as such, and the
      // timestamp we persist on the expense is the one actually used.
      if (cached) return { ...cached.value, stale: true };
      return null;
    }
  }

  async convert(amount: number, from: CurrencyCode, to: CurrencyCode) {
    const rate = await this.getRate(from, to);
    if (!rate) return null;
    return { value: Math.round((amount * rate.rate + Number.EPSILON) * 100) / 100, rate };
  }
}

export const currencyService: CurrencyService = new FrankfurterCurrencyService();
