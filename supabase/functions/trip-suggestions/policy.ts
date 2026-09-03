/**
 * O veredito de uma tentativa de geração — puro, sem Deno e sem rede.
 *
 * POR QUE ESTE MÓDULO EXISTE SEPARADO DO `index.ts`
 *
 * A regra que esta correção acrescenta é uma tabela de decisão: dado o que o
 * provedor fez e quantas sugestões sobreviveram à sanitização, a tentativa
 * consome a janela de seis horas ou apenas um cooldown de minutos. Uma tabela
 * de decisão que só pode ser conferida lendo o código-fonte com `indexOf` não
 * está testada — está descrita. Aqui ela é executada pelo Jest, caso a caso,
 * do mesmo jeito que `trip-daily-briefing/protocol.ts`.
 *
 * O módulo não decide NADA sobre concorrência: quem garante que só uma
 * tentativa existe por vez é o claim da 0017, no Postgres. Aqui só se responde
 * "o que aconteceu com ESTA tentativa, que já venceu o claim".
 */

/**
 * Como uma rodada com o provedor terminou sem produzir lista.
 *
 * `input` é a categoria que muda o desfecho: ela significa que repetir daqui a
 * dez minutos gastaria de novo com a mesma certeza de falhar — chave ausente ou
 * inválida, corpo recusado, `responseSchema` que o provedor não aceita. As
 * outras três são transitórias por natureza.
 */
export type RoundFailure = 'transport' | 'provider' | 'format' | 'input';

/** O que fazer com a tentativa, do ponto de vista do banco (0017). */
export type GenerationOutcome = 'delivered' | 'exhausted' | 'retry';

export interface GenerationVerdict {
  /** O `outcome` que vai para `settle_trip_suggestion_refresh`. */
  outcome: GenerationOutcome;
  /** O status HTTP que a Function devolve. */
  status: number;
  /** O código de negócio no corpo — o cliente decide o texto de tela por ele. */
  code?: string;
  /** O corpo carrega a lista (parcial ou completa)? */
  carriesSuggestions: boolean;
}

/**
 * Um status HTTP do provedor é falha transitória ou determinística?
 *
 * 429 e 408 são recusas de MOMENTO, não de conteúdo: o mesmo pedido tem chance
 * real de passar depois. 5xx é do outro lado. Todo o resto do 4xx é o pedido —
 * e o pedido não muda sozinho entre uma tentativa e a seguinte.
 */
export function classifyProviderStatus(status: number): RoundFailure {
  if (status === 408 || status === 429 || status >= 500) return 'provider';
  if (status >= 400) return 'input';
  return 'provider';
}

/**
 * O veredito da tentativa inteira.
 *
 * `produced` é o que sobreviveu à sanitização e à deduplicação — não o que o
 * modelo alegou ter devolvido. `minimumNeeded` é quanto ESTA viagem ainda
 * precisava (o catálogo já pode ter coberto parte, §22 do handoff).
 *
 * A ordem das perguntas é a regra:
 *
 *  1. a rodada nem produziu lista?
 *     · falha determinística → `exhausted`: a janela de 6h é consumida, porque
 *       repetir é gasto garantido sem chance de sucesso;
 *     · falha transitória → `retry`: cooldown de minutos, e a marca d'água da
 *       última entrega de verdade permanece intacta.
 *  2. produziu lista, mas ZERO sugestão útil, numa viagem que precisava de
 *     alguma → `retry`. É o caso que motivou esta correção: o provedor
 *     respondeu, nada foi persistido, e não há motivo para prender a pessoa por
 *     seis horas por isso.
 *  3. produziu MENOS que o necessário, mas produziu → `delivered`. A chamada
 *     foi paga e o conteúdo existe e fica salvo; a janela segue a regra normal.
 *     O 422 continua dizendo que não completou.
 *  4. produziu o necessário → `delivered`, 200.
 *
 * O caso `minimumNeeded === 0` é o refresh de uma viagem que já está completa:
 * zero sugestão nova é o resultado honesto de um modelo que não repete o que já
 * existe, e não uma falha.
 */
export function generationVerdict(input: {
  failure?: RoundFailure;
  produced: number;
  minimumNeeded: number;
}): GenerationVerdict {
  const { failure, produced, minimumNeeded } = input;

  if (failure) {
    return failure === 'input'
      ? { outcome: 'exhausted', status: 503, code: 'GENERATION_REJECTED', carriesSuggestions: false }
      : { outcome: 'retry', status: 502, code: 'GENERATION_RETRY', carriesSuggestions: false };
  }

  if (produced === 0 && minimumNeeded > 0) {
    return { outcome: 'retry', status: 502, code: 'GENERATION_EMPTY', carriesSuggestions: false };
  }

  if (produced < minimumNeeded) {
    return {
      outcome: 'delivered',
      status: 422,
      code: 'INSUFFICIENT_SUGGESTIONS',
      carriesSuggestions: true,
    };
  }

  return { outcome: 'delivered', status: 200, carriesSuggestions: true };
}
