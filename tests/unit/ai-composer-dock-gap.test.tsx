import { act, fireEvent, render } from '@testing-library/react-native';
import { Keyboard, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';

import AdvisorScreen from '@/app/(tabs)/advisor';
import {
  DockMetricsProvider,
  dockGap,
  useReportDockTop,
} from '@/components/navigation/DockMetrics';
import { ToastProvider } from '@/components/ui';
import type { AIMessage, Trip } from '@/domain/types';
import { ThemeProvider, lightTheme, darkTheme } from '@/theme';

/**
 * O vão entre o composer da IA e a navbar (§9–§12 do handoff).
 *
 * DUAS TENTATIVAS ANTES DESTA
 *
 * A primeira reservava 110pt fixos. A segunda calculava: altura medida da
 * barra + área segura inferior. A conta da segunda estava certa no papel, e o
 * vão continuou enorme no aparelho — o que significa que a PREMISSA estava
 * errada, não a aritmética. A premissa era "a tela vai até o fundo da janela e
 * o dock flutua por cima". Quando a coluna já termina acima do dock, somar a
 * altura dele conta a mesma faixa duas vezes.
 *
 * O QUE ESTA SUÍTE FIXA
 *
 * Que a folga é a SOBREPOSIÇÃO MEDIDA — `max(0, fundo da coluna − topo do
 * dock)` — e não uma soma de alturas. Os testes abaixo alimentam as duas
 * posições diretamente, o que permite exercitar tanto o caso "a coluna passa
 * por baixo do dock" quanto o caso "a coluna já para acima dele", que é
 * justamente o que nenhuma das versões anteriores sabia distinguir.
 *
 * Altura renderizada não serve de medida: o `react-test-renderer` não roda o
 * Yoga e toda altura é zero. O que existe é o estilo — e as posições que dock
 * e coluna publicam.
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
  messages: [] as AIMessage[],
};

const mensagens = (quantas: number): AIMessage[] =>
  Array.from({ length: quantas }, (_, index) => ({
    id: `m${index}`,
    conversationId: 'conv-trip-paris',
    role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
    content: 'x'.repeat(60),
    createdAt: `2026-08-22T10:${String(index).padStart(2, '0')}:00.000Z`,
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

/**
 * O papel do dock dentro do teste.
 *
 * O dock de verdade vive no layout das abas e publica o próprio TOPO em
 * coordenadas da janela. Aqui só o que importa é essa publicação: um
 * componente que anuncia a posição que se quer simular, dentro do mesmo
 * provider que a tela lê.
 */
function DockDouble({ topY }: { topY: number }) {
  const report = useReportDockTop();
  return <View testID="dock-double" onLayout={() => report(topY)} />;
}

/** Um aparelho: onde a navbar começa e onde a coluna do composer termina. */
interface Aparelho {
  nome: string;
  /** Altura da janela — o fundo da tela, em coordenadas da janela. */
  janela: number;
  /** Área segura inferior reportada pelo sistema. */
  insetBottom: number;
  /** Altura desenhada da navbar. */
  navbar: number;
  /**
   * A coluna do composer vai até o fundo da janela, ou já para acima do dock?
   * É a variável que quebrou as duas tentativas anteriores.
   */
  colunaAteOFundo: boolean;
}

const APARELHOS: Aparelho[] = [
  { nome: 'gestos, navbar 56', janela: 844, insetBottom: 24, navbar: 56, colunaAteOFundo: true },
  { nome: 'gestos, navbar 64', janela: 844, insetBottom: 24, navbar: 64, colunaAteOFundo: true },
  { nome: 'gestos, navbar 80', janela: 844, insetBottom: 24, navbar: 80, colunaAteOFundo: true },
  { nome: '3 botões, navbar 64', janela: 844, insetBottom: 48, navbar: 64, colunaAteOFundo: true },
  { nome: 'safe area 0, navbar 56', janela: 800, insetBottom: 0, navbar: 56, colunaAteOFundo: true },
  { nome: 'safe area 34, navbar 80', janela: 926, insetBottom: 34, navbar: 80, colunaAteOFundo: true },
  // Os casos que expõem a contagem dupla: a coluna já termina acima do dock.
  { nome: 'coluna já inserida (gestos)', janela: 844, insetBottom: 24, navbar: 64, colunaAteOFundo: false },
  { nome: 'coluna já inserida (3 botões)', janela: 844, insetBottom: 48, navbar: 64, colunaAteOFundo: false },
];

/** O topo do dock, em coordenadas da janela. */
const topoDoDock = (d: Aparelho) => d.janela - Math.max(d.insetBottom, 12) - d.navbar;

/** Onde a coluna do composer termina, em coordenadas da janela. */
const fundoDaColuna = (d: Aparelho) => (d.colunaAteOFundo ? d.janela : topoDoDock(d));

const abrirAbaIA = async (aparelho?: Aparelho) => {
  const view = render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <ToastProvider>
          <DockMetricsProvider>
            {aparelho ? <DockDouble topY={topoDoDock(aparelho)} /> : null}
            <AdvisorScreen />
          </DockMetricsProvider>
        </ToastProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
  await act(async () => undefined);

  fireEvent.press(view.getByLabelText('IA de Viagens'));
  await act(async () => undefined);

  if (aparelho) {
    // O dock publica o próprio topo…
    fireEvent(view.getByTestId('dock-double'), 'layout', {
      nativeEvent: { layout: { x: 0, y: topoDoDock(aparelho), width: 350, height: aparelho.navbar } },
    });
    // …e a coluna publica o próprio fundo. `measureInWindow` não existe no
    // renderer de teste, então a coluna cai no caminho do layout local — que é
    // o mesmo par de números.
    fireEvent(view.getByTestId('ai-dock-column'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 390, height: fundoDaColuna(aparelho) } },
    });
    await act(async () => undefined);
  }
  return view;
};

const flat = (style: unknown): Record<string, unknown> =>
  (StyleSheet.flatten(style as never) ?? {}) as Record<string, unknown>;

const folga = (view: Awaited<ReturnType<typeof abrirAbaIA>>): number =>
  flat((view.getByTestId('ai-composer') as unknown as { props: Record<string, unknown> }).props.style)
    .paddingBottom as number;

type Handler = () => void;
const keyboardListeners = new Map<string, Set<Handler>>();

const teclado = (fase: 'show' | 'hide') =>
  act(async () => {
    for (const [evento, handlers] of keyboardListeners) {
      if (!evento.toLowerCase().endsWith(fase)) continue;
      for (const handler of handlers) handler();
    }
  });

beforeEach(() => {
  state.messages = [];
  keyboardListeners.clear();
  jest.spyOn(Keyboard, 'addListener').mockImplementation(((evento: string, handler: Handler) => {
    const set = keyboardListeners.get(evento) ?? new Set<Handler>();
    set.add(handler);
    keyboardListeners.set(evento, set);
    return { remove: () => set.delete(handler) };
  }) as unknown as typeof Keyboard.addListener);
});

afterEach(() => jest.restoreAllMocks());

describe('a folga é a sobreposição medida, não uma soma de alturas', () => {
  it.each(APARELHOS.map((d) => [d.nome, d] as const))(
    '%s: o composer para 8–16pt acima da navbar',
    async (_nome, aparelho) => {
      const view = await abrirAbaIA(aparelho);

      // Onde o campo termina, em coordenadas da janela.
      const fimDoComposer = fundoDaColuna(aparelho) - folga(view);
      const vao = topoDoDock(aparelho) - fimDoComposer;

      // Abaixo de zero o composer estaria ATRÁS da navbar; acima de 16 volta o
      // buraco que apareceu no aparelho.
      expect(vao).toBeGreaterThanOrEqual(8);
      expect(vao).toBeLessThanOrEqual(16);
    },
  );

  it('a coluna que já para acima do dock NÃO soma a navbar de novo', async () => {
    // Esta é a contagem dupla do §10, isolada: mesmo aparelho, mesma navbar, e
    // a única diferença é a coluna terminar no fundo da janela ou no topo do
    // dock. Na versão anterior as duas reservavam o mesmo, e uma delas ficava
    // com a altura da navbar inteira de espaço vazio.
    const passandoPorBaixo = APARELHOS.find((d) => d.nome === 'gestos, navbar 64')!;
    const jaInserida = APARELHOS.find((d) => d.nome === 'coluna já inserida (gestos)')!;

    const comSobreposicao = folga(await abrirAbaIA(passandoPorBaixo));
    const semSobreposicao = folga(await abrirAbaIA(jaInserida));

    expect(semSobreposicao).toBe(dockGap(lightTheme));
    expect(comSobreposicao).toBe(
      passandoPorBaixo.navbar + Math.max(passandoPorBaixo.insetBottom, 12) + dockGap(lightTheme),
    );
    expect(comSobreposicao).toBeGreaterThan(semSobreposicao);
  });

  it('uma navbar mais alta empurra o composer na mesma medida', async () => {
    const baixa = APARELHOS.find((d) => d.nome === 'gestos, navbar 56')!;
    const alta = APARELHOS.find((d) => d.nome === 'gestos, navbar 80')!;

    expect(folga(await abrirAbaIA(alta)) - folga(await abrirAbaIA(baixa))).toBe(
      alta.navbar - baixa.navbar,
    );
  });

  it('sem medição ainda, reserva a MAIS — nunca a menos', async () => {
    // Enquanto as medidas não chegam, esconder o campo atrás da navbar é o
    // erro pior dos dois. A estimativa sai dos tokens da própria barra.
    const view = await abrirAbaIA();
    expect(folga(view)).toBeGreaterThan(dockGap(lightTheme));
  });

  it('claro e escuro produzem a mesma folga — a fórmula não lê cor', () => {
    expect(dockGap(darkTheme)).toBe(dockGap(lightTheme));
  });
});

describe('o teclado troca a referência, não a fórmula', () => {
  const aparelho = APARELHOS[1];

  it('abrindo o teclado, sobra só o respiro acima do teclado', async () => {
    const view = await abrirAbaIA(aparelho);
    const fechado = folga(view);

    await teclado('show');
    const aberto = folga(view);

    // O dock sai de cena com o teclado; manter a folga dele deixaria o
    // composer boiando acima do teclado (§11: 8–12pt).
    expect(aberto).toBeLessThan(fechado);
    expect(aberto).toBeGreaterThanOrEqual(8);
    expect(aberto).toBeLessThanOrEqual(12);
  });

  it('fechando o teclado, o composer volta para logo acima da navbar', async () => {
    const view = await abrirAbaIA(aparelho);
    const antes = folga(view);

    await teclado('show');
    await teclado('hide');

    expect(folga(view)).toBe(antes);
  });
});

describe('a folga não depende do conteúdo da conversa', () => {
  it.each([0, 1, 25])('com %i mensagens, a mesma distância da navbar', async (quantas) => {
    state.messages = mensagens(quantas);
    const aparelho = APARELHOS[1];
    const view = await abrirAbaIA(aparelho);

    const vao = topoDoDock(aparelho) - (fundoDaColuna(aparelho) - folga(view));
    expect(vao).toBeGreaterThanOrEqual(8);
    expect(vao).toBeLessThanOrEqual(16);
  });
});
