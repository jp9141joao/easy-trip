/**
 * País → moeda, e moeda → como escrevê-la (§24 do handoff).
 *
 * POR QUE UMA TABELA, E POR QUE ELA É GRANDE
 *
 * O conversor da Carteira precisa saber, sem perguntar, qual moeda a pessoa vai
 * gastar no destino. O destino chega como ISO 3166-1 alpha-2 — é o que o
 * geocoder devolve e o que `Trip.countryCode` guarda —, e a resposta é um
 * código ISO 4217.
 *
 * A tabela cobre praticamente todos os países porque o aplicativo não restringe
 * destinos: quem cria uma viagem digita a cidade, e o geocoder aceita o mundo.
 * Cobrir só os seis do exemplo do handoff deixaria a maior parte dos destinos
 * sem conversor — e um conversor que some sem explicação é pior do que um que
 * diz "não tenho cotação para esta moeda".
 *
 * O QUE ESTE MÓDULO NÃO FAZ
 *
 * Não tem cotação. Nenhum número aqui é câmbio: são códigos, símbolos e casas
 * decimais. A cotação vem do provedor, em `services/exchangeRates.ts`, e é a
 * única fonte de valor — nada é "aproximado a partir da tabela".
 */

/**
 * ISO 3166-1 alpha-2 → ISO 4217.
 *
 * Territórios que usam a moeda de outro país aparecem apontando para ela (PR →
 * USD, MC → EUR): é o que a pessoa vai de fato usar na rua, que é a pergunta
 * do conversor. Países com mais de uma moeda em circulação recebem a de curso
 * legal principal.
 */
const COUNTRY_TO_CURRENCY: Record<string, string> = {
  AD: 'EUR', AE: 'AED', AF: 'AFN', AG: 'XCD', AI: 'XCD', AL: 'ALL', AM: 'AMD',
  AO: 'AOA', AR: 'ARS', AS: 'USD', AT: 'EUR', AU: 'AUD', AW: 'AWG', AX: 'EUR',
  AZ: 'AZN', BA: 'BAM', BB: 'BBD', BD: 'BDT', BE: 'EUR', BF: 'XOF', BG: 'BGN',
  BH: 'BHD', BI: 'BIF', BJ: 'XOF', BL: 'EUR', BM: 'BMD', BN: 'BND', BO: 'BOB',
  BQ: 'USD', BR: 'BRL', BS: 'BSD', BT: 'BTN', BW: 'BWP', BY: 'BYN', BZ: 'BZD',
  CA: 'CAD', CC: 'AUD', CD: 'CDF', CF: 'XAF', CG: 'XAF', CH: 'CHF', CI: 'XOF',
  CK: 'NZD', CL: 'CLP', CM: 'XAF', CN: 'CNY', CO: 'COP', CR: 'CRC', CU: 'CUP',
  CV: 'CVE', CW: 'ANG', CX: 'AUD', CY: 'EUR', CZ: 'CZK', DE: 'EUR', DJ: 'DJF',
  DK: 'DKK', DM: 'XCD', DO: 'DOP', DZ: 'DZD', EC: 'USD', EE: 'EUR', EG: 'EGP',
  EH: 'MAD', ER: 'ERN', ES: 'EUR', ET: 'ETB', FI: 'EUR', FJ: 'FJD', FK: 'FKP',
  FM: 'USD', FO: 'DKK', FR: 'EUR', GA: 'XAF', GB: 'GBP', GD: 'XCD', GE: 'GEL',
  GF: 'EUR', GG: 'GBP', GH: 'GHS', GI: 'GIP', GL: 'DKK', GM: 'GMD', GN: 'GNF',
  GP: 'EUR', GQ: 'XAF', GR: 'EUR', GT: 'GTQ', GU: 'USD', GW: 'XOF', GY: 'GYD',
  HK: 'HKD', HN: 'HNL', HR: 'EUR', HT: 'HTG', HU: 'HUF', ID: 'IDR', IE: 'EUR',
  IL: 'ILS', IM: 'GBP', IN: 'INR', IO: 'USD', IQ: 'IQD', IR: 'IRR', IS: 'ISK',
  IT: 'EUR', JE: 'GBP', JM: 'JMD', JO: 'JOD', JP: 'JPY', KE: 'KES', KG: 'KGS',
  KH: 'KHR', KI: 'AUD', KM: 'KMF', KN: 'XCD', KP: 'KPW', KR: 'KRW', KW: 'KWD',
  KY: 'KYD', KZ: 'KZT', LA: 'LAK', LB: 'LBP', LC: 'XCD', LI: 'CHF', LK: 'LKR',
  LR: 'LRD', LS: 'LSL', LT: 'EUR', LU: 'EUR', LV: 'EUR', LY: 'LYD', MA: 'MAD',
  MC: 'EUR', MD: 'MDL', ME: 'EUR', MF: 'EUR', MG: 'MGA', MH: 'USD', MK: 'MKD',
  ML: 'XOF', MM: 'MMK', MN: 'MNT', MO: 'MOP', MP: 'USD', MQ: 'EUR', MR: 'MRU',
  MS: 'XCD', MT: 'EUR', MU: 'MUR', MV: 'MVR', MW: 'MWK', MX: 'MXN', MY: 'MYR',
  MZ: 'MZN', NA: 'NAD', NC: 'XPF', NE: 'XOF', NF: 'AUD', NG: 'NGN', NI: 'NIO',
  NL: 'EUR', NO: 'NOK', NP: 'NPR', NR: 'AUD', NU: 'NZD', NZ: 'NZD', OM: 'OMR',
  PA: 'PAB', PE: 'PEN', PF: 'XPF', PG: 'PGK', PH: 'PHP', PK: 'PKR', PL: 'PLN',
  PM: 'EUR', PN: 'NZD', PR: 'USD', PS: 'ILS', PT: 'EUR', PW: 'USD', PY: 'PYG',
  QA: 'QAR', RE: 'EUR', RO: 'RON', RS: 'RSD', RU: 'RUB', RW: 'RWF', SA: 'SAR',
  SB: 'SBD', SC: 'SCR', SD: 'SDG', SE: 'SEK', SG: 'SGD', SH: 'SHP', SI: 'EUR',
  SJ: 'NOK', SK: 'EUR', SL: 'SLE', SM: 'EUR', SN: 'XOF', SO: 'SOS', SR: 'SRD',
  SS: 'SSP', ST: 'STN', SV: 'USD', SX: 'ANG', SY: 'SYP', SZ: 'SZL', TC: 'USD',
  TD: 'XAF', TG: 'XOF', TH: 'THB', TJ: 'TJS', TK: 'NZD', TL: 'USD', TM: 'TMT',
  TN: 'TND', TO: 'TOP', TR: 'TRY', TT: 'TTD', TV: 'AUD', TW: 'TWD', TZ: 'TZS',
  UA: 'UAH', UG: 'UGX', US: 'USD', UY: 'UYU', UZ: 'UZS', VA: 'EUR', VC: 'XCD',
  VE: 'VES', VG: 'USD', VI: 'USD', VN: 'VND', VU: 'VUV', WF: 'XPF', WS: 'WST',
  XK: 'EUR', YE: 'YER', YT: 'EUR', ZA: 'ZAR', ZM: 'ZMW', ZW: 'ZWG',
};

/**
 * Nomes de país → alpha-2, para quando só houver o nome.
 *
 * A viagem guarda `countryCode`, então este caminho é o de recuperação: uma
 * viagem antiga sem código, ou um geocoder que devolveu só o nome. Cobre as
 * grafias em português e em inglês dos destinos que aparecem no aplicativo —
 * "Rússia", "Russia", "Rússia" sem acento — porque é isso que chega escrito.
 */
const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  brasil: 'BR', brazil: 'BR',
  russia: 'RU', 'federacao russa': 'RU', 'russian federation': 'RU',
  japao: 'JP', japan: 'JP',
  'estados unidos': 'US', 'united states': 'US', eua: 'US', usa: 'US',
  'estados unidos da america': 'US', 'united states of america': 'US',
  franca: 'FR', france: 'FR',
  'reino unido': 'GB', 'united kingdom': 'GB', inglaterra: 'GB', england: 'GB',
  alemanha: 'DE', germany: 'DE',
  espanha: 'ES', spain: 'ES',
  italia: 'IT', italy: 'IT',
  portugal: 'PT',
  argentina: 'AR', chile: 'CL', uruguai: 'UY', uruguay: 'UY',
  mexico: 'MX', canada: 'CA', colombia: 'CO', peru: 'PE',
  china: 'CN', 'coreia do sul': 'KR', 'south korea': 'KR',
  india: 'IN', tailandia: 'TH', thailand: 'TH',
  australia: 'AU', 'nova zelandia': 'NZ', 'new zealand': 'NZ',
  suica: 'CH', switzerland: 'CH', holanda: 'NL', 'paises baixos': 'NL',
  netherlands: 'NL', belgica: 'BE', belgium: 'BE', austria: 'AT',
  grecia: 'GR', greece: 'GR', turquia: 'TR', turkey: 'TR',
  egito: 'EG', egypt: 'EG', marrocos: 'MA', morocco: 'MA',
  'africa do sul': 'ZA', 'south africa': 'ZA',
  noruega: 'NO', norway: 'NO', suecia: 'SE', sweden: 'SE',
  dinamarca: 'DK', denmark: 'DK', finlandia: 'FI', finland: 'FI',
  irlanda: 'IE', ireland: 'IE', polonia: 'PL', poland: 'PL',
  'republica tcheca': 'CZ', tchequia: 'CZ', czechia: 'CZ',
  hungria: 'HU', hungary: 'HU', croacia: 'HR', croatia: 'HR',
  israel: 'IL', 'emirados arabes unidos': 'AE',
  'united arab emirates': 'AE', singapura: 'SG', singapore: 'SG',
  indonesia: 'ID', vietna: 'VN', vietnam: 'VN', filipinas: 'PH',
  philippines: 'PH', malasia: 'MY', malaysia: 'MY',
};

function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A moeda do país do destino.
 *
 * `undefined` — e não um palpite — quando o país não está na tabela. O
 * conversor prefere dizer "não sei qual moeda usar aqui" a converter para a
 * moeda errada, que é um erro silencioso e caro no meio de uma viagem.
 */
export function currencyForCountry(
  countryCode: string | undefined,
  countryName?: string,
): string | undefined {
  const code = countryCode?.trim().toUpperCase();
  if (code && COUNTRY_TO_CURRENCY[code]) return COUNTRY_TO_CURRENCY[code];

  if (countryName) {
    const alpha2 = COUNTRY_NAME_TO_CODE[fold(countryName)];
    if (alpha2) return COUNTRY_TO_CURRENCY[alpha2];
  }

  return undefined;
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

export function isKnownCurrency(currency: string): boolean {
  return Object.values(COUNTRY_TO_CURRENCY).includes(currency.toUpperCase());
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
