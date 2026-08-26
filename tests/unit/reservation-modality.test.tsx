import { fireEvent, render as rtlRender, type RenderResult } from '@testing-library/react-native';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';

import ReservationsScreen from '@/app/trip/[tripId]/reservations';
import { ToastProvider } from '@/components/ui';
import {
  RESERVATION_CATEGORIES,
  RESERVATION_PROVIDER_LABEL,
  type Reservation,
  type ReservationType,
} from '@/domain/reservations';
import type { Trip } from '@/domain/types';
import { ThemeProvider } from '@/theme';

/**
 * "Reservas abre sempre como Voo" (§30–§37 do handoff).
 *
 * O DEFEITO NO APARELHO: tocar em 🚆 Trem abria "Nova reserva · Voo", com Voo
 * marcado e "Companhia aérea" no formulário. O mesmo acontecia nas outras
 * modalidades e também ao editar uma reserva existente.
 *
 * A CAUSA: a folha do formulário guarda a modalidade em `useState`, e
 * `useState` só lê o valor inicial no primeiro render. Ela era renderizada
 * junto com a tela — sem `key` —, então montava uma vez só, quando ainda não
 * havia categoria escolhida e o `initialType` era o `?? 'flight'` do padrão.
 * Trocar a prop depois não trocava mais nada: nem o título, nem o chip, nem os
 * rótulos, nem o `type` gravado.
 *
 * O que esta suíte fixa é a propriedade, não o pixel: **a modalidade que abre é
 * a que foi tocada**, para as seis categorias, criando e editando — e é ela que
 * chega ao `create`/`update`.
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
const criadas: { type: ReservationType }[] = [];
const atualizadas: { id: string; type: ReservationType }[] = [];

jest.mock('@/hooks/useReservations', () => ({
  // Só o que a tela consome muda de comportamento por teste; o resto do módulo
  // é lógica pura e continua sendo a de produção.
  findReminder: jest.requireActual('@/hooks/useReservations').findReminder,
  groupReservations: jest.requireActual('@/hooks/useReservations').groupReservations,
  useReservations: () => ({
    data: reservas,
    isLoading: false,
    isError: false,
    error: null,
  }),
  useReminders: () => ({ data: [], isLoading: false, isError: false }),
  useReminderMutations: () => ({
    set: { mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false },
    clear: { mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false },
  }),
  useReservationMutations: () => ({
    create: {
      mutateAsync: jest.fn(async ({ input }: { input: { type: ReservationType } }) => {
        criadas.push({ type: input.type });
      }),
      isPending: false,
    },
    update: {
      mutateAsync: jest.fn(
        async ({ id, patch }: { id: string; patch: { type: ReservationType } }) => {
          atualizadas.push({ id, type: patch.type });
        },
      ),
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

/** A grade de categorias abre o formulário quando a categoria está vazia. */
const tocarCategoria = (view: RenderResult, categoria: (typeof criaveis)[number]) => {
  fireEvent.press(
    view.getByLabelText(`${categoria.plural}. Nenhuma reserva. Toque para adicionar.`),
  );
};

/**
 * Fecha a folha aberta.
 *
 * Há mais de um "Fechar" na árvore quando visualizador e editor coexistem; o
 * último renderizado é o que está por cima, e é ele que o toque atinge.
 */
const fechar = (view: RenderResult) => {
  const botoes = view.getAllByLabelText('Fechar', { includeHiddenElements: true });
  fireEvent.press(botoes[botoes.length - 1]);
};

/** O chip de modalidade daquele rótulo — e não outro controle homônimo. */
const chip = (view: RenderResult, label: string) =>
  view
    .getAllByLabelText(label, { includeHiddenElements: true })
    .find((node) => node.props.accessibilityRole === 'radio')!;

const reserva = (type: ReservationType): Reservation => ({
  id: `res-${type}`,
  tripId: 'trip-1',
  visibility: 'shared',
  type,
  title: `Reserva de ${type}`,
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

describe('criar: a modalidade que abre é a que foi tocada', () => {
  it.each(criaveis.map((c) => [c.label, c] as const))(
    '%s abre o formulário na própria modalidade',
    (_label, categoria) => {
      const view = render();
      tocarCategoria(view, categoria);

      // O título nomeia a categoria escolhida — antes dizia sempre "Voo".
      expect(view.getByText(`Nova reserva · ${categoria.label}`)).toBeTruthy();
      // E o chip correspondente está marcado, não o de Voo. A busca é pelo
      // papel `radio` porque "Hospedagem" também é o rótulo do fornecedor
      // dessa modalidade — dois textos iguais, controles diferentes.
      expect(chip(view, categoria.label).props.accessibilityState.selected).toBe(true);
      for (const outra of criaveis) {
        if (outra.type === categoria.type) continue;
        expect(chip(view, outra.label).props.accessibilityState.selected).toBe(false);
      }
    },
  );

  it.each(criaveis.map((c) => [c.label, c] as const))(
    '%s traz os rótulos da própria modalidade, não os de voo',
    (_label, categoria) => {
      const view = render();
      tocarCategoria(view, categoria);

      // O rótulo do fornecedor é o teste mais direto: "Companhia aérea" num
      // formulário de trem era exatamente o sintoma relatado (§35).
      // `getAllByText` porque em Hospedagem o rótulo do fornecedor e o nome da
      // categoria são a mesma palavra.
      expect(view.getAllByText(RESERVATION_PROVIDER_LABEL[categoria.type]).length).toBeGreaterThan(0);
      if (categoria.type !== 'flight') {
        expect(view.queryByText('Companhia aérea')).toBeNull();
      }
    },
  );

  it('trocar de chip dentro do formulário troca título e rótulos', () => {
    const view = render();
    tocarCategoria(view, criaveis[0]); // Voo
    expect(view.getByText('Nova reserva · Voo')).toBeTruthy();

    fireEvent.press(view.getByLabelText('Ônibus', { includeHiddenElements: true }));

    expect(view.getByText('Nova reserva · Ônibus')).toBeTruthy();
    expect(view.getAllByText(RESERVATION_PROVIDER_LABEL.bus).length).toBeGreaterThan(0);
    expect(view.queryByText('Companhia aérea')).toBeNull();
  });

  it('abrir uma modalidade depois da outra não carrega a anterior', () => {
    // A regressão exata: o estado local sobrevivia entre aberturas, então a
    // segunda categoria herdava a primeira.
    const view = render();

    tocarCategoria(view, criaveis[4]); // Trem
    expect(view.getByText('Nova reserva · Trem')).toBeTruthy();
    fechar(view);

    tocarCategoria(view, criaveis[1]); // Hospedagem
    expect(view.getByText('Nova reserva · Hospedagem')).toBeTruthy();
    expect(view.queryByText('Nova reserva · Trem')).toBeNull();
  });
});

describe('editar: a modalidade é a que está gravada', () => {
  it.each(criaveis.map((c) => [c.label, c] as const))(
    'uma reserva de %s reabre na própria modalidade',
    (_label, categoria) => {
      reservas.push(reserva(categoria.type));
      const view = render();

      fireEvent.press(view.getByText(`Reserva de ${categoria.type}`));
      fireEvent.press(view.getByText('Editar'));

      expect(view.getByText('Editar reserva')).toBeTruthy();
      // O subtítulo nomeia o tipo persistido — nunca Voo por padrão (§34).
      expect(view.getAllByText(categoria.label).length).toBeGreaterThan(0);
      expect(
        view.getAllByText(RESERVATION_PROVIDER_LABEL[categoria.type]).length,
      ).toBeGreaterThan(0);
    },
  );

  it('editar um trem logo depois de um voo não reabre como voo', () => {
    reservas.push(reserva('flight'), reserva('train'));
    const view = render();

    fireEvent.press(view.getByText('Reserva de flight'));
    fireEvent.press(view.getByText('Editar'));
    expect(view.getByText('Companhia aérea')).toBeTruthy();
    fechar(view);

    fireEvent.press(view.getByText('Reserva de train'));
    fireEvent.press(view.getByText('Editar'));

    expect(view.getAllByText(RESERVATION_PROVIDER_LABEL.train).length).toBeGreaterThan(0);
    expect(view.queryByText('Companhia aérea')).toBeNull();
  });
});
