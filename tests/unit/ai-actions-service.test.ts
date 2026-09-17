/**
 * O que o serviço de IA devolve — texto e proposta, separados.
 *
 * A garantia principal está no que **não** acontece: nada é extraído do
 * Markdown. Uma resposta que descreve um roteiro em prosa, sem o campo
 * estruturado, não gera botão nenhum — e uma que traz `actions` gera, mesmo que
 * o texto não mencione ação alguma. Os dois canais são independentes por
 * construção (§1).
 */

const mockPostJson = jest.fn();

jest.mock('@/services/http', () => {
  const actual = jest.requireActual('@/services/http');
  return { ...actual, postJson: (...args: unknown[]) => mockPostJson(...args) };
});

function loadService(hasBff: boolean): typeof import('@/services/ai') {
  jest.resetModules();
  jest.doMock('@/lib/config', () => ({
    config: { bffUrl: hasBff ? 'https://bff.example' : '', hasBff, hasSupabase: hasBff, mode: 'demo' },
    hasBff,
    hasSupabase: hasBff,
  }));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@/services/ai') as typeof import('@/services/ai');
}

const context = () => ({
  trip: {
    destinationCity: 'Paris',
    destinationCountry: 'França',
    startDate: '2026-08-22',
    endDate: '2026-08-31',
    status: 'upcoming' as const,
    daysUntil: 30,
    budgetTotal: 30000,
    totalSpent: 0,
    remainingBudget: 30000,
    currency: 'BRL' as const,
    timezone: 'Europe/Paris',
    today: '2026-08-22',
  },
  expenses: [],
  itinerary: [],
  checklist: [],
  profile: { defaultCurrency: 'BRL' },
});

beforeEach(() => {
  mockPostJson.mockReset();
});

describe('modo Gemini', () => {
  it('devolve o texto e as ações estruturadas como campos distintos', async () => {
    const { aiService } = loadService(true);
    mockPostJson.mockResolvedValue({
      content: 'Preparei uma sugestão de roteiro para amanhã.',
      actions: [
        {
          type: 'itinerary.add',
          label: 'Adicionar ao roteiro',
          items: [{ title: 'Museu do Louvre', date: '2026-08-23' }],
        },
      ],
    });

    const reply = await aiService.send({ prompt: 'Monte meu roteiro', context: context(), history: [] });

    expect(reply.local).toBe(false);
    expect(reply.content).toBe('Preparei uma sugestão de roteiro para amanhã.');
    expect(reply.actions).toHaveLength(1);
  });

  it('uma resposta sem ações não vira ação nenhuma, por mais que o texto descreva um roteiro', async () => {
    const { aiService } = loadService(true);
    mockPostJson.mockResolvedValue({
      content:
        '## Roteiro sugerido\n\n- 09:00 Museu do Louvre\n- 18:00 Torre Eiffel\n\n' +
        'Quer que eu **adicione ao roteiro**? Posso implementar esse roteiro agora.',
    });

    const reply = await aiService.send({ prompt: 'Monte meu roteiro', context: context(), history: [] });

    // O texto contém todas as frases-gatilho imagináveis. Nada disso vira botão.
    expect(reply.actions).toEqual([]);
  });

  it('ignora um campo `actions` que não seja lista', async () => {
    const { aiService } = loadService(true);
    mockPostJson.mockResolvedValue({ content: 'Olá', actions: 'itinerary.add' });

    const reply = await aiService.send({ prompt: 'oi', context: context(), history: [] });
    expect(reply.actions).toEqual([]);
  });
});

describe('modo local (demonstração)', () => {
  /*
   * CONSULTAR NÃO É CRIAR — TAMBÉM NO MODO DEMONSTRAÇÃO.
   *
   * Estas duas asserções mudaram de propósito. "O que falta no meu checklist?"
   * pedia a leitura de um checklist que já existe, e o modo local respondia com
   * uma proposta de itens novos: `detectIntent` respondia ASSUNTO ("isto é
   * sobre checklist") e o assunto era tratado como autorização. É a mesma
   * confusão que o servidor tinha, e ela é corrigida nos dois lugares.
   */
  it('uma CONSULTA ao checklist não propõe item nenhum', async () => {
    const { aiService } = loadService(false);

    const reply = await aiService.send({
      prompt: 'O que falta no meu checklist?',
      context: context(),
      history: [],
    });

    expect(reply.local).toBe(true);
    expect(reply.actions).toEqual([]);
    // O texto da consulta continua sendo respondido — o que some é a proposta.
    expect(reply.content).toMatch(/checklist/i);
  });

  it('propõe os essenciais que ainda faltam quando a pessoa PEDE que sejam criados', async () => {
    const { aiService } = loadService(false);

    const reply = await aiService.send({
      prompt: 'Adicione ao meu checklist os itens essenciais que faltam.',
      context: context(),
      history: [],
    });

    expect(reply.local).toBe(true);
    expect(reply.actions).toHaveLength(1);
    expect(reply.actions[0]).toMatchObject({ type: 'checklist.add' });
  });

  it('não repropõe o que o checklist da viagem já tem', async () => {
    const { aiService } = loadService(false);

    const reply = await aiService.send({
      prompt: 'Adicione ao meu checklist os itens essenciais que faltam.',
      context: {
        ...context(),
        checklist: [
          { label: 'Seguro viagem', category: 'reservas', completed: false },
          { label: 'Adaptador de tomada', category: 'mala', completed: false },
        ],
      },
      history: [],
    });

    const [action] = reply.actions as { items: { label: string }[] }[];
    const labels = action.items.map((item) => item.label);
    expect(labels).not.toContain('Seguro viagem');
    expect(labels).not.toContain('Adaptador de tomada');
    expect(labels).toContain('Carregador portátil');
  });

  it('não propõe roteiro nem despesa: o modo local não conhece o destino nem preços', async () => {
    const { aiService } = loadService(false);

    for (const prompt of ['Monte um roteiro de 3 dias', 'Quanto vou gastar amanhã?']) {
      const reply = await aiService.send({ prompt, context: context(), history: [] });
      expect(reply.actions).toEqual([]);
    }
  });

  it('sem viagem selecionada não há proposta', async () => {
    const { aiService } = loadService(false);
    const reply = await aiService.send({ prompt: 'me ajuda', context: null, history: [] });
    expect(reply.actions).toEqual([]);
  });
});
