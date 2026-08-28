import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { CurrencyConverterCard } from '@/components/trip';
import type { CurrencyCode, Trip } from '@/domain/types';
import { ThemeProvider } from '@/theme';

/**
 * Quando o conversor aparece, e quando ele não existe (§39, §64 do handoff).
 *
 * A REGRA: mesma moeda dos dois lados, sem card.
 *
 * Um conversor de euro para euro é um campo que copia o outro — ocupa a altura
 * de um cartão para não responder nada. E a decisão é LOCAL: o teste também
 * mede que nenhuma consulta de cotação sai quando as moedas coincidem, porque
 * gastar rede para descobrir que 1 EUR = 1 EUR é o desperdício que o §48 proíbe.
 */

const mockFetchRate = jest.fn();

jest.mock('@/services/exchangeRates', () => ({
  EXCHANGE_RATE_ATTRIBUTION: 'Fonte de teste',
  convertWithRate: (value: number, rate: { rate: number }) => value * rate.rate,
  getReferenceRate: (...args: unknown[]) => {
    mockFetchRate(...args);
    return Promise.resolve({
      rate: { rate: 27.31, from: 'BRL', to: 'JPY', timestamp: '2026-08-28T00:00:00.000Z' },
      fetchedAt: '2026-08-28T00:00:00.000Z',
      stale: false,
    });
  },
}));

const trip = (patch: Partial<Trip> = {}): Trip => ({
  id: 't1',
  userId: 'u1',
  destinationCity: 'Tóquio',
  destinationCountry: 'Japão',
  countryCode: 'JP',
  timezone: 'Asia/Tokyo',
  startDate: '2026-09-18',
  endDate: '2026-09-27',
  budgetTotal: 10000,
  budgetCurrency: 'BRL',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  ...patch,
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>{children}</ThemeProvider>
    </QueryClientProvider>
  );
}

const montar = (patch: Partial<Trip>) =>
  render(<CurrencyConverterCard trip={trip(patch)} />, { wrapper });

beforeEach(() => mockFetchRate.mockClear());

describe('moedas diferentes — o conversor aparece (§64)', () => {
  it('BRL para JPY monta o card', () => {
    const view = montar({ budgetCurrency: 'BRL', countryCode: 'JP', destinationCountry: 'Japão' });
    expect(view.queryByText('Conversão de moeda')).toBeTruthy();
  });

  it('EUR para USD monta o card', () => {
    const view = montar({
      budgetCurrency: 'EUR' as CurrencyCode,
      countryCode: 'US',
      destinationCountry: 'Estados Unidos',
    });
    expect(view.queryByText('Conversão de moeda')).toBeTruthy();
  });
});

describe('mesma moeda — o conversor não é montado (§39, §64)', () => {
  it('BRL numa viagem ao Brasil', () => {
    const view = montar({ budgetCurrency: 'BRL', countryCode: 'BR', destinationCountry: 'Brasil' });
    expect(view.queryByText('Conversão de moeda')).toBeNull();
    expect(view.toJSON()).toBeNull();
  });

  it('EUR numa viagem à França', () => {
    const view = montar({
      budgetCurrency: 'EUR' as CurrencyCode,
      countryCode: 'FR',
      destinationCountry: 'França',
    });
    expect(view.toJSON()).toBeNull();
  });

  it('USD numa viagem aos Estados Unidos', () => {
    const view = montar({
      budgetCurrency: 'USD' as CurrencyCode,
      countryCode: 'US',
      destinationCountry: 'Estados Unidos',
    });
    expect(view.toJSON()).toBeNull();
  });

  it('não consulta cotação nenhuma para decidir (§48)', () => {
    montar({ budgetCurrency: 'BRL', countryCode: 'BR', destinationCountry: 'Brasil' });
    expect(mockFetchRate).not.toHaveBeenCalled();
  });
});

describe('país sem moeda conhecida (§43)', () => {
  it('não monta card quebrado nem consulta o provedor', () => {
    const view = montar({ countryCode: 'ZZ', destinationCountry: 'Nárnia' });
    expect(view.toJSON()).toBeNull();
    expect(mockFetchRate).not.toHaveBeenCalled();
  });
});

describe('a moeda base é a do orçamento da viagem (§41)', () => {
  it('consulta o par a partir de `budgetCurrency`, não de um BRL fixo', () => {
    montar({
      budgetCurrency: 'EUR' as CurrencyCode,
      countryCode: 'JP',
      destinationCountry: 'Japão',
    });
    expect(mockFetchRate).toHaveBeenCalledWith('EUR', 'JPY');
  });
});
