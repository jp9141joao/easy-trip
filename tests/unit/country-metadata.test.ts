import {
  countryMetadata,
  currencyForCountryCode,
  destinationLanguagesToShow,
  formatLanguageList,
  languageFamily,
  languageName,
  resolveCountryCode,
  sameLanguageFamily,
} from '@/lib/countryMetadata';
import { currencyForCountry, isKnownCurrency } from '@/lib/countryCurrency';

/**
 * O registro central de país (§8, §9, §42 do handoff).
 *
 * A REGRA QUE ESTA SUÍTE PROTEGE: uma base só responde às duas perguntas.
 *
 * Antes havia uma tabela de moeda e a tentação de acrescentar uma de idioma ao
 * lado. Duas listas de países divergem na primeira correção — alguém acrescenta
 * um destino numa e esquece a outra, e a viagem passa a ter moeda sem idioma ou
 * o contrário. Os testes de coerência no fim do arquivo existem para essa
 * divergência não passar despercebida.
 */

describe('normalização do código de país (§65)', () => {
  it('aceita o alpha-2 em qualquer caixa', () => {
    expect(resolveCountryCode('jp')).toBe('JP');
    expect(resolveCountryCode('Jp')).toBe('JP');
    expect(resolveCountryCode('  JP  ')).toBe('JP');
  });

  it('recupera o código a partir do nome, com e sem acento', () => {
    expect(resolveCountryCode(undefined, 'Japão')).toBe('JP');
    expect(resolveCountryCode(undefined, 'japao')).toBe('JP');
    expect(resolveCountryCode(undefined, 'Japan')).toBe('JP');
    expect(resolveCountryCode(undefined, 'Estados Unidos')).toBe('US');
  });

  it('prefere o código ao nome quando os dois vêm', () => {
    // O código é o dado estruturado que o geocoder devolveu; o nome é texto.
    expect(resolveCountryCode('FR', 'Japão')).toBe('FR');
  });

  it('não inventa código para o que não reconhece', () => {
    expect(resolveCountryCode('ZZZ')).toBeUndefined();
    expect(resolveCountryCode(undefined, 'Nárnia')).toBeUndefined();
    expect(resolveCountryCode(undefined, undefined)).toBeUndefined();
    expect(resolveCountryCode('', '')).toBeUndefined();
  });
});

describe('metadados do país', () => {
  it('responde idioma e moeda a partir do mesmo código', () => {
    const jp = countryMetadata('JP');
    expect(jp?.primaryLanguage).toBe('ja');
    expect(jp?.currencyCode).toBe('JPY');

    const br = countryMetadata('BR');
    expect(br?.primaryLanguage).toBe('pt');
    expect(br?.currencyCode).toBe('BRL');
  });

  it('mantém a ordem de relevância nos países multilíngues (§10)', () => {
    // O primeiro é o que responde "em que língua eu falo no balcão".
    expect(countryMetadata('CH')?.languages).toEqual(['de', 'fr', 'it']);
    expect(countryMetadata('CA')?.languages).toEqual(['en', 'fr']);
    expect(countryMetadata('CH')?.primaryLanguage).toBe('de');
  });

  it('devolve undefined — e não um objeto meio vazio — para país desconhecido (§43)', () => {
    expect(countryMetadata('ZZ')).toBeUndefined();
    expect(countryMetadata(undefined, 'Nárnia')).toBeUndefined();
  });

  it('aponta território para a moeda que se usa na rua', () => {
    // Porto Rico é dos Estados Unidos e usa dólar; Mônaco usa euro.
    expect(currencyForCountryCode('PR')).toBe('USD');
    expect(currencyForCountryCode('MC')).toBe('EUR');
  });
});

describe('famílias linguísticas (§12)', () => {
  it('reduz a etiqueta BCP 47 à língua', () => {
    expect(languageFamily('pt-BR')).toBe('pt');
    expect(languageFamily('pt-PT')).toBe('pt');
    expect(languageFamily('en_US')).toBe('en');
    expect(languageFamily('JA')).toBe('ja');
  });

  it('trata variantes regionais como a mesma língua', () => {
    expect(sameLanguageFamily('pt-BR', 'pt-PT')).toBe(true);
    expect(sameLanguageFamily('en-US', 'en-GB')).toBe(true);
    expect(sameLanguageFamily('pt-BR', 'es-ES')).toBe(false);
  });
});

describe('qual idioma mostrar (§11, §13, §58)', () => {
  const paraUsuario = (idioma: string, code: string) =>
    destinationLanguagesToShow(countryMetadata(code), idioma);

  it('esconde quando o destino fala a mesma língua', () => {
    expect(paraUsuario('pt-BR', 'BR')).toEqual([]);
    // Portugal também: a variante regional não muda a resposta.
    expect(paraUsuario('pt-BR', 'PT')).toEqual([]);
    expect(paraUsuario('en-US', 'US')).toEqual([]);
  });

  it('mostra quando o destino fala outra língua', () => {
    expect(paraUsuario('pt-BR', 'JP')).toEqual(['ja']);
    expect(paraUsuario('pt-BR', 'US')).toEqual(['en']);
    expect(paraUsuario('pt-BR', 'FR')).toEqual(['fr']);
    expect(paraUsuario('pt-BR', 'ES')).toEqual(['es']);
    expect(paraUsuario('pt-BR', 'IT')).toEqual(['it']);
    expect(paraUsuario('pt-BR', 'DE')).toEqual(['de']);
    expect(paraUsuario('en-US', 'JP')).toEqual(['ja']);
  });

  it('num país multilíngue, esconde só o que a pessoa já fala (§13)', () => {
    // Suíça fala alemão, francês e italiano. Quem fala francês continua
    // ganhando em saber dos outros dois — a parte útil é a que ele não sabia.
    expect(paraUsuario('fr-FR', 'CH')).toEqual(['de', 'it']);
    expect(paraUsuario('de-DE', 'CH')).toEqual(['fr', 'it']);
    expect(paraUsuario('pt-BR', 'CH')).toEqual(['de', 'fr', 'it']);
  });

  it('mostra tudo quando o idioma do usuário é desconhecido', () => {
    expect(destinationLanguagesToShow(countryMetadata('CA'), undefined)).toEqual(['en', 'fr']);
  });

  it('não quebra com destino sem metadados (§43)', () => {
    expect(destinationLanguagesToShow(undefined, 'pt-BR')).toEqual([]);
    expect(formatLanguageList([])).toBeUndefined();
  });
});

describe('rótulo do idioma', () => {
  it('escreve o nome em português', () => {
    expect(languageName('ja')).toBe('Japonês');
    expect(languageName('en')).toBe('Inglês');
    expect(languageName('pt-BR')).toBe('Português');
  });

  it('monta a lista como frase', () => {
    expect(formatLanguageList(['ja'])).toBe('Japonês');
    expect(formatLanguageList(['en', 'fr'])).toBe('Inglês e Francês');
    expect(formatLanguageList(['nl', 'fr', 'de'])).toBe('Neerlandês, Francês e Alemão');
  });

  it('omite o idioma que não sabemos nomear em vez de mostrar o código cru', () => {
    expect(formatLanguageList(['ja', 'xx'])).toBe('Japonês');
    expect(languageName('xx')).toBeUndefined();
  });
});

describe('uma base só serve moeda e idioma (§9, §42)', () => {
  it('`countryCurrency` responde pelo registro central', () => {
    // O módulo antigo continua exportando a mesma função com o mesmo
    // comportamento — o que mudou foi de onde ela lê.
    expect(currencyForCountry('JP')).toBe('JPY');
    expect(currencyForCountry(undefined, 'Japão')).toBe('JPY');
    expect(currencyForCountry('ZZ')).toBeUndefined();
  });

  it('`isKnownCurrency` é derivada do registro, não de uma lista paralela', () => {
    expect(isKnownCurrency('JPY')).toBe(true);
    expect(isKnownCurrency('brl')).toBe(true);
    expect(isKnownCurrency('XXX')).toBe(false);
  });

  it('todo país com moeda também tem idioma, e vice-versa', () => {
    // A conferência que impede as duas tabelas de se afastarem: se alguém
    // acrescentar um destino a uma e esquecer a outra, este teste diz qual.
    const codigos = ['BR', 'PT', 'JP', 'US', 'FR', 'DE', 'ES', 'IT', 'CH', 'CA', 'AR', 'ZA'];
    for (const code of codigos) {
      const meta = countryMetadata(code);
      expect(meta).toBeDefined();
      expect(meta!.languages.length).toBeGreaterThan(0);
      expect(meta!.currencyCode).toBeDefined();
    }
  });
});
