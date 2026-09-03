import { SuggestionGenerationError } from '@/domain/suggestions';
import { createSuggestionRepository } from '@/repositories/supabase/collaboration';

jest.mock('@/lib/config', () => ({
  config: {
    hasBff: true,
    bffUrl: 'https://example.test/functions/v1',
  },
}));

/**
 * TÓQUIO, PARIS E MOSCOVO — POR QUE UM DELES ABRIA VAZIO
 *
 * Os três seguem caminhos diferentes dentro do mesmo `ensure`, e é a diferença
 * entre eles que explica o defeito relatado:
 *
 *   Paris   — `public.places` cobre a cidade. O catálogo sozinho fecha o
 *             mínimo, a IA nem é chamada, e nada pode falhar no caminho.
 *   Tóquio  — o catálogo não cobre (o seed tem Kyoto, não Tóquio). Depende
 *             inteiramente da geração, e funciona quando ela devolve três.
 *   Moscovo — mesmo caminho de Tóquio, com a geração voltando incompleta. É
 *             aqui que a janela de seis horas já foi consumida — o claim é
 *             gasto ANTES do Gemini, de propósito — e o que a chamada
 *             conseguiu gravar é tudo o que a viagem terá até a janela
 *             reabrir.
 *
 * O defeito não estava na consulta, no destino nem no acento: estava no que a
 * falha CARREGAVA. O 422 subia `existing`, a lista de antes da gravação, e
 * numa viagem de catálogo vazio isso é a lista vazia — a tela jogava fora as
 * sugestões que a própria chamada acabara de salvar e pintava o cartão de
 * falha por cima delas.
 */

type Place = Record<string, unknown>;

const CATALOGO: Place[] = [
  { id: 'p1', name: 'Museu do Louvre', city: 'Paris', type: 'attraction', latitude: 48.8606, longitude: 2.3376 },
  { id: 'p2', name: 'Hôtel Lumière Rivoli', city: 'Paris', type: 'hotel', latitude: 48.8571, longitude: 2.3519 },
  { id: 'p3', name: 'Le Comptoir du Marais', city: 'Paris', type: 'restaurant', latitude: 48.8592, longitude: 2.3596 },
];

function harness(options: { city: string; places?: Place[]; refreshedAt?: string } = { city: 'Paris' }) {
  let stored: Record<string, unknown>[] = [];
  const consultas: string[] = [];

  const db = () => ({
    from(table: string) {
      if (table === 'trip_suggestions') {
        return {
          select: () => ({
            eq: () => ({ order: async () => ({ data: stored, error: null }) }),
          }),
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
        return {
          select: () => ({
            ilike: (_coluna: string, valor: string) => {
              consultas.push(valor);
              const linhas = (options.places ?? CATALOGO).filter(
                (place) => String(place.city).toLowerCase() === valor.toLowerCase(),
              );
              return { limit: async () => ({ data: linhas, error: null }) };
            },
          }),
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
      destinationCity: options.city,
      destinationCountry: 'País',
      startDate: '2026-09-01',
      endDate: '2026-09-08',
      suggestionsRefreshedAt: options.refreshedAt,
    }),
    async () => undefined,
  );

  return { repository, consultas };
}

const geradas = (quantas: number) =>
  Array.from({ length: quantas }, (_, index) => ({
    title: `Lugar gerado ${index + 1}`,
    category: 'atracoes',
    description: 'Um lugar real do destino, descrito em uma frase que se sustenta sozinha.',
  }));

const respondeCom = (status: number, body: unknown) =>
  jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);

afterEach(() => jest.restoreAllMocks());

describe('Paris — o catálogo cobre o destino', () => {
  it('fecha o mínimo sem gastar uma chamada de geração', async () => {
    const fetch = jest.spyOn(global, 'fetch');
    const { repository } = harness({ city: 'Paris' });

    await expect(repository.ensure('trip-paris')).resolves.toHaveLength(3);
    // É isto que torna Paris imune ao defeito: ela nunca depende do Gemini.
    expect(fetch).not.toHaveBeenCalled();
  });

  it('encontra o catálogo mesmo com espaço sobrando no destino digitado', async () => {
    const { repository, consultas } = harness({ city: '  Paris ' });

    await expect(repository.ensure('trip-paris')).resolves.toHaveLength(3);
    expect(consultas).toEqual(['Paris']);
  });
});

describe('Tóquio — catálogo vazio, geração completa', () => {
  it('carrega as três sugestões pela IA', async () => {
    respondeCom(200, { suggestions: geradas(3) });
    const { repository } = harness({ city: 'Tóquio', places: [] });

    await expect(repository.ensure('trip-toquio')).resolves.toHaveLength(3);
  });
});

describe('Moscovo — catálogo vazio, geração incompleta', () => {
  it('entrega o que foi gravado junto com a falha, em vez de uma lista vazia', async () => {
    // O corpo do 422: duas sugestões legítimas e a recusa por não alcançar três.
    respondeCom(422, {
      error: 'A geração não alcançou o mínimo de sugestões para esta viagem.',
      code: 'INSUFFICIENT_SUGGESTIONS',
      suggestions: geradas(2),
    });
    const { repository } = harness({ city: 'Moscovo', places: [] });

    const erro = await repository.ensure('trip-moscovo').catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(SuggestionGenerationError);
    const falha = erro as SuggestionGenerationError;
    expect(falha.code).toBe('INCOMPLETE_GENERATION');
    // O CORAÇÃO DA CORREÇÃO: antes isto era `[]`, e a tela pintava o cartão de
    // erro por cima das duas sugestões que acabara de salvar.
    expect(falha.partialSuggestions).toHaveLength(2);
    expect(falha.partialSuggestions.map((s) => s.title)).toEqual([
      'Lugar gerado 1',
      'Lugar gerado 2',
    ]);
    expect(falha.diagnostics).toMatchObject({ aiCount: 2, totalCount: 2 });
  });

  it('na abertura seguinte devolve o que ficou salvo, com a janela fechada', async () => {
    const fetch = jest.spyOn(global, 'fetch');
    // A viagem já tem as duas de ontem e a janela de 6h foi consumida.
    const { repository } = harness({
      city: 'Moscovo',
      places: [],
      refreshedAt: new Date().toISOString(),
    });
    await repository
      .ensure('trip-moscovo')
      .catch(() => undefined); // primeira ida: nada a gerar, janela fechada

    const erro = await repository.ensure('trip-moscovo').catch((e: unknown) => e);
    const falha = erro as SuggestionGenerationError;

    // `REFRESH_LIMITED` é informação com prazo, não falha — e a tela a
    // apresenta como estado vazio, sem botão que não teria como funcionar.
    expect(falha.code).toBe('REFRESH_LIMITED');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('um destino sem catálogo e sem geração não vira erro de conexão', async () => {
    // Geração devolve zero sugestões válidas, com a janela aberta: o destino
    // realmente não rendeu nada. Isso é `INCOMPLETE_GENERATION` — um estado com
    // texto próprio — e não um 'failed' genérico de rede.
    respondeCom(200, { suggestions: [] });
    const { repository } = harness({ city: 'Moscovo', places: [] });

    const falha = (await repository
      .ensure('trip-moscovo')
      .catch((e: unknown) => e)) as SuggestionGenerationError;

    expect(falha.code).toBe('INCOMPLETE_GENERATION');
    expect(falha.diagnostics.transport).toBeUndefined();
  });
});

describe('catálogo com coordenada pela metade', () => {
  it('grava o par vazio em vez de derrubar o upsert inteiro', async () => {
    // O CHECK `trip_suggestions_coords_pair` da 0012 recusa meia coordenada, e
    // o upsert é uma transação só: uma linha torta levava junto todas as
    // outras sugestões daquele destino.
    const fetch = jest.spyOn(global, 'fetch');
    const { repository } = harness({
      city: 'Lisboa',
      places: [
        { id: 'p1', name: 'A', city: 'Lisboa', type: 'attraction', latitude: 38.7, longitude: -9.1 },
        { id: 'p2', name: 'B', city: 'Lisboa', type: 'hotel', latitude: 38.7 },
        { id: 'p3', name: 'C', city: 'Lisboa', type: 'restaurant', longitude: -9.1 },
      ],
    });

    const resultado = await repository.ensure('trip-lisboa');

    expect(resultado).toHaveLength(3);
    expect(resultado[1]).toMatchObject({ latitude: undefined, longitude: undefined });
    expect(resultado[2]).toMatchObject({ latitude: undefined, longitude: undefined });
    expect(fetch).not.toHaveBeenCalled();
  });
});
