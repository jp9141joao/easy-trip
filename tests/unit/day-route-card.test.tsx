import { fireEvent, render, type RenderResult } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';

import { DayRouteCard } from '@/components/trip';
import { ToastProvider } from '@/components/ui';
import {
  buildDayRoute,
  describeRouteDistance,
  formatApproximateDistance,
  STRAIGHT_LINE_METHOD,
} from '@/domain/route';
import type { ItineraryItem } from '@/domain/types';
import { ThemeProvider } from '@/theme';
import { mockDeviceMetrics } from '../deviceMetrics';

/**
 * O card "Rota do dia" espremido no Android (§18).
 *
 * O que se mede aqui é o que GOVERNA o aperto, não a aparência: as medidas
 * fixas que competiam pela largura de um aparelho de 360dp. Largura renderizada
 * não existe no renderer de teste (o Yoga não roda aqui), então o que se
 * verifica é o estilo declarado e a decisão que o `AdaptiveButtonRow` toma a
 * partir da largura que lhe é informada.
 */

const metrics: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 24 },
};

const wrap = (node: React.ReactElement) =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <ToastProvider>{node}</ToastProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );

const flat = (style: unknown): Record<string, unknown> =>
  (StyleSheet.flatten(style as never) ?? {}) as Record<string, unknown>;

const styleOf = (node: { props: Record<string, unknown> }) => flat(node.props.style);

const DATE = '2026-09-02';

const parada = (over: Partial<ItineraryItem> = {}): ItineraryItem => ({
  id: 'i1',
  tripId: 't1',
  date: DATE,
  type: 'atividade',
  title: 'Bairro de Akihabara',
  completed: false,
  sortOrder: 0,
  visibility: 'shared',
  latitude: 35.6984,
  longitude: 139.7731,
  ...over,
});

/** O dia da captura de tela, com um nome curto e um nome longo. */
const DIA: ItineraryItem[] = [
  parada({
    id: 'i1',
    startTime: '01:59:00',
    title: 'Visita ao Museu Nacional de Ciência e Natureza',
    latitude: 35.7163,
    longitude: 139.7766,
  }),
  parada({ id: 'i2', startTime: '10:00:00', title: 'Bairro de Akihabara', sortOrder: 1 }),
  parada({
    id: 'i3',
    startTime: '20:30:00',
    title: 'Jantar nas Ruas de Shinjuku',
    sortOrder: 2,
    latitude: 35.6938,
    longitude: 139.7034,
  }),
];

const card = (props: Partial<React.ComponentProps<typeof DayRouteCard>> = {}) =>
  wrap(<DayRouteCard items={DIA} date={DATE} onOpenFullMap={jest.fn()} {...props} />);

/** Informa ao contêiner adaptativo a largura útil daquele aparelho. */
const medir = (view: RenderResult, width: number) =>
  fireEvent(view.getByTestId('adaptive-button-row'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width, height: 40 } },
  });

const direcao = (view: RenderResult) =>
  styleOf(view.getByTestId('adaptive-button-row') as never).flexDirection;

/* ----------------------------------- mapa ---------------------------------- */

// Aparelho real: o preset do RN devolve fontScale 2, que não é um celular.
mockDeviceMetrics({ width: 390, fontScale: 1 });

describe('o mapa é proporção, não altura de aparelho', () => {
  it('acompanha a largura do card em vez de fixar 180dp', () => {
    const estilo = styleOf(card().getByTestId('day-route-map') as never);

    expect(estilo.width).toBe('100%');
    expect(estilo.aspectRatio).toBeGreaterThan(1);
    // Altura fixa é o que fazia o mapa tomar o card no aparelho estreito.
    expect(estilo.height).toBeUndefined();
    // O teto é do tablet, e é teto — não altura.
    expect(estilo.maxHeight).toBeGreaterThan(0);
  });
});

/* --------------------------------- paradas --------------------------------- */

describe('a lista de paradas com nomes longos', () => {
  it('o nome inteiro chega à tela, sem corte no meio do texto', () => {
    const view = card();
    expect(view.getByText('Visita ao Museu Nacional de Ciência e Natureza')).toBeTruthy();
    expect(view.getByText('Jantar nas Ruas de Shinjuku')).toBeTruthy();
    expect(view.getByText('Bairro de Akihabara')).toBeTruthy();
  });

  it('o nome ocupa o que sobra da linha e quebra em até duas', () => {
    const nome = card().getByText('Visita ao Museu Nacional de Ciência e Natureza');
    const estilo = styleOf(nome as never);

    expect(estilo.flex).toBe(1);
    // Sem `minWidth: 0` o texto se recusa a encolher e empurra a linha.
    expect(estilo.minWidth).toBe(0);
    expect(nome.props.numberOfLines).toBe(2);
  });

  it('número e horário continuam visíveis ao lado do nome longo', () => {
    const view = card();

    // Um por parada, e na ordem do roteiro.
    expect(view.getByText('1')).toBeTruthy();
    expect(view.getByText('2')).toBeTruthy();
    expect(view.getByText('3')).toBeTruthy();

    // HH:mm, e nunca os segundos que o PostgREST manda.
    expect(view.getByText('01:59')).toBeTruthy();
    expect(view.getByText('10:00')).toBeTruthy();
    expect(view.queryByText('01:59:00')).toBeNull();
  });

  it('o horário não encolhe para caber — quem cede é o nome', () => {
    expect(styleOf(card().getByText('01:59') as never).flexShrink).toBe(0);
  });

  it('parada sem horário não deixa buraco nem quebra a linha', () => {
    const view = wrap(
      <DayRouteCard
        items={[DIA[0], { ...DIA[1], startTime: undefined }]}
        date={DATE}
        onOpenFullMap={jest.fn()}
      />,
    );
    expect(view.getByText('Bairro de Akihabara')).toBeTruthy();
    expect(view.queryByText('10:00')).toBeNull();
  });
});

/* -------------------------------- distância -------------------------------- */

describe('a distância tem hierarquia própria', () => {
  it('o número em destaque, o método em texto secundário', () => {
    const view = card();
    const rota = buildDayRoute(DIA, DATE)!;
    const numero = formatApproximateDistance(rota.totalDistanceKm);

    // Separados no visual, e ainda assim a mesma frase: o método nunca some.
    expect(`${numero} ${STRAIGHT_LINE_METHOD}`).toBe(describeRouteDistance(rota));
    expect(view.getByText(numero)).toBeTruthy();
    expect(view.getByText(STRAIGHT_LINE_METHOD)).toBeTruthy();
  });

  it('para o leitor de tela as duas partes voltam a ser uma frase só', () => {
    const rota = buildDayRoute(DIA, DATE)!;
    expect(card().getByLabelText(describeRouteDistance(rota))).toBeTruthy();
  });

  it('a ressalva sobre a distância real continua legível e separada', () => {
    expect(
      card().getByText('3 paradas · a distância real de caminhada ou carro é maior'),
    ).toBeTruthy();
  });
});

/* --------------------------------- botões ---------------------------------- */

describe('os dois botões, sem rótulo cortado', () => {
  it('os rótulos chegam inteiros — nada de "Ver mapa co..."', () => {
    const view = card();
    medir(view, 280); // a largura útil dentro do card num aparelho de 360dp

    expect(view.getByText('Mapa completo')).toBeTruthy();
    expect(view.getByText('Abrir no Maps')).toBeTruthy();
  });

  it.each([
    ['320dp de tela', 240, 'column'],
    ['360dp de tela', 280, 'column'],
    ['412dp de tela', 332, 'column'],
    ['tablet', 700, 'row'],
  ])('%s: empilha ou enfileira conforme o que cabe', (_nome, largura, esperado) => {
    const view = card();
    medir(view, largura);
    expect(direcao(view)).toBe(esperado);
  });

  it('sem mapa completo, sobra a ação externa sozinha', () => {
    const view = card({ onOpenFullMap: undefined });
    medir(view, 280);

    expect(view.queryByText('Mapa completo')).toBeNull();
    expect(view.getByText('Abrir no Maps')).toBeTruthy();
    // Um botão só nunca precisa empilhar.
    expect(direcao(view)).toBe('row');
  });
});

/* ------------------------------ o card em si ------------------------------- */

describe('o card só existe quando há rota', () => {
  it('menos de duas paradas com coordenada: não desenha nada', () => {
    const view = wrap(<DayRouteCard items={[DIA[0]]} date={DATE} />);
    expect(view.queryByTestId('day-route-map')).toBeNull();
    expect(view.queryByText('Abrir no Maps')).toBeNull();
  });
});
