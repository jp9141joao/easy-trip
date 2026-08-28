/**
 * A fonte única de metadados de país (§8, §9, §42 do handoff).
 *
 * POR QUE ESTE MÓDULO EXISTE
 *
 * O aplicativo precisa responder duas perguntas sobre o destino — "qual moeda
 * se gasta aqui?" e "qual idioma se fala aqui?" — e as duas partem do MESMO
 * dado: o ISO 3166-1 alpha-2 que o geocoder devolve e que `Trip.countryCode`
 * guarda.
 *
 * A tabela de moeda já existia em `countryCurrency.ts`. Acrescentar uma segunda
 * tabela de idioma ao lado, com sua própria lista de países e sua própria
 * normalização de nome, teria produzido duas bases que divergem na primeira
 * correção: alguém acrescenta "Kosovo" numa e esquece a outra, e o destino
 * passa a ter moeda sem idioma. Por isso o registro é um só, e
 * `countryCurrency.ts` passou a lê-lo em vez de manter cópia própria.
 *
 * O QUE ESTE MÓDULO NÃO FAZ
 *
 * Não vai à rede. Descobrir o idioma de um país é conhecimento estável — não
 * muda entre uma abertura da tela e a seguinte —, e uma chamada HTTP para isso
 * gastaria bateria e falharia em modo avião para devolver sempre a mesma
 * resposta (§48).
 *
 * Não tem cotação, e não tem tradução de interface. Os nomes de idioma aqui
 * são rótulos em português para exibição, não um sistema de i18n.
 */

/* ------------------------------ normalização ------------------------------ */

/** Tira acento, pontuação e caixa para "Rússia", "Russia" e "RUSSIA" baterem. */
export function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* --------------------------------- moeda ---------------------------------- */

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

/* -------------------------------- idiomas --------------------------------- */

/**
 * ISO 3166-1 alpha-2 → idiomas (ISO 639-1), em ordem de relevância para quem
 * chega de fora.
 *
 * A ORDEM É CONTEÚDO, NÃO ARBITRARIEDADE
 *
 * O primeiro da lista é o que responde "em que língua eu falo no balcão".
 * Para a Suíça isso é o alemão, falado pela maioria; para o Canadá, o inglês.
 * Um país oficialmente bilíngue não é reduzido a um idioma só (§10): CA traz
 * `['en', 'fr']`, CH traz `['de', 'fr', 'it']`, BE traz `['nl', 'fr', 'de']`.
 *
 * A cobertura acompanha a da moeda, porque é a mesma pergunta feita sobre o
 * mesmo destino. Onde a informação seria um chute — um país com dezenas de
 * línguas locais e nenhuma franca — entra a língua oficial de administração,
 * que é a que a pessoa vai encontrar em placa e cardápio.
 */
const COUNTRY_TO_LANGUAGES: Record<string, readonly string[]> = {
  AD: ['ca'], AE: ['ar'], AF: ['ps', 'fa'], AG: ['en'], AI: ['en'], AL: ['sq'],
  AM: ['hy'], AO: ['pt'], AR: ['es'], AS: ['en'], AT: ['de'], AU: ['en'],
  AW: ['nl', 'es'], AX: ['sv'], AZ: ['az'], BA: ['bs', 'hr', 'sr'], BB: ['en'],
  BD: ['bn'], BE: ['nl', 'fr', 'de'], BF: ['fr'], BG: ['bg'], BH: ['ar'],
  BI: ['fr', 'en'], BJ: ['fr'], BL: ['fr'], BM: ['en'], BN: ['ms'],
  BO: ['es'], BQ: ['nl'], BR: ['pt'], BS: ['en'], BT: ['dz'], BW: ['en', 'tn'],
  BY: ['be', 'ru'], BZ: ['en', 'es'], CA: ['en', 'fr'], CC: ['en'],
  CD: ['fr'], CF: ['fr'], CG: ['fr'], CH: ['de', 'fr', 'it'], CI: ['fr'],
  CK: ['en'], CL: ['es'], CM: ['fr', 'en'], CN: ['zh'], CO: ['es'], CR: ['es'],
  CU: ['es'], CV: ['pt'], CW: ['nl'], CX: ['en'], CY: ['el', 'tr'], CZ: ['cs'],
  DE: ['de'], DJ: ['fr', 'ar'], DK: ['da'], DM: ['en'], DO: ['es'], DZ: ['ar'],
  EC: ['es'], EE: ['et'], EG: ['ar'], EH: ['ar'], ER: ['ti', 'ar', 'en'],
  ES: ['es'], ET: ['am'], FI: ['fi', 'sv'], FJ: ['en', 'fj'], FK: ['en'],
  FM: ['en'], FO: ['fo', 'da'], FR: ['fr'], GA: ['fr'], GB: ['en'],
  GD: ['en'], GE: ['ka'], GF: ['fr'], GG: ['en'], GH: ['en'], GI: ['en'],
  GL: ['kl', 'da'], GM: ['en'], GN: ['fr'], GP: ['fr'], GQ: ['es', 'fr', 'pt'],
  GR: ['el'], GT: ['es'], GU: ['en'], GW: ['pt'], GY: ['en'], HK: ['zh', 'en'],
  HN: ['es'], HR: ['hr'], HT: ['fr', 'ht'], HU: ['hu'], ID: ['id'], IE: ['en', 'ga'],
  IL: ['he', 'ar'], IM: ['en'], IN: ['hi', 'en'], IO: ['en'], IQ: ['ar', 'ku'],
  IR: ['fa'], IS: ['is'], IT: ['it'], JE: ['en'], JM: ['en'], JO: ['ar'],
  JP: ['ja'], KE: ['sw', 'en'], KG: ['ky', 'ru'], KH: ['km'], KI: ['en'],
  KM: ['ar', 'fr'], KN: ['en'], KP: ['ko'], KR: ['ko'], KW: ['ar'], KY: ['en'],
  KZ: ['kk', 'ru'], LA: ['lo'], LB: ['ar', 'fr'], LC: ['en'], LI: ['de'],
  LK: ['si', 'ta'], LR: ['en'], LS: ['en', 'st'], LT: ['lt'], LU: ['fr', 'de', 'lb'],
  LV: ['lv'], LY: ['ar'], MA: ['ar', 'fr'], MC: ['fr'], MD: ['ro'], ME: ['sr'],
  MF: ['fr'], MG: ['mg', 'fr'], MH: ['en'], MK: ['mk'], ML: ['fr'], MM: ['my'],
  MN: ['mn'], MO: ['zh', 'pt'], MP: ['en'], MQ: ['fr'], MR: ['ar'], MS: ['en'],
  MT: ['mt', 'en'], MU: ['en', 'fr'], MV: ['dv'], MW: ['en'], MX: ['es'],
  MY: ['ms', 'en'], MZ: ['pt'], NA: ['en'], NC: ['fr'], NE: ['fr'], NF: ['en'],
  NG: ['en'], NI: ['es'], NL: ['nl'], NO: ['no'], NP: ['ne'], NR: ['en'],
  NU: ['en'], NZ: ['en', 'mi'], OM: ['ar'], PA: ['es'], PE: ['es'], PF: ['fr'],
  PG: ['en'], PH: ['tl', 'en'], PK: ['ur', 'en'], PL: ['pl'], PM: ['fr'],
  PN: ['en'], PR: ['es', 'en'], PS: ['ar'], PT: ['pt'], PW: ['en'], PY: ['es', 'gn'],
  QA: ['ar'], RE: ['fr'], RO: ['ro'], RS: ['sr'], RU: ['ru'], RW: ['rw', 'en', 'fr'],
  SA: ['ar'], SB: ['en'], SC: ['fr', 'en'], SD: ['ar', 'en'], SE: ['sv'],
  SG: ['en', 'zh', 'ms', 'ta'], SH: ['en'], SI: ['sl'], SJ: ['no'], SK: ['sk'],
  SL: ['en'], SM: ['it'], SN: ['fr'], SO: ['so', 'ar'], SR: ['nl'], SS: ['en'],
  ST: ['pt'], SV: ['es'], SX: ['nl', 'en'], SY: ['ar'], SZ: ['en', 'ss'],
  TC: ['en'], TD: ['fr', 'ar'], TG: ['fr'], TH: ['th'], TJ: ['tg'], TK: ['en'],
  TL: ['pt', 'id'], TM: ['tk'], TN: ['ar', 'fr'], TO: ['en', 'to'], TR: ['tr'],
  TT: ['en'], TV: ['en'], TW: ['zh'], TZ: ['sw', 'en'], UA: ['uk'], UG: ['en', 'sw'],
  US: ['en'], UY: ['es'], UZ: ['uz'], VA: ['it'], VC: ['en'], VE: ['es'],
  VG: ['en'], VI: ['en'], VN: ['vi'], VU: ['bi', 'en', 'fr'], WF: ['fr'],
  WS: ['en', 'sm'], XK: ['sq', 'sr'], YE: ['ar'], YT: ['fr'], ZA: ['en', 'af', 'zu'],
  ZM: ['en'], ZW: ['en', 'sn'],
};

/**
 * ISO 639-1 → nome do idioma em português.
 *
 * Sem entrada aqui, o código não vira rótulo — e a tela prefere não mostrar
 * nada a mostrar "ISO: ps" para alguém que só queria saber o que se fala no
 * destino (§43).
 */
const LANGUAGE_NAME_PT: Record<string, string> = {
  af: 'Africâner', am: 'Amárico', ar: 'Árabe', az: 'Azerbaijano', be: 'Bielorrusso',
  bg: 'Búlgaro', bi: 'Bislamá', bn: 'Bengali', bs: 'Bósnio', ca: 'Catalão',
  cs: 'Tcheco', da: 'Dinamarquês', de: 'Alemão', dv: 'Divehi', dz: 'Dzongkha',
  el: 'Grego', en: 'Inglês', es: 'Espanhol', et: 'Estoniano', fa: 'Persa',
  fi: 'Finlandês', fj: 'Fijiano', fo: 'Feroês', fr: 'Francês', ga: 'Irlandês',
  gn: 'Guarani', he: 'Hebraico', hi: 'Híndi', hr: 'Croata', ht: 'Crioulo haitiano',
  hu: 'Húngaro', hy: 'Armênio', id: 'Indonésio', is: 'Islandês', it: 'Italiano',
  ja: 'Japonês', ka: 'Georgiano', kk: 'Cazaque', kl: 'Groenlandês', km: 'Khmer',
  ko: 'Coreano', ku: 'Curdo', ky: 'Quirguiz', lb: 'Luxemburguês', lo: 'Laosiano',
  lt: 'Lituano', lv: 'Letão', mg: 'Malgaxe', mi: 'Maori', mk: 'Macedônio',
  mn: 'Mongol', ms: 'Malaio', mt: 'Maltês', my: 'Birmanês', ne: 'Nepalês',
  nl: 'Neerlandês', no: 'Norueguês', pl: 'Polonês', ps: 'Pashto', pt: 'Português',
  ro: 'Romeno', ru: 'Russo', rw: 'Quiniaruanda', si: 'Cingalês', sk: 'Eslovaco',
  sl: 'Esloveno', sm: 'Samoano', sn: 'Shona', so: 'Somali', sq: 'Albanês',
  sr: 'Sérvio', ss: 'Suázi', st: 'Sesotho', sv: 'Sueco', sw: 'Suaíli',
  ta: 'Tâmil', tg: 'Tadjique', th: 'Tailandês', ti: 'Tigrínia', tk: 'Turcomeno',
  tl: 'Filipino', tn: 'Tswana', to: 'Tonganês', tr: 'Turco', uk: 'Ucraniano',
  ur: 'Urdu', uz: 'Uzbeque', vi: 'Vietnamita', zh: 'Chinês', zu: 'Zulu',
};

/* ------------------------------ nomes de país ----------------------------- */

/**
 * Nomes de país → alpha-2, para quando só houver o nome.
 *
 * A viagem guarda `countryCode`, então este caminho é o de recuperação: uma
 * viagem antiga sem código, ou um geocoder que devolveu só o nome. Cobre as
 * grafias em português e em inglês dos destinos que aparecem no aplicativo —
 * "Rússia", "Russia", "Russia" sem acento — porque é isso que chega escrito.
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

/* -------------------------------- acessores ------------------------------- */

export interface CountryMetadata {
  /** ISO 3166-1 alpha-2, sempre em caixa alta. */
  readonly code: string;
  /** ISO 639-1, em ordem de relevância. Nunca vazio. */
  readonly languages: readonly string[];
  /** O primeiro de `languages` — o que responde "em que língua eu falo aqui". */
  readonly primaryLanguage: string;
  /** ISO 4217, ou `undefined` quando o país não está na tabela de moeda. */
  readonly currencyCode?: string;
}

/**
 * Do que a viagem guarda para o alpha-2 canônico.
 *
 * Duas entradas porque as viagens antigas nem sempre têm código: o `countryCode`
 * é o caminho normal, e o nome é a recuperação. O nome sozinho **não** vira
 * código gravado em lugar nenhum (§44) — serve só para a leitura desta tela.
 */
export function resolveCountryCode(
  countryCode: string | undefined | null,
  countryName?: string | null,
): string | undefined {
  const code = countryCode?.trim().toUpperCase();
  // Conhecido é o que a base reconhece. Um "código" de três letras vindo de um
  // geocoder confuso não passa a valer só por estar preenchido.
  if (code && (COUNTRY_TO_CURRENCY[code] || COUNTRY_TO_LANGUAGES[code])) return code;

  if (countryName) {
    const alpha2 = COUNTRY_NAME_TO_CODE[fold(countryName)];
    if (alpha2) return alpha2;
  }

  return undefined;
}

/**
 * Os metadados do país, ou `undefined` quando ele não é reconhecido.
 *
 * `undefined` — e não um objeto com campos vazios — porque quem chama precisa
 * decidir o que fazer com a ausência, e um objeto meio preenchido faria a tela
 * mostrar um rótulo "Idioma" sem idioma nenhum (§43).
 */
export function countryMetadata(
  countryCode: string | undefined | null,
  countryName?: string | null,
): CountryMetadata | undefined {
  const code = resolveCountryCode(countryCode, countryName);
  if (!code) return undefined;

  const languages = COUNTRY_TO_LANGUAGES[code];
  if (!languages || languages.length === 0) return undefined;

  return {
    code,
    languages,
    primaryLanguage: languages[0],
    currencyCode: COUNTRY_TO_CURRENCY[code],
  };
}

/** A moeda do país, direto do registro central. */
export function currencyForCountryCode(
  countryCode: string | undefined | null,
  countryName?: string | null,
): string | undefined {
  const code = resolveCountryCode(countryCode, countryName);
  return code ? COUNTRY_TO_CURRENCY[code] : undefined;
}

/** O nome do idioma em português, ou `undefined` se não soubermos escrevê-lo. */
export function languageName(language: string): string | undefined {
  return LANGUAGE_NAME_PT[languageFamily(language)];
}

/* -------------------------- comparação de idiomas ------------------------- */

/**
 * A família linguística de uma etiqueta BCP 47 (§12).
 *
 * `pt-BR`, `pt-PT` e `pt` são a mesma família; `en-US` e `en-GB` também. A
 * regra de esconder o idioma compara famílias, e não etiquetas completas, porque
 * a pergunta que ela responde — "eu vou me virar falando o que eu já falo?" — é
 * respondida pela língua, não pela variante regional. Mostrar "Idioma: Português"
 * a um brasileiro que vai a Portugal seria ruído.
 */
export function languageFamily(tag: string): string {
  return tag.trim().toLowerCase().split(/[-_]/)[0];
}

export function sameLanguageFamily(a: string, b: string): boolean {
  return languageFamily(a) === languageFamily(b);
}

/**
 * Quais idiomas do destino vale mostrar a quem fala `userLanguage`.
 *
 * A REGRA, EM UMA FRASE: mostra-se o que a pessoa **não** já fala.
 *
 * Monolíngue que coincide (usuário pt, destino BR ou PT) → lista vazia, e a
 * tela não desenha nada. A informação existiria, mas não acrescentaria: quem
 * fala português não precisa ser avisado de que em Portugal se fala português.
 *
 * Multilíngue com coincidência parcial (§13) → os outros continuam aparecendo.
 * Um brasileiro no Luxemburgo (fr, de, lb) que fale francês ainda ganha em saber
 * que há alemão e luxemburguês; esconder a lista inteira porque um item bateu
 * apagaria justamente a parte útil. O critério é por idioma, não por país.
 *
 * Sem `userLanguage` conhecido, mostra tudo: é melhor informar demais do que
 * esconder por causa de um locale que não foi possível ler.
 */
export function destinationLanguagesToShow(
  metadata: CountryMetadata | undefined,
  userLanguage: string | undefined,
): string[] {
  if (!metadata) return [];

  const user = userLanguage ? languageFamily(userLanguage) : undefined;

  return metadata.languages
    .filter((language) => !user || languageFamily(language) !== user)
    // Um idioma que não sabemos nomear não vira código cru na tela.
    .filter((language) => Boolean(languageName(language)));
}

/**
 * O rótulo pronto para a tela — "Japonês", "Inglês e Francês" —, ou `undefined`
 * quando não há nada a dizer.
 *
 * A conjunção é "e", e não vírgula em todos, porque a lista tem dois ou três
 * itens no pior caso e "Neerlandês, Francês e Alemão" lê como frase.
 */
export function formatLanguageList(languages: readonly string[]): string | undefined {
  const names = languages
    .map((language) => languageName(language))
    .filter((name): name is string => Boolean(name));

  if (names.length === 0) return undefined;
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
}

/**
 * Todas as moedas que algum país do registro usa.
 *
 * Existe para `isKnownCurrency` não precisar de lista própria: a resposta é
 * literalmente a imagem de `country → currency`, e mantê-la derivada evita que
 * uma moeda entre no registro sem passar a ser reconhecida.
 *
 * Calculado uma vez. A tabela é constante em tempo de execução.
 */
let currencyCodeCache: Set<string> | undefined;

export function knownCurrencyCodes(): ReadonlySet<string> {
  currencyCodeCache ??= new Set(Object.values(COUNTRY_TO_CURRENCY));
  return currencyCodeCache;
}
