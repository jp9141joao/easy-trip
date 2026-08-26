/**
 * Cotação de referência para o conversor da Carteira (§25, §26, §28).
 *
 * POR QUE UM SEGUNDO PROVEDOR, E NÃO O QUE JÁ EXISTE
 *
 * `services/currency.ts` usa o Frankfurter, que publica as taxas de referência
 * do Banco Central Europeu. Ele continua sendo a fonte das despesas: é a taxa
 * que fica gravada junto com cada gasto, e trocá-la mudaria números já
 * lançados. Não se mexe nele.
 *
 * O que ele não tem é RUB — o BCE parou de publicar o rublo em 2022 — nem a
 * maior parte das moedas fora do bloco europeu. Um conversor de viagem que não
 * converte para a moeda do destino não é um conversor, e o destino do teste em
 * aparelho era justamente Moscovo. Daí este módulo, com o ExchangeRate-API
 * Open Access: sem chave, com cobertura ampla, e com a atribuição que os
 * termos exigem exibida na tela (§25).
 *
 * NENHUM SEGREDO NO CLIENTE
 *
 * O endpoint aberto não usa chave. Não há `EXPO_PUBLIC_*` novo, não há BFF a
 * publicar e não há nada a esconder — que é a razão de ser desta escolha, e
 * não um efeito colateral dela.
 *
 * O QUE NUNCA ACONTECE AQUI
 *
 * Não existe taxa embutida no código. Quando o provedor não responde e não há
 * nada em cache, a função devolve `null` e a tela diz que não tem cotação. Um
 * número inventado para "não deixar a tela vazia" seria a pessoa trocando
 * dinheiro com base numa conta que ninguém fez.
 */

import { cacheStorage } from '@/lib/storage';
import { getJson, ServiceError } from './http';

/** A atribuição exigida pelos termos do Open Access. Vai para a tela. */
export const EXCHANGE_RATE_ATTRIBUTION = 'Cotações por ExchangeRate-API';
export const EXCHANGE_RATE_PROVIDER_URL = 'https://www.exchangerate-api.com';

export interface ReferenceRate {
  from: string;
  to: string;
  rate: number;
  /** Quando o provedor publicou esta tabela — não quando a buscamos. */
  publishedAt: string;
  /** Quando ela entrou no nosso cache. É o que a tela mostra como "atualizada". */
  fetchedAt: string;
  /** `true` quando veio do cache porque a rede falhou agora. */
  stale: boolean;
}

export type ReferenceRateFailure =
  | 'unsupported'
  | 'offline'
  | 'provider_unavailable';

export interface ReferenceRateResult {
  rate: ReferenceRate | null;
  failure?: ReferenceRateFailure;
}

interface OpenErApiResponse {
  result?: string;
  'error-type'?: string;
  base_code?: string;
  time_last_update_utc?: string;
  rates?: Record<string, number>;
}

const ENDPOINT = 'https://open.er-api.com/v6/latest';

const cacheKey = (from: string) => `fx-ref:${from.toUpperCase()}`;

interface CachedTable {
  base: string;
  publishedAt: string;
  rates: Record<string, number>;
}

/**
 * A tabela inteira da moeda base, e não o par.
 *
 * O provedor devolve todas as moedas numa resposta só. Guardar a tabela faz
 * com que trocar o destino — BRL→RUB para BRL→JPY — seja instantâneo e sem
 * rede, o que é exatamente o comportamento que se quer num aplicativo de
 * viagem, onde a conexão é a parte não confiável.
 */
async function fetchTable(base: string): Promise<CachedTable> {
  const data = await getJson<OpenErApiResponse>(`${ENDPOINT}/${base.toUpperCase()}`, {
    timeoutMs: 8_000,
    retries: 1,
  });

  if (data.result !== 'success' || !data.rates || typeof data.rates !== 'object') {
    throw new ServiceError('parse', 'O provedor de cotação respondeu sem tabela.');
  }

  return {
    base: (data.base_code ?? base).toUpperCase(),
    // A data é do provedor; se ele não mandar, é honesto usar a de agora — o
    // que não se pode é inventar uma data anterior para parecer mais fresca.
    publishedAt: data.time_last_update_utc
      ? new Date(data.time_last_update_utc).toISOString()
      : new Date().toISOString(),
    rates: data.rates,
  };
}

/**
 * A cotação de um par, com cache e falha honesta.
 *
 * A ordem importa: tenta a rede, e só cai no cache quando a rede falha. O
 * contrário — cache primeiro — deixaria a pessoa vendo a cotação de ontem sem
 * saber, e o rótulo "Cotação de referência" não é licença para isso.
 */
export async function getReferenceRate(from: string, to: string): Promise<ReferenceRateResult> {
  const origem = from.toUpperCase();
  const destino = to.toUpperCase();

  if (origem === destino) {
    const agora = new Date().toISOString();
    return {
      rate: { from: origem, to: destino, rate: 1, publishedAt: agora, fetchedAt: agora, stale: false },
    };
  }

  const chave = cacheKey(origem);

  try {
    const tabela = await fetchTable(origem);
    const envelope = await cacheStorage.set(chave, tabela);

    const valor = tabela.rates[destino];
    if (typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0) {
      // A tabela veio; esta moeda é que não está nela. Dizer "sem conexão"
      // aqui mandaria a pessoa conferir o wi-fi por um problema que é outro.
      return { rate: null, failure: 'unsupported' };
    }

    return {
      rate: {
        from: origem,
        to: destino,
        rate: valor,
        publishedAt: tabela.publishedAt,
        fetchedAt: envelope.updatedAt,
        stale: false,
      },
    };
  } catch (error) {
    const cache = await cacheStorage.get<CachedTable>(chave);
    const guardada = cache?.value.rates?.[destino];

    if (typeof guardada === 'number' && Number.isFinite(guardada) && guardada > 0) {
      // Uma cotação velha continua sendo uma cotação real — e vai rotulada
      // como velha, com a data em que foi buscada (§28).
      return {
        rate: {
          from: origem,
          to: destino,
          rate: guardada,
          publishedAt: cache!.value.publishedAt,
          fetchedAt: cache!.updatedAt,
          stale: true,
        },
      };
    }

    const offline = error instanceof ServiceError && (error.kind === 'offline' || error.kind === 'timeout');
    return { rate: null, failure: offline ? 'offline' : 'provider_unavailable' };
  }
}

/**
 * Converte, sem esconder o arredondamento.
 *
 * As casas são as da moeda de destino (`fractionDigitsFor`), porque mostrar
 * centavos de iene é mostrar um número que não existe.
 */
export function convertWithRate(amount: number, rate: ReferenceRate, digits: number): number {
  const bruto = amount * rate.rate;
  const fator = 10 ** digits;
  return Math.round((bruto + Number.EPSILON) * fator) / fator;
}
