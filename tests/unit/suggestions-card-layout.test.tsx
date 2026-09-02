import { fireEvent, render as rtlRender } from '@testing-library/react-native';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';

import SuggestionsScreen from '@/app/trip/[tripId]/suggestions';
import { ToastProvider } from '@/components/ui';
import { ThemeProvider } from '@/theme';
import { SuggestionGenerationError, type TripSuggestion } from '@/domain/suggestions';
import type { Trip } from '@/domain/types';
import { mockDeviceMetrics } from '../deviceMetrics';

/**
 * O CARTÃO ESPREMIDO E O BOTÃO CORTADO.
 *
 * Duas queixas distintas, com causas distintas:
 *
 *  1. O cartão era uma pilha de `gap: md` uniforme. Título, metadados,
 *     descrição, etiqueta e botões ficavam todos à mesma distância, e o
 *     espaçamento deixava de dizer o que pertencia a quê.
 *  2. "Adicionar ao roteiro" aparecia como "Adicion...". `AdaptiveButtonRow`
 *     já existia para evitar isso, mas decidia com um limiar em dp fixo — que
 *     ignora a preferência de texto grande do sistema, justamente quando o
 *     rótulo mais precisa de espaço.
 */

const metrics: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const render = () =>
  rtlRender(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <ToastProvider>
          <SuggestionsScreen />
        </ToastProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );

// Um celular de 390dp com a preferência de texto padrão — não a fixture do
// preset do RN, que descreve uma tela de 750dp com o texto no dobro.
mockDeviceMetrics({ width: 390, fontScale: 1 });

const mockRouter = { replace: jest.fn(), back: jest.fn(), push: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));

const trip: Trip = {
  id: 'trip-1',
  userId: 'owner-1',
  destinationCity: 'Moscovo',
  destinationCountry: 'Rússia',
  countryCode: 'RU',
  timezone: 'Europe/Moscow',
  startDate: '2026-09-01',
  endDate: '2026-09-08',
  budgetTotal: 1_000,
  budgetCurrency: 'BRL',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

jest.mock('@/features/trip/useTripRoute', () => ({
  useTripRoute: () => ({
    tripId: trip.id,
    trip,
    isLoading: false,
    isError: false,
    notFound: false,
    errorMessage: '',
    refetch: jest.fn(),
  }),
}));

const mockPermissions = {
  role: 'owner' as 'owner' | 'editor' | 'viewer' | undefined,
  members: [] as unknown[],
  memberCount: 1,
  isShared: false,
  canEdit: true,
  canManageMembers: true,
  canLeave: false,
  status: 'ready' as string,
  isResolved: true,
  isLoading: false,
  isError: false,
  error: null as unknown,
  refetch: jest.fn(),
};
jest.mock('@/hooks/useCollaboration', () => ({ useTripPermissions: () => mockPermissions }));

const mockSuggestionsQuery = {
  data: undefined as TripSuggestion[] | undefined,
  error: null as unknown,
  isLoading: false,
  isError: false,
  refetch: jest.fn(),
};
const mockRefresh = { mutate: jest.fn(), isPending: false, error: null as unknown };

jest.mock('@/hooks/useSuggestions', () => {
  const actual = jest.requireActual('@/domain/suggestions');
  return {
    useSuggestions: () => mockSuggestionsQuery,
    useRefreshSuggestions: () => mockRefresh,
    useSuggestionDuplicate: () => (s: TripSuggestion) =>
      mockDuplicate.on ? { id: 'i1', title: s.title } : undefined,
    useSuggestionsByCategory: (items: TripSuggestion[]) => {
      const grupos = new Map<string, TripSuggestion[]>();
      for (const item of items) {
        grupos.set(item.category, [...(grupos.get(item.category) ?? []), item]);
      }
      return grupos;
    },
    canRefreshSuggestions: actual.canRefreshSuggestions,
    MINIMUM_SUGGESTIONS: actual.MINIMUM_SUGGESTIONS,
  };
});

const mockDuplicate = { on: false };

jest.mock('@/hooks/useTripData', () => ({
  useItinerary: () => ({ data: [] }),
  useItineraryMutations: () => ({ create: { mutateAsync: jest.fn(), isPending: false } }),
}));
jest.mock('@/hooks/useTripRealtime', () => ({ useTripRealtime: () => undefined }));
jest.mock('@/repositories', () => ({ dataSource: { kind: 'supabase' } }));

function suggestion(overrides: Partial<TripSuggestion> = {}): TripSuggestion {
  return {
    id: 's1',
    tripId: trip.id,
    title: 'Praça Vermelha',
    category: 'atracoes',
    description:
      'O centro cerimonial da cidade, ladeado pela catedral de São Basílio e pelo museu histórico. ' +
      'É o ponto de partida natural para conhecer o centro a pé.',
    area: 'Kitay-gorod, distrito central',
    estimatedDurationMinutes: 120,
    source: 'ai',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Achata `style` (array ou objeto) num objeto só, como o RN faria. */
function flatten(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flatten));
  return (style ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  Object.assign(mockPermissions, {
    role: 'owner',
    canEdit: true,
    status: 'ready',
    isResolved: true,
    isLoading: false,
    isError: false,
    error: null,
  });
  Object.assign(mockSuggestionsQuery, {
    data: [suggestion()],
    error: null,
    isLoading: false,
    isError: false,
  });
  Object.assign(mockRefresh, { isPending: false, error: null });
  mockDuplicate.on = false;
  mockRefresh.mutate.mockClear();
  mockSuggestionsQuery.refetch.mockClear();
});

describe('o cartão respira', () => {
  it('separa os blocos com mais espaço do que separa as linhas de um bloco', () => {
    const tela = render();
    const card = tela.getByTestId('suggestion-card');

    // 16dp entre blocos. Era 12, o mesmo valor usado dentro dos blocos — e é
    // por isso que tudo parecia da mesma família.
    expect(flatten(card.props.style).gap).toBe(16);
  });

  it('dá entrelinha à descrição em vez de comprimir três linhas', () => {
    const tela = render();
    const descricao = tela.getByText(/centro cerimonial da cidade/);

    expect(flatten(descricao.props.style).lineHeight).toBeGreaterThan(20);
    expect(descricao.props.numberOfLines).toBe(3);
  });

  it('põe um filete entre a etiqueta de origem e as ações', () => {
    const tela = render();
    const card = tela.getByTestId('suggestion-card');

    // A etiqueta é a última coisa a se LER e o botão a primeira a se TOCAR.
    // Sem nada entre as duas, a etiqueta parecia legenda do botão.
    const filetes = card.findAll((node: { props: { style?: unknown } }) => {
      const style = flatten(node.props.style);
      return style.height === 1 && Boolean(style.backgroundColor);
    });
    expect(filetes.length).toBeGreaterThan(0);
  });

  it('mostra a etiqueta de procedência pelo campo `source`, não por heurística', () => {
    expect(render().getByText('✨ Sugestão da IA')).toBeTruthy();

    Object.assign(mockSuggestionsQuery, { data: [suggestion({ source: 'catalog' })] });
    expect(render().getByText('Do catálogo Easy Trip')).toBeTruthy();
  });

  it('deixa o endereço longo encolher sem empurrar categoria e duração para fora', () => {
    const tela = render();
    const area = tela.getByText('Kitay-gorod, distrito central');

    expect(area.props.numberOfLines).toBe(1);
    expect(flatten(area.props.style).flexShrink).toBe(1);
  });
});

describe('os botões mostram o rótulo inteiro', () => {
  it('escreve "Adicionar ao roteiro" por extenso', () => {
    const tela = render();
    expect(tela.getByText('Adicionar ao roteiro')).toBeTruthy();
    expect(tela.queryByText(/Adicion\.\.\./)).toBeNull();
  });

  it('mantém "Ver detalhes" ao lado', () => {
    expect(render().getByText('Ver detalhes')).toBeTruthy();
  });

  it('empilha os dois botões numa largura em que a fileira não caberia', () => {
    const tela = render();
    const row = tela.getByTestId('adaptive-button-row');

    // 390dp de janela, menos margens de tela e recuo do cartão: a fileira
    // precisaria de 2×200 + 8. A coluna é o layout honesto, e vale já no
    // primeiro quadro — sem um quadro visível com a palavra cortada.
    expect(flatten(row.props.style).flexDirection).toBe('column');
  });

  it('não prende o rótulo numa caixa de altura fixa', () => {
    const tela = render();
    const botao = tela.getByLabelText('Adicionar ao roteiro');
    const style = flatten(
      typeof botao.props.style === 'function' ? botao.props.style({ pressed: false }) : botao.props.style,
    );

    // Com `allowFontScaling` ligado (§70, §87), altura fixa recorta o rótulo na
    // preferência de texto grande. O piso continua em 40dp.
    expect(style.height).toBeUndefined();
    expect(style.minHeight).toBe(40);
  });
});

describe('as ações continuam funcionando', () => {
  it('"Ver detalhes" abre a ficha da sugestão', () => {
    const tela = render();
    fireEvent.press(tela.getByLabelText('Ver detalhes'));

    // A ficha traz a categoria como subtítulo e o aviso de procedência da IA —
    // nenhum dos dois existe no cartão, então servem de prova de que abriu.
    expect(tela.getByText('Atrações')).toBeTruthy();
    expect(tela.getByText(/Esta sugestão foi escrita pela IA/)).toBeTruthy();
  });

  it('"Adicionar ao roteiro" abre a folha de revisão', () => {
    const tela = render();
    fireEvent.press(tela.getByLabelText('Adicionar ao roteiro'));

    expect(tela.getByText('Adicionar Praça Vermelha')).toBeTruthy();
    expect(tela.getByText('Escolha quando entra no seu roteiro')).toBeTruthy();
  });

  it('avisa antes de duplicar um item que já está no roteiro (§46)', () => {
    mockDuplicate.on = true;
    const tela = render();
    fireEvent.press(tela.getByLabelText('Adicionar ao roteiro'));

    expect(tela.getByText('Já existe algo parecido')).toBeTruthy();
    expect(tela.getByText('Adicionar mesmo assim')).toBeTruthy();
  });

  it('"Adicionar mesmo assim" segue para a folha de revisão', () => {
    mockDuplicate.on = true;
    const tela = render();
    fireEvent.press(tela.getByLabelText('Adicionar ao roteiro'));
    fireEvent.press(tela.getByText('Adicionar mesmo assim'));

    expect(tela.getByText('Adicionar Praça Vermelha')).toBeTruthy();
  });
});

describe('Moscovo sem conteúdo — o que a tela diz', () => {
  it('a janela de seis horas não vira cartão de erro com botão morto', () => {
    Object.assign(mockSuggestionsQuery, {
      data: undefined,
      isError: true,
      error: new SuggestionGenerationError('REFRESH_LIMITED', 'limitado'),
    });
    const tela = render();

    expect(tela.getByText('Atualizado recentemente')).toBeTruthy();
    // "Tentar novamente" antes das seis horas ensina que o aplicativo quebrou.
    expect(tela.queryByText('Tentar novamente')).toBeNull();
    // E não é apresentado como falha de conexão.
    expect(tela.queryByText(/Verifique sua conexão/)).toBeNull();
  });

  it('uma falha de verdade continua sendo erro, com nova tentativa', () => {
    Object.assign(mockSuggestionsQuery, {
      data: undefined,
      isError: true,
      error: new SuggestionGenerationError('AI_PROVIDER_FAILED', 'falhou'),
    });
    const tela = render();

    expect(tela.getByText('A geração falhou')).toBeTruthy();
    fireEvent.press(tela.getByText('Tentar novamente'));
    expect(mockSuggestionsQuery.refetch).toHaveBeenCalled();
  });

  it('a geração parcial mostra o que veio em vez do cartão de falha', () => {
    // O caso de Moscovo depois da correção: o 422 carrega o que ficou salvo.
    Object.assign(mockSuggestionsQuery, {
      data: undefined,
      isError: true,
      error: new SuggestionGenerationError('INCOMPLETE_GENERATION', 'incompleta', [suggestion()]),
    });
    const tela = render();

    expect(tela.getByTestId('suggestion-card')).toBeTruthy();
    expect(tela.getByText('Praça Vermelha')).toBeTruthy();
    expect(tela.getByLabelText('Adicionar ao roteiro')).toBeTruthy();
  });
});
