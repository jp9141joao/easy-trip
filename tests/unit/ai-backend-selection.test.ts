/**
 * QUEM RESPONDE A PERGUNTA — e por quê.
 *
 * O defeito que este arquivo prende foi observado no Android: a pessoa pedia
 * "Monte um roteiro para hoje" e recebia um resumo da própria viagem terminando
 * em "Resposta gerada localmente pelo Easy Trip". Nada tinha quebrado no
 * caminho da IA; o aplicativo simplesmente nunca chegou a chamar o backend,
 * porque `config.hasBff` era falso.
 *
 * São três situações diferentes, e antes as três terminavam na mesma frase:
 *
 *   1. nada configurado           → resposta local É a resposta certa;
 *   2. conectado, Functions do próprio projeto → tem de usar o Gemini;
 *   3. conectado, endereço desconhecido        → instalação pela metade.
 *
 * E há uma quarta, que nunca pode virar resposta local: o backend responder
 * errado. Falha de backend é falha, e precisa chegar à tela como falha.
 */

const mockPostJson = jest.fn();

jest.mock('@/services/http', () => {
  const actual = jest.requireActual('@/services/http') as typeof import('@/services/http');
  return { ...actual, postJson: (...args: unknown[]) => mockPostJson(...args) };
});

type Loaded = {
  ai: typeof import('@/services/ai');
  config: typeof import('@/lib/config');
  /**
   * O MESMO módulo `http` que o serviço enxerga.
   *
   * Sem isto o teste construía o `ServiceError` a partir de OUTRO registro de
   * módulos, e `error instanceof ServiceError` dentro do serviço dava falso —
   * o teste falhava por identidade de classe, não por comportamento.
   */
  http: typeof import('@/services/http');
};

const ENV_KEYS = [
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  'EXPO_PUBLIC_BFF_URL',
] as const;

/**
 * Carrega o serviço com o ambiente REAL do `config.ts`.
 *
 * A diferença para os outros testes de IA é deliberada: eles substituem
 * `@/lib/config` por um objeto e testam o serviço; este carrega o módulo de
 * verdade e testa a REGRA DE SELEÇÃO — que é exatamente onde a regressão vivia.
 */
function loadAI(env: Partial<Record<(typeof ENV_KEYS)[number], string>>): Loaded {
  let loaded!: Loaded;
  const previous = { ...process.env };
  jest.isolateModules(() => {
    for (const key of ENV_KEYS) delete process.env[key];
    Object.assign(process.env, env);
    loaded = {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      config: require('@/lib/config') as typeof import('@/lib/config'),
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      http: require('@/services/http') as typeof import('@/services/http'),
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      ai: require('@/services/ai') as typeof import('@/services/ai'),
    };
  });
  process.env = previous;
  return loaded;
}

const PROJECT = 'https://projeto.supabase.co';
const KEY = 'sb_publishable_abc123';

const context = (): import('@/services/ai').AITripContext => ({
  trip: {
    destinationCity: 'Paris',
    destinationCountry: 'França',
    startDate: '2026-09-07',
    endDate: '2026-09-15',
    status: 'active',
    daysUntil: 0,
    budgetTotal: 30000,
    totalSpent: 0,
    remainingBudget: 30000,
    currency: 'BRL',
    timezone: 'Europe/Paris',
    today: '2026-09-07',
  },
  expenses: [],
  itinerary: [],
  checklist: [],
  profile: { defaultCurrency: 'BRL' },
});

beforeEach(() => {
  mockPostJson.mockReset();
});

describe('modo conectado usa a IA real', () => {
  it('com Supabase hospedado, o assistente é o Gemini mesmo sem EXPO_PUBLIC_BFF_URL', async () => {
    const { ai, config } = loadAI({
      EXPO_PUBLIC_SUPABASE_URL: PROJECT,
      EXPO_PUBLIC_SUPABASE_ANON_KEY: KEY,
    });

    expect(config.aiBackendState).toBe('backend');
    expect(ai.aiService.kind).toBe('gemini');

    mockPostJson.mockResolvedValue({
      content: 'Preparei um roteiro para hoje.',
      actions: [
        {
          type: 'itinerary.add',
          label: 'Adicionar ao roteiro',
          items: [{ title: 'Museu do Louvre', date: '2026-09-07' }],
        },
      ],
    });

    const reply = await ai.aiService.send({
      prompt: 'Monte um roteiro para hoje',
      context: context(),
      history: [],
      accessToken: 'jwt-da-sessao',
    });

    // A chamada saiu, e saiu para as Functions do próprio projeto.
    expect(mockPostJson).toHaveBeenCalledTimes(1);
    expect(mockPostJson.mock.calls[0][0]).toBe(`${PROJECT}/functions/v1/ai-chat`);
    // E a resposta não é local: veio do backend, com a proposta crua intacta.
    expect(reply.local).toBe(false);
    expect(reply.actions).toHaveLength(1);
  });

  it('o token da sessão vai no cabeçalho, e a chave do Gemini não existe no cliente', async () => {
    const { ai } = loadAI({
      EXPO_PUBLIC_SUPABASE_URL: PROJECT,
      EXPO_PUBLIC_SUPABASE_ANON_KEY: KEY,
    });
    mockPostJson.mockResolvedValue({ content: 'Olá' });

    await ai.aiService.send({
      prompt: 'oi',
      context: context(),
      history: [],
      accessToken: 'jwt-da-sessao',
    });

    const [, body, options] = mockPostJson.mock.calls[0] as [
      string,
      Record<string, unknown>,
      { headers: Record<string, string> },
    ];
    expect(options.headers.Authorization).toBe('Bearer jwt-da-sessao');
    // O contrato do payload: é o que `supabase/functions/ai-chat` lê.
    expect(Object.keys(body).sort()).toEqual(['context', 'history', 'prompt']);
    // CA-06: a credencial do modelo vive só no servidor.
    expect(JSON.stringify(body)).not.toMatch(/GEMINI/i);
  });
});

describe('modo local só onde ele é a resposta certa', () => {
  it('sem backend nenhum, responde localmente e diz que é local', async () => {
    const { ai, config } = loadAI({});

    expect(config.aiBackendState).toBe('demo');
    expect(ai.aiService.kind).toBe('local');

    const reply = await ai.aiService.send({
      prompt: 'Monte um roteiro para hoje',
      context: context(),
      history: [],
    });

    expect(mockPostJson).not.toHaveBeenCalled();
    expect(reply.local).toBe(true);
    expect(reply.content).toMatch(/gerada localmente/i);
  });

  it('conectado com endereço desconhecido é instalação pela metade, não demonstração', () => {
    /*
     * O caso que a frase "modo demonstração" descrevia errado. A resposta
     * continua local — não há para onde chamar —, mas o estado que a tela lê
     * agora diz a verdade, e `configIssues` nomeia a variável que falta.
     */
    const { ai, config } = loadAI({
      EXPO_PUBLIC_SUPABASE_URL: 'https://supabase.empresa.com.br',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: KEY,
    });

    expect(ai.aiService.kind).toBe('local');
    expect(config.aiBackendState).toBe('unreachable');
    expect(config.config.mode).toBe('production');
    expect(config.configIssues.join(' ')).toMatch(/EXPO_PUBLIC_BFF_URL/);
  });
});

describe('falha do backend nunca vira sucesso local', () => {
  const connected = () =>
    loadAI({ EXPO_PUBLIC_SUPABASE_URL: PROJECT, EXPO_PUBLIC_SUPABASE_ANON_KEY: KEY });

  it('502 do ai-chat sobe como falha, com o código que o servidor mandou', async () => {
    const { ai, http } = connected();
    mockPostJson.mockRejectedValue(
      new http.ServiceError('http', 'Serviço respondeu 502', 502, {
        error: 'O assistente está indisponível.',
        code: 'GEMINI_ALL_MODELS_QUOTA_EXCEEDED',
        stage: 'UPSTREAM',
      }),
    );

    const erro = await ai.aiService
      .send({ prompt: 'Monte um roteiro para hoje', context: context(), history: [] })
      .then(
        () => null,
        (error: unknown) => error as { name: string; fields: Record<string, unknown> },
      );

    // O ponto: NÃO houve resposta. Um `reply.local === true` aqui seria a
    // regressão — o usuário leria um resumo da viagem achando que a IA falou.
    expect(erro).not.toBeNull();
    expect(erro!.name).toBe('AIRequestError');
    expect(erro!.fields).toMatchObject({
      httpStatus: 502,
      code: 'GEMINI_ALL_MODELS_QUOTA_EXCEEDED',
      stage: 'UPSTREAM',
    });
  });

  it('200 sem texto utilizável é falha declarada, não resposta local', async () => {
    const { ai } = connected();
    mockPostJson.mockResolvedValue({ content: '   ' });

    const erro = await ai.aiService
      .send({ prompt: 'Monte um roteiro para hoje', context: context(), history: [] })
      .then(
        () => null,
        (error: unknown) => error as { name: string; fields: Record<string, unknown> },
      );

    expect(erro).not.toBeNull();
    expect(erro!.fields).toMatchObject({ code: 'EMPTY_CONTENT', stage: 'PARSE' });
  });

  it('429 é espera, e continua sendo espera — não resposta local', async () => {
    const { ai, http } = connected();
    mockPostJson.mockRejectedValue(new http.ServiceError('http', 'Serviço respondeu 429', 429));

    const erro = await ai.aiService
      .send({ prompt: 'oi', context: context(), history: [] })
      .then(
        () => null,
        (error: unknown) => error as { name: string },
      );

    expect(erro!.name).toBe('AIRateLimitError');
  });

  it('queda de rede não é respondida por um resumo da viagem', async () => {
    const { ai, http } = connected();
    mockPostJson.mockRejectedValue(
      new http.ServiceError('offline', 'Não foi possível alcançar o serviço.'),
    );

    const erro = await ai.aiService
      .send({ prompt: 'Monte um roteiro para hoje', context: context(), history: [] })
      .then(
        () => null,
        (error: unknown) => error as { name: string; fields: Record<string, unknown> },
      );

    expect(erro!.name).toBe('AIRequestError');
    expect(erro!.fields).toMatchObject({ code: 'OFFLINE', stage: 'TRANSPORT' });
  });
});
