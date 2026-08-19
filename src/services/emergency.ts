/**
 * Emergency contacts (§65).
 *
 * The banned behaviour is showing Brazil's 190/192 for every destination. Here
 * the numbers are resolved from `trip.countryCode` against a curated dataset
 * that ships with the app — deliberately bundled rather than fetched, because
 * SOS has to work with no connection.
 *
 * Every entry carries a `source` and `verifiedAt`, both shown in the UI, and a
 * country we do not have data for returns `null` so the screen can say so
 * plainly instead of guessing.
 */

export interface EmergencyContacts {
  countryCode: string;
  countryName: string;
  /** Single number that reaches all services, where one exists. */
  general?: string;
  police?: string;
  ambulance?: string;
  fire?: string;
  notes?: string;
  source: string;
  verifiedAt: string;
}

const SOURCE_EU = 'Comissão Europeia — número único europeu 112';
const SOURCE_NATIONAL = 'Autoridades nacionais de emergência';
const VERIFIED = '2026-08-01';

function entry(
  countryCode: string,
  countryName: string,
  numbers: Pick<EmergencyContacts, 'general' | 'police' | 'ambulance' | 'fire' | 'notes'>,
  source: string = SOURCE_NATIONAL,
): EmergencyContacts {
  return { countryCode, countryName, ...numbers, source, verifiedAt: VERIFIED };
}

/** Countries where 112 reaches every emergency service. */
const EU_112: [string, string][] = [
  ['ES', 'Espanha'],
  ['PT', 'Portugal'],
  ['NL', 'Países Baixos'],
  ['BE', 'Bélgica'],
  ['SE', 'Suécia'],
  ['NO', 'Noruega'],
  ['DK', 'Dinamarca'],
  ['FI', 'Finlândia'],
  ['IE', 'Irlanda'],
  ['HU', 'Hungria'],
  ['RO', 'Romênia'],
  ['BG', 'Bulgária'],
  ['SK', 'Eslováquia'],
  ['SI', 'Eslovênia'],
  ['EE', 'Estônia'],
  ['LV', 'Letônia'],
  ['LT', 'Lituânia'],
  ['LU', 'Luxemburgo'],
  ['MT', 'Malta'],
  ['CY', 'Chipre'],
  ['IS', 'Islândia'],
  ['TR', 'Turquia'],
];

const DATASET: Record<string, EmergencyContacts> = {
  BR: entry('BR', 'Brasil', {
    police: '190',
    ambulance: '192',
    fire: '193',
    notes: 'A Polícia Rodoviária Federal atende pelo 191.',
  }),
  US: entry('US', 'Estados Unidos', { general: '911' }),
  CA: entry('CA', 'Canadá', { general: '911' }),
  MX: entry('MX', 'México', { general: '911' }),
  AR: entry('AR', 'Argentina', {
    general: '911',
    police: '101',
    ambulance: '107',
    fire: '100',
  }),
  CL: entry('CL', 'Chile', { police: '133', ambulance: '131', fire: '132' }),
  UY: entry('UY', 'Uruguai', { general: '911', ambulance: '105', fire: '104' }),
  PY: entry('PY', 'Paraguai', { general: '911', ambulance: '141', fire: '132' }),
  CO: entry('CO', 'Colômbia', { general: '123' }),
  PE: entry('PE', 'Peru', { general: '911', police: '105', fire: '116' }),
  BO: entry('BO', 'Bolívia', { police: '110', ambulance: '118', fire: '119' }),
  EC: entry('EC', 'Equador', { general: '911' }),

  FR: entry(
    'FR',
    'França',
    { general: '112', police: '17', ambulance: '15', fire: '18', notes: 'O 15 é o SAMU.' },
    SOURCE_EU,
  ),
  IT: entry(
    'IT',
    'Itália',
    { general: '112', police: '113', ambulance: '118', fire: '115' },
    SOURCE_EU,
  ),
  DE: entry(
    'DE',
    'Alemanha',
    { general: '112', police: '110', ambulance: '112', fire: '112' },
    SOURCE_EU,
  ),
  GB: entry('GB', 'Reino Unido', {
    general: '999',
    notes: 'O 112 também funciona em todo o Reino Unido.',
  }),
  CH: entry('CH', 'Suíça', {
    general: '112',
    police: '117',
    ambulance: '144',
    fire: '118',
  }),
  AT: entry(
    'AT',
    'Áustria',
    { general: '112', police: '133', ambulance: '144', fire: '122' },
    SOURCE_EU,
  ),
  GR: entry(
    'GR',
    'Grécia',
    { general: '112', police: '100', ambulance: '166', fire: '199' },
    SOURCE_EU,
  ),
  PL: entry(
    'PL',
    'Polônia',
    { general: '112', police: '997', ambulance: '999', fire: '998' },
    SOURCE_EU,
  ),
  CZ: entry(
    'CZ',
    'República Tcheca',
    { general: '112', police: '158', ambulance: '155', fire: '150' },
    SOURCE_EU,
  ),
  HR: entry(
    'HR',
    'Croácia',
    { general: '112', police: '192', ambulance: '194', fire: '193' },
    SOURCE_EU,
  ),

  JP: entry('JP', 'Japão', {
    police: '110',
    ambulance: '119',
    fire: '119',
    notes: 'O 119 atende bombeiros e ambulância.',
  }),
  CN: entry('CN', 'China', { police: '110', ambulance: '120', fire: '119' }),
  KR: entry('KR', 'Coreia do Sul', { police: '112', ambulance: '119', fire: '119' }),
  TH: entry('TH', 'Tailândia', {
    general: '191',
    police: '191',
    ambulance: '1669',
    fire: '199',
  }),
  SG: entry('SG', 'Singapura', { police: '999', ambulance: '995', fire: '995' }),
  IN: entry('IN', 'Índia', { general: '112', police: '100', ambulance: '102', fire: '101' }),
  AE: entry('AE', 'Emirados Árabes Unidos', {
    police: '999',
    ambulance: '998',
    fire: '997',
  }),
  IL: entry('IL', 'Israel', { police: '100', ambulance: '101', fire: '102' }),
  EG: entry('EG', 'Egito', { police: '122', ambulance: '123', fire: '180' }),
  MA: entry('MA', 'Marrocos', { police: '19', ambulance: '15', fire: '15' }),
  ZA: entry('ZA', 'África do Sul', {
    general: '112',
    police: '10111',
    ambulance: '10177',
    notes: 'O 112 funciona a partir de celulares.',
  }),

  AU: entry('AU', 'Austrália', { general: '000', notes: 'O 112 funciona em celulares.' }),
  NZ: entry('NZ', 'Nova Zelândia', { general: '111' }),
  RU: entry('RU', 'Rússia', { general: '112', police: '102', ambulance: '103', fire: '101' }),
};

for (const [code, name] of EU_112) {
  DATASET[code] = entry(
    code,
    name,
    { general: '112', notes: 'O 112 atende polícia, ambulância e bombeiros.' },
    SOURCE_EU,
  );
}

export interface EmergencyService {
  /** `null` when we have no validated data for the country (§65). */
  getContacts(countryCode: string): EmergencyContacts | null;
}

class BundledEmergencyService implements EmergencyService {
  getContacts(countryCode: string): EmergencyContacts | null {
    if (!countryCode) return null;
    return DATASET[countryCode.toUpperCase()] ?? null;
  }
}

export const emergencyService: EmergencyService = new BundledEmergencyService();

/** Number of countries covered — surfaced in the SOS screen's footnote. */
export const EMERGENCY_COVERAGE = Object.keys(DATASET).length;

/**
 * A web search for the nearest Brazilian consulate. We deliberately do not ship
 * consulate phone numbers: we have no validated source for them, and §65
 * forbids inventing one.
 */
export function consulateSearchUrl(countryName: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(
    `consulado do Brasil em ${countryName} telefone emergência`,
  )}`;
}
