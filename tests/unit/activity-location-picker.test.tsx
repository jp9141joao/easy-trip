import * as Linking from 'expo-linking';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render as rtlRender, type RenderResult } from '@testing-library/react-native';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';

import ItineraryScreen from '@/app/trip/[tripId]/itinerary';
import { LocationPicker } from '@/components/trip';
import { resetReverseGeocodeCache } from '@/services/reverseGeocode';
import { ToastProvider } from '@/components/ui';
import { directionsUrl } from '@/domain/route';
import type { ItineraryItem, Trip } from '@/domain/types';
import { ThemeProvider } from '@/theme';

/**
 * Localização da atividade pelo mapa (§16–§22 do handoff).
 *
 * O QUE MUDOU: o formulário pedia "Latitude" e "Longitude" em dois campos de
 * texto, com `48.8606` e `2.3376` de placeholder. Ninguém sabe a latitude de um
 * restaurante — e quem soubesse não estaria digitando num aplicativo de viagem.
 *
 * O QUE NÃO MUDOU: as coordenadas continuam sendo gravadas. Elas são o que faz
 * o item entrar na rota do dia, na distância, no "Como chegar" e na previsão
 * por horário. O que saiu foi a INTERFACE, não o dado.
 *
 * Por isso os dois lados são medidos aqui: que o número não aparece, e que ele
 * chega ao `create`/`update` mesmo assim.
 */

const metrics: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

/*
 * O geocoder do sistema, dublado.
 *
 * `expo-location` só existe com módulo nativo. O que interessa testar não é o
 * geocoder — é o que o aplicativo faz com a resposta dele, inclusive quando
 * ela não vem (§24).
 */
const geo = {
  granted: true,
  resultado: [
    {
      street: 'Shibuya',
      streetNumber: null,
      district: 'Shibuya',
      city: 'Tóquio',
      subregion: null,
      country: 'Japão',
      name: 'Cruzamento de Shibuya',
      region: null,
      postalCode: null,
      isoCountryCode: 'JP',
      timezone: null,
      formattedAddress: null,
    },
  ] as unknown[],
  falha: false,
};

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(async () => ({ granted: geo.granted })),
  reverseGeocodeAsync: jest.fn(async () => {
    if (geo.falha) throw new Error('geocoder indisponível');
    return geo.resultado;
  }),
}));

const LOUVRE = { latitude: 48.8606, longitude: 2.3376 };
const ORSAY = { latitude: 48.86, longitude: 2.3266 };

const trip: Trip = {
  id: 'trip-1',
  userId: 'owner-1',
  destinationCity: 'Paris',
  destinationCountry: 'França',
  countryCode: 'FR',
  latitude: 48.8566,
  longitude: 2.3522,
  timezone: 'Europe/Paris',
  startDate: '2026-09-01',
  endDate: '2026-09-08',
  budgetTotal: 10_000,
  budgetCurrency: 'BRL',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const wrap = (node: React.ReactElement) =>
  rtlRender(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <ToastProvider>{node}</ToastProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );

/** Um toque no mapa, no formato que o `react-native-maps` entrega. */
const tocarNoMapa = (view: RenderResult, coordinate: { latitude: number; longitude: number }) =>
  fireEvent(view.getByTestId('location-map'), 'press', { nativeEvent: { coordinate } });

beforeEach(() => {
  resetReverseGeocodeCache();
  geo.granted = true;
  geo.falha = false;
});

describe('o seletor de local', () => {
  it('sem ponto, convida a tocar no mapa e não mostra marcador', () => {
    const view = wrap(<LocationPicker value={null} onChange={jest.fn()} fallbackCenter={LOUVRE} />);

    expect(view.getByText('Toque no mapa para marcar o local.')).toBeTruthy();
    // Sem marcador falso "para não ficar vazio": um pino que a pessoa não
    // colocou seria o aplicativo afirmando um lugar (§20).
    expect(view.queryByTestId('location-marker')).toBeNull();
  });

  it('tocar no mapa devolve a coordenada de quem chamou', () => {
    const onChange = jest.fn();
    const view = wrap(<LocationPicker value={null} onChange={onChange} fallbackCenter={LOUVRE} />);

    tocarNoMapa(view, LOUVRE);

    expect(onChange).toHaveBeenCalledWith(LOUVRE);
  });

  it('com ponto, mostra o marcador e some o convite', () => {
    const view = wrap(<LocationPicker value={LOUVRE} onChange={jest.fn()} />);

    expect(view.getByTestId('location-marker')).toBeTruthy();
    expect(view.queryByTestId('location-empty-hint')).toBeNull();
  });

  it('NUNCA escreve a coordenada na tela', () => {
    const view = wrap(
      <LocationPicker
        value={{ ...LOUVRE, address: 'Rua de Rivoli, Paris', placeName: 'Museu do Louvre' }}
        onChange={jest.fn()}
      />,
    );

    // O sintoma que motivou a mudança: `48.8606` e `2.3376` visíveis para quem
    // só queria marcar um museu. Nem como rótulo, nem como "confirmação".
    for (const numero of ['48.8606', '2.3376', '48,8606', '2,3376']) {
      expect(view.queryByText(new RegExp(numero.replace('.', '\\.')))).toBeNull();
    }
    // O que confirma o ponto é o nome que o geocoder resolveu (§25).
    expect(view.getByText('Museu do Louvre')).toBeTruthy();
  });

  it('arrastar o marcador move o ponto', () => {
    const onChange = jest.fn();
    const view = wrap(<LocationPicker value={LOUVRE} onChange={onChange} />);

    fireEvent(view.getByTestId('location-marker'), 'dragEnd', {
      nativeEvent: { coordinate: ORSAY },
    });

    expect(onChange).toHaveBeenCalledWith(ORSAY);
  });

  it('remover devolve "sem local", e não uma coordenada zerada', () => {
    const onChange = jest.fn();
    const view = wrap(<LocationPicker value={LOUVRE} onChange={onChange} />);

    fireEvent.press(view.getByText('Remover'));

    // `null`, e nunca `{ latitude: 0, longitude: 0 }` — que é um ponto real no
    // Golfo da Guiné e apareceria no mapa do dia.
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('em modo leitura não oferece remover, e continua oferecendo "Como chegar"', () => {
    const view = wrap(<LocationPicker value={LOUVRE} onChange={jest.fn()} editable={false} />);

    expect(view.queryByText('Remover')).toBeNull();
    expect(view.getByText('Como chegar')).toBeTruthy();
  });
});

describe('"Como chegar" (§21)', () => {
  it('abre o aplicativo de mapas no ponto marcado', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const view = wrap(
      <LocationPicker
        value={{ ...LOUVRE, address: 'Rua de Rivoli', placeName: 'Museu do Louvre' }}
        onChange={jest.fn()}
      />,
    );

    fireEvent.press(view.getByText('Como chegar'));
    await Promise.resolve();

    expect(openURL).toHaveBeenCalledWith(directionsUrl(LOUVRE, 'Museu do Louvre'));
    openURL.mockRestore();
  });

  it('o destino é a coordenada — o nome é só rótulo', () => {
    const url = directionsUrl(LOUVRE, 'Museu do Louvre');

    // Um nome como destino pode resolver para o homônimo do outro lado da
    // cidade; a coordenada é a que a pessoa marcou.
    expect(url).toContain('destination=48.8606%2C2.3376');
    expect(url).toContain('query=Museu+do+Louvre');
    expect(url.startsWith('https://www.google.com/maps/dir/')).toBe(true);
  });

  it('sem rótulo, ainda leva ao ponto', () => {
    expect(directionsUrl(ORSAY)).toContain('destination=48.86%2C2.3266');
    expect(directionsUrl(ORSAY)).not.toContain('query=');
  });

  it('não escolhe o meio de transporte pela pessoa', () => {
    // Quem decide entre andar, dirigir ou pegar metrô é quem está na rua.
    expect(directionsUrl(LOUVRE)).not.toContain('travelmode');
  });
});

/* -------------------- o formulário de atividade, inteiro ------------------- */

const itens: ItineraryItem[] = [];
const criados: { latitude?: number; longitude?: number; placeSource?: string }[] = [];
const atualizados: { latitude?: number; longitude?: number; placeSource?: string }[] = [];

const mockRouter = { replace: jest.fn(), back: jest.fn(), push: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));

jest.mock('@/features/trip/useTripRoute', () => ({
  useTripRoute: () => ({
    tripId: 'trip-1',
    trip,
    isLoading: false,
    isError: false,
    notFound: false,
    errorMessage: '',
    refetch: jest.fn(),
  }),
}));

jest.mock('@/hooks/useTripRealtime', () => ({ useTripRealtime: () => undefined }));

/*
  A previsão por horário é uma das coisas que a coordenada faz funcionar, e por
  isso ela aparece na tela — mas o provedor de clima não é o que está sob teste
  aqui, e deixá-lo ir à rede prenderia o Jest esperando a conexão terminar.
*/
jest.mock('@/services/activityWeather', () => ({
  ...jest.requireActual('@/services/activityWeather'),
  getActivityForecast: jest.fn(async () => null),
}));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'owner-1' } }) }));

jest.mock('@/hooks/useCollaboration', () => ({
  useTripPermissions: () => ({
    role: 'owner',
    members: [],
    memberCount: 1,
    isShared: false,
    canEdit: true,
    canManageMembers: true,
    status: 'ready',
    isResolved: true,
    isLoading: false,
    isError: false,
    error: null,
    refetch: jest.fn(),
  }),
  useMemberNames: () => ({}),
  useTripInvites: () => ({ data: [], isError: false, error: null }),
}));

jest.mock('@/hooks/useTripData', () => ({
  useItinerary: () => ({ data: itens, isLoading: false, isError: false }),
  useChecklist: () => ({ data: [] }),
  useJournal: () => ({ data: [] }),
  useItineraryMutations: () => ({
    create: {
      mutateAsync: jest.fn(async (input: Record<string, unknown>) => {
        criados.push(input as never);
      }),
      isPending: false,
    },
    update: {
      mutateAsync: jest.fn(async ({ patch }: { patch: Record<string, unknown> }) => {
        atualizados.push(patch as never);
      }),
      isPending: false,
    },
    remove: { mutateAsync: jest.fn(), isPending: false },
  }),
}));

/*
  A tela do roteiro mostra a previsão por horário de cada atividade com
  coordenada — que é justamente uma das coisas que as coordenadas fazem
  funcionar. Ela usa react-query, então o provider é necessário.

  `gcTime: 0` não é detalhe de performance: com o padrão de cinco minutos o
  QueryClient deixa um timer de coleta vivo depois do teste, e o processo do
  Jest fica pendurado esperando por ele. `retry: false` impede que uma consulta
  sem rede segure o teste; `clear()` no `afterEach` fecha o resto.
*/
let queryClient: QueryClient;

const abrirRoteiro = () => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return rtlRender(
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeProvider>
          <ToastProvider>
            <ItineraryScreen />
          </ToastProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  itens.length = 0;
  criados.length = 0;
  atualizados.length = 0;
  jest.clearAllMocks();
});

afterEach(() => {
  // Sem isto o QueryClient sobrevive ao teste e leva os timers dele junto.
  queryClient?.clear();
  queryClient?.unmount();
});

describe('o formulário de atividade', () => {
  it('não pede mais latitude, longitude, local nem endereço (§20)', () => {
    const view = abrirRoteiro();
    fireEvent.press(view.getByLabelText('Adicionar atividade'));

    // Os quatro campos técnicos saíram: nenhum deles é pergunta que se faça a
    // quem está planejando uma viagem.
    for (const rotulo of ['Latitude', 'Longitude', 'Local', 'Endereço']) {
      expect(view.queryByText(rotulo)).toBeNull();
    }
    // No lugar deles, só o mapa.
    expect(view.getByTestId('location-picker')).toBeTruthy();
    expect(view.getByText('Localização')).toBeTruthy();
  });

  it('editar um item com coordenada abre o mapa já marcado (§19)', () => {
    itens.push({
      id: 'item-1',
      tripId: 'trip-1',
      visibility: 'shared',
      date: '2026-09-02',
      type: 'atracao',
      title: 'Louvre',
      completed: false,
      sortOrder: 0,
      latitude: LOUVRE.latitude,
      longitude: LOUVRE.longitude,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const view = abrirRoteiro();
    fireEvent.press(view.getByText('Louvre'));

    expect(view.getByTestId('location-marker')).toBeTruthy();
    // E o número continua fora da tela, também na edição.
    expect(view.queryByText(/48\.8606/)).toBeNull();
  });
});

/* ---------------------------- geocodificação reversa ---------------------- */

describe('o endereço é resolvido pelo mapa, não digitado (§21, §22)', () => {
  /** Espera o debounce e a resolução assíncrona assentarem. */
  const assentar = async () => {
    await act(async () => {
      jest.advanceTimersByTime(700);
    });
    await act(async () => undefined);
  };

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('tocar no mapa resolve o endereço e devolve os dois juntos', async () => {
    const onChange = jest.fn();
    const view = wrap(<LocationPicker value={ORSAY} onChange={onChange} />);

    await assentar();

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        latitude: ORSAY.latitude,
        longitude: ORSAY.longitude,
        address: 'Shibuya, Tóquio, Japão',
        placeName: 'Cruzamento de Shibuya',
      }),
    );
    expect(view.getByTestId('location-picker')).toBeTruthy();
  });

  it('não pergunta de novo por um ponto que já tem endereço', async () => {
    const onChange = jest.fn();
    wrap(
      <LocationPicker value={{ ...ORSAY, address: 'Shibuya, Tóquio' }} onChange={onChange} />,
    );

    await assentar();

    // Reabrir a folha de uma atividade salva não pode disparar geocoder.
    expect(onChange).not.toHaveBeenCalled();
  });

  it('arrastar não dispara uma resolução por quadro (§22)', async () => {
    const Location = jest.requireMock('expo-location');
    const onChange = jest.fn();
    const view = wrap(<LocationPicker value={null} onChange={onChange} />);

    // Três movimentos em sequência, dentro da janela do debounce.
    for (const passo of [0.001, 0.002, 0.003]) {
      fireEvent(view.getByTestId('location-map'), 'press', {
        nativeEvent: {
          coordinate: { latitude: ORSAY.latitude + passo, longitude: ORSAY.longitude },
        },
      });
    }
    await assentar();

    // Nenhuma chamada: sem `value`, o pai é quem controla — o que importa aqui
    // é que o componente não martelou o geocoder a cada toque.
    expect(Location.reverseGeocodeAsync.mock.calls.length).toBeLessThanOrEqual(1);
  });
});

describe('quando o geocoder não ajuda, o ponto continua salvável (§24)', () => {
  const assentar = async () => {
    await act(async () => {
      jest.advanceTimersByTime(700);
    });
    await act(async () => undefined);
  };

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('permissão negada não impede de marcar o local', async () => {
    geo.granted = false;
    const onChange = jest.fn();
    wrap(<LocationPicker value={ORSAY} onChange={onChange} />);

    await assentar();

    // O ponto vai adiante; o endereço fica em branco, e não com o de outro
    // lugar. É a diferença entre "não sei" e uma afirmação falsa.
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ latitude: ORSAY.latitude, address: '' }),
    );
  });

  it('geocoder fora do ar também não impede', async () => {
    geo.falha = true;
    const onChange = jest.fn();
    wrap(<LocationPicker value={LOUVRE} onChange={onChange} />);

    await assentar();

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ address: '' }));
  });

  it('mover o marcador NUNCA reaproveita o endereço anterior', () => {
    const onChange = jest.fn();
    const view = wrap(
      <LocationPicker
        value={{ ...LOUVRE, address: 'Rua de Rivoli, Paris', placeName: 'Louvre' }}
        onChange={onChange}
      />,
    );

    fireEvent(view.getByTestId('location-marker'), 'dragEnd', {
      nativeEvent: { coordinate: ORSAY },
    });

    // O ponto novo sai SEM endereço — quem o resolve é a rodada seguinte.
    // Carregar "Rua de Rivoli" para um ponto a 800 metros dali seria afirmar
    // um lugar que ninguém verificou.
    const [ultimo] = onChange.mock.calls[onChange.mock.calls.length - 1];
    expect(ultimo).toEqual({ latitude: ORSAY.latitude, longitude: ORSAY.longitude });
    expect(ultimo.address).toBeUndefined();
  });

  it('sem endereço resolvido, a linha diz "Local marcado" em vez de mentir', () => {
    const view = wrap(<LocationPicker value={{ ...LOUVRE, address: '' }} onChange={jest.fn()} />);
    expect(view.getByTestId('location-label').props.children).toBe('Local marcado');
  });
});
