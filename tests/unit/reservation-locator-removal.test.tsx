import { fireEvent, render as rtlRender, type RenderResult } from '@testing-library/react-native';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';

import ReservationsScreen from '@/app/trip/[tripId]/reservations';
import { ToastProvider } from '@/components/ui';
import { RESERVATION_CATEGORIES, type Reservation, type ReservationType } from '@/domain/reservations';
import { reservationSchema } from '@/domain/schemas';
import type { Trip } from '@/domain/types';
import { ThemeProvider } from '@/theme';

/**
 * O LOCALIZADOR SAIU DA EXPERIÊNCIA DE RESERVAS.
 *
 * Era um campo comum a todas as modalidades — entre "Companhia aérea" e
 * "Partida" no formulário de Voo, e igual nas outras seis. Saiu de três lugares:
 * o formulário, os detalhes e o cartão da lista.
 *
 * O QUE NÃO SAIU, E POR QUÊ
 *
 * A coluna `reference` (0011) continua no banco e
 * `Reservation.confirmationCode` continua no domínio. Reserva antiga tem código
 * gravado, e a alternativa — migration destrutiva — apagaria dado de quem já
 * usava o aplicativo para não mostrar um campo. O compromisso é o contrário do
 * habitual: o dado sobrevive, a interface é que esquece dele.
 *
 * E o campo não foi substituído por `""`, `"-"` nem por um campo oculto.
 * `reservationSchema` simplesmente não o tem, e o `onSubmit` não o envia — o que
 * faz o `prune` de `toRow` deixar a coluna intacta ao editar uma reserva legada,
 * em vez de sobrescrevê-la com vazio.
 */

const metrics: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const trip: Trip = {
  id: 'trip-1',
  userId: 'owner-1',
  destinationCity: 'Paris',
  destinationCountry: 'França',
  countryCode: 'FR',
  timezone: 'Europe/Paris',
  startDate: '2026-09-01',
  endDate: '2026-09-08',
  budgetTotal: 10_000,
  budgetCurrency: 'BRL',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

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
}));

const reservas: Reservation[] = [];
const criadas: Record<string, unknown>[] = [];
const atualizadas: { id: string; patch: Record<string, unknown> }[] = [];

jest.mock('@/hooks/useReservations', () => ({
  findReminder: jest.requireActual('@/hooks/useReservations').findReminder,
  groupReservations: jest.requireActual('@/hooks/useReservations').groupReservations,
  useReservations: () => ({ data: reservas, isLoading: false, isError: false, error: null }),
  useReminders: () => ({ data: [], isLoading: false, isError: false }),
  useReminderMutations: () => ({
    set: { mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false },
    clear: { mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false },
  }),
  useReservationMutations: () => ({
    create: {
      mutateAsync: jest.fn(async ({ input }: { input: Record<string, unknown> }) => {
        criadas.push(input);
      }),
      isPending: false,
    },
    update: {
      mutateAsync: jest.fn(async ({ id, patch }: { id: string; patch: Record<string, unknown> }) => {
        atualizadas.push({ id, patch });
      }),
      isPending: false,
    },
    remove: { mutateAsync: jest.fn(), isPending: false },
  }),
}));

const render = () =>
  rtlRender(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <ToastProvider>
          <ReservationsScreen />
        </ToastProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );

const criaveis = RESERVATION_CATEGORIES.filter((c) => c.creatable);

const tocarCategoria = (view: RenderResult, categoria: (typeof criaveis)[number]) => {
  fireEvent.press(
    view.getByLabelText(`${categoria.plural}. Nenhuma reserva. Toque para adicionar.`),
  );
};

/** Uma reserva legada: criada quando o localizador ainda era coletado. */
const legada = (type: ReservationType): Reservation => ({
  id: `res-${type}`,
  tripId: 'trip-1',
  visibility: 'shared',
  type,
  title: `Reserva de ${type}`,
  provider: 'Air France',
  confirmationCode: 'ABC123',
  status: 'confirmed',
  details: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

beforeEach(() => {
  reservas.length = 0;
  criadas.length = 0;
  atualizadas.length = 0;
  jest.clearAllMocks();
});

/* ------------------------------- o formulário ------------------------------ */

describe('o formulário de nova reserva não pede localizador', () => {
  it.each(criaveis.map((c) => [c.label, c] as const))(
    '%s abre sem o campo Localizador',
    (_label, categoria) => {
      const view = render();
      tocarCategoria(view, categoria);

      // A folha está aberta na modalidade certa...
      expect(view.getByText(`Nova reserva · ${categoria.label}`)).toBeTruthy();
      // ...e não há rótulo, nem placeholder, nem resquício do campo.
      expect(view.queryByText('Localizador')).toBeNull();
      expect(view.queryByLabelText('Localizador')).toBeNull();
      expect(view.queryByPlaceholderText('Código da reserva')).toBeNull();
    },
  );

  it('o campo também não aparece ao editar — em nenhuma modalidade', () => {
    for (const categoria of criaveis) {
      reservas.length = 0;
      reservas.push(legada(categoria.type));
      const view = render();

      fireEvent.press(view.getByText(`Reserva de ${categoria.type}`));
      fireEvent.press(view.getByText('Editar'));

      expect(view.getByText('Editar reserva')).toBeTruthy();
      expect(view.queryByText('Localizador')).toBeNull();
      expect(view.queryByPlaceholderText('Código da reserva')).toBeNull();
      view.unmount();
    }
  });

  it('trocar de chip dentro do formulário não traz o campo de volta', () => {
    const view = render();
    tocarCategoria(view, criaveis[0]); // Voo

    for (const outra of criaveis.slice(1)) {
      fireEvent.press(view.getByLabelText(outra.label, { includeHiddenElements: true }));
      expect(view.queryByText('Localizador')).toBeNull();
    }
  });
});

/* ------------------------------- a criação --------------------------------- */

describe('criar reserva sem localizador', () => {
  it.each(criaveis.map((c) => [c.label, c] as const))(
    'grava uma reserva de %s com só o título preenchido',
    async (_label, categoria) => {
      const view = render();
      tocarCategoria(view, categoria);

      fireEvent.changeText(view.getByLabelText('Título'), `Minha ${categoria.label}`);
      fireEvent.press(view.getByText('Salvar reserva'));

      // O formulário resolve o zod de forma assíncrona.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(criadas).toHaveLength(1);
      expect(criadas[0]).toMatchObject({ type: categoria.type, title: `Minha ${categoria.label}` });
      // O que importa: nada de `confirmationCode` no payload — nem `undefined`,
      // nem `""`, nem `"-"`. A chave não existe.
      expect(criadas[0]).not.toHaveProperty('confirmationCode');
      criadas.length = 0;
      view.unmount();
    },
  );
});

/* --------------------------- os detalhes da reserva ------------------------ */

describe('os detalhes de uma reserva legada', () => {
  it('abrem normalmente e não mostram "Localizador: ABC123"', () => {
    reservas.push(legada('flight'));
    const view = render();

    fireEvent.press(view.getByText('Reserva de flight'));

    // A reserva antiga continua abrindo, com os demais campos no lugar.
    expect(view.getAllByText('Reserva de flight').length).toBeGreaterThan(0);
    expect(view.getAllByText('Air France').length).toBeGreaterThan(0);
    // O código não é desenhado — e não sobrou um "Localizador: —" no lugar.
    expect(view.queryByText('Localizador')).toBeNull();
    expect(view.queryByText('ABC123')).toBeNull();
  });

  it('o cartão da lista também não desenha o código', () => {
    reservas.push(legada('hotel'));
    const view = render();

    expect(view.getByText('Reserva de hotel')).toBeTruthy();
    expect(view.queryByText('ABC123')).toBeNull();
  });
});

/* ------------------------ a compatibilidade do legado --------------------- */

describe('editar uma reserva legada não apaga o localizador gravado', () => {
  it('o patch enviado não menciona confirmationCode', async () => {
    reservas.push(legada('flight'));
    const view = render();

    fireEvent.press(view.getByText('Reserva de flight'));
    fireEvent.press(view.getByText('Editar'));
    fireEvent.changeText(view.getByLabelText('Título'), 'Voo GRU → CDG');
    fireEvent.press(view.getByText('Salvar alterações'));

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(atualizadas).toHaveLength(1);
    expect(atualizadas[0].patch).toMatchObject({ title: 'Voo GRU → CDG' });
    /*
     * A CHAVE AUSENTE É A COMPATIBILIDADE.
     *
     * `toRow` monta a linha com `prune`, que descarta `undefined`. Sem a chave,
     * `reference` não entra no `update` e o banco mantém "ABC123". Se o payload
     * trouxesse `confirmationCode: undefined`, o resultado seria o mesmo; se
     * trouxesse `""`, o localizador da pessoa seria apagado por um campo que
     * ela não pode mais ver.
     */
    expect(atualizadas[0].patch).not.toHaveProperty('confirmationCode');
  });
});

/* -------------------------------- o contrato ------------------------------ */

describe('o contrato de entrada da reserva', () => {
  it('não tem confirmationCode', () => {
    expect(Object.keys(reservationSchema.shape)).not.toContain('confirmationCode');
  });

  it('aceita uma reserva de qualquer modalidade sem localizador', () => {
    for (const categoria of RESERVATION_CATEGORIES) {
      const parsed = reservationSchema.safeParse({ type: categoria.type, title: 'Registro' });
      expect(parsed.success).toBe(true);
    }
  });

  it('descarta um localizador que ainda venha de fora, em vez de gravá-lo', () => {
    // `z.object` sem `passthrough` remove a chave desconhecida: um chamador
    // antigo não consegue reintroduzir o campo pela porta dos fundos.
    const parsed = reservationSchema.parse({
      type: 'flight',
      title: 'GRU → CDG',
      confirmationCode: 'ABC123',
    });
    expect(parsed).not.toHaveProperty('confirmationCode');
  });

  it('o domínio continua sabendo ler o campo legado', () => {
    // O tipo `Reservation` mantém `confirmationCode` para o dado que já existe;
    // o que mudou é quem o escreve e quem o desenha.
    const antiga = legada('flight');
    expect(antiga.confirmationCode).toBe('ABC123');
  });
});
