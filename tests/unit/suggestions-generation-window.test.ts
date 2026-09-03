import {
  SuggestionGenerationError,
  suggestionRefreshWindow,
  suggestionScreenState,
} from '@/domain/suggestions';
import { createSuggestionRepository } from '@/repositories/supabase/collaboration';
import {
  classifyProviderStatus,
  generationVerdict,
} from '../../supabase/functions/trip-suggestions/policy';

jest.mock('@/lib/config', () => ({
  config: { hasBff: true, bffUrl: 'https://example.test/functions/v1' },
}));

/**
 * A JANELA DE SEIS HORAS DEIXA DE SER GASTA POR UMA GERAÇÃO QUE NÃO ENTREGOU
 *
 * O claim continua sendo consumido ANTES do Gemini — é isso que impede duas
 * chamadas simultâneas, e trocar essa ordem seria trocar a proteção por um
 * conserto. O que muda (0017) é o que a tentativa CUSTA quando termina:
 *
 *   entregou (mesmo pouco) → seis horas, como sempre;
 *   falhou ou não entregou → minutos.
 *
 * Este arquivo cobre as duas pontas do desenho:
 *
 *  1. a tabela de decisão da Edge Function, executada de verdade
 *     (`policy.ts`), e não conferida por `indexOf` no código-fonte;
 *  2. o que o aplicativo faz com cada desfecho — inclusive a contraprova de
 *     concorrência, com duas aberturas simultâneas contra um servidor falso
 *     que aplica o claim do jeito que o Postgres aplica.
 *
 * O comportamento do BANCO em si (claim, lease, cooldown que dobra, token que
 * não casa) é provado em `supabase/tests/suggestion_refresh_window.test.sql`,
 * contra um PostgreSQL de verdade. Reimplementá-lo aqui provaria só que sei
 * escrever duas vezes a mesma suposição.
 */

/* -------------------------------------------------------------------------- */
/* 1. A tabela de decisão da Function                                          */
/* -------------------------------------------------------------------------- */

describe('o que cada desfecho de geração custa', () => {
  it('sucesso com o mínimo consome a janela de seis horas', () => {
    expect(generationVerdict({ produced: 3, minimumNeeded: 3 })).toEqual({
      outcome: 'delivered',
      status: 200,
      carriesSuggestions: true,
    });
  });

  it('parcial entregou conteúdo: as sugestões ficam e a janela segue a regra normal', () => {
    // Uma sugestão válida é conteúdo salvo e visível, e a chamada foi paga.
    // O 422 continua dizendo que não completou — o que ele NÃO faz é fingir
    // que nada aconteceu para ganhar uma nova tentativa de graça.
    for (const produced of [1, 2]) {
      expect(generationVerdict({ produced, minimumNeeded: 3 })).toEqual({
        outcome: 'delivered',
        status: 422,
        code: 'INSUFFICIENT_SUGGESTIONS',
        carriesSuggestions: true,
      });
    }
  });

  it('zero sugestão útil NÃO bloqueia por seis horas', () => {
    // O caso que motivou a correção: o provedor respondeu, o corpo era
    // legível, e nada sobreviveu à sanitização. Nada será persistido — cobrar
    // seis horas por isso é cobrar por um resultado que não existiu.
    expect(generationVerdict({ produced: 0, minimumNeeded: 3 })).toEqual({
      outcome: 'retry',
      status: 502,
      code: 'GENERATION_EMPTY',
      carriesSuggestions: false,
    });
  });

  it('zero sugestão numa viagem que já está completa é sucesso, não falha', () => {
    // Refresh de uma viagem cheia: o modelo não repete o que já existe, e
    // "nada novo" é o resultado honesto. Aqui a janela deve mesmo ser gasta.
    expect(generationVerdict({ produced: 0, minimumNeeded: 0 }).outcome).toBe('delivered');
  });

  it('timeout e queda de rede não custam a janela', () => {
    expect(generationVerdict({ failure: 'transport', produced: 0, minimumNeeded: 3 })).toEqual({
      outcome: 'retry',
      status: 502,
      code: 'GENERATION_RETRY',
      carriesSuggestions: false,
    });
  });

  it('5xx e 429 do provedor não custam a janela', () => {
    for (const status of [500, 502, 503, 429, 408]) {
      expect(classifyProviderStatus(status)).toBe('provider');
      expect(
        generationVerdict({
          failure: classifyProviderStatus(status),
          produced: 0,
          minimumNeeded: 3,
        }).outcome,
      ).toBe('retry');
    }
  });

  it('corpo ilegível é transitório: é saída de modelo, não pedido inválido', () => {
    expect(generationVerdict({ failure: 'format', produced: 0, minimumNeeded: 3 }).outcome).toBe(
      'retry',
    );
  });

  /**
   * §6 — erro determinístico não pode virar retry infinito.
   *
   * Chave ausente ou inválida, corpo recusado, `responseSchema` que o provedor
   * não aceita: repetir daqui a dez minutos gastaria de novo com a mesma
   * certeza de falhar. Consome a janela como uma entrega consumiria, e é o
   * único caminho de falha que faz isso.
   */
  it('falha determinística do provedor não ganha retry curto', () => {
    for (const status of [400, 401, 403, 404, 422]) {
      expect(classifyProviderStatus(status)).toBe('input');
    }

    expect(generationVerdict({ failure: 'input', produced: 0, minimumNeeded: 3 })).toEqual({
      outcome: 'exhausted',
      status: 503,
      code: 'GENERATION_REJECTED',
      carriesSuggestions: false,
    });
  });
});

/* -------------------------------------------------------------------------- */
/* 2. As três esperas, do lado do aplicativo                                   */
/* -------------------------------------------------------------------------- */

const AGORA = new Date('2026-09-02T12:00:00.000Z');
const emMinutos = (minutos: number) => new Date(AGORA.getTime() + minutos * 60_000).toISOString();
const emHoras = (horas: number) => emMinutos(horas * 60);

describe('qual espera está de pé, e por quê', () => {
  it('sem marca nenhuma, a geração está liberada', () => {
    expect(suggestionRefreshWindow({}, AGORA)).toEqual({ open: true });
  });

  it('uma entrega recente fecha a janela por seis horas', () => {
    expect(suggestionRefreshWindow({ suggestionsRefreshedAt: emHoras(-1) }, AGORA)).toEqual({
      open: false,
      blockedBy: 'window',
      nextAttemptAt: emHoras(5),
    });
  });

  it('uma falha recente fecha só o cooldown curto — e isso não é "atualizado"', () => {
    const janela = suggestionRefreshWindow(
      // Repare: a marca d'água é de ANTEONTEM. A tentativa que falhou não a
      // tocou, e é por isso que a espera aqui é de minutos.
      { suggestionsRefreshedAt: emHoras(-48), suggestionsRetryAfter: emMinutos(10) },
      AGORA,
    );

    expect(janela).toEqual({
      open: false,
      blockedBy: 'cooldown',
      nextAttemptAt: emMinutos(10),
    });
  });

  it('uma tentativa em curso bloqueia enquanto a lease dela vale', () => {
    expect(suggestionRefreshWindow({ suggestionsAttemptAt: emMinutos(-1) }, AGORA)).toEqual({
      open: false,
      blockedBy: 'in_progress',
      nextAttemptAt: emMinutos(4),
    });
  });

  it('uma tentativa abandonada expira sozinha com a lease', () => {
    // A Function pode morrer entre o claim e o encerramento. Sem lease, essa
    // tentativa seguraria a viagem para sempre; com ela, custa cinco minutos.
    expect(suggestionRefreshWindow({ suggestionsAttemptAt: emMinutos(-6) }, AGORA)).toEqual({
      open: true,
    });
  });

  it('quando duas barreiras estão de pé, o prazo é o da mais longa', () => {
    // Prometer o prazo da mais curta marcaria um horário em que o pedido ainda
    // seria recusado — pior do que não prometer nada.
    const janela = suggestionRefreshWindow(
      { suggestionsAttemptAt: emMinutos(-1), suggestionsRetryAfter: emMinutos(30) },
      AGORA,
    );
    expect(janela).toMatchObject({ blockedBy: 'cooldown', nextAttemptAt: emMinutos(30) });
  });

  it('o cooldown vencido libera a geração de novo', () => {
    expect(
      suggestionRefreshWindow({ suggestionsRetryAfter: emMinutos(-1) }, AGORA).open,
    ).toBe(true);
  });
});

describe('o texto de tela de cada espera', () => {
  it('não diz "Atualizado recentemente" quando o que houve foi uma falha', () => {
    const estado = suggestionScreenState(
      new SuggestionGenerationError('GENERATION_COOLDOWN', 'falhou', [], undefined, {}),
    );

    expect(estado.kind).toBe('cooldown');
    expect(estado.title).not.toBe('Atualizado recentemente');
    expect(estado.message).toBe(
      'Não conseguimos gerar sugestões agora. Tente novamente em alguns minutos.',
    );
    // Sem botão: tocar agora esbarraria no cooldown do próprio banco.
    expect(estado.retryable).toBe(false);
  });

  it('acrescenta o horário quando a resposta trouxe um', () => {
    const daquiAPouco = new Date(Date.now() + 12 * 60_000).toISOString();
    const estado = suggestionScreenState(
      new SuggestionGenerationError('GENERATION_COOLDOWN', 'falhou', [], undefined, {
        retryAfter: daquiAPouco,
      }),
    );

    expect(estado.message).toMatch(/Você poderá tentar de novo às \d{1,2}:\d{2}\.$/);
  });

  it('não promete horário para uma espera longa demais para um relógio', () => {
    // "às 08:15" sem o dia levaria a pessoa a tentar no horário errado.
    const amanha = new Date(Date.now() + 20 * 60 * 60_000).toISOString();
    const estado = suggestionScreenState(
      new SuggestionGenerationError('REFRESH_LIMITED', 'janela', [], undefined, {
        retryAfter: amanha,
      }),
    );

    expect(estado.message).not.toContain('tentar de novo às');
  });
});

/* -------------------------------------------------------------------------- */
/* 3. O aplicativo contra um servidor que aplica o claim                       */
/* -------------------------------------------------------------------------- */

/**
 * O servidor falso.
 *
 * Ele NÃO é uma reimplementação do SQL para provar o SQL — isso seria provar
 * duas vezes a mesma suposição. Ele existe para responder à única pergunta que
 * o banco não responde sozinho: o que o APLICATIVO faz quando duas aberturas
 * disputam a mesma viagem, e o que ele mostra depois de cada desfecho.
 *
 * A parte que importa é que o claim é aplicado de forma síncrona, sem `await`
 * entre a verificação e a marcação — do mesmo jeito que o `update ... where` da
 * 0017 é um comando só. É isso que faz a segunda requisição perder.
 */
interface LinhaDaViagem {
  suggestionsRefreshedAt?: string;
  suggestionsRetryAfter?: string;
  suggestionsAttemptAt?: string;
  attempt?: string;
  falhas: number;
}

const COOLDOWN_BASE_MS = 10 * 60_000;
const LEASE_MS = 5 * 60_000;

function servidorFalso(linha: LinhaDaViagem, gemini: () => { status: number; body: unknown }) {
  const chamadasAoGemini: number[] = [];

  const bloqueado = () => {
    const agora = Date.now();
    const emCurso =
      linha.suggestionsAttemptAt !== undefined &&
      agora - new Date(linha.suggestionsAttemptAt).getTime() < LEASE_MS;
    const janela =
      linha.suggestionsRefreshedAt !== undefined &&
      agora - new Date(linha.suggestionsRefreshedAt).getTime() < 6 * 60 * 60_000;
    const cooldown =
      linha.suggestionsRetryAfter !== undefined &&
      new Date(linha.suggestionsRetryAfter).getTime() > agora;
    return emCurso || janela || cooldown;
  };

  const encerrar = (attempt: string, outcome: 'delivered' | 'exhausted' | 'retry') => {
    if (linha.attempt !== attempt) return undefined; // token velho: não faz nada
    linha.attempt = undefined;
    linha.suggestionsAttemptAt = undefined;
    if (outcome === 'retry') {
      linha.falhas += 1;
      linha.suggestionsRetryAfter = new Date(
        Date.now() + COOLDOWN_BASE_MS * 2 ** (linha.falhas - 1),
      ).toISOString();
      return linha.suggestionsRetryAfter;
    }
    linha.suggestionsRefreshedAt = new Date().toISOString();
    linha.suggestionsRetryAfter = undefined;
    if (outcome === 'delivered') linha.falhas = 0;
    return undefined;
  };

  return {
    chamadasAoGemini,
    async handle(): Promise<Response> {
      if (bloqueado()) {
        return {
          ok: false,
          status: 429,
          json: async () => ({
            error: 'As sugestões desta viagem já foram atualizadas recentemente.',
            code: 'REFRESH_LIMITED',
            retryAfter: linha.suggestionsRetryAfter,
          }),
        } as Response;
      }

      // Claim: verificar e marcar sem ceder o controle no meio.
      const attempt = `attempt-${chamadasAoGemini.length + 1}-${Math.random()}`;
      linha.attempt = attempt;
      linha.suggestionsAttemptAt = new Date().toISOString();

      chamadasAoGemini.push(Date.now());
      const resposta = gemini();
      const outcome =
        resposta.status === 200 || resposta.status === 422
          ? 'delivered'
          : resposta.status === 503
            ? 'exhausted'
            : 'retry';
      const retryAfter = encerrar(attempt, outcome);

      return {
        ok: resposta.status >= 200 && resposta.status < 300,
        status: resposta.status,
        json: async () => ({ ...(resposta.body as object), ...(retryAfter ? { retryAfter } : {}) }),
      } as Response;
    },
  };
}

function harness(linha: LinhaDaViagem, gemini: () => { status: number; body: unknown }) {
  let stored: Record<string, unknown>[] = [];
  const servidor = servidorFalso(linha, gemini);

  jest.spyOn(global, 'fetch').mockImplementation(() => servidor.handle());

  const db = () => ({
    from(table: string) {
      if (table === 'trip_suggestions') {
        return {
          select: () => ({ eq: () => ({ order: async () => ({ data: stored, error: null }) }) }),
          upsert: async (rows: Record<string, unknown>[]) => {
            stored = [
              ...stored,
              ...rows.map((row, index) => ({
                ...row,
                id: `s${stored.length + index + 1}`,
                created_at: '2026-01-01T00:00:00.000Z',
                updated_at: '2026-01-01T00:00:00.000Z',
              })),
            ];
            return { data: null, error: null };
          },
          delete: () => ({ eq: async () => ({ data: null, error: null }) }),
        };
      }
      if (table === 'places') {
        return { select: () => ({ ilike: () => ({ limit: async () => ({ data: [], error: null }) }) }) };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  });

  const repository = createSuggestionRepository(
    {
      db: db as never,
      unwrap: (result) => result.data as never,
      unwrapList: (result) => result.data ?? [],
      prune: (row) => row,
      openableUrl: async () => undefined,
      uploadAttachment: async () => ({ url: '', mimeType: '' }),
      attachmentsBucket: 'attachments',
    },
    // A leitura da viagem sempre vê a linha ATUAL — inclusive as marcas que a
    // tentativa anterior deixou. É assim que a segunda abertura descobre o
    // cooldown sem ir à Function.
    async (tripId) => ({
      id: tripId,
      destinationCity: 'Moscovo',
      destinationCountry: 'Rússia',
      startDate: '2026-09-01',
      endDate: '2026-09-08',
      suggestionsRefreshedAt: linha.suggestionsRefreshedAt,
      suggestionsRetryAfter: linha.suggestionsRetryAfter,
      suggestionsAttemptAt: linha.suggestionsAttemptAt,
    }),
    async () => undefined,
  );

  return { repository, servidor };
}

const geradas = (quantas: number) =>
  Array.from({ length: quantas }, (_, index) => ({
    title: `Lugar gerado ${index + 1}`,
    category: 'atracoes',
    description: 'Um lugar real do destino, descrito em uma frase que se sustenta sozinha.',
  }));

afterEach(() => jest.restoreAllMocks());

describe('a viagem depois de uma geração que não entregou nada', () => {
  it('não fica seis horas bloqueada — a marca d\'água nem é tocada', async () => {
    const linha: LinhaDaViagem = { falhas: 0 };
    const { repository } = harness(linha, () => ({
      status: 502,
      body: { error: 'nada utilizável', code: 'GENERATION_EMPTY' },
    }));

    const erro = (await repository.ensure('trip-1').catch((e: unknown) => e)) as SuggestionGenerationError;

    expect(erro.code).toBe('GENERATION_COOLDOWN');
    // A prova de que não são seis horas: a marca d'água continua vazia, e o
    // que fechou a porta foi um instante de minutos.
    expect(linha.suggestionsRefreshedAt).toBeUndefined();
    expect(new Date(linha.suggestionsRetryAfter!).getTime() - Date.now()).toBeLessThanOrEqual(
      COOLDOWN_BASE_MS,
    );
    expect(erro.diagnostics.retryAfter).toBe(linha.suggestionsRetryAfter);
  });

  it('a abertura seguinte, dentro do cooldown, nem chega a chamar o Gemini', async () => {
    const linha: LinhaDaViagem = { falhas: 0 };
    const { repository, servidor } = harness(linha, () => ({
      status: 502,
      body: { code: 'GENERATION_EMPTY' },
    }));

    await repository.ensure('trip-1').catch(() => undefined);
    const erro = (await repository.ensure('trip-1').catch((e: unknown) => e)) as SuggestionGenerationError;

    expect(servidor.chamadasAoGemini).toHaveLength(1);
    expect(erro.code).toBe('GENERATION_COOLDOWN');
    expect(erro.diagnostics.refreshBlockedBy).toBe('cooldown');
  });

  it('vencido o cooldown, uma nova tentativa é permitida', async () => {
    const linha: LinhaDaViagem = { falhas: 1, suggestionsRetryAfter: emMinutosDeAgora(-1) };
    const { repository, servidor } = harness(linha, () => ({
      status: 200,
      body: { suggestions: geradas(3) },
    }));

    await expect(repository.ensure('trip-1')).resolves.toHaveLength(3);
    expect(servidor.chamadasAoGemini).toHaveLength(1);
    // E o sucesso zera a contagem de falhas: o cooldown volta ao começo.
    expect(linha.falhas).toBe(0);
  });

  it('cada falha seguida adia mais — não vira tentativa ilimitada', async () => {
    const linha: LinhaDaViagem = { falhas: 0 };
    const { repository } = harness(linha, () => ({ status: 502, body: {} }));

    await repository.ensure('trip-1').catch(() => undefined);
    const primeiro = new Date(linha.suggestionsRetryAfter!).getTime() - Date.now();

    linha.suggestionsRetryAfter = emMinutosDeAgora(-1);
    await repository.ensure('trip-1').catch(() => undefined);
    const segundo = new Date(linha.suggestionsRetryAfter!).getTime() - Date.now();

    expect(segundo).toBeGreaterThan(primeiro);
  });
});

describe('a viagem depois de uma geração que entregou', () => {
  it('sucesso: a abertura seguinte não chama o Gemini de novo dentro das 6h', async () => {
    const linha: LinhaDaViagem = { falhas: 0 };
    const { repository, servidor } = harness(linha, () => ({
      status: 200,
      body: { suggestions: geradas(3) },
    }));

    await expect(repository.ensure('trip-1')).resolves.toHaveLength(3);
    await expect(repository.ensure('trip-1')).resolves.toHaveLength(3);

    expect(servidor.chamadasAoGemini).toHaveLength(1);
    expect(linha.suggestionsRefreshedAt).toBeDefined();
    expect(linha.suggestionsRetryAfter).toBeUndefined();
  });

  it('parcial: o que veio fica salvo e a janela de seis horas permanece', async () => {
    const linha: LinhaDaViagem = { falhas: 0 };
    const { repository, servidor } = harness(linha, () => ({
      status: 422,
      body: { code: 'INSUFFICIENT_SUGGESTIONS', suggestions: geradas(2) },
    }));

    const erro = (await repository.ensure('trip-1').catch((e: unknown) => e)) as SuggestionGenerationError;
    expect(erro.code).toBe('INCOMPLETE_GENERATION');
    expect(erro.partialSuggestions).toHaveLength(2);

    // A janela É consumida aqui, e de propósito: houve entrega, e ela custou
    // uma chamada. O que a correção mudou é o caso vizinho — zero entrega.
    expect(linha.suggestionsRefreshedAt).toBeDefined();
    const seguinte = (await repository
      .ensure('trip-1', { force: true })
      .catch((e: unknown) => e)) as SuggestionGenerationError;
    expect(seguinte.code).toBe('REFRESH_LIMITED');
    expect(servidor.chamadasAoGemini).toHaveLength(1);
  });
});

/**
 * CONTRAPROVA DE CONCORRÊNCIA
 *
 * Duas aberturas ao mesmo tempo, uma viagem sem nada. Se o claim não fosse
 * atômico — se houvesse um `await` entre "está livre?" e "reservei" — as duas
 * passariam e o Gemini seria chamado duas vezes, que é exatamente o custo
 * duplicado que a 0012 existia para impedir e que esta correção não pode
 * afrouxar.
 */
describe('duas aberturas simultâneas', () => {
  it('só uma chama o Gemini; a outra é recusada', async () => {
    const linha: LinhaDaViagem = { falhas: 0 };
    const { repository, servidor } = harness(linha, () => ({
      status: 200,
      body: { suggestions: geradas(3) },
    }));

    const [a, b] = await Promise.all([
      repository.ensure('trip-1').catch((e: unknown) => e),
      repository.ensure('trip-1').catch((e: unknown) => e),
    ]);

    expect(servidor.chamadasAoGemini).toHaveLength(1);
    const vencedora = [a, b].filter((r) => Array.isArray(r));
    expect(vencedora).toHaveLength(1);
  });

  it('enquanto A falha, B continua bloqueada — e não herda o cooldown como sucesso', async () => {
    // A tentativa de A está viva (lease em curso) e vai terminar em falha. B
    // chega no meio: precisa ser recusada, e a recusa precisa dizer "tentativa
    // em andamento", não "atualizado recentemente".
    const linha: LinhaDaViagem = { falhas: 0, suggestionsAttemptAt: new Date().toISOString() };
    const { repository, servidor } = harness(linha, () => ({ status: 200, body: {} }));

    const erro = (await repository.ensure('trip-1').catch((e: unknown) => e)) as SuggestionGenerationError;

    expect(servidor.chamadasAoGemini).toHaveLength(0);
    expect(erro.code).toBe('GENERATION_COOLDOWN');
    expect(erro.diagnostics.refreshBlockedBy).toBe('in_progress');
    expect(suggestionScreenState(erro).title).not.toBe('Atualizado recentemente');
  });
});

function emMinutosDeAgora(minutos: number): string {
  return new Date(Date.now() + minutos * 60_000).toISOString();
}
