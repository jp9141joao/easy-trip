import { render as rtlRender } from '@testing-library/react-native';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';

import SuggestionsScreen from '@/app/trip/[tripId]/suggestions';
import { ToastProvider } from '@/components/ui';
import { ThemeProvider } from '@/theme';
import { SuggestionGenerationError, type TripSuggestion } from '@/domain/suggestions';
import type { Trip } from '@/domain/types';
import { BackendCapabilityError } from '@/repositories/backendCapabilities';

/**
 * §25 e §26 do handoff — a tela de sugestões precisa dizer o que aconteceu.
 *
 * O defeito: com `permissions.status` em `error` ou `unavailable`, a tela caía
 * num `null` silencioso. A pessoa via o cabeçalho, nada embaixo, e nenhuma
 * explicação — indistinguível de "este destino não tem sugestões".
 *
 * Os estados que precisam existir: carregando, vazio, erro, backend
 * incompatível, somente leitura, atualização limitada e sucesso.
 */

const metrics: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

/** A tela usa toast, tema e safe area; nenhum deles é o que está sob teste. */
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

const mockRouter = { replace: jest.fn(), back: jest.fn(), push: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));

const trip: Trip = {
  id: 'trip-1',
  userId: 'owner-1',
  destinationCity: 'Paris',
  destinationCountry: 'França',
  countryCode: 'FR',
  timezone: 'Europe/Paris',
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
    trip: { ...trip, suggestionsRefreshedAt: mockTripState.suggestionsRefreshedAt },
    isLoading: false,
    isError: false,
    notFound: false,
    errorMessage: '',
    refetch: jest.fn(),
  }),
}));

const mockTripState = { suggestionsRefreshedAt: undefined as string | undefined };

const mockPermissions = {
  role: 'owner' as 'owner' | 'editor' | 'viewer' | undefined,
  members: [] as unknown[],
  memberCount: 1,
  isShared: false,
  canEdit: true,
  canManageMembers: true,
  canLeave: false,
  status: 'ready' as 'idle' | 'loading' | 'error' | 'ready' | 'unavailable',
  isResolved: true,
  isLoading: false,
  isError: false,
  error: null as unknown,
  refetch: jest.fn(),
};

jest.mock('@/hooks/useCollaboration', () => ({
  useTripPermissions: () => mockPermissions,
}));

const mockSuggestionsQuery = {
  data: undefined as TripSuggestion[] | undefined,
  error: null as unknown,
  isLoading: false,
  isError: false,
  refetch: jest.fn(),
};

const mockRefresh = {
  mutate: jest.fn(),
  isPending: false,
  error: null as unknown,
};

jest.mock('@/hooks/useSuggestions', () => {
  const actual = jest.requireActual('@/domain/suggestions');
  return {
    useSuggestions: () => mockSuggestionsQuery,
    useRefreshSuggestions: () => mockRefresh,
    useSuggestionDuplicate: () => () => undefined,
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

jest.mock('@/hooks/useTripData', () => ({
  useItinerary: () => ({ data: [] }),
  useItineraryMutations: () => ({ create: { mutateAsync: jest.fn(), isPending: false } }),
}));

jest.mock('@/hooks/useTripRealtime', () => ({ useTripRealtime: () => undefined }));

jest.mock('@/repositories', () => ({
  dataSource: { kind: 'supabase' },
}));

function suggestion(id: string): TripSuggestion {
  return {
    id,
    tripId: trip.id,
    title: `Sugestão ${id}`,
    category: 'lugares',
    description: 'Um lugar de verdade, com uma descrição que se sustenta sozinha.',
    source: 'catalog',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

beforeEach(() => {
  mockTripState.suggestionsRefreshedAt = undefined;
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
    data: undefined,
    error: null,
    isLoading: false,
    isError: false,
  });
  Object.assign(mockRefresh, { isPending: false, error: null });
  mockRefresh.mutate.mockClear();
  mockPermissions.refetch.mockClear();
});

describe('o papel ainda não foi resolvido', () => {
  it('carregando mostra esqueleto, não uma tela vazia', () => {
    Object.assign(mockPermissions, { isLoading: true, isResolved: false, status: 'loading' });
    const view = render();
    expect(view.queryByText('Ainda sem sugestões')).toBeNull();
  });

  it('erro de permissão explica e oferece nova tentativa — nunca `null`', () => {
    Object.assign(mockPermissions, {
      isError: true,
      isResolved: false,
      status: 'error',
      error: new Error('sem conexão'),
      canEdit: false,
    });

    const view = render();

    expect(view.getByText('Não foi possível confirmar seu acesso')).toBeTruthy();
    expect(view.queryByText('Ainda sem sugestões')).toBeNull();
  });

  it('backend incompatível é dito como tal, e não como falha de rede', () => {
    Object.assign(mockPermissions, {
      isError: true,
      isResolved: false,
      status: 'error',
      error: new BackendCapabilityError('MISSING_TRIP_MEMBERS'),
      canEdit: false,
    });

    const view = render();

    expect(view.getByText('Recurso indisponível neste servidor')).toBeTruthy();
    // A frase precisa dizer que a permissão NÃO mudou: um backend antigo não
    // pode ser lido como rebaixamento de papel.
    expect(
      view.getAllByText(/recursos de colaboração ainda não estão disponíveis/i).length,
    ).toBeGreaterThan(0);
    expect(view.getAllByText(/permissão não foi alterada/i).length).toBeGreaterThan(0);
  });

  it('quem não participa mais da viagem recebe uma frase, não um vazio', () => {
    Object.assign(mockPermissions, {
      role: undefined,
      status: 'unavailable',
      isResolved: false,
      canEdit: false,
    });

    const view = render();

    expect(view.getByText('Você não participa desta viagem')).toBeTruthy();
    expect(view.queryByText('Tentar de novo')).toBeNull();
  });
});

describe('estados da própria coleção', () => {
  /*
   * §15 do handoff — cada causa tem o seu texto.
   *
   * Antes tudo isto era "Sugestões indisponíveis" com um "Tentar de novo" ao
   * lado. Foi o que apareceu no Android para Moscovo, e não dizia nada: o
   * mesmo cartão servia para a janela de seis horas, para falta de permissão,
   * para o serviço não publicado e para queda de rede — quatro problemas com
   * quatro saídas diferentes, e um deles sequer é problema.
   */
  it('a falha do provedor é dita como falha do provedor, e permite nova tentativa', () => {
    Object.assign(mockSuggestionsQuery, {
      isError: true,
      error: new SuggestionGenerationError('AI_PROVIDER_FAILED', 'O Gemini falhou agora.'),
    });

    const view = render();

    expect(view.getByText('A geração falhou')).toBeTruthy();
    expect(view.getByText('Tentar novamente')).toBeTruthy();
  });

  it('sem conexão, o texto fala de conexão — e não de geração', () => {
    Object.assign(mockSuggestionsQuery, {
      isError: true,
      error: new SuggestionGenerationError(
        'AI_UNAVAILABLE',
        'Não foi possível alcançar o serviço de sugestões.',
        [],
        undefined,
        { transport: 'offline' },
      ),
    });

    const view = render();

    expect(view.getByText('Sem conexão com o serviço')).toBeTruthy();
    expect(view.getByText('Tentar novamente')).toBeTruthy();
  });

  it('sem permissão, não há botão que possa dar certo', () => {
    Object.assign(mockSuggestionsQuery, {
      isError: true,
      error: new SuggestionGenerationError(
        'PERMISSION_DENIED',
        'Sua permissão atual não permite gerar sugestões.',
        [],
        undefined,
        { httpStatus: 403 },
      ),
    });

    const view = render();

    expect(view.getByText('Sem permissão para gerar')).toBeTruthy();
    expect(view.queryByText('Tentar de novo')).toBeNull();
  });

  it('a Function não publicada é dita como serviço, e não como destino sem sugestões', () => {
    Object.assign(mockSuggestionsQuery, {
      isError: true,
      error: new SuggestionGenerationError(
        'EDGE_FUNCTION_UNAVAILABLE',
        'O serviço de sugestões não está publicado.',
        [],
        undefined,
        { httpStatus: 404 },
      ),
    });

    const view = render();

    expect(view.getByText('Serviço não publicado')).toBeTruthy();
  });

  it('a janela de seis horas não é apresentada como falha', () => {
    Object.assign(mockSuggestionsQuery, {
      isError: true,
      error: new SuggestionGenerationError('REFRESH_LIMITED', 'Já atualizamos nas últimas 6 horas.'),
    });

    const view = render();

    expect(view.getByText('Atualizado recentemente')).toBeTruthy();
    // Recusa de janela não oferece "tentar de novo": tentar não muda nada.
    expect(view.queryByText('Tentar de novo')).toBeNull();
    // E diz quando será possível de novo, em vez de parecer definitivo (§15).
    expect(view.getByText(/poderá atualizar as sugestões novamente mais tarde/)).toBeTruthy();
  });

  it('geração incompleta mostra o que veio e diz que não completou', () => {
    const parciais = [suggestion('a'), suggestion('b')];
    Object.assign(mockSuggestionsQuery, {
      isError: true,
      error: new SuggestionGenerationError(
        'INCOMPLETE_GENERATION',
        'Conseguimos apenas algumas sugestões para este destino.',
        parciais,
      ),
    });

    const view = render();

    // O que já existe FICA na tela: uma falha parcial não apaga conteúdo bom.
    expect(view.getByText('Sugestão a')).toBeTruthy();
    expect(view.getByText('Sugestão b')).toBeTruthy();
    expect(view.getByText(/Conseguimos apenas parte das sugestões/)).toBeTruthy();
  });

  it('sucesso mostra a lista e o botão de atualizar', () => {
    mockSuggestionsQuery.data = [suggestion('a'), suggestion('b'), suggestion('c')];

    const view = render();

    expect(view.getByText('Sugestão a')).toBeTruthy();
    expect(view.getByText('Atualizar sugestões')).toBeTruthy();
  });
});

describe('atualização limitada', () => {
  it('o botão desabilitado vem com o motivo escrito', () => {
    mockSuggestionsQuery.data = [suggestion('a'), suggestion('b'), suggestion('c')];
    mockTripState.suggestionsRefreshedAt = new Date().toISOString();

    const view = render();

    expect(view.getByText('Atualizado recentemente')).toBeTruthy();
    expect(view.getByText(/no máximo uma vez a cada\s+6 horas por viagem/)).toBeTruthy();
  });
});

describe('viewer (§26)', () => {
  beforeEach(() => {
    Object.assign(mockPermissions, { role: 'viewer', canEdit: false, canManageMembers: false });
  });

  it('vê as sugestões existentes', () => {
    mockSuggestionsQuery.data = [suggestion('a'), suggestion('b'), suggestion('c')];
    const view = render();
    expect(view.getByText('Sugestão a')).toBeTruthy();
  });

  it('não recebe botão de atualizar — nada que dispare custo de Gemini', () => {
    mockSuggestionsQuery.data = [suggestion('a'), suggestion('b'), suggestion('c')];
    const view = render();

    expect(view.queryByText('Atualizar sugestões')).toBeNull();
    expect(view.queryByText('Tentar de novo')).toBeNull();
    expect(mockRefresh.mutate).not.toHaveBeenCalled();
  });

  it('a lista vazia explica o acesso de leitura em vez de oferecer geração', () => {
    mockSuggestionsQuery.data = [];
    const view = render();

    expect(view.getByText('Ainda sem sugestões')).toBeTruthy();
    expect(
      view.getByText('Ainda não há sugestões compartilhadas nesta viagem.'),
    ).toBeTruthy();
    expect(view.queryByText('Tentar de novo')).toBeNull();
  });

  it('é avisado de que a edição é de quem pode editar', () => {
    mockSuggestionsQuery.data = [suggestion('a')];
    const view = render();
    expect(view.getByText(/acesso somente de visualização/)).toBeTruthy();
  });
});
