import { render } from '@testing-library/react-native';

import { TripLanguageCard } from '@/components/trip';
import type { Trip } from '@/domain/types';
import { ThemeProvider } from '@/theme';

/**
 * O cartão de idioma do destino na tela (§10, §11, §58 do handoff).
 *
 * A suíte de `country-metadata` já prova a REGRA. Esta prova que a tela obedece
 * a ela — inclusive na parte que é fácil errar: quando a resposta é "não
 * mostrar", o componente não pode renderizar um cartão vazio com o rótulo
 * "Idioma" e nada embaixo.
 */

const mockLanguage = jest.fn();
jest.mock('@/lib/locale', () => ({
  getUserLanguage: () => mockLanguage(),
  getUserLanguageTag: () => mockLanguage(),
}));

const trip = (countryCode: string, destinationCountry: string): Trip => ({
  id: 't1',
  userId: 'u1',
  destinationCity: 'Cidade',
  destinationCountry,
  countryCode,
  timezone: 'UTC',
  startDate: '2026-09-18',
  endDate: '2026-09-27',
  budgetTotal: 1000,
  budgetCurrency: 'BRL',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
});

const montar = (countryCode: string, país = 'País') =>
  render(<TripLanguageCard trip={trip(countryCode, país)} />, { wrapper: ThemeProvider });

describe('usuário que fala português (§58)', () => {
  beforeEach(() => mockLanguage.mockReturnValue('pt'));

  it('Brasil: não mostra nada', () => {
    expect(montar('BR', 'Brasil').toJSON()).toBeNull();
  });

  it('Portugal: não mostra nada', () => {
    expect(montar('PT', 'Portugal').toJSON()).toBeNull();
  });

  it('Japão: mostra Japonês', () => {
    const view = montar('JP', 'Japão');
    expect(view.getByText('Japonês')).toBeTruthy();
    expect(view.getByText('Idioma do destino')).toBeTruthy();
  });

  it('Estados Unidos: mostra Inglês', () => {
    expect(montar('US', 'Estados Unidos').getByText('Inglês')).toBeTruthy();
  });
});

describe('usuário que fala inglês (§58)', () => {
  beforeEach(() => mockLanguage.mockReturnValue('en'));

  it('Estados Unidos: não mostra nada', () => {
    expect(montar('US', 'Estados Unidos').toJSON()).toBeNull();
  });

  it('Japão: mostra Japonês', () => {
    expect(montar('JP', 'Japão').getByText('Japonês')).toBeTruthy();
  });
});

describe('variantes regionais são a mesma língua (§12)', () => {
  it('pt-BR indo a Portugal continua oculto', () => {
    mockLanguage.mockReturnValue('pt-BR');
    expect(montar('PT', 'Portugal').toJSON()).toBeNull();
  });

  it('en-GB indo aos Estados Unidos continua oculto', () => {
    mockLanguage.mockReturnValue('en-GB');
    expect(montar('US', 'Estados Unidos').toJSON()).toBeNull();
  });
});

describe('país multilíngue (§13)', () => {
  it('mostra os idiomas que a pessoa não fala, no plural', () => {
    mockLanguage.mockReturnValue('fr');
    const view = montar('CH', 'Suíça');

    expect(view.getByText('Alemão e Italiano')).toBeTruthy();
    expect(view.getByText('Idiomas do destino')).toBeTruthy();
  });

  it('mostra todos quando nenhum coincide', () => {
    mockLanguage.mockReturnValue('pt');
    expect(montar('CH', 'Suíça').getByText('Alemão, Francês e Italiano')).toBeTruthy();
  });
});

describe('destino sem metadados (§43)', () => {
  beforeEach(() => mockLanguage.mockReturnValue('pt'));

  it('não quebra e não desenha cartão vazio', () => {
    expect(montar('ZZ', 'Nárnia').toJSON()).toBeNull();
  });

  it('recupera pelo nome quando o código está ausente', () => {
    // Viagem antiga, sem `countryCode` gravado.
    expect(montar('', 'Japão').getByText('Japonês')).toBeTruthy();
  });
});
