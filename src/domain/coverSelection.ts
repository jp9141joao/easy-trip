/**
 * A escolha da capa AUTOMÁTICA de uma viagem.
 *
 * ONDE ESTE MÓDULO ENTRA
 *
 * `tripCover.ts` responde "qual capa a tela desenha" — capa própria primeiro,
 * sugerida depois. Este módulo responde a pergunta anterior: **qual é a
 * sugerida**, dado um destino recém-resolvido pelo geocoder. Os dois são
 * separados porque a prioridade (§3) não muda nunca, e a política de escolha,
 * sim: acrescentar um provedor de imagem amanhã mexe aqui e em mais nada.
 *
 * O DEFEITO QUE ELE CORRIGE
 *
 * A versão anterior era `suggestCoverImage(city)`: uma tabela de treze nomes de
 * cidade, indexada SÓ pelo nome, com uma foto de litoral como padrão de tudo o
 * que não estivesse na tabela. Dois erros diferentes moravam nisso.
 *
 *   1. O nome sozinho não identifica lugar nenhum. "Paris" é Paris e é Paris,
 *      Texas; "Barcelona" é a catalã e é a venezuelana; "Roma" é a italiana e é
 *      Roma, Queensland. A viagem já nasce com `countryCode` vindo do geocoder
 *      — o dado estava na mão de quem chamava e era jogado fora no parâmetro.
 *   2. O padrão era uma FOTO ESPECÍFICA de um lugar específico. Toda cidade
 *      fora da tabela — São Paulo inclusive — recebia a mesma paisagem
 *      litorânea europeia, apresentada como se fosse o destino. Não era um
 *      fallback: era um palpite errado com cara de acerto.
 *
 * A REGRA CENTRAL
 *
 * É melhor uma capa genérica e coerente do que uma capa específica e
 * geograficamente errada. Uma foto de mapa, mala ou passaporte não afirma nada
 * sobre o destino e nunca desmente a viagem; uma foto de Munique numa viagem a
 * São Paulo desmente. Por isso a imagem de cidade só é usada com confiança
 * ALTA, e o degrau de baixo não é outro lugar — é uma cena de viagem sem
 * afirmação geográfica.
 *
 * O QUE ESTE MÓDULO NÃO FAZ
 *
 * Não vai à rede e não sorteia. A capa é gravada uma vez, na criação, em
 * `coverImageUrl`, e é lida em toda abertura da viagem: um resultado que
 * dependesse de rede faria a criação falhar com o provedor fora do ar, e um que
 * dependesse de `Math.random` daria uma capa diferente a cada render. A escolha
 * é uma função pura do destino — mesma viagem, mesma capa, para sempre.
 */

import { IMAGES } from '@/data/images';
import { fold, resolveCountryCode } from '@/lib/countryMetadata';

/**
 * O quanto se sabe que a imagem é mesmo daquele lugar.
 *
 * `high`  — cidade E país confirmados contra o catálogo.
 * `medium`— o país foi confirmado, a cidade não. A imagem é do país, não da
 *           cidade, e não finge ser.
 * `low`   — não há confirmação suficiente para afirmar lugar nenhum. A imagem
 *           escolhida também não afirma.
 */
export type CoverConfidence = 'high' | 'medium' | 'low';

/** Em que degrau da cadeia de fallback a escolha parou. */
export type CoverTier = 'city' | 'country' | 'context';

export interface CoverChoice {
  url: string;
  confidence: CoverConfidence;
  tier: CoverTier;
  /** Por que este degrau — o que a suíte de teste afirma, em uma palavra. */
  reason:
    | 'city-and-country-confirmed'
    | 'country-confirmed-city-unknown'
    | 'city-known-country-missing'
    | 'city-known-country-mismatch'
    | 'unknown-destination';
}

/**
 * O que a decisão precisa saber. É um subconjunto exato do que
 * `DestinationSuggestion` (geocoding) e `Trip` já carregam — nada de novo
 * precisa ser coletado da pessoa.
 */
export interface CoverDestination {
  city: string;
  country?: string;
  countryCode?: string;
  /** Estado/província (`admin1` do geocoder). Entra só na desempate estável. */
  admin?: string;
}

/* ----------------------------- catálogo de cidade -------------------------- */

interface CityCover {
  /**
   * Os nomes pelos quais a cidade chega. `fold` já resolve acento e caixa —
   * "São Paulo" e "Sao Paulo" são a mesma chave sem precisar de entrada. O que
   * entra aqui é só o exônimo de verdade, o nome que muda de LETRAS entre
   * idiomas: Tóquio/Tokyo, Moscovo/Moscow, Quioto/Kyoto.
   *
   * Não é, e não deve virar, uma tabela de tradução: só existe linha para
   * cidade de que temos foto conferida. Uma lista de mil exônimos sem foto
   * atrás não melhoraria escolha nenhuma.
   */
  readonly names: readonly string[];
  /** ISO 3166-1 alpha-2. É ele que separa Paris da França de Paris do Texas. */
  readonly countryCode: string;
  readonly image: string;
}

const CITY_COVERS: readonly CityCover[] = [
  { names: ['paris'], countryCode: 'FR', image: IMAGES.paris },
  { names: ['kyoto', 'quioto'], countryCode: 'JP', image: IMAGES.kyoto },
  { names: ['tokyo', 'toquio', 'tokio'], countryCode: 'JP', image: IMAGES.tokyo },
  { names: ['roma', 'rome'], countryCode: 'IT', image: IMAGES.rome },
  {
    names: ['new york', 'new york city', 'nova york', 'nova iorque'],
    countryCode: 'US',
    image: IMAGES.newYork,
  },
  { names: ['lisboa', 'lisbon'], countryCode: 'PT', image: IMAGES.lisbon },
  { names: ['santorini', 'thira', 'fira'], countryCode: 'GR', image: IMAGES.santorini },
  { names: ['barcelona'], countryCode: 'ES', image: IMAGES.barcelona },
];

/* ------------------------------ capa de país ------------------------------- */

/**
 * Degrau intermediário: uma imagem que representa o PAÍS, para a cidade que não
 * está no catálogo mas cujo país está confirmado.
 *
 * A tabela está vazia de propósito, e isso é uma decisão, não um esquecimento.
 * Preenchê-la exige foto conferida por gente — alguém olhou e sabe que aquilo é
 * o Brasil. Enfiar aqui uma URL escolhida pelo nome do arquivo recriaria
 * exatamente o defeito que este módulo existe para corrigir, um degrau abaixo:
 * uma foto específica apresentada como o país da pessoa, sem ninguém ter
 * conferido. Enquanto não houver curadoria, a viagem cai no degrau de contexto,
 * que não erra porque não afirma.
 *
 * Acrescentar país aqui depois é mudança de DADO: nenhuma linha de lógica muda,
 * e a suíte de teste já cobre o degrau.
 */
const COUNTRY_COVERS: Readonly<Record<string, string>> = {};

/* ---------------------------- capa de contexto ----------------------------- */

/**
 * O degrau que nunca erra, porque não afirma lugar.
 *
 * Cenas de viagem — mapa, mala, passaporte, asa de avião. Servem a Franca, a
 * uma vila no interior da Noruega e a um destino que o geocoder mal reconheceu,
 * porque são verdadeiras sobre a viagem em vez de serem um palpite sobre o
 * lugar. Litoral e montanha ficaram DE FORA: são afirmações geográficas
 * disfarçadas de genérico, e uma delas está errada para toda cidade de
 * interior.
 */
const CONTEXT_COVERS: readonly string[] = [
  IMAGES.mapPlanning,
  IMAGES.luggage,
  IMAGES.passport,
  IMAGES.airplaneWing,
];

/**
 * Hash estável do destino — FNV-1a, 32 bits.
 *
 * Existe para o degrau de contexto não dar a MESMA foto a todo destino
 * desconhecido, sem introduzir sorteio: a escolha é uma função do destino, então
 * duas viagens diferentes tendem a capas diferentes e a mesma viagem recebe
 * sempre a mesma. Não é hash criptográfico e não precisa ser — o pior caso de
 * uma colisão é duas cidades com a mesma foto de mala.
 */
function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * A identidade geográfica canônica, em texto — a chave do desempate estável.
 *
 * País primeiro, depois estado, depois cidade: é a ordem que faz duas cidades
 * homônimas de países diferentes caírem em capas diferentes.
 */
function identityOf(destination: CoverDestination, countryCode: string | undefined): string {
  return [countryCode ?? '', fold(destination.admin ?? ''), fold(destination.city)].join('|');
}

function contextCover(destination: CoverDestination, countryCode: string | undefined): string {
  const index = stableHash(identityOf(destination, countryCode)) % CONTEXT_COVERS.length;
  return CONTEXT_COVERS[index];
}

/* --------------------------------- decisão --------------------------------- */

/**
 * A capa automática do destino, com o porquê junto.
 *
 * A ORDEM DAS PERGUNTAS É A REGRA:
 *
 *  1. O país é reconhecível? `resolveCountryCode` aceita o alpha-2 do geocoder
 *     e, para viagens antigas que só têm o nome, recupera o código a partir
 *     dele. Sem país não existe desambiguação possível — e a partir daqui a
 *     cidade sozinha não vale como prova.
 *  2. A cidade está no catálogo E o país bate? Só então a foto da cidade sai.
 *     Este é o único caminho `high`, e é o único que produz Torre Eiffel.
 *  3. A cidade está no catálogo mas o país NÃO bate (Paris/US) ou não veio?
 *     A foto da cidade é RECUSADA. O nome coincidir é justamente o sintoma da
 *     ambiguidade, não a solução dela.
 *  4. O país está confirmado e tem capa curada? Imagem do país, `medium`.
 *  5. Nada disso? Cena de viagem, escolhida pelo hash do destino, `low`.
 */
export function selectTripCover(destination: CoverDestination): CoverChoice {
  const countryCode = resolveCountryCode(destination.countryCode, destination.country);
  const city = fold(destination.city);
  const entry = city ? CITY_COVERS.find((candidate) => candidate.names.includes(city)) : undefined;

  if (entry) {
    if (countryCode === entry.countryCode) {
      return {
        url: entry.image,
        confidence: 'high',
        tier: 'city',
        reason: 'city-and-country-confirmed',
      };
    }

    // A cidade foi reconhecida pelo nome e recusada pela geografia. As duas
    // recusas são registradas separadamente porque significam coisas
    // diferentes: uma é dado faltando, a outra é dado contradizendo.
    const reason = countryCode ? 'city-known-country-mismatch' : 'city-known-country-missing';
    const country = countryCode ? COUNTRY_COVERS[countryCode] : undefined;

    return country
      ? { url: country, confidence: 'medium', tier: 'country', reason }
      : { url: contextCover(destination, countryCode), confidence: 'low', tier: 'context', reason };
  }

  const country = countryCode ? COUNTRY_COVERS[countryCode] : undefined;
  if (country) {
    return {
      url: country,
      confidence: 'medium',
      tier: 'country',
      reason: 'country-confirmed-city-unknown',
    };
  }

  return {
    url: contextCover(destination, countryCode),
    confidence: 'low',
    tier: 'context',
    reason: 'unknown-destination',
  };
}

/**
 * A URL da capa automática, sem o diagnóstico — o que a tela de criação grava.
 *
 * Existe como função separada só para a tela não precisar conhecer `CoverChoice`
 * inteiro; a decisão é a mesma, e os testes exercem a de cima.
 */
export function suggestTripCover(destination: CoverDestination): string {
  return selectTripCover(destination).url;
}
