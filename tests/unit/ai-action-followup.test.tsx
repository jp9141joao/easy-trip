import { act, fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';

import AdvisorScreen from '@/app/(tabs)/advisor';
import { ToastProvider } from '@/components/ui';
import { isApplyConfirmation, type AITripAction } from '@/domain/aiActions';
import { AIRateLimitError } from '@/domain/aiRateLimit';
import type { AIMessage, Trip } from '@/domain/types';
import { ThemeProvider } from '@/theme';

/**
 * A proposta na tela, e o "pode aplicar" que a pessoa escreveu.
 *
 * O QUE ACONTECEU NO APARELHO: a IA respondeu "preparei a proposta, revise e
 * confirme a aplicação no aplicativo" e nenhum card apareceu. O usuário escreveu
 * "aprovar"; a frase virou outra pergunta ao Gemini, que respondeu de novo
 * "revise e confirme…". Nada foi gravado. O roteiro continuou vazio.
 *
 * São duas correções distintas, e as duas são medidas aqui:
 *
 *  1. **o card aparece sozinho** quando a resposta traz proposta — ninguém
 *     precisa escrever nada para vê-lo;
 *  2. **"pode aplicar" abre a revisão** da proposta que já existe, em vez de
 *     virar uma pergunta nova. Reconhecer a confirmação não é gravar às cegas:
 *     a revisão abre com os itens à vista.
 */

const metrics: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

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

const roteiro: AITripAction = {
  id: 'action-1',
  tripId: 'trip-paris',
  type: 'itinerary.add',
  label: 'Adicionar 3 itens ao roteiro',
  items: [
    { title: 'Museu do Louvre', date: '2026-08-23', startTime: '09:00', type: 'atracao' },
    { title: 'Jardin des Tuileries', date: '2026-08-23', startTime: '15:00', type: 'atividade' },
    { title: 'Torre Eiffel', date: '2026-08-23', startTime: '18:00', type: 'atracao' },
  ],
};

const resposta: AIMessage = {
  id: 'msg-1',
  conversationId: 'conv-1',
  role: 'assistant',
  content: 'Preparei uma sugestão para amanhã.',
  createdAt: '2026-08-22T10:00:00.000Z',
};

const state = {
  /** As propostas que a conversa tem abertas, por mensagem. */
  actions: {} as Record<string, AITripAction[]>,
  messages: [] as AIMessage[],
};

const mockSend = jest.fn(async (_prompt: string) => ({ content: 'ok', local: false }));
const mockRun = jest.fn(async () => ({
  ok: true,
  partial: false,
  undoable: true,
  outcomes: [
    {
      actionId: 'action-1',
      type: 'itinerary.add' as const,
      ok: true,
      succeeded: 3,
      failed: [],
      summary: '3 itens adicionados ao roteiro',
    },
  ],
  created: [],
}));

jest.mock('@/hooks/useTrips', () => ({
  useTrips: () => ({ data: [paris], isLoading: false, isSuccess: true }),
}));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
jest.mock('@/lib/aiTripContext', () => ({
  readAITripContext: async () => 'trip-paris',
  writeAITripContext: async () => undefined,
  clearAITripContext: async () => undefined,
}));
jest.mock('@/hooks/useContent', () => ({
  useAdvisors: () => ({ data: [], isLoading: false }),
  useConsultations: () => ({ consultations: [], request: { isPending: false } }),
}));
jest.mock('@/hooks/useTripData', () => ({
  useItinerary: () => ({ data: [] }),
  useChecklist: () => ({ data: [] }),
}));
jest.mock('@/hooks/useAIActions', () => ({
  AIActionBlockedError: class extends Error {},
  useAIActionRunner: () => ({
    run: () => mockRun(),
    undo: jest.fn(),
    runningKey: null,
    undoing: false,
    isBusy: false,
  }),
}));
jest.mock('@/hooks/useAI', () => {
  const rateLimit = jest.requireActual('@/domain/aiRateLimit');
  return {
    ...rateLimit,
    useAIConversation: () => {
      const abertas = Object.entries(state.actions);
      const [messageId, actions] = abertas.at(-1) ?? [];
      return {
        conversationId: 'conv-1',
        messages: state.messages,
        isLoading: false,
        kind: 'gemini' as const,
        send: {
          isPending: false,
          mutateAsync: (prompt: string) => mockSend(prompt),
          reset: jest.fn(),
        },
        newChat: { isPending: false, mutateAsync: jest.fn() },
        actionsFor: (id: string) => state.actions[id] ?? [],
        appliedActionIds: [] as string[],
        markApplied: jest.fn(),
        unmarkApplied: jest.fn(),
        pendingProposal: messageId && actions ? { messageId, actions } : null,
        dismissProposal: jest.fn(),
      };
    },
  };
});

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

const escrever = async (view: Awaited<ReturnType<typeof abrirAbaIA>>, texto: string) => {
  fireEvent.changeText(view.getByLabelText('Mensagem para a Easy Trip IA'), texto);
  await act(async () => undefined);
  fireEvent.press(view.getByLabelText('Enviar mensagem'));
  await act(async () => undefined);
};

beforeEach(() => {
  state.actions = {};
  state.messages = [];
  mockSend.mockClear();
  mockRun.mockClear();
});

describe('A. o card aparece sozinho', () => {
  it('uma resposta com proposta mostra "Aplicar à viagem" logo abaixo', async () => {
    state.messages = [resposta];
    state.actions = { 'msg-1': [roteiro] };

    const view = await abrirAbaIA();

    // Ninguém precisou escrever "aprovar" para o card existir.
    expect(view.getByText('Adicionar 3 itens ao roteiro')).toBeTruthy();
    expect(view.getByText('• 3 itens de roteiro')).toBeTruthy();
    expect(view.getByLabelText('Revisar')).toBeTruthy();
    expect(view.getByLabelText('Implementar')).toBeTruthy();
  });

  it('uma resposta sem proposta não mostra botão nenhum', async () => {
    // Pergunta de leitura — "quanto já gastei?" — não ganha card (§17).
    state.messages = [{ ...resposta, content: 'Você já gastou R$ 4.200.' }];

    const view = await abrirAbaIA();
    expect(view.queryByLabelText('Implementar')).toBeNull();
    expect(view.queryByLabelText('Revisar')).toBeNull();
  });
});

describe('B. "pode aplicar" com proposta aberta', () => {
  beforeEach(() => {
    state.messages = [resposta];
    state.actions = { 'msg-1': [roteiro] };
  });

  it('Implementar exige revisão e confirmação mesmo para um único bloco sem avisos', async () => {
    const view = await abrirAbaIA();
    expect(mockRun).not.toHaveBeenCalled();

    fireEvent.press(view.getByLabelText('Implementar'));
    await act(async () => undefined);

    expect(mockRun).not.toHaveBeenCalled();
    expect(view.getByText('Revisar antes de adicionar')).toBeTruthy();
    expect(view.getByText('Museu do Louvre')).toBeTruthy();

    fireEvent.press(view.getByLabelText(/Adicionar 3 itens/));
    await act(async () => undefined);
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it('cancelar a revisão aberta por Implementar preserva a proposta sem gravar', async () => {
    const view = await abrirAbaIA();
    fireEvent.press(view.getByLabelText('Implementar'));
    await act(async () => undefined);
    fireEvent.press(view.getByLabelText('Cancelar'));
    await act(async () => undefined);

    expect(mockRun).not.toHaveBeenCalled();
    expect(view.queryByText('Revisar antes de adicionar')).toBeNull();
    expect(view.getByLabelText('Implementar')).toBeTruthy();
  });

  it('abre a revisão em vez de perguntar ao modelo de novo', async () => {
    const view = await abrirAbaIA();

    await escrever(view, 'Pode aplicar');

    // O laço que a pessoa viveu no aparelho: a frase virava outra chamada, e o
    // modelo respondia "revise e confirme no aplicativo" sobre uma proposta que
    // ele não tem como reabrir.
    expect(mockSend).not.toHaveBeenCalled();
    expect(view.getByText('Revisar antes de adicionar')).toBeTruthy();
    // Os três itens à vista: confirmar não é gravar às cegas.
    expect(view.getByText('Museu do Louvre')).toBeTruthy();
    expect(view.getByText('Torre Eiffel')).toBeTruthy();
  });

  it('confirmar na revisão grava', async () => {
    const view = await abrirAbaIA();
    await escrever(view, 'Aprovar');

    fireEvent.press(view.getByLabelText(/Adicionar 3 itens/));
    await act(async () => undefined);

    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it('cancelar na revisão não grava', async () => {
    const view = await abrirAbaIA();
    await escrever(view, 'Aprovar');

    fireEvent.press(view.getByLabelText('Cancelar'));
    await act(async () => undefined);

    expect(mockRun).not.toHaveBeenCalled();
    expect(view.queryByText('Revisar antes de adicionar')).toBeNull();
  });

  it('a pergunta de verdade continua indo ao modelo', async () => {
    const view = await abrirAbaIA();
    await escrever(view, 'Pode aplicar, mas troca o Louvre para a tarde');

    // Um pedido de ajuste não é uma confirmação: quem sabe reorganizar a
    // proposta é o modelo.
    expect(mockSend).toHaveBeenCalledWith('Pode aplicar, mas troca o Louvre para a tarde');
  });
});

describe('C. sem proposta aberta, "aprovar" é só uma mensagem', () => {
  it('vai ao modelo como qualquer outra frase', async () => {
    state.messages = [{ ...resposta, content: 'Você já gastou R$ 4.200.' }];

    const view = await abrirAbaIA();
    await escrever(view, 'Aprovar');

    expect(mockSend).toHaveBeenCalledWith('Aprovar');
  });
});

describe('D. o reconhecedor de confirmação', () => {
  it('aceita as formas curtas e inequívocas', () => {
    const frases = [
      'Aprovar',
      'aprovado',
      'Pode aplicar',
      'pode adicionar',
      'Sim',
      'Sim, implemente',
      'Confirmo',
      'ok, pode aplicar',
    ];
    for (const frase of frases) expect(isApplyConfirmation(frase)).toBe(true);
  });

  it('recusa o que carrega pedido junto', () => {
    // Frase longa ou ambígua segue para o modelo, que é quem sabe lidar com um
    // ajuste. Errar para este lado custa uma chamada; errar para o outro
    // aplicaria uma proposta que a pessoa queria mudar.
    const frases = [
      'Pode aplicar mas só os dois primeiros',
      'aprovar o quê?',
      'Quanto já gastei?',
      'não pode aplicar ainda',
      '',
    ];
    for (const frase of frases) expect(isApplyConfirmation(frase)).toBe(false);
  });
});

describe('E. mensagem bloqueada pelo limite', () => {
  it('devolve o texto ao composer', async () => {
    state.messages = [resposta];
    mockSend.mockRejectedValueOnce(new AIRateLimitError(30));
    const view = await abrirAbaIA();

    await escrever(view, 'Meu texto não pode sumir');

    expect(view.getByLabelText('Mensagem para a Easy Trip IA').props.value).toBe(
      'Meu texto não pode sumir',
    );
  });
});
