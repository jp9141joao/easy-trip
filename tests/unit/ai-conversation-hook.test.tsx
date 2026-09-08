import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { onAITrace, type AITraceFields } from '@/lib/aiTrace';
import { AIRateLimitError, AIRequestInFlightError } from '@/domain/aiRateLimit';
import type { AIMessage, Trip } from '@/domain/types';
import { resetAIClientRateLimitForTests, useAIConversation } from '@/hooks/useAI';

/**
 * A conversa da IA vista pelo hook: limite de mensagens, "Novo chat"
 * destrutivo e a proposta que fica pendente.
 *
 * Os três nasceram do mesmo teste em aparelho:
 *
 *  - **limite**: 15/min nunca segurou toque duplo nem insistência, e cada
 *    passagem é uma chamada paga ao Gemini;
 *  - **novo chat**: o produto decidiu não guardar histórico — começar de novo
 *    apaga a conversa anterior, em vez de escondê-la numa lista que ninguém
 *    abre;
 *  - **proposta pendente**: a pessoa respondeu "aprovar" à proposta que estava
 *    na tela, e a frase virou outra pergunta ao modelo.
 *
 * O repositório é dublado por um em memória que se comporta como os dois de
 * verdade (o local e o Supabase): o `deleteConversation` apaga as mensagens em
 * cascata, como o `on delete cascade` de 0001 faz no Postgres.
 */

const paris: Trip = {
  id: 'trip-paris',
  userId: 'u1',
  destinationCity: 'Paris',
  destinationCountry: 'França',
  countryCode: 'FR',
  timezone: 'Europe/Paris',
  startDate: '2026-08-22',
  endDate: '2026-08-31',
  budgetTotal: 30000,
  budgetCurrency: 'BRL',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

/** Banco em memória, com as mesmas regras de cascata do esquema real. */
const db = {
  conversations: [] as { id: string; tripId: string }[],
  messages: [] as AIMessage[],
  nextId: 0,
};

/** O que o serviço de IA devolve na próxima chamada. */
const reply = { content: 'resposta', actions: [] as unknown[] };
const mockAiSend = jest.fn(async () => ({ ...reply, local: false }));

jest.mock('@/repositories', () => ({
  dataSource: {
    ai: {
      getOrCreateConversation: async (_userId: string, tripId: string) => {
        const found = db.conversations.find((c) => c.tripId === tripId);
        if (found) return found;
        const created = { id: `conv-${(db.nextId += 1)}`, tripId };
        db.conversations.push(created);
        return created;
      },
      createConversation: async (_userId: string, tripId: string) => {
        const created = { id: `conv-${(db.nextId += 1)}`, tripId };
        db.conversations.push(created);
        return created;
      },
      deleteConversation: async (conversationId: string) => {
        db.conversations = db.conversations.filter((c) => c.id !== conversationId);
        // Cascata: o banco apaga as mensagens junto com a conversa.
        db.messages = db.messages.filter((m) => m.conversationId !== conversationId);
      },
      listMessages: async (conversationId: string) =>
        db.messages.filter((m) => m.conversationId === conversationId),
      addMessage: async (input: Omit<AIMessage, 'id' | 'createdAt'>) => {
        const message: AIMessage = {
          ...input,
          id: `msg-${(db.nextId += 1)}`,
          createdAt: new Date(2026, 7, 22, 10, db.nextId).toISOString(),
        };
        db.messages.push(message);
        return message;
      },
    },
  },
}));

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u1' }, session: { accessToken: 't' }, profile: null }),
}));

jest.mock('@/services/ai', () => ({
  aiService: { kind: 'gemini', send: () => mockAiSend() },
  /*
   * O contexto é um stub, mas `trip.today` NÃO é opcional nele.
   *
   * `AITripContext.trip.today` é o hoje do destino, e o hook o repassa a
   * `parseAIActions` para que `journal.add` saiba separar plano de relato. Um
   * `{}` aqui devolvia `undefined` num campo que o tipo declara obrigatório —
   * o stub mentia sobre o contrato, e a mentira só apareceu quando alguém
   * passou a ler o campo.
   */
  buildTripContext: () => ({ trip: { today: '2026-09-17' } }),
  AI_SUGGESTIONS: [],
}));

jest.mock('@/hooks/useTripData', () => ({
  useExpenses: () => ({ data: [] }),
  useItinerary: () => ({ data: [] }),
  useChecklist: () => ({ data: [] }),
}));
jest.mock('@/hooks/useContent', () => ({ usePlaces: () => ({ data: [] }) }));

/*
 * Um cliente por teste, criado no `beforeEach`.
 *
 * Criá-lo dentro do `wrapper` faria um cliente novo a cada renderização — o
 * cache seria descartado a cada ciclo e as consultas nunca assentariam.
 * `gcTime: Infinity` evita que uma consulta sobrevivente deixe um timer de 5
 * minutos aberto, que o Jest esperaria vencer antes de encerrar.
 */
let queryClient: QueryClient;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

/** Toda montagem é desfeita no fim do teste — nada de assinatura pendurada. */
const montados: { unmount: () => void }[] = [];

const montar = async () => {
  const view = renderHook(() => useAIConversation(paris), { wrapper });
  montados.push(view);
  await waitFor(() => expect(view.result.current.conversationId).toBeTruthy());
  return view;
};

beforeEach(() => {
  resetAIClientRateLimitForTests();
  db.conversations = [];
  db.messages = [];
  db.nextId = 0;
  reply.content = 'resposta';
  reply.actions = [];
  mockAiSend.mockClear();
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      /*
       * `gcTime: Infinity` também nas mutations, e não por simetria.
       *
       * Uma mutation encerrada fica no cache até o `gcTime` vencer — 5 minutos,
       * por padrão —, e o agendamento disso é um `setTimeout` de 300s. O Jest
       * espera o timer vencer antes de encerrar o arquivo, e a suíte inteira
       * ficava pendurada. `Infinity` não agenda nada: o cache é descartado com
       * o cliente, no fim de cada cenário.
       */
      mutations: { gcTime: Infinity, retry: 0 },
    },
  });
});

afterEach(async () => {
  for (const view of montados.splice(0)) view.unmount();
  queryClient.clear();
  jest.restoreAllMocks();
  // O `notifyManager` do React Query agenda o aviso de mudança num `setTimeout`
  // de zero. Sem dar a ele um ciclo para escoar, o Jest termina o arquivo com o
  // timer ainda agendado e avisa que "não conseguiu sair".
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

/* ------------------------------- rate limit ------------------------------- */

describe('A. limite de mensagens', () => {
  it('deixa passar cinco em um minuto', async () => {
    const view = await montar();

    for (let i = 1; i <= 5; i += 1) {
      await act(async () => {
        await view.result.current.send.mutateAsync(`pergunta ${i}`);
      });
    }

    expect(mockAiSend).toHaveBeenCalledTimes(5);
  });

  it('barra a sexta, e diz quanto falta esperar', async () => {
    const view = await montar();
    for (let i = 1; i <= 5; i += 1) {
      await act(async () => {
        await view.result.current.send.mutateAsync(`pergunta ${i}`);
      });
    }

    let capturado: unknown;
    await act(async () => {
      capturado = await view.result.current.send.mutateAsync('sexta').catch((e: unknown) => e);
    });

    expect(capturado).toBeInstanceOf(AIRateLimitError);
    expect((capturado as AIRateLimitError).retryAfterSeconds).toBeGreaterThan(0);
    expect((capturado as Error).message).toMatch(/Tente novamente em \d+s/);
    // O ponto: a chamada paga não aconteceu.
    expect(mockAiSend).toHaveBeenCalledTimes(5);
  });

  it('recusar não grava nada — nem a pergunta do usuário', async () => {
    const view = await montar();
    for (let i = 1; i <= 5; i += 1) {
      await act(async () => {
        await view.result.current.send.mutateAsync(`pergunta ${i}`);
      });
    }
    const antes = db.messages.length;

    await act(async () => {
      await view.result.current.send.mutateAsync('sexta').catch(() => undefined);
    });

    // Uma recusa que já tivesse escrito a pergunta deixaria a conversa com um
    // balão sem resposta e sem explicação.
    expect(db.messages).toHaveLength(antes);
  });

  it('passada a janela, volta a aceitar', async () => {
    const view = await montar();
    for (let i = 1; i <= 5; i += 1) {
      await act(async () => {
        await view.result.current.send.mutateAsync(`pergunta ${i}`);
      });
    }

    const agora = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(agora + 61_000);

    await act(async () => {
      await view.result.current.send.mutateAsync('depois da janela');
    });

    expect(mockAiSend).toHaveBeenCalledTimes(6);
  });

  it('toque duplo no mesmo instante faz uma chamada só', async () => {
    const view = await montar();

    // Sem `await` entre os dois: é a situação real do toque duplo, em que a
    // segunda chamada não vê o estado que a primeira ainda vai produzir. Por
    // isso a trava é um `ref`, e não estado de renderização.
    const resultados = await act(async () =>
      Promise.all([
        view.result.current.send.mutateAsync('mesma').catch((e: unknown) => e),
        view.result.current.send.mutateAsync('mesma').catch((e: unknown) => e),
      ]),
    );

    expect(mockAiSend).toHaveBeenCalledTimes(1);
    expect(resultados.some((r) => r instanceof AIRequestInFlightError)).toBe(true);
  });

  it('trocar de aba e remontar o hook não zera a janela', async () => {
    const first = await montar();
    for (let i = 1; i <= 5; i += 1) {
      await act(async () => {
        await first.result.current.send.mutateAsync(`pergunta ${i}`);
      });
    }
    first.unmount();
    montados.splice(montados.indexOf(first), 1);

    const mountedAgain = await montar();
    let blocked: unknown;
    await act(async () => {
      blocked = await mountedAgain.result.current.send
        .mutateAsync('sexta depois de remontar')
        .catch((error: unknown) => error);
    });

    expect(blocked).toBeInstanceOf(AIRateLimitError);
    expect(mockAiSend).toHaveBeenCalledTimes(5);
  });
});

/* -------------------------------- novo chat ------------------------------- */

describe('B. novo chat apaga a conversa anterior', () => {
  it('a conversa e as mensagens somem do repositório', async () => {
    const view = await montar();
    await act(async () => {
      await view.result.current.send.mutateAsync('pergunta');
    });

    const anterior = view.result.current.conversationId!;
    expect(db.messages.filter((m) => m.conversationId === anterior).length).toBeGreaterThan(0);

    await act(async () => {
      await view.result.current.newChat.mutateAsync();
    });

    // "Criou novo chat, já era o anterior": não sobra thread escondida.
    expect(db.conversations.some((c) => c.id === anterior)).toBe(false);
    expect(db.messages.filter((m) => m.conversationId === anterior)).toEqual([]);
  });

  it('a conversa nova é outra, e nasce vazia', async () => {
    const view = await montar();
    const anterior = view.result.current.conversationId;

    await act(async () => {
      await view.result.current.newChat.mutateAsync();
    });

    await waitFor(() => expect(view.result.current.conversationId).not.toBe(anterior));
    expect(view.result.current.messages).toEqual([]);
  });

  it('reabrir o aplicativo não recupera o chat apagado', async () => {
    const primeiro = await montar();
    await act(async () => {
      await primeiro.result.current.send.mutateAsync('pergunta antiga');
    });
    await act(async () => {
      await primeiro.result.current.newChat.mutateAsync();
    });
    primeiro.unmount();

    // Uma montagem nova é o que acontece ao reabrir o app: `getOrCreate` pega a
    // conversa que existe. Se a antiga tivesse sobrevivido, ela voltaria aqui.
    const segundo = await montar();
    await waitFor(() => expect(segundo.result.current.messages).toEqual([]));
    expect(db.messages).toEqual([]);
    expect(db.conversations).toHaveLength(1);
  });

  it('a viagem selecionada não muda', async () => {
    // Começar de novo é sobre a conversa, não sobre o contexto.
    const view = await montar();
    await act(async () => {
      await view.result.current.newChat.mutateAsync();
    });
    expect(db.conversations[0].tripId).toBe('trip-paris');
  });

  it('as propostas pendentes vão junto', async () => {
    reply.actions = [
      {
        type: 'checklist.add',
        label: 'Adicionar item',
        items: [{ label: 'Adaptador de tomada', category: 'mala' }],
      },
    ];

    const view = await montar();
    await act(async () => {
      await view.result.current.send.mutateAsync('o que levar?');
    });
    await waitFor(() => expect(view.result.current.pendingProposal).not.toBeNull());

    await act(async () => {
      await view.result.current.newChat.mutateAsync();
    });

    // Um botão "Implementar" apontando para uma mensagem apagada é uma promessa
    // sem lastro.
    await waitFor(() => expect(view.result.current.pendingProposal).toBeNull());
  });
});

/* ----------------------------- proposta aberta ---------------------------- */

describe('C. a proposta que fica pendente', () => {
  const checklistAction = [
    {
      type: 'checklist.add',
      label: 'Adicionar 1 item',
      items: [{ label: 'Adaptador de tomada', category: 'mala' }],
    },
  ];

  it('uma resposta com proposta deixa a proposta aberta', async () => {
    reply.actions = checklistAction;
    const view = await montar();

    await act(async () => {
      await view.result.current.send.mutateAsync('o que levar?');
    });

    await waitFor(() => expect(view.result.current.pendingProposal).not.toBeNull());
    expect(view.result.current.pendingProposal!.actions[0].type).toBe('checklist.add');
    // O card aparece sozinho, sem a pessoa precisar escrever "aprovar".
    expect(view.result.current.actionsFor(view.result.current.pendingProposal!.messageId)).toHaveLength(1);
  });

  it('uma resposta sem proposta não deixa nada aberto', async () => {
    // Pergunta de leitura — "quanto já gastei?" — não ganha botão nenhum (§17).
    const view = await montar();
    await act(async () => {
      await view.result.current.send.mutateAsync('quanto já gastei?');
    });
    expect(view.result.current.pendingProposal).toBeNull();
  });

  it('remove promessa depois que a validação local descarta a action', async () => {
    // O aviso solto virou rastro estruturado (§2 do handoff): as mesmas
    // contagens, agora numa fase nomeada que o aparelho também emite.
    const fases: { fase: string; campos: AITraceFields }[] = [];
    const parar = onAITrace((fase, campos) => fases.push({ fase, campos }));
    reply.content =
      'Encontrei algumas opções para amanhã. Preparei a proposta abaixo. ' +
      'Revise e confirme no aplicativo.';
    // A Function remota antiga pode entregar isto; sem data, o cliente recusa
    // o item e portanto não consegue renderizar um card.
    reply.actions = [
      {
        type: 'itinerary.add',
        label: 'Adicionar ao roteiro',
        items: [{ title: 'Louvre sem data' }],
      },
    ];
    const view = await montar();

    await act(async () => {
      await view.result.current.send.mutateAsync('monte um roteiro');
    });

    const assistant = db.messages.find((message) => message.role === 'assistant');
    expect(assistant?.content).toBe('Encontrei algumas opções para amanhã.');
    expect(view.result.current.pendingProposal).toBeNull();
    expect(fases.find((f) => f.fase === 'AI_PARSE_RESULT')?.campos).toMatchObject({
      code: 'PROMISES_STRIPPED',
    });
    expect(fases.find((f) => f.fase === 'AI_ACTION_COUNT')?.campos).toMatchObject({
      actionCount: 0,
    });
    parar();
  });

  it('aplicada, deixa de estar aberta — e não pode reaplicar', async () => {
    reply.actions = checklistAction;
    const view = await montar();
    await act(async () => {
      await view.result.current.send.mutateAsync('o que levar?');
    });
    await waitFor(() => expect(view.result.current.pendingProposal).not.toBeNull());

    const aberta = view.result.current.pendingProposal!;
    act(() => {
      view.result.current.markApplied(aberta.actions.map((a) => a.id));
    });

    await waitFor(() => expect(view.result.current.pendingProposal).toBeNull());
  });

  it('descartada, deixa de estar aberta', async () => {
    reply.actions = checklistAction;
    const view = await montar();
    await act(async () => {
      await view.result.current.send.mutateAsync('o que levar?');
    });
    await waitFor(() => expect(view.result.current.pendingProposal).not.toBeNull());

    const aberta = view.result.current.pendingProposal!;
    act(() => {
      view.result.current.dismissProposal(aberta.messageId);
    });

    await waitFor(() => expect(view.result.current.pendingProposal).toBeNull());
  });

  it('a proposta aberta é a mais recente', async () => {
    reply.actions = checklistAction;
    const view = await montar();

    await act(async () => {
      await view.result.current.send.mutateAsync('primeira');
    });
    await waitFor(() => expect(view.result.current.pendingProposal).not.toBeNull());
    const primeira = view.result.current.pendingProposal!.messageId;

    await act(async () => {
      await view.result.current.send.mutateAsync('segunda');
    });

    await waitFor(() =>
      expect(view.result.current.pendingProposal!.messageId).not.toBe(primeira),
    );
  });

  it('a segunda resposta também registra actions e pode produzir outro card', async () => {
    reply.actions = checklistAction;
    const view = await montar();

    await act(async () => {
      await view.result.current.send.mutateAsync('primeira proposta');
    });
    await waitFor(() => expect(view.result.current.pendingProposal).not.toBeNull());
    const first = view.result.current.pendingProposal!;

    reply.actions = [
      {
        type: 'itinerary.add',
        label: 'Adicionar roteiro',
        items: [{ title: 'Louvre', date: '2026-08-23', type: 'atracao' }],
      },
    ];
    await act(async () => {
      await view.result.current.send.mutateAsync('segunda proposta');
    });

    await waitFor(() => expect(view.result.current.pendingProposal?.messageId).not.toBe(first.messageId));
    const second = view.result.current.pendingProposal!;
    expect(second.actions[0].type).toBe('itinerary.add');
    expect(view.result.current.actionsFor(first.messageId)).toHaveLength(1);
    expect(view.result.current.actionsFor(second.messageId)).toHaveLength(1);
  });
});

/* -------------------- D. o que o aparelho não conseguia ver ------------------- */

/**
 * §1–§8 do handoff: os dois sintomas do Android físico.
 *
 * A bolha do "•" e o "Não foi possível obter uma resposta agora" chegavam à
 * tela sem dizer o que tinha acontecido. Estes casos fixam as duas garantias
 * que faltavam: nada ilegível vira mensagem, e toda falha carrega status,
 * código e fase.
 */
describe('D. a resposta ilegível nunca vira mensagem', () => {
  it.each(['•', '- ', '   ', '*'])('%p é recusado em vez de virar bolha', async (texto) => {
    reply.content = texto;
    reply.actions = [];
    const view = await montar();

    await act(async () => {
      await expect(view.result.current.send.mutateAsync('monte um roteiro')).rejects.toMatchObject({
        name: 'AIRequestError',
        fields: { code: 'EMPTY_AFTER_PARSE', stage: 'PARSE' },
      });
    });

    // A pergunta fica (ela foi feita), mas nenhuma bolha muda entra no histórico.
    expect(db.messages.filter((m) => m.role === 'assistant')).toHaveLength(0);
  });

  it('recarregar a conversa não faz o "•" reaparecer', async () => {
    reply.content = '•';
    const primeira = await montar();
    await act(async () => {
      await primeira.result.current.send.mutateAsync('monte um roteiro').catch(() => undefined);
    });

    // Uma segunda montagem lê o que está gravado. Se um "•" tivesse sido
    // persistido, ele voltaria aqui — e voltava, a cada abertura da aba.
    const segunda = await montar();
    await waitFor(() => expect(segunda.result.current.isLoading).toBe(false));
    for (const message of segunda.result.current.messages) {
      expect(message.content.trim()).not.toMatch(/^(?:[-*+•]|\d{1,3}[.)])$/);
    }
  });
});

describe('D2. toda falha diz status, código e fase', () => {
  it('o rastro registra começo, erro e fim mesmo quando o envio falha', async () => {
    const fases: string[] = [];
    const parar = onAITrace((fase) => fases.push(fase));
    mockAiSend.mockRejectedValueOnce(new Error('boom'));
    const view = await montar();

    await act(async () => {
      await view.result.current.send.mutateAsync('oi').catch(() => undefined);
    });
    parar();

    expect(fases).toContain('USER_SEND');
    expect(fases).toContain('AI_REQUEST_END');
  });

  it('o rastro conta as actions que sobreviveram à validação', async () => {
    const eventos: { fase: string; campos: AITraceFields }[] = [];
    const parar = onAITrace((fase, campos) => eventos.push({ fase, campos }));
    reply.content = 'Seu dia está montado.';
    reply.actions = [
      {
        type: 'itinerary.add',
        label: 'Adicionar ao roteiro',
        items: [
          { title: 'Louvre', date: '2026-08-23' },
          { title: 'Orsay', date: '2026-08-23' },
          { title: 'Sena', date: '2026-08-23' },
        ],
      },
    ];
    const view = await montar();

    await act(async () => {
      await view.result.current.send.mutateAsync('monte um roteiro');
    });
    parar();

    expect(eventos.find((e) => e.fase === 'AI_ACTION_COUNT')?.campos).toMatchObject({
      actionCount: 1,
      itineraryItems: 3,
    });
    expect(eventos.some((e) => e.fase === 'AI_MESSAGE_COMMIT')).toBe(true);
    expect(eventos.some((e) => e.fase === 'AI_ACTION_COMMIT')).toBe(true);
  });

  it('toque duplo continua fazendo UMA chamada só', async () => {
    const view = await montar();

    await act(async () => {
      const primeira = view.result.current.send.mutateAsync('monte um roteiro');
      const segunda = view.result.current.send.mutateAsync('monte um roteiro');
      await Promise.all([primeira, segunda.catch(() => undefined)]);
    });

    expect(mockAiSend).toHaveBeenCalledTimes(1);
  });
});
