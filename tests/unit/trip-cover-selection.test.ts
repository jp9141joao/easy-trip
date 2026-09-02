import { IMAGES } from '@/data/images';
import { selectTripCover, suggestTripCover } from '@/domain/coverSelection';
import { tripCoverUri } from '@/domain/tripCover';

/**
 * A CAPA QUE MENTIA SOBRE O DESTINO.
 *
 * A escolha anterior recebia UMA string — o nome da cidade — e devolvia uma foto
 * de litoral europeu para tudo o que não estivesse numa tabela de treze nomes.
 * São Paulo caía ali. A pessoa criava a viagem e via uma cidade que não era a
 * dela, apresentada com a mesma naturalidade com que Paris via Paris.
 *
 * O que esta suíte protege é a regra que substituiu aquilo: imagem de cidade só
 * com cidade E país confirmados; qualquer dúvida desce para uma cena de viagem,
 * que não afirma lugar nenhum e por isso não pode estar errada.
 */

/** Toda foto que AFIRMA um lugar. Nenhuma delas pode sair de um caminho duvidoso. */
const FOTOS_DE_LUGAR = [
  IMAGES.paris,
  IMAGES.kyoto,
  IMAGES.rome,
  IMAGES.newYork,
  IMAGES.tokyo,
  IMAGES.lisbon,
  IMAGES.santorini,
  IMAGES.barcelona,
  IMAGES.alps,
  IMAGES.coast,
];

describe('cidade e país confirmados — o único caminho que dá foto de cidade', () => {
  it('Paris, França', () => {
    const escolha = selectTripCover({ city: 'Paris', country: 'França', countryCode: 'FR' });
    expect(escolha).toMatchObject({ url: IMAGES.paris, confidence: 'high', tier: 'city' });
  });

  it.each([
    ['Tóquio', 'toquio'],
    ['Tokyo', 'tokyo'],
    ['Tokio', 'tokio'],
  ])('%s, Japão resolve para a mesma foto', (city) => {
    expect(selectTripCover({ city, countryCode: 'JP' })).toMatchObject({
      url: IMAGES.tokyo,
      confidence: 'high',
    });
  });

  it('o país pode vir só pelo nome — viagem antiga sem alpha-2 gravado', () => {
    expect(selectTripCover({ city: 'Roma', country: 'Itália' })).toMatchObject({
      url: IMAGES.rome,
      confidence: 'high',
    });
  });
});

describe('a contraprova — nome que bate, geografia que não', () => {
  /**
   * O caso que dá nome ao defeito. "Paris" existe no Texas, "Barcelona" existe
   * na Venezuela e "Roma" existe em Queensland. Se o nome bastasse, as três
   * viagens receberiam o cartão-postal do outro hemisfério.
   */
  it.each([
    ['Paris', 'US', IMAGES.paris],
    ['Barcelona', 'VE', IMAGES.barcelona],
    ['Roma', 'AU', IMAGES.rome],
  ])('%s em %s não recebe a foto da cidade homônima', (city, countryCode, recusada) => {
    const escolha = selectTripCover({ city, countryCode });
    expect(escolha.url).not.toBe(recusada);
    expect(escolha.tier).not.toBe('city');
    expect(escolha.reason).toBe('city-known-country-mismatch');
  });

  it('cidade ambígua SEM país nenhum também é recusada', () => {
    // Sem país não há desambiguação possível, e o nome coincidir é justamente o
    // sintoma da ambiguidade — não a prova de que é a cidade certa.
    const escolha = selectTripCover({ city: 'Paris' });
    expect(escolha.url).not.toBe(IMAGES.paris);
    expect(escolha.reason).toBe('city-known-country-missing');
    expect(escolha.confidence).toBe('low');
  });

  it('um país que não existe não confirma cidade nenhuma', () => {
    expect(selectTripCover({ city: 'Paris', countryCode: 'ZZ' }).url).not.toBe(IMAGES.paris);
  });
});

describe('destino sem foto conferida cai em cena de viagem, nunca em outro lugar', () => {
  it.each([
    ['São Paulo', 'BR'],
    ['Sao Paulo', 'BR'],
    ['Franca', 'BR'],
    ['Moscovo', 'RU'],
    ['Moscow', 'RU'],
    ['Bento Gonçalves', 'BR'],
    ['Ittoqqortoormiit', 'GL'],
  ])('%s (%s) não recebe foto de lugar nenhum', (city, countryCode) => {
    const escolha = selectTripCover({ city, countryCode });
    expect(FOTOS_DE_LUGAR).not.toContain(escolha.url);
    expect(escolha.tier).toBe('context');
  });

  it('São Paulo e Sao Paulo são a mesma viagem e ganham a mesma capa', () => {
    expect(suggestTripCover({ city: 'São Paulo', countryCode: 'BR' })).toBe(
      suggestTripCover({ city: 'Sao Paulo', countryCode: 'BR' }),
    );
  });

  it('a mesma capa em toda chamada — a viagem não troca de foto entre renders', () => {
    const destino = { city: 'Franca', admin: 'São Paulo', countryCode: 'BR' };
    const capas = new Set(Array.from({ length: 20 }, () => suggestTripCover(destino)));
    expect(capas.size).toBe(1);
  });

  it('mas nem todo destino desconhecido recebe a MESMA foto', () => {
    const capas = new Set(
      [
        { city: 'São Paulo', countryCode: 'BR' },
        { city: 'Franca', countryCode: 'BR' },
        { city: 'Moscovo', countryCode: 'RU' },
        { city: 'Oslo', countryCode: 'NO' },
        { city: 'Hanói', countryCode: 'VN' },
        { city: 'Nairóbi', countryCode: 'KE' },
      ].map(suggestTripCover),
    );
    expect(capas.size).toBeGreaterThan(1);
  });

  it('cidades homônimas de países diferentes desempatam pelo país', () => {
    // Não é obrigatório que difiram — o hash pode colidir —, mas a identidade
    // que alimenta a escolha precisa incluir o país, senão nunca poderiam.
    expect(selectTripCover({ city: 'Paris', countryCode: 'US' }).reason).toBe(
      'city-known-country-mismatch',
    );
    expect(selectTripCover({ city: 'Springfield', countryCode: 'US' }).reason).toBe(
      'unknown-destination',
    );
  });
});

describe('o destino chega quebrado', () => {
  it('cidade vazia não derruba a criação da viagem', () => {
    const escolha = selectTripCover({ city: '' });
    expect(typeof escolha.url).toBe('string');
    expect(escolha.url.length).toBeGreaterThan(0);
    expect(escolha.tier).toBe('context');
  });

  it('só o nome do país, sem cidade reconhecível, ainda devolve capa', () => {
    expect(suggestTripCover({ city: '   ', country: 'Brasil' })).toBeTruthy();
  });
});

describe('a capa escolhida pela pessoa continua vencendo a automática', () => {
  it('a capa própria vem na frente da sugerida', () => {
    const automatica = suggestTripCover({ city: 'Paris', countryCode: 'FR' });
    expect(
      tripCoverUri({
        coverImageSignedUrl: 'https://storage.example/trip/cover-abc.jpg',
        coverImageUrl: automatica,
      }),
    ).toBe('https://storage.example/trip/cover-abc.jpg');
  });

  it('removida a capa própria, a sugerida reaparece — ela nunca foi apagada', () => {
    const automatica = suggestTripCover({ city: 'Paris', countryCode: 'FR' });
    expect(tripCoverUri({ coverImageUrl: automatica })).toBe(automatica);
  });
});
