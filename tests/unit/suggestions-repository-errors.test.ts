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

  it('does not call Gemini again after a cold start inside the six-hour window', async () => {
    const fetch = jest.spyOn(global, 'fetch');
    const refreshedAt = new Date().toISOString();

    const firstColdStart = repositoryHarness({ places: [], refreshedAt }).repository;

    /*
     * A abertura normal da tela dentro da janela: nada é gerado, e o resultado
     * é honesto sobre estar abaixo do mínimo em vez de devolver `[]` como se
     * fosse a lista final (§21 do handoff).
     */
    await expect(firstColdStart.ensure('trip-1')).rejects.toMatchObject({
      name: 'SuggestionGenerationError',
      code: 'INCOMPLETE_GENERATION',
    } satisfies Partial<SuggestionGenerationError>);
    expect(fetch).not.toHaveBeenCalled();
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
