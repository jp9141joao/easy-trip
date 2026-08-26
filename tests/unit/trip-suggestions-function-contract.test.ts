import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const functionSource = readFileSync(
  resolve(process.cwd(), 'supabase/functions/trip-suggestions/index.ts'),
  'utf8',
);
const migrationSource = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/0012_trip_suggestions.sql'),
  'utf8',
);
const briefingSource = readFileSync(
  resolve(process.cwd(), 'supabase/functions/trip-daily-briefing/index.ts'),
  'utf8',
);

describe('trip-suggestions server-side cost and role contract', () => {
  it('checks editor permission and atomically claims the six-hour window before Gemini', () => {
    const permission = functionSource.indexOf("supabase.rpc('can_edit_trip'");
    const claim = functionSource.indexOf("'claim_trip_suggestion_refresh'");
    const provider = functionSource.indexOf('response = await fetch(');

    expect(permission).toBeGreaterThan(-1);
    expect(claim).toBeGreaterThan(permission);
    expect(provider).toBeGreaterThan(claim);
    expect(functionSource).toContain("claimError.code === '42501'");
    expect(functionSource).toContain('return json({ error: \'Sem permissão');
    expect(functionSource).toContain('últimas 6 horas.\' }, 429)');
  });

  /**
   * §21 do handoff — o mínimo de três é obrigação do modelo, não sugestão.
   *
   * `minItems` no `responseSchema` é mais forte do que pedir em prosa: o
   * provedor recusa a própria resposta antes de devolvê-la.
   */
  it('requires at least three suggestions from the model', () => {
    expect(functionSource).toContain('minItems: MINIMUM_SUGGESTIONS');
    expect(functionSource).toContain('const MINIMUM_SUGGESTIONS = 3;');
  });

  /**
   * §14 do handoff — completar dentro da MESMA execução.
   *
   * O claim de seis horas é consumido antes do provedor, de propósito. Isso
   * significa que uma volta que devolve 1 de 3 deixa a viagem incompleta por
   * seis horas — foi assim que a tela de Moscovo travou. A única hora em que
   * dá para corrigir isso sem abrir mão da proteção de custo é aqui, com o
   * claim já ganho: um segundo pedido, menor, pelo que falta.
   *
   * UMA tentativa. Duas chamadas por claim é o teto, e um modelo que devolveu
   * pouco duas vezes não devolve mais na terceira — repetir só gastaria.
   */
  it('completes a short generation once, inside the same claim', () => {
    expect(functionSource).toContain('if (suggestions.length < minimumNeeded)');
    expect(functionSource).toContain('const faltam = minimumNeeded - suggestions.length;');

    // O segundo pedido leva os títulos que já vieram, para não repetir.
    expect(functionSource).toContain('...suggestions.map((item) => String(item.title ?? \'\'))');

    // E é UM só: nenhum laço em volta da chamada ao provedor.
    const chamadas = functionSource.match(/await generate\(/g) ?? [];
    expect(chamadas).toHaveLength(2);
    expect(functionSource).not.toMatch(/(while|for)\s*\([^)]*\)\s*\{[^}]*generate\(/);
  });

  it('still refuses the first round failing — there is nothing to complete', () => {
    expect(functionSource).toContain('if (primeira === null)');
    expect(functionSource).toContain("json({ error: 'Não foi possível gerar sugestões agora.' }, 502)");
  });

  /**
   * §21/§22 — geração parcial não pode sair como 200.
   *
   * O total mínimo é da VIAGEM (catálogo + IA), e só o cliente sabe quanto o
   * catálogo já cobriu: por isso `minimumNeeded` chega no payload, e por isso a
   * recusa carrega o parcial em vez de descartá-lo.
   */
  it('refuses to report a partial generation as success', () => {
    expect(functionSource).toContain('payload.minimumNeeded');
    expect(functionSource).toContain('if (suggestions.length < minimumNeeded)');
    expect(functionSource).toContain("code: 'INSUFFICIENT_SUGGESTIONS'");
    expect(functionSource).toContain('422');

    // O parcial viaja junto com a recusa.
    const recusa = functionSource.slice(functionSource.indexOf('INSUFFICIENT_SUGGESTIONS'));
    expect(recusa.slice(0, 400)).toContain('suggestions,');

    // A checagem vem DEPOIS da sanitização: o que conta é o que sobreviveu a
    // ela, não o que o modelo alegou ter devolvido.
    expect(functionSource.indexOf('.map(sanitizeSuggestion)')).toBeLessThan(
      functionSource.indexOf('if (suggestions.length < minimumNeeded)'),
    );
  });

  it('clamps minimumNeeded instead of trusting the payload', () => {
    expect(functionSource).toContain(
      'Math.min(MINIMUM_SUGGESTIONS, Math.max(0, Math.trunc(payload.minimumNeeded)))',
    );
    // Cliente antigo, sem o campo: a suposição segura é o mínimo inteiro.
    expect(functionSource).toContain(': MINIMUM_SUGGESTIONS;');
  });

  /**
   * §28 — o que o modelo NÃO pode afirmar continua ausente do schema.
   *
   * A ausência é a validação: sem o campo, não há onde escrever preço, nota,
   * horário ou URL — e o sanitizador reconstrói o objeto campo a campo, então o
   * que ele não copia não sai.
   */
  it('gives the model nowhere to write price, rating, hours or links', () => {
    const schema = functionSource.slice(
      functionSource.indexOf('const RESPONSE_SCHEMA'),
      functionSource.indexOf('const SYSTEM_PROMPT'),
    );
    for (const campo of ['url', 'price', 'rating', 'openingHours', 'phone', 'availability']) {
      expect(schema).not.toContain(`${campo}:`);
    }

    const sanitizer = functionSource.slice(functionSource.indexOf('function sanitizeSuggestion'));
    for (const campo of ['url', 'price', 'rating', 'openingHours', 'phone']) {
      expect(sanitizer).not.toContain(`item.${campo}`);
    }
  });

  it('never reaches the provider with a service-role client', () => {
    // A identidade é o JWT do chamador, e só ele: um `service_role` aqui
    // transformaria um bug em escrita autorizada em qualquer viagem.
    expect(functionSource).toContain('SUPABASE_ANON_KEY');
    expect(functionSource).not.toContain('SERVICE_ROLE');
  });

  it('keeps the claim in Postgres as a role-checked compare-and-set', () => {
    expect(migrationSource).toContain(
      'create or replace function public.claim_trip_suggestion_refresh(target_trip uuid)',
    );
    expect(migrationSource).toContain('if not public.can_edit_trip(target_trip) then');
    expect(migrationSource).toContain("t.suggestions_refreshed_at <= now() - interval '6 hours'");
    expect(migrationSource).toContain(
      'revoke all on function public.claim_trip_suggestion_refresh(uuid) from public, anon;',
    );
  });
});

/**
 * §29 do handoff — o briefing diário já foi endurecido pelo Codex.
 *
 * Aqui só se confirma que a ordem continua: autorização antes de qualquer
 * provider. Um `fetch` de clima ou Gemini acima da barreira transformaria uma
 * chamada não autorizada em custo.
 */
describe('trip-daily-briefing authorization ordering', () => {
  it('authorizes before touching any external provider', () => {
    // Só o corpo do handler interessa: os `fetch` de clima e Gemini moram em
    // funções auxiliares declaradas antes dele no arquivo, e comparar posições
    // no arquivo inteiro mediria a ordem das DECLARAÇÕES, não a das chamadas.
    const handler = briefingSource.slice(briefingSource.indexOf('Deno.serve(async (req)'));
    const autorizacao = handler.indexOf('authorizeDailyBriefing(req.headers');

    expect(autorizacao).toBeGreaterThan(-1);
    expect(handler).toContain('if (!authorization.ok)');

    // Nada que chame provedor externo aparece antes da barreira.
    const antes = handler.slice(0, autorizacao);
    for (const chamada of ['fetchWeather(', 'writeBriefing(', 'runClaimedBatch(', 'fetch(']) {
      expect(antes).not.toContain(chamada);
    }
  });

  it('runs providers only for briefings that won an idempotent claim', () => {
    expect(briefingSource).toContain('runClaimedBatch');
  });
});
