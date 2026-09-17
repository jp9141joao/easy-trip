import { act, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';

import PlaceDetailScreen from '@/app/places/[placeId]';
import { ToastProvider } from '@/components/ui';
import type { Place } from '@/domain/types';
import { spacing } from '@/theme/tokens';
import { ThemeProvider } from '@/theme';
import { mockDeviceMetrics, janela } from '../deviceMetrics';

/**
 * O AVISO AMARELO DA SEÇÃO "HORÁRIOS", COLADO NO CONTEÚDO ACIMA.
 *
 * No detalhe de um lugar, o card de Horários lista as faixas de funcionamento e
 * fecha com um aviso de tom `warning`. O aviso encostava na última linha de
 * horário, como se fizesse parte dela.
 *
 * A CAUSA: DOIS IRMÃOS SEM VÃO
 *
 * A lista de horários e o `InlineNotice` eram filhos DIRETOS do `GlassCard`. O
 * `padding: xl` (20) do card separa o conteúdo das BORDAS — ele nunca separou um
 * filho do outro. Sem `gap` no card e sem margem no aviso, o espaço entre os
 * dois era exatamente zero.
 *
 * A CORREÇÃO É LOCAL, E ISSO É DELIBERADO
 *
 * Acrescentar margem ao `InlineNotice` mexeria nas dezenas de telas que já
 * resolvem o espaçamento no contêiner delas — `DailyGoalCard` é uma, e é o
 * padrão da casa. A seção de Horários era justamente a que esquecia o
 * contêiner.
 *
 * O que estes testes medem é a tela DE PRODUÇÃO, renderizada. O Yoga não roda no
 * renderer de teste, então não há pixel a conferir; o que se confere é o que
 * governa o resultado — a árvore que a tela monta e os estilos que ela declara.
 */

const metrics: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

mockDeviceMetrics({ width: 390, fontScale: 1 });

const AVISO = 'Horários podem mudar sem aviso. Confirme com o estabelecimento antes de ir.';

const UM_DIA = ['Seg–Sex 12:00–14:30, 19:00–23:00'];
const DOIS_DIAS = [...UM_DIA, 'Sáb–Dom 12:00–23:00'];
const SEMANA = [
  'Segunda 12:00–14:30, 19:00–23:00',
  'Terça 12:00–14:30, 19:00–23:00',
  'Quarta 12:00–14:30, 19:00–23:00',
  'Quinta 12:00–14:30, 19:00–23:00',
  'Sexta 12:00–14:30, 19:00–00:30',
  'Sábado 12:00–23:00',
  'Domingo 12:00–18:00',
];

const basePlace: Place = {
  id: 'p1',
  name: 'Restaurante Le Petit',
  type: 'restaurant',
  city: 'Paris',
  country: 'França',
  amenities: ['Wi-Fi', 'Acessível'],
  openingHours: DOIS_DIAS,
};

const mockPlace: { current: Place } = { current: basePlace };

jest.mock('expo-linking', () => ({ openURL: jest.fn() }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ placeId: 'p1' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true }),
}));

jest.mock('@/hooks/useContent', () => ({
  usePlace: () => ({ data: mockPlace.current, isLoading: false, isError: false, refetch: jest.fn() }),
  usePlaceFavorites: () => ({ isFavorite: () => false, toggle: { mutate: jest.fn() } }),
  useReservations: () => ({ request: { mutateAsync: jest.fn(), isPending: false } }),
}));
jest.mock('@/hooks/useTrips', () => ({ useCurrentTrip: () => ({ trip: null }) }));
jest.mock('@/services/ai', () => ({ aiService: { kind: 'local', send: jest.fn() } }));

const renderScreen = async (place: Partial<Place> = {}) => {
  mockPlace.current = { ...basePlace, ...place };
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <ToastProvider>
          <PlaceDetailScreen />
        </ToastProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
  await act(async () => undefined);
};

const flat = (style: unknown): Record<string, unknown> =>
  (StyleSheet.flatten(style as never) ?? {}) as Record<string, unknown>;

type Node = { parent: Node | null; props: Record<string, unknown> };

/** Sobe da folha até o primeiro ancestral cujo estilo satisfaz o teste. */
const ancestral = (
  from: unknown,
  matches: (style: Record<string, unknown>) => boolean,
): Record<string, unknown> => {
  let node = (from as Node).parent;
  while (node) {
    const style = flat(node.props?.style);
    if (matches(style)) return style;
    node = node.parent;
  }
  throw new Error('nenhum ancestral com o estilo procurado');
};

/**
 * O contêiner que embrulha a lista de horários e o aviso.
 *
 * `flexDirection === undefined` exclui a fileira interna do próprio
 * `InlineNotice` (ícone ao lado do texto, `gap: sm`), que é o primeiro ancestral
 * com vão no caminho e não tem nada a ver com o espaçamento sob teste.
 */
const containerDoAviso = () =>
  ancestral(
    screen.getByText(AVISO),
    (s) => s.gap !== undefined && s.flexDirection === undefined && s.backgroundColor === undefined,
  );

/** A caixa amarela: o View do `InlineNotice` que carrega o fundo do tom. */
const caixaAmarela = () =>
  ancestral(
    screen.getByText(AVISO),
    (s) => s.backgroundColor !== undefined && s.borderRadius !== undefined,
  );

/** O contêiner das linhas de horário, medido a partir de uma delas. */
const listaDeHorarios = (linha: string) =>
  ancestral(screen.getByText(linha), (s) => s.gap !== undefined && s.flexDirection === undefined);

/* ------------------------------- a estrutura ------------------------------- */

describe('o aviso e os horários moram num contêiner com vão', () => {
  it('existe um vão entre a lista de horários e o aviso', async () => {
    await renderScreen();

    // O defeito era este número não existir. `lg` (16) é o vão de um bloco com
    // fundo próprio; `md` seria o de dois parágrafos de texto.
    expect(containerDoAviso().gap).toBe(spacing.lg);
  });

  it('o vão externo é maior que o que separa duas linhas de horário', async () => {
    await renderScreen();

    const externo = containerDoAviso().gap as number;
    const interno = listaDeHorarios(DOIS_DIAS[0]).gap as number;

    // Se os dois fossem iguais, o aviso leria como mais uma linha da lista —
    // que era exatamente o sintoma relatado.
    expect(interno).toBe(spacing.sm);
    expect(externo).toBeGreaterThan(interno);
  });

  it('o vão vem dos tokens do tema, não de um número solto', async () => {
    await renderScreen();

    // §27/§39: nada de valor cru. Se alguém trocar por `17`, isto falha.
    expect(Object.values(spacing)).toContain(containerDoAviso().gap);
  });
});

/* ------------------------------ o próprio aviso ---------------------------- */

describe('o aviso continua destacado e confortável', () => {
  it('tem fundo próprio, canto arredondado e recuo interno', async () => {
    await renderScreen();

    const caixa = caixaAmarela();
    // O recuo interno é o que faz a caixa parecer um bloco, e não uma faixa de
    // texto colorida. Não foi alterado — só ganhou espaço em volta.
    expect(caixa.padding).toBe(spacing.lg);
    expect(caixa.borderRadius).toBeGreaterThan(0);
    expect(caixa.backgroundColor).toBeTruthy();
  });

  it('a cor vem do tema, e não de um hexadecimal escrito na tela', async () => {
    await renderScreen();

    // O tom `warning` resolve por `theme.colors.warningSoft`, que muda com o
    // modo claro/escuro. O teste garante que existe cor, não qual é.
    const fundo = caixaAmarela().backgroundColor;
    expect(typeof fundo).toBe('string');
    expect(fundo).not.toBe('transparent');
  });

  it('o texto não é truncado — pode ocupar quantas linhas precisar', async () => {
    await renderScreen();

    const texto = screen.getByText(AVISO);
    // Sem `numberOfLines`, o aviso cresce em vez de cortar: uma, duas ou três
    // linhas, e o mesmo com a fonte do sistema ampliada.
    expect(texto.props.numberOfLines).toBeUndefined();
    expect(texto.props.ellipsizeMode).toBeUndefined();
  });

  it('o texto do aviso não foi alterado', async () => {
    // §34: esta tarefa é de layout.
    await renderScreen();
    expect(screen.getByText(AVISO)).toBeTruthy();
  });
});

/* ----------------------------- a responsividade --------------------------- */

describe('o card se comporta com qualquer quantidade de horários', () => {
  it.each([
    ['uma linha', UM_DIA],
    ['duas linhas', DOIS_DIAS],
    ['a semana inteira', SEMANA],
  ])('com %s o vão e o aviso continuam no lugar', async (_nome, openingHours) => {
    await renderScreen({ openingHours });

    for (const linha of openingHours) expect(screen.getByText(linha)).toBeTruthy();
    expect(screen.getByText(AVISO)).toBeTruthy();
    expect(containerDoAviso().gap).toBe(spacing.lg);
  });

  it('a linha de horário pode quebrar em vez de esticar o card', async () => {
    await renderScreen({ openingHours: UM_DIA });

    // "Seg–Sex 12:00–14:30, 19:00–23:00" não cabe em uma linha num aparelho
    // estreito. Com `flex: 1` o texto quebra; sem ele, empurraria a largura do
    // card e levaria o horário para fora junto.
    const linha = screen.getByText(UM_DIA[0]);
    expect(flat(linha.props.style).flex).toBe(1);
    expect(linha.props.numberOfLines).toBeUndefined();
  });

  it.each([
    ['tela pequena', 320, 1],
    ['tela média', 360, 1],
    ['fonte ampliada', 390, 1.5],
    ['fonte muito ampliada', 320, 2],
  ])('em %s o aviso continua inteiro e espaçado', async (_nome, width, fontScale) => {
    janela({ width, fontScale });
    await renderScreen();

    expect(screen.getByText(AVISO)).toBeTruthy();
    expect(screen.getByText(AVISO).props.numberOfLines).toBeUndefined();
    expect(containerDoAviso().gap).toBe(spacing.lg);
  });
});

/* --------------------------- o resto da tela intacto ---------------------- */

describe('as outras seções da tela não foram tocadas', () => {
  it('Comodidades, o assistente e as ações continuam presentes', async () => {
    await renderScreen();

    expect(screen.getByText('Comodidades')).toBeTruthy();
    expect(screen.getByText('Wi-Fi')).toBeTruthy();
    expect(screen.getByText('Horários')).toBeTruthy();
    expect(screen.getByText('Pergunte ao assistente')).toBeTruthy();
  });

  it('sem horários no lugar, a seção não é desenhada — e nem o aviso', async () => {
    await renderScreen({ openingHours: undefined });

    expect(screen.queryByText('Horários')).toBeNull();
    expect(screen.queryByText(AVISO)).toBeNull();
    // A tela continua de pé sem a seção.
    expect(screen.getByText('Comodidades')).toBeTruthy();
  });
});
