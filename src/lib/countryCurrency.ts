/**
 * Como escrever uma moeda — símbolo, casas decimais e formatação (§24 do
 * handoff).
 *
 * O QUE SAIU DAQUI, E POR QUÊ
 *
 * As tabelas país→moeda e nome→alpha-2 moravam neste arquivo. Elas foram para
 * `countryMetadata.ts`, que passou a ser a fonte única sobre país (§9, §42):
 * o mesmo destino agora responde "qual moeda" e "qual idioma" a partir de uma
 * base só. Manter uma cópia aqui teria produzido duas listas que divergem na
 * primeira correção — um país acrescentado numa e esquecido na outra.
 *
 * `currencyForCountry` continua exportado com a mesma assinatura e o mesmo
 * comportamento: é o que a Carteira e o conversor chamam, e não havia motivo
 * para mexer em quem já usa.
 *
 * O QUE ESTE MÓDULO NÃO FAZ
 *
 * Não tem cotação. Nenhum número aqui é câmbio: são símbolos e casas decimais.
 * A cotação vem do provedor, em `services/exchangeRates.ts`, e é a única fonte
 * de valor — nada é "aproximado a partir da tabela".
 */

import { currencyForCountryCode, knownCurrencyCodes } from './countryMetadata';

/**
 * A moeda do país do destino.
 *
 * `undefined` — e não um palpite — quando o país não está na base. O conversor
 * prefere dizer "não sei qual moeda usar aqui" a converter para a moeda errada,
 * que é um erro silencioso e caro no meio de uma viagem.
 */
export function currencyForCountry(
  countryCode: string | undefined,
  countryName?: string,
): string | undefined {
  return currencyForCountryCode(countryCode, countryName);
}

/** Símbolos usados na tela. Sem símbolo conhecido, o próprio código serve. */
const CURRENCY_SYMBOLS: Record<string, string> = {
  AED: 'د.إ', ARS: 'AR$', AUD: 'A$', BGN: 'лв', BRL: 'R$', CAD: 'C$',
  CHF: 'CHF', CLP: 'CLP$', CNY: '¥', COP: 'COL$', CZK: 'Kč', DKK: 'kr',
  EGP: 'E£', EUR: '€', GBP: '£', HKD: 'HK$', HUF: 'Ft', IDR: 'Rp',
  ILS: '₪', INR: '₹', ISK: 'kr', JPY: '¥', KRW: '₩', MAD: 'DH',
  MXN: 'MX$', MYR: 'RM', NOK: 'kr', NZD: 'NZ$', PEN: 'S/', PHP: '₱',
  PLN: 'zł', RON: 'lei', RSD: 'дин', RUB: '₽', SAR: '﷼', SEK: 'kr',
  SGD: 'S$', THB: '฿', TRY: '₺', TWD: 'NT$', UAH: '₴', USD: 'US$',
  UYU: '$U', VND: '₫', ZAR: 'R',
};

/**
 * Moedas escritas sem casas decimais (ISO 4217, `minor unit = 0`).
 *
 * Não é preferência de estilo: "¥ 16.240,00" está errado em iene, e mostrar
 * centavos numa moeda que não os tem faz o número parecer outro.
 */
const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF',
  'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);

export function symbolFor(currency: string): string {
  return CURRENCY_SYMBOLS[currency.toUpperCase()] ?? currency.toUpperCase();
}

export function fractionDigitsFor(currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 0 : 2;
}

/**
 * A moeda é usada por algum país que conhecemos?
 *
 * Pergunta ao registro central em vez de manter lista própria: é literalmente a
 * imagem de `country → currency`, e derivá-la evita que uma moeda nova entre no
 * registro sem passar a ser "conhecida" aqui.
 */
export function isKnownCurrency(currency: string): boolean {
  return knownCurrencyCodes().has(currency.toUpperCase());
}

/**
 * Um valor escrito na convenção do usuário (pt-BR) com o símbolo da moeda.
 *
 * Sempre `pt-BR` para os separadores porque quem lê a tela é a pessoa que
 * escreveu "1.000,00" no campo ao lado; alternar a convenção de separadores
 * por moeda faria o resultado parecer de outra ordem de grandeza.
 */
export function formatCurrencyAmount(value: number, currency: string): string {
  const digits = fractionDigitsFor(currency);
  const negativo = value < 0;
  const corpo = Math.abs(value).toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${negativo ? '- ' : ''}${symbolFor(currency)} ${corpo}`;
}

/**
 * A taxa em si — "1 BRL ≈ 16,24 RUB".
 *
 * Mais casas do que o valor final, e de propósito: uma taxa arredondada a duas
 * casas viraria "1 BRL ≈ 0,16 EUR", que perde a informação de que 1.000 BRL
 * dão 158 e não 160. O valor convertido continua nas casas da moeda.
 */
export function formatRate(rate: number, from: string, to: string): string {
  const casas = rate >= 100 ? 2 : rate >= 1 ? 4 : 6;
  const corpo = rate.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: casas,
  });
  return `1 ${from.toUpperCase()} ≈ ${corpo} ${to.toUpperCase()}`;
}
