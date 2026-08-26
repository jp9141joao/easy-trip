import { act, fireEvent, render } from '@testing-library/react-native';
import { Keyboard, StyleSheet } from 'react-native';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';

import AdvisorScreen from '@/app/(tabs)/advisor';
import { ToastProvider } from '@/components/ui';
import { DOCK_CLEARANCE } from '@/constants/layout';
import type { AIMessage, Trip } from '@/domain/types';
import { ThemeProvider } from '@/theme';

/**
 * O vão embaixo do composer (§2 do hotfix).
 *
 * O DEFEITO, EM UMA FRASE: a `ScrollView` da conversa não reivindicava o espaço
 * que sobrava, então com poucas mensagens ela ficava baixinha, o composer subia
 * colado nela, e a folga da tela caía **abaixo** do composer — um buraco entre
 * o campo de texto e a navbar. Com muitas mensagens a lista enchia a tela e o
 * mesmo layout parecia certo, o que fazia o defeito parecer intermitente.
 *
 * O que se mede aqui é a propriedade que corrige isso e que não depende de
 * pixel: **a conversa é o elemento elástico da coluna**. Se ela cresce para
 * ocupar o que sobra, o composer fica ancorado embaixo em todos os estados — e
 * a folga passa a viver dentro da lista, entre o cabeçalho e as mensagens.
 *
 * Medir altura renderizada não serviria: o `react-test-renderer` não roda o
 * layout do Yoga, então toda altura é zero. O que existe, e é o que de fato
 * governa a coluna, é o estilo.
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

const state = {
  trips: [paris] as Trip[],
  aiTripContextId: 'trip-paris' as string | null,
  messages: [] as AIMessage[],
};

const mensagens = (quantas: number, tamanho = 40): AIMessage[] =>
  Array.from({ length: quantas }, (_, index) => ({
    id: `m${index}`,
    conversationId: 'conv-trip-paris',
    role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
    content: 'x'.repeat(tamanho),
    createdAt: `2026-08-22T10:${String(index).padStart(2, '0')}:00.000Z`,
  }));

jest.mock('@/hooks/useTrips', () => ({
  useTrips: () => ({ data: state.trips, isLoading: false, isSuccess: true }),
}));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
jest.mock('@/lib/aiTripContext', () => ({
  readAITripContext: async () => state.aiTripContextId,
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
    run: jest.fn(),
    undo: jest.fn(),
    runningKey: null,
    undoing: false,
    isBusy: false,
  }),
}));
jest.mock('@/hooks/useAI', () => {
  const actual = jest.requireActual('@/domain/aiRateLimit');
  return {
    AI_RATE_LIMIT: actual.AI_RATE_LIMIT,
    AIRateLimitError: actual.AIRateLimitError,
    AIRequestInFlightError: actual.AIRequestInFlightError,
    useAIConversation: (trip: Trip | null) => ({
      conversationId: trip ? 'conv-trip-paris' : undefined,
      messages: trip ? state.messages : [],
      isLoading: false,
      kind: 'gemini' as const,
      send: { isPending: false, mutateAsync: jest.fn(), reset: jest.fn() },
      newChat: { isPending: false, mutateAsync: jest.fn() },
      actionsFor: () => [],
      appliedActionIds: [] as string[],
      markApplied: jest.fn(),
      unmarkApplied: jest.fn(),
      pendingProposal: null,
      dismissProposal: jest.fn(),
    }),
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

type Node = { props: Record<string, unknown> };

const flat = (style: unknown): Record<string, unknown> =>
  (StyleSheet.flatten(style as never) ?? {}) as Record<string, unknown>;

const conversa = (view: Awaited<ReturnType<typeof abrirAbaIA>>): Node =>
  view.getByTestId('ai-conversation') as unknown as Node;

const composerRow = (view: Awaited<ReturnType<typeof abrirAbaIA>>): Node =>
  view.getByTestId('ai-composer') as unknown as Node;

/*
 * O teclado, dublado nos próprios eventos do React Native.
 *
 * `Keyboard.emit` não existe fora do runtime nativo, e o `useKeyboardVisible`
 * escuta `Keyboard.addListener`. Interceptar a inscrição é o que permite abrir
 * e fechar o teclado dentro do teste.
 */
type Handler = () => void;
const keyboardListeners = new Map<string, Set<Handler>>();

/*
 * `show`/`hide` e não o nome do evento: o hook escuta `Will*` no iOS e `Did*`
 * no Android, e este teste é sobre o layout, não sobre qual nome cada
 * plataforma usa — isso já tem suíte própria (`use-keyboard.test.ts`).
 */
const teclado = (fase: 'show' | 'hide') =>
  act(async () => {
    for (const [evento, handlers] of keyboardListeners) {
      if (!evento.toLowerCase().endsWith(fase)) continue;
      for (const handler of handlers) handler();
    }
  });

beforeEach(() => {
  state.trips = [paris];
  state.aiTripContextId = 'trip-paris';
  state.messages = [];

  keyboardListeners.clear();
  jest.spyOn(Keyboard, 'addListener').mockImplementation(((event: string, handler: Handler) => {
    if (!keyboardListeners.has(event)) keyboardListeners.set(event, new Set());
    keyboardListeners.get(event)!.add(handler);
    return {
      remove: () => {
        keyboardListeners.get(event)?.delete(handler);
      },
    };
  }) as unknown as typeof Keyboard.addListener);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('a conversa reivindica o espaço que sobra', () => {
  const cenarios: [string, AIMessage[]][] = [
    ['zero mensagens', []],
    ['uma mensagem', mensagens(1)],
    ['vinte mensagens', mensagens(20)],
    ['uma resposta longa', mensagens(1, 4000)],
  ];

  it.each(cenarios)('%s: a lista é elástica e rola', async (_nome, msgs) => {
    state.messages = msgs;
    const view = await abrirAbaIA();

    const estilo = flat(conversa(view).props.style);
    // Elástica: é ela, e não o composer, que absorve a folga da tela. Sem isto
    // a folga aparecia embaixo do composer.
    expect(estilo.flex).toBe(1);

    const container = flat(conversa(view).props.contentContainerStyle);
    // `flexGrow` e não `flex`: com pouco conteúdo o contêiner cresce até
    // preencher; com muito, ele volta a crescer com o conteúdo e a lista rola.
    expect(container.flexGrow).toBe(1);
    expect(container.flex).toBeUndefined();
  });

  it('a folga não muda com a quantidade de mensagens', async () => {
    // A causa da instabilidade visual seria um espaçamento condicionado ao
    // número de mensagens. Não existe: o mesmo layout serve a todos os estados.
    state.messages = [];
    const vazio = flat(composerRow(await abrirAbaIA()).props.style).paddingBottom;

    state.messages = mensagens(20);
    const cheio = flat(composerRow(await abrirAbaIA()).props.style).paddingBottom;

    expect(vazio).toBe(cheio);
  });
});

describe('teclado aberto e fechado', () => {
  it('com o teclado fechado, o composer reserva o espaço do dock', async () => {
    const view = await abrirAbaIA();
    // O dock é `position: absolute` e flutua sobre a tela; sem esta folga ele
    // cobriria o campo de texto (§88).
    expect(flat(composerRow(view).props.style).paddingBottom).toBeGreaterThan(DOCK_CLEARANCE / 2);
  });

  it('com o teclado aberto, a folga cai para a área segura', async () => {
    const view = await abrirAbaIA();
    const fechado = flat(composerRow(view).props.style).paddingBottom as number;

    await teclado('show');

    // O dock sai de cena com o teclado (`(tabs)/_layout.tsx` devolve `null`),
    // então manter a folga dele deixaria o composer boiando acima do teclado.
    //
    // A folga passou a ser o respiro pedido no §11 do handoff — 8 a 12pt acima
    // do teclado — e não mais a área segura inferior: o teclado já cobre essa
    // faixa, e somá-la de novo era mais uma contagem dupla.
    const aberto = flat(composerRow(view).props.style).paddingBottom as number;
    expect(aberto).toBeLessThan(fechado);
    expect(aberto).toBeGreaterThanOrEqual(8);
    expect(aberto).toBeLessThanOrEqual(12);
  });

  it('fechar o teclado devolve a folga original — sem resíduo', async () => {
    const view = await abrirAbaIA();
    const antes = flat(composerRow(view).props.style).paddingBottom;

    await teclado('show');
    await teclado('hide');

    expect(flat(composerRow(view).props.style).paddingBottom).toBe(antes);
  });
});

describe('troca de estado não altera a estrutura', () => {
  it('sem viagem selecionada o composer continua ancorado', async () => {
    state.aiTripContextId = null;
    const view = await abrirAbaIA();

    expect(flat(conversa(view).props.style).flex).toBe(1);
    expect(flat(composerRow(view).props.style).paddingBottom).toBeGreaterThan(0);
  });

  it('trocar de viagem não muda o layout da coluna', async () => {
    const view = await abrirAbaIA();
    const antes = flat(conversa(view).props.style).flex;

    fireEvent.press(view.getByLabelText(/Contexto ativo: Paris/));
    await act(async () => undefined);
    fireEvent.press(view.getByLabelText(/^Paris/));
    await act(async () => undefined);

    expect(flat(conversa(view).props.style).flex).toBe(antes);
  });
});
