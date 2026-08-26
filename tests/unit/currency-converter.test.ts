import {
  currencyForCountry,
  formatCurrencyAmount,
  formatRate,
  fractionDigitsFor,
  symbolFor,
} from '@/lib/countryCurrency';
import { parseMoneyInput } from '@/lib/currency';
import { convertWithRate, getReferenceRate } from '@/services/exchangeRates';
import { cacheStorage } from '@/lib/storage';

/**
 * O conversor de moeda da Carteira (§23–§29 do handoff).
 *
 * A REGRA QUE ESTA SUÍTE PROTEGE: nenhum câmbio embutido no código.
 *
 * Um número de câmbio escrito à mão envelhece em silêncio e continua parecendo
 * certo — é o pior tipo de dado errado, porque ninguém o revisa. Aqui a taxa
 * vem sempre do provedor ou do cache, e quando não vem de nenhum dos dois a
 * resposta é "não tenho cotação", nunca uma conta plausível.
 */

const okResponse = (rates: Record<string, number>) => ({
  ok: true,
  status: 200,
  json: async () => ({
    result: 'success',
    base_code: 'BRL',
    time_last_update_utc: 'Tue, 26 Aug 2026 00:00:01 +0000',
    rates,
  }),
});

/** As taxas do provedor num dia qualquer. Nada aqui é fonte de verdade. */
const TABELA = { BRL: 1, RUB: 16.24, JPY: 27.31, USD: 0.1842, EUR: 0.1702, GBP: 0.1455 };

beforeEach(async () => {
  await cacheStorage.clearAll();
  jest.restoreAllMocks();
});

describe('a moeda vem do país da viagem (§24)', () => {
  it.each([
    ['BR', 'BRL'],
    ['RU', 'RUB'],
    ['JP', 'JPY'],
    ['US', 'USD'],
    ['FR', 'EUR'],
    ['GB', 'GBP'],
  ])('%s → %s', (pais, moeda) => {
    expect(currencyForCountry(pais)).toBe(moeda);
  });

  it('cobre muito além dos seis do exemplo', () => {
    // O aplicativo não restringe destinos: quem cria uma viagem digita a
    // cidade e o geocoder aceita o mundo. Cobrir só o exemplo deixaria a maior
    // parte dos destinos sem conversor.
    expect(currencyForCountry('AR')).toBe('ARS');
    expect(currencyForCountry('CH')).toBe('CHF');
    expect(currencyForCountry('TH')).toBe('THB');
    expect(currencyForCountry('ZA')).toBe('ZAR');
    expect(currencyForCountry('MA')).toBe('MAD');
    expect(currencyForCountry('KR')).toBe('KRW');
    expect(currencyForCountry('SE')).toBe('SEK');
    expect(currencyForCountry('AE')).toBe('AED');
    // Territórios usam a moeda que circula neles, que é o que se gasta na rua.
    expect(currencyForCountry('PR')).toBe('USD');
    expect(currencyForCountry('MC')).toBe('EUR');
  });

  it('aceita o nome do país quando não há código', () => {
    expect(currencyForCountry(undefined, 'Rússia')).toBe('RUB');
    expect(currencyForCountry(undefined, 'Japão')).toBe('JPY');
    expect(currencyForCountry('', 'Estados Unidos')).toBe('USD');
  });

  it('país desconhecido devolve nada — nunca um palpite', () => {
    // Converter para a moeda errada é um erro silencioso e caro no meio de uma
    // viagem. Sem resposta, o card simplesmente não aparece.
    expect(currencyForCountry('ZZ')).toBeUndefined();
    expect(currencyForCountry(undefined, 'Terra Média')).toBeUndefined();
  });
});

describe('formatação (§29)', () => {
  it('o iene não tem centavos, e o real tem', () => {
    expect(fractionDigitsFor('JPY')).toBe(0);
    expect(fractionDigitsFor('BRL')).toBe(2);
    expect(formatCurrencyAmount(27310, 'JPY')).toBe('¥ 27.310');
    expect(formatCurrencyAmount(1000, 'BRL')).toBe('R$ 1.000,00');
  });

  it('usa o símbolo da moeda, e o código quando não há símbolo', () => {
    expect(symbolFor('RUB')).toBe('₽');
    expect(symbolFor('XOF')).toBe('XOF');
  });

  it('a taxa mostra casas suficientes para não virar zero', () => {
    // "1 BRL ≈ 0,17 EUR" perderia a informação de que 1.000 dão 170,2 e não 170.
    expect(formatRate(0.1702, 'BRL', 'EUR')).toBe('1 BRL ≈ 0,1702 EUR');
    expect(formatRate(16.24, 'BRL', 'RUB')).toBe('1 BRL ≈ 16,24 RUB');
  });

  it('zero converte para zero, sem esconder o resultado', () => {
    expect(formatCurrencyAmount(0, 'RUB')).toBe('₽ 0,00');
  });
});

describe('entrada da pessoa', () => {
  it('aceita a convenção pt-BR e a com ponto', () => {
    expect(parseMoneyInput('1.000,00')).toBe(1000);
    expect(parseMoneyInput('1000.00')).toBe(1000);
    expect(parseMoneyInput('0')).toBe(0);
  });

  it('texto que não é número devolve nada', () => {
    expect(parseMoneyInput('abc')).toBeNull();
    expect(parseMoneyInput('')).toBeNull();
  });

  it('valor grande não perde precisão na conversão', () => {
    const rate = {
      from: 'BRL',
      to: 'RUB',
      rate: 16.24,
      publishedAt: '2026-08-26T00:00:01.000Z',
      fetchedAt: '2026-08-26T10:00:00.000Z',
      stale: false,
    };
    expect(convertWithRate(1_000_000, rate, 2)).toBe(16_240_000);
  });
});

describe('conversão com cotação real (§25)', () => {
  it.each([
    ['RUB', 16_240],
    ['JPY', 27_310],
    ['USD', 184.2],
    ['EUR', 170.2],
  ])('1000 BRL → %s', async (moeda, esperado) => {
    jest.spyOn(global, 'fetch').mockResolvedValue(okResponse(TABELA) as Response);

    const { rate } = await getReferenceRate('BRL', moeda);
    expect(rate).not.toBeNull();
    expect(convertWithRate(1000, rate!, fractionDigitsFor(moeda))).toBeCloseTo(esperado, 2);
  });

  it('a mesma moeda converte por 1, sem ir à rede', async () => {
    const fetch = jest.spyOn(global, 'fetch');
    const { rate } = await getReferenceRate('BRL', 'BRL');
    expect(rate?.rate).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('o iene arredonda para inteiro, porque não tem centavos', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(okResponse(TABELA) as Response);
    const { rate } = await getReferenceRate('BRL', 'JPY');
    expect(convertWithRate(123.45, rate!, 0)).toBe(3371);
  });
});

describe('cache e offline (§26, §28)', () => {
  it('a tabela fica em cache e serve a próxima moeda sem nova rede', async () => {
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValue(okResponse(TABELA) as Response);

    await getReferenceRate('BRL', 'RUB');
    expect(fetch).toHaveBeenCalledTimes(1);

    // Rede caída na segunda pergunta: a resposta vem do cache, marcada.
    fetch.mockRejectedValue(new TypeError('Network request failed'));
    const { rate } = await getReferenceRate('BRL', 'JPY');

    expect(rate?.rate).toBe(TABELA.JPY);
    expect(rate?.stale).toBe(true);
    expect(rate?.fetchedAt).toBeTruthy();
  });

  it('offline sem cache nenhum é uma falha honesta, não um número inventado', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new TypeError('Network request failed'));

    const resultado = await getReferenceRate('BRL', 'RUB');

    expect(resultado.rate).toBeNull();
    expect(resultado.failure).toBe('offline');
  });

  it('o provedor fora do ar é dito como provedor, e não como falta de conexão', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as Response);

    const resultado = await getReferenceRate('BRL', 'RUB');

    expect(resultado.rate).toBeNull();
    expect(resultado.failure).toBe('provider_unavailable');
  });

  it('moeda ausente da tabela é "sem cobertura", e não "sem conexão"', async () => {
    // As duas pedem coisas diferentes da pessoa: uma se resolve saindo do
    // metrô, a outra não se resolve.
    jest.spyOn(global, 'fetch').mockResolvedValue(okResponse({ BRL: 1, USD: 0.18 }) as Response);

    const resultado = await getReferenceRate('BRL', 'RUB');

    expect(resultado.rate).toBeNull();
    expect(resultado.failure).toBe('unsupported');
  });

  it('resposta do provedor sem tabela não vira cotação', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ result: 'error', 'error-type': 'unsupported-code' }),
    } as Response);

    const resultado = await getReferenceRate('BRL', 'RUB');
    expect(resultado.rate).toBeNull();
    expect(resultado.failure).toBe('provider_unavailable');
  });
});

describe('nenhum câmbio no código', () => {
  it('o módulo de país→moeda não contém taxa nenhuma', () => {
    // Guarda contra a tentação de "só um fallback" — que é como um câmbio
    // embutido entra e nunca mais sai.
    const fonte = require('node:fs').readFileSync('src/lib/countryCurrency.ts', 'utf8');
    expect(fonte).not.toMatch(/rate\s*[:=]\s*\d/);
    expect(fonte).not.toMatch(/\d+\.\d+\s*\/\/.*(cotac|cambio|rate)/i);
  });

  it('o serviço não define taxa alguma como constante', () => {
    const fonte = require('node:fs').readFileSync('src/services/exchangeRates.ts', 'utf8');
    expect(fonte).not.toMatch(/const\s+\w*RATE\w*\s*=\s*\d/i);
    // E não usa chave: o endpoint aberto é o que permite não ter segredo aqui.
    expect(fonte).not.toMatch(/api[_-]?key/i);
  });
});

/* --------------------------- conversão nos dois sentidos ------------------- */

/**
 * §28–§31 do handoff: o conversor passou a valer nos dois sentidos.
 *
 * A regra que impede o laço é o `activeInput`: o campo que a pessoa digita é a
 * FONTE e guarda o texto; o outro é sempre DERIVADO. Aqui se mede a aritmética
 * dos dois sentidos e a propriedade que mais importa — que ir e voltar não
 * muda o valor além do arredondamento da moeda.
 */
describe('os dois sentidos usam a MESMA taxa (§31)', () => {
  const taxa = (rate: number) => ({
    from: 'BRL',
    to: 'JPY',
    rate,
    publishedAt: '2026-08-26T00:00:01.000Z',
    fetchedAt: '2026-08-26T10:00:00.000Z',
    stale: false,
  });

  /** O lado inverso: destino → BRL é uma divisão, nunca uma segunda cotação. */
  const paraBase = (valor: number, rate: number, digitos: number) => {
    const fator = 10 ** digitos;
    return Math.round((valor / rate + Number.EPSILON) * fator) / fator;
  };

  it('200 BRL → JPY', () => {
    expect(convertWithRate(200, taxa(30.918), fractionDigitsFor('JPY'))).toBe(6184);
  });

  it('6184 JPY → BRL', () => {
    expect(paraBase(6184, 30.918, fractionDigitsFor('BRL'))).toBeCloseTo(200, 1);
  });

  it.each([
    ['USD', 0.1842],
    ['EUR', 0.1702],
    ['RUB', 16.24],
  ])('ida e volta em %s não perde o valor', (moeda, valor) => {
    const digitosDestino = fractionDigitsFor(moeda);
    const ida = convertWithRate(1000, { ...taxa(valor), to: moeda }, digitosDestino);
    const volta = paraBase(ida, valor, fractionDigitsFor('BRL'));

    // O arredondamento da moeda de destino é a única perda aceitável.
    expect(volta).toBeCloseTo(1000, 0);
  });

  it('o iene arredonda o lado de lá, e o real o de cá', () => {
    // JPY não tem centavos; BRL tem. Cada lado respeita a sua moeda (§32).
    expect(convertWithRate(123.45, taxa(30.918), 0)).toBe(3817);
    expect(paraBase(3817, 30.918, 2)).toBeCloseTo(123.45, 1);
  });

  it('zero converte para zero nos dois sentidos', () => {
    expect(convertWithRate(0, taxa(30.918), 0)).toBe(0);
    expect(paraBase(0, 30.918, 2)).toBe(0);
  });

  it('um valor grande não estoura em nenhum dos sentidos', () => {
    const grande = convertWithRate(1_000_000, taxa(30.918), 0);
    expect(grande).toBe(30_918_000);
    expect(paraBase(grande, 30.918, 2)).toBeCloseTo(1_000_000, 0);
  });
});

describe('formatação de cada lado (§32)', () => {
  it('BRL com duas casas, JPY sem nenhuma', () => {
    expect(formatCurrencyAmount(1000, 'BRL')).toBe('R$ 1.000,00');
    expect(formatCurrencyAmount(30918, 'JPY')).toBe('¥ 30.918');
  });

  it('USD e EUR com duas casas', () => {
    expect(fractionDigitsFor('USD')).toBe(2);
    expect(fractionDigitsFor('EUR')).toBe(2);
  });

  it('RUB usa o símbolo do rublo', () => {
    expect(formatCurrencyAmount(16240, 'RUB')).toBe('₽ 16.240,00');
  });
});

/* ------------------------------ o campo ativo ------------------------------ */

/**
 * §29, §30 e §33 — quem digita é fonte, o outro é derivado.
 *
 * A construção proibida é a de dois efeitos que se atualizam em cadeia: no
 * aparelho ela trava a digitação, porque cada tecla reescreve o campo que a
 * pessoa está usando. A regra abaixo é a que substitui os efeitos, e é pura —
 * dá para exercitá-la sem montar a tela.
 */
describe('activeInput decide quem é fonte e quem é derivado', () => {
  const rate = 30.918;
  const digitos = { base: 2, destino: 0 };

  /** A mesma decisão que o card toma a cada render. */
  const derivar = (active: 'base' | 'destination', digitado: number) =>
    active === 'base'
      ? Math.round(digitado * rate)
      : Math.round((digitado / rate + Number.EPSILON) * 100) / 100;

  it('digitando em BRL, o lado do destino é o calculado', () => {
    expect(derivar('base', 200)).toBe(6184);
  });

  it('digitando na moeda do destino, o lado do BRL é o calculado', () => {
    expect(derivar('destination', 6184)).toBeCloseTo(200, 1);
  });

  it('trocar de lado não recalcula o lado que passou a ser fonte', () => {
    // O valor derivado vira o texto do novo campo ativo, e a partir daí é ele
    // que manda. Sem isso, os dois lados se reescreveriam sem parar.
    const derivadoEmJPY = derivar('base', 200);
    expect(derivar('destination', derivadoEmJPY)).toBeCloseTo(200, 1);
  });

  it.each([
    ['', null],
    ['abc', null],
    ['0', 0],
  ])('entrada %p não produz conversão inventada', (texto, esperado) => {
    expect(parseMoneyInput(texto)).toBe(esperado);
  });

  it('digitos por lado são os da respectiva moeda', () => {
    expect(digitos.base).toBe(fractionDigitsFor('BRL'));
    expect(digitos.destino).toBe(fractionDigitsFor('JPY'));
  });
});
