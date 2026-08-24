/**
 * O teto de mensagens da Easy Trip IA — o número e o erro, num lugar só.
 *
 * Vive no domínio porque três camadas precisam dele e nenhuma delas deve ser
 * dona: o hook (que recusa antes de sair), o serviço (que traduz o 429 do
 * servidor) e a tela (que mostra a mensagem). Duplicar o número em cada uma
 * seria a receita para eles divergirem em silêncio.
 *
 * O valor espelha `RATE_LIMIT` da Edge Function (`supabase/functions/ai-chat/
 * protocol.ts`). Espelha, não compartilha: Deno e o bundle do Expo não têm
 * módulo em comum. Os testes de cada lado fixam o mesmo par de números.
 */

export const AI_RATE_LIMIT = { windowMs: 60_000, max: 5 } as const;

/**
 * Recusa por excesso de mensagens — nossa ou do servidor.
 *
 * É uma classe própria, e não um `ServiceError` genérico, porque a tela reage
 * a ela de um jeito específico: avisa em tom de espera (não de falha) e
 * **devolve o texto ao campo**. Uma mensagem que não saiu não pode custar o
 * que a pessoa digitou.
 */
export class AIRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super(
      retryAfterSeconds > 0
        ? `Você enviou muitas mensagens. Tente novamente em ${retryAfterSeconds}s.`
        : 'Você enviou muitas mensagens. Aguarde alguns segundos para continuar.',
    );
    this.name = 'AIRateLimitError';
  }
}
