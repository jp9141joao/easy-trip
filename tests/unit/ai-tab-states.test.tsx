import { act, fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';

import AdvisorScreen from '@/app/(tabs)/advisor';
import { ToastProvider } from '@/components/ui';
import type { AIMessage, Trip } from '@/domain/types';
import { ThemeProvider } from '@/theme';

/**
 * Os estados da aba IA de Viagens (§7).
 *
 * Cobre o que o teste no aparelho pediu: sem viagem criada, com viagens e
 * nenhuma escolhida, com uma escolhida, na troca Paris → Tóquio, e no "Novo
 * chat". A tela é montada de verdade — o que se substitui são as fontes de
 * dados, para o teste falar sobre comportamento e não sobre rede.
 */

const metrics: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const trip = (overrides: Partial<Trip> = {}): Trip => ({
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
  ...overrides,
});

const paris = trip();
const toquio = trip({
  id: 'trip-toquio',
  destinationCity: 'Tóquio',
  destinationCountry: 'Japão',
  countryCode: 'JP',
  timezone: 'Asia/Tokyo',
  startDate: '2026-09-18',
  endDate: '2026-10-27',
});

const state = {
  trips: [] as Trip[],
  /** A viagem que a **Home** está mostrando. A aba de IA não pode lê-la. */
  currentTripId: null as string | null,
  /** A escolha anterior feita **na IA**, como estaria persistida no aparelho. */
  aiTripContextId: null as string | null,
  messages: [] as AIMessage[],
};

const mockSend = jest.fn(async (_prompt: string) => ({ content: 'ok', local: false }));
const mockNewChat = jest.fn(async () => undefined);
/** A viagem que o hook da conversa recebeu na última renderização. */
const contextoRecebido: { current: Trip | null } = { current: null };

jest.mock('@/hooks/useTrips', () => ({
  useTrips: () => ({ data: state.trips, isLoading: false, isSuccess: true }),
}));

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u1' } }),
}));

/*
 * O armazenamento da escolha da IA, em memória.
 *
 * `state.currentTripId` continua existindo nesta suíte de propósito: ele é a
 * seleção da Home, e vários cenários o deixam apontando para uma viagem só
 * para provar que a aba de IA **não** o consulta.
 */
jest.mock('@/lib/aiTripContext', () => ({
  readAITripContext: async () => state.aiTripContextId,
  writeAITripContext: async (_userId: string, tripId: string | null) => {
    state.aiTripContextId = tripId;
  },
  clearAITripContext: async () => {
    state.aiTripContextId = null;
  },
}));

jest.mock('@/hooks/useContent', () => ({
  useAdvisors: () => ({ data: [], isLoading: false }),
  useConsultations: () => ({ consultations: [], request: { isPending: false } }),
}));

jest.mock('@/hooks/useAI', () => {
  const rateLimit = jest.requireActual('@/domain/aiRateLimit');
  return {
    ...rateLimit,
    useAIConversation: (trip: Trip | null) => {
      contextoRecebido.current = trip;
      return {
        conversationId: trip ? `conv-${trip.id}` : undefined,
        // Cada viagem tem a sua thread: sem viagem, não há mensagem nenhuma.
        messages: trip ? state.messages : [],
        isLoading: false,
        kind: 'gemini' as const,
        send: {
          isPending: false,
          mutateAsync: (prompt: string) => mockSend(prompt),
          reset: jest.fn(),
        },
        newChat: { isPending: false, mutateAsync: () => mockNewChat() },
        pendingProposal: null,
        dismissProposal: jest.fn(),
        // Nenhuma resposta desta suíte traz proposta — o que se mede aqui são os
        // estados da aba, não o fluxo de ações (que tem suíte própria).
        actionsFor: () => [],
        appliedActionIds: [] as string[],
        markApplied: jest.fn(),
        unmarkApplied: jest.fn(),
      };
    },
  };
});

/*
 * A aba lê roteiro e checklist da viagem para detectar duplicata antes de
 * gravar. Aqui as duas viram listas vazias: sem `QueryClientProvider`, as
 * consultas reais não teriam onde rodar, e o assunto desta suíte é outro.
 */
jest.mock('@/hooks/useTripData', () => ({
  useItinerary: () => ({ data: [] }),
  useChecklist: () => ({ data: [] }),
}));

jest.mock('@/hooks/useAIActions', () => ({
  AIActionBlockedError: class extends Error {},
  useAIActionRunner: () => ({
    run: jest.fn(),
    undo: jest.fn(),
    runningKey: null,
    undoing: false,
    isBusy: false,
  }),
}));

const abrirAbaIA = async () => {
  const view = render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <ToastProvider>
          <AdvisorScreen />
        </ToastProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
  await act(async () => undefined);
  fireEvent.press(view.getByLabelText('IA de Viagens'));
  await act(async () => undefined);
  return view;
};

beforeEach(() => {
  state.trips = [];
  state.currentTripId = null;
  state.aiTripContextId = null;
  state.messages = [];
  contextoRecebido.current = null;
  mockSend.mockClear();
  mockNewChat.mockClear();
});

describe('A. nenhuma viagem criada', () => {
  it('explica que é preciso criar uma viagem antes', async () => {
    const view = await abrirAbaIA();
    expect(view.getByText('Crie uma viagem primeiro')).toBeTruthy();
    expect(contextoRecebido.current).toBeNull();
  });
});

describe('B. viagens existentes, nenhuma selecionada', () => {
  beforeEach(() => {
    state.trips = [paris, toquio];
  });

  it('não usa nenhuma viagem escondida como contexto', async () => {
    const view = await abrirAbaIA();
    expect(view.getByText('Escolha uma viagem')).toBeTruthy();
    // O ponto central do §1: nada é assumido em silêncio.
    expect(contextoRecebido.current).toBeNull();
  });

  it('mantém campo e envio desabilitados', async () => {
    const view = await abrirAbaIA();
    expect(view.getByLabelText('Mensagem para a Easy Trip IA').props.editable).toBe(false);
    expect(view.getByLabelText('Enviar mensagem').props.accessibilityState.disabled).toBe(true);
  });

  it('não oferece as sugestões rápidas sem contexto', async () => {
    const view = await abrirAbaIA();
    expect(view.queryByText('Estou gastando demais?')).toBeNull();
  });
});

describe('C. uma viagem selecionada', () => {
  beforeEach(() => {
    state.trips = [paris, toquio];
  });

  it('NÃO herda a viagem que a Home está mostrando', async () => {
    // A regra invertida em relação à versão anterior desta suíte, e o motivo é
    // de produto: escolher Paris na Home não pode trocar o contexto de uma
    // conversa sobre outra viagem. Sem escolha própria, a IA pergunta.
    state.currentTripId = 'trip-paris';
    const view = await abrirAbaIA();

    expect(contextoRecebido.current).toBeNull();
    expect(view.getByText('Escolha uma viagem')).toBeTruthy();
  });

  it('restaura a última viagem escolhida na própria IA', async () => {
    state.aiTripContextId = 'trip-toquio';
    const view = await abrirAbaIA();

    expect(contextoRecebido.current?.id).toBe('trip-toquio');
    expect(view.getByLabelText(/Contexto ativo: Tóquio/)).toBeTruthy();
  });

  it('ignora uma escolha guardada que não pertence à lista do usuário', async () => {
    // Viagem excluída, ou de outra conta: a referência órfã não vira contexto.
    state.aiTripContextId = 'trip-de-outra-conta';
    await abrirAbaIA();
    expect(contextoRecebido.current).toBeNull();
  });

  it('libera a pergunta assim que existe contexto', async () => {
    state.aiTripContextId = 'trip-paris';
    const view = await abrirAbaIA();

    fireEvent.press(view.getByText('Estou gastando demais?'));
    await act(async () => undefined);

    expect(mockSend).toHaveBeenCalledWith('Estou gastando demais?');
  });
});

describe('D/E. troca Paris → Tóquio', () => {
  beforeEach(() => {
    state.trips = [paris, toquio];
    state.aiTripContextId = 'trip-paris';
  });

  it('troca o contexto e é a nova viagem que vale na próxima pergunta', async () => {
    const view = await abrirAbaIA();
    expect(contextoRecebido.current?.destinationCity).toBe('Paris');

    fireEvent.press(view.getByLabelText(/Contexto ativo: Paris/));
    await act(async () => undefined);
    fireEvent.press(view.getByLabelText(/^Tóquio/));
    await act(async () => undefined);

    expect(contextoRecebido.current?.destinationCity).toBe('Tóquio');
    expect(view.getByLabelText(/Contexto ativo: Tóquio/)).toBeTruthy();

    fireEvent.press(view.getByText('Como está meu roteiro?'));
    await act(async () => undefined);

    // A pergunta saiu com Tóquio no contexto, não com Paris.
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(contextoRecebido.current?.id).toBe('trip-toquio');
  });
});

describe('F. novo chat', () => {
  const mensagem = (id: string, content: string): AIMessage => ({
    id,
    conversationId: 'conv-trip-paris',
    role: 'assistant',
    content,
    createdAt: '2026-08-22T10:00:00.000Z',
  });

  beforeEach(() => {
    state.trips = [paris];
    state.aiTripContextId = 'trip-paris';
  });

  it('pergunta antes de encerrar uma conversa em andamento', async () => {
    state.messages = [mensagem('m1', 'Resposta anterior')];
    const view = await abrirAbaIA();

    fireEvent.press(view.getByLabelText('Novo chat'));
    await act(async () => undefined);

    expect(view.getByText('Iniciar novo chat?')).toBeTruthy();
    // O aviso precisa dizer o que de fato acontece: a conversa é apagada.
    expect(view.getByText('A conversa atual e suas mensagens serão apagadas.')).toBeTruthy();
    // Só cria depois da confirmação.
    expect(mockNewChat).not.toHaveBeenCalled();

    fireEvent.press(view.getByLabelText('Cancelar'));
    await act(async () => undefined);
    expect(mockNewChat).not.toHaveBeenCalled();
  });

  it('cria a conversa nova ao confirmar', async () => {
    state.messages = [mensagem('m1', 'Resposta anterior')];
    const view = await abrirAbaIA();

    fireEvent.press(view.getByLabelText('Novo chat'));
    await act(async () => undefined);

    // O último "Novo chat" é o botão de confirmação do diálogo.
    const confirmar = view.getAllByLabelText('Novo chat').at(-1)!;
    fireEvent.press(confirmar);
    await act(async () => undefined);

    expect(mockNewChat).toHaveBeenCalledTimes(1);
    expect(view.queryByText('Iniciar novo chat?')).toBeNull();
  });

  it('não pede confirmação quando não há nada para encerrar', async () => {
    const view = await abrirAbaIA();

    fireEvent.press(view.getByLabelText('Novo chat'));
    await act(async () => undefined);

    expect(view.queryByText('Iniciar novo chat?')).toBeNull();
    expect(mockNewChat).toHaveBeenCalledTimes(1);
  });
});

describe('H. resposta longa em Markdown', () => {
  it('mostra a resposta formatada, sem sintaxe crua', async () => {
    state.trips = [paris];
    state.aiTripContextId = 'trip-paris';
    state.messages = [
      {
        id: 'm1',
        conversationId: 'conv-trip-paris',
        role: 'assistant',
        content: '### Dicas úteis\n\n**Orçamento:** R$ 30.000\n\n- Museu\n- Restaurante',
        createdAt: '2026-08-22T10:00:00.000Z',
      },
    ];

    const view = await abrirAbaIA();

    expect(view.getByText('Dicas úteis')).toBeTruthy();
    expect(view.queryByText('### Dicas úteis')).toBeNull();
    // O leitor de tela ouve a frase, não a pontuação.
    expect(view.getByLabelText(/^Easy Trip IA: Dicas úteis/)).toBeTruthy();
  });
});
