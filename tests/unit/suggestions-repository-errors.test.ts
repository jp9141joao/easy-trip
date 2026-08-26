import { SuggestionGenerationError } from '@/domain/suggestions';
import { BackendCapabilityError } from '@/repositories/backendCapabilities';
import { createSuggestionRepository } from '@/repositories/supabase/collaboration';

jest.mock('@/lib/config', () => ({
  config: {
    hasBff: true,
    bffUrl: 'https://example.test/functions/v1',
  },
}));

type DbError = { code: string; message: string } | null;

function repositoryHarness(
  options: {
    readError?: DbError;
    upsertError?: DbError;
    places?: Record<string, unknown>[];
    refreshedAt?: string;
  } = {},
) {
  const upsertOptions: Record<string, unknown>[] = [];
  let stored: Record<string, unknown>[] = [];

  const places = options.places ?? [
    { id: 'p1', name: 'Museu A', city: 'Paris', type: 'attraction', latitude: 1, longitude: 1 },
    { id: 'p2', name: 'Museu B', city: 'Paris', type: 'attraction', latitude: 2, longitude: 2 },
    { id: 'p3', name: 'Café C', city: 'Paris', type: 'restaurant', latitude: 3, longitude: 3 },
  ];

  const db = () => ({
    from(table: string) {
      if (table === 'trip_suggestions') {
        return {
          select: () => ({
            eq: () => ({
              order: async () => ({ data: stored, error: options.readError ?? null }),
            }),
          }),
          upsert: async (rows: Record<string, unknown>[], upsert: Record<string, unknown>) => {
            upsertOptions.push(upsert);
            if (!options.upsertError) {
              // Acumula, como a tabela real: o `ensure` grava o catálogo e a
              // IA em duas passagens, e o mínimo é a soma das duas (§22 do
              // handoff). Substituir aqui faria a segunda apagar a primeira.
              stored = [
                ...stored,
                ...rows.map((row, index) => ({
                  ...row,
                  id: `s${stored.length + index + 1}`,
                  created_at: '2026-01-01T00:00:00.000Z',
                  updated_at: '2026-01-01T00:00:00.000Z',
                })),
              ];
            }
            return { data: null, error: options.upsertError ?? null };
          },
          delete: () => ({ eq: async () => ({ data: null, error: null }) }),
        };
      }

      if (table === 'places') {
        return {
          select: () => ({
            ilike: () => ({ limit: async () => ({ data: places, error: null }) }),
          }),
        };
      }

      if (table === 'trips') {
        return {
          update: () => ({ eq: async () => ({ data: null, error: null }) }),
        };
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
    async (tripId) => ({
      id: tripId,
      destinationCity: 'Paris',
      destinationCountry: 'França',
      startDate: '2026-09-01',
      endDate: '2026-09-08',
      suggestionsRefreshedAt: options.refreshedAt,
    }),
    async () => undefined,
  );

  return { repository, upsertOptions };
}

describe('Supabase suggestion repository failures', () => {
  it('targets the generated case-insensitive key for PostgREST upserts', async () => {
    const { repository, upsertOptions } = repositoryHarness();

    await expect(repository.ensure('trip-1')).resolves.toHaveLength(3);
    expect(upsertOptions).toEqual([
      { onConflict: 'trip_id,title_key', ignoreDuplicates: true },
    ]);
  });

  it('does not swallow the former 42P10 upsert failure as zero suggestions', async () => {
    const { repository } = repositoryHarness({
      upsertError: {
        code: '42P10',
        message: 'there is no unique or exclusion constraint matching the ON CONFLICT specification',
      },
    });

    await expect(repository.ensure('trip-1')).rejects.toMatchObject({
      name: 'SuggestionGenerationError',
      code: 'PERSISTENCE_FAILED',
    } satisfies Partial<SuggestionGenerationError>);
  });

  it('classifies a missing 0012 table as backend incompatibility', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { repository } = repositoryHarness({
      readError: {
        code: 'PGRST205',
        message: "Could not find the table 'public.trip_suggestions' in the schema cache",
      },
    });

    await expect(repository.listByTrip('trip-1')).rejects.toBeInstanceOf(BackendCapabilityError);
    await expect(repository.listByTrip('trip-1')).rejects.toMatchObject({
      code: 'MISSING_SUGGESTIONS_SCHEMA',
    });
    warn.mockRestore();
  });

  it('distinguishes an unpublished edge function from an empty catalog', async () => {
    const fetch = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: false, status: 404 } as Response);
    const { repository } = repositoryHarness({ places: [] });

    await expect(repository.ensure('trip-1')).rejects.toMatchObject({
      name: 'SuggestionGenerationError',
      code: 'EDGE_FUNCTION_UNAVAILABLE',
    } satisfies Partial<SuggestionGenerationError>);
    fetch.mockRestore();
  });

  it('reports a Gemini failure while preserving catalog suggestions', async () => {
    const fetch = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: false, status: 502 } as Response);
    const { repository } = repositoryHarness({
      places: [
        {
          id: 'p1',
          name: 'Museu A',
          city: 'Paris',
          type: 'attraction',
          latitude: 1,
          longitude: 1,
        },
      ],
    });

    await expect(repository.ensure('trip-1')).rejects.toMatchObject({
      name: 'SuggestionGenerationError',
      code: 'AI_PROVIDER_FAILED',
      partialSuggestions: [expect.objectContaining({ title: 'Museu A' })],
    } satisfies Partial<SuggestionGenerationError>);
    fetch.mockRestore();
  });

  it.each([
    [403, 'PERMISSION_DENIED'],
    [429, 'REFRESH_LIMITED'],
  ] as const)('keeps HTTP %i as its own suggestion failure cause', async (status, code) => {
    const fetch = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: false, status } as Response);
    const { repository } = repositoryHarness({ places: [] });

    await expect(repository.ensure('trip-1')).rejects.toMatchObject({
      name: 'SuggestionGenerationError',
      code,
    } satisfies Partial<SuggestionGenerationError>);
    fetch.mockRestore();
  });

  it('treats an empty catalog as data, then lets AI complete the suggestions', async () => {
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        suggestions: [
          {
            title: 'Passeio pelo Sena',
            category: 'lugares',
            description: 'Um passeio pelas margens do rio para conhecer diferentes áreas de Paris.',
          },
          {
            title: 'Jardim de Luxemburgo',
            category: 'ar_livre',
            description: 'Um jardim histórico com caminhos, esculturas e espaços tranquilos no centro.',
          },
          {
            title: 'Montmartre',
            category: 'atracoes',
            description: 'Um bairro histórico conhecido pelas ruas elevadas e pela tradição artística.',
          },
        ],
      }),
    } as Response);
    const { repository } = repositoryHarness({ places: [] });

    await expect(repository.ensure('trip-1')).resolves.toHaveLength(3);
    fetch.mockRestore();
  });

  /**
   * O ESTADO PRESO DE MOSCOVO (§13 do handoff).
   *
   * A tela do Android mostrava "Sugestões indisponíveis / Ainda não encontramos
   * sugestões suficientes para este destino", com um botão "Tentar novamente"
   * que não tinha como funcionar. A causa não era o backend: uma tentativa
   * anterior tinha consumido a janela de seis horas — o claim é gasto ANTES do
   * Gemini, de propósito, para proteger custo — e, dentro da janela, este
   * caminho nem chama a Function.
   *
   * Ou seja: não houve geração nenhuma para ser "incompleta". Chamar aquilo de
   * `INCOMPLETE_GENERATION` fazia a tela pintar uma falha permanente onde o
   * sistema só estava dentro do próprio limite. O código honesto é
   * `REFRESH_LIMITED`, que a tela apresenta como informação com prazo.
   */
  it('reports the closed six-hour window as REFRESH_LIMITED, not a failed generation', async () => {
    const fetch = jest.spyOn(global, 'fetch');
    const refreshedAt = new Date().toISOString();

    const firstColdStart = repositoryHarness({ places: [], refreshedAt }).repository;

    await expect(firstColdStart.ensure('trip-1')).rejects.toMatchObject({
      name: 'SuggestionGenerationError',
      code: 'REFRESH_LIMITED',
    } satisfies Partial<SuggestionGenerationError>);
    // A economia continua sendo a razão de ser da janela: nenhuma ida ao Gemini.
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });

  it('carries a sanitised diagnostic saying the window was closed', async () => {
    const fetch = jest.spyOn(global, 'fetch');
    const { repository } = repositoryHarness({
      places: [],
      refreshedAt: new Date().toISOString(),
    });

    // O que faltava no aparelho: distinguir "janela fechada" de "backend fora"
    // sem abrir o Metro. Só números e rótulos — nada de token nem de corpo.
    await expect(repository.ensure('trip-1')).rejects.toMatchObject({
      code: 'REFRESH_LIMITED',
      diagnostics: { refreshWindowOpen: false, forced: false, totalCount: 0 },
    });
    fetch.mockRestore();
  });

  it('a genuine partial generation stays INCOMPLETE_GENERATION', async () => {
    // Contraprova do teste acima: com a janela ABERTA, a geração acontece,
    // volta insuficiente, e aí "incompleta" é a palavra certa.
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        suggestions: [
          {
            title: 'Passeio pelo Sena',
            category: 'lugares',
            description: 'Um passeio pelas margens do rio para conhecer diferentes áreas de Paris.',
          },
        ],
      }),
    } as Response);
    const { repository } = repositoryHarness({ places: [] });

    await expect(repository.ensure('trip-1')).rejects.toMatchObject({
      code: 'INCOMPLETE_GENERATION',
      diagnostics: { refreshWindowOpen: true, catalogCount: 0, aiCount: 1 },
    });
    expect(fetch).toHaveBeenCalled();
    fetch.mockRestore();
  });

  /**
   * §23 do handoff — `force` dentro das seis horas é `REFRESH_LIMITED`.
   *
   * Antes, o pedido caía fora do `if` de geração e a função devolvia a lista
   * inalterada: a tela não tinha como distinguir "atualizei e nada mudou" de
   * "nem tentei", e o usuário via um botão que parecia não fazer nada.
   */
  it('refuses a forced refresh inside the six-hour window instead of returning quietly', async () => {
    const fetch = jest.spyOn(global, 'fetch');
    const { repository } = repositoryHarness({ refreshedAt: new Date().toISOString() });

    await expect(repository.ensure('trip-1', { force: true })).rejects.toMatchObject({
      name: 'SuggestionGenerationError',
      code: 'REFRESH_LIMITED',
    } satisfies Partial<SuggestionGenerationError>);
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });

  it('allows a forced refresh once the window has passed', async () => {
    const seteHorasAtras = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ suggestions: [] }),
    } as Response);
    const { repository } = repositoryHarness({ refreshedAt: seteHorasAtras });

    await expect(repository.ensure('trip-1', { force: true })).resolves.toHaveLength(3);
    expect(fetch).toHaveBeenCalled();
    fetch.mockRestore();
  });

  /**
   * §22 do handoff — o mínimo de três é do TOTAL, catálogo incluído.
   *
   * Catálogo com 2 + uma sugestão válida da IA = 3 = sucesso. Exigir três só da
   * IA reprovaria exatamente a resposta que completou a lista.
   */
  it('completes the minimum with catalog plus a single AI suggestion', async () => {
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        suggestions: [
          {
            title: 'Montmartre',
            category: 'atracoes',
            description: 'Um bairro histórico conhecido pelas ruas elevadas e pela tradição artística.',
          },
        ],
      }),
    } as Response);
    const { repository } = repositoryHarness({
      places: [
        { id: 'p1', name: 'Museu A', city: 'Paris', type: 'attraction', latitude: 1, longitude: 1 },
        { id: 'p2', name: 'Museu B', city: 'Paris', type: 'attraction', latitude: 2, longitude: 2 },
      ],
    });

    await expect(repository.ensure('trip-1')).resolves.toHaveLength(3);

    // E o servidor foi informado de quantas ainda faltavam — não de três.
    const body = JSON.parse(String((fetch.mock.calls[0]?.[1] as RequestInit).body));
    expect(body.minimumNeeded).toBe(1);
    fetch.mockRestore();
  });

  it('does not call a partial generation a success', async () => {
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        suggestions: [
          {
            title: 'Montmartre',
            category: 'atracoes',
            description: 'Um bairro histórico conhecido pelas ruas elevadas e pela tradição artística.',
          },
        ],
      }),
    } as Response);
    const { repository } = repositoryHarness({ places: [] });

    // Catálogo vazio pedia três; veio uma. A que veio é gravada e visível, mas
    // a chamada não pode se declarar completa.
    await expect(repository.ensure('trip-1')).rejects.toMatchObject({
      name: 'SuggestionGenerationError',
      code: 'INCOMPLETE_GENERATION',
    } satisfies Partial<SuggestionGenerationError>);
    fetch.mockRestore();
  });

  it('keeps the valid part of a 422 refusal and still reports it as incomplete', async () => {
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        error: 'A geração não alcançou o mínimo de sugestões para esta viagem.',
        code: 'INSUFFICIENT_SUGGESTIONS',
        suggestions: [
          {
            title: 'Montmartre',
            category: 'atracoes',
            description: 'Um bairro histórico conhecido pelas ruas elevadas e pela tradição artística.',
          },
        ],
      }),
    } as Response);
    const { repository } = repositoryHarness({ places: [] });

    await expect(repository.ensure('trip-1')).rejects.toMatchObject({
      name: 'SuggestionGenerationError',
      code: 'INCOMPLETE_GENERATION',
    } satisfies Partial<SuggestionGenerationError>);

    // O que veio foi gravado: jogar fora custaria outra janela de seis horas.
    await expect(repository.listByTrip('trip-1')).resolves.toEqual([
      expect.objectContaining({ title: 'Montmartre' }),
    ]);
    fetch.mockRestore();
  });
});
