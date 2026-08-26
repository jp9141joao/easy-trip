import { fireEvent, render, type RenderResult } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';

import { ActivityCard } from '@/components/cards';
import { AdaptiveButtonRow, Button, ToastProvider } from '@/components/ui';
import { formatClockTime } from '@/lib/date';
import type { ItineraryItem } from '@/domain/types';
import { ThemeProvider } from '@/theme';

/**
 * Cartões apertados no Android físico (§13–§19 do handoff).
 *
 * TRÊS DEFEITOS, TRÊS CAUSAS
 *
 * 1. "Adicionar ao r..." — dois botões `flex: 1` numa fileira que não cabia
 *    num aparelho de 360dp. Um botão que não diz o que faz não é um botão.
 * 2. "Compartilhado" cortado na direita — a linha de etiquetas do cartão da
 *    Jornada não tinha `flexWrap`, e a terceira etiqueta batia na borda.
 * 3. "01:59:00" e "até 19:59:00" — o `time` do Postgres chega como HH:MM:SS
 *    pelo PostgREST, e ninguém cortava os segundos. Além de não dizerem nada,
 *    eles alargavam a linha e ajudavam a empurrar a etiqueta para fora.
 *
 * Largura renderizada não existe aqui (o Yoga não roda no renderer de teste),
 * então o que se mede é o que de fato governa cada um: o estilo, e a decisão
 * que o `AdaptiveButtonRow` toma a partir da largura que lhe é informada.
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

/** Informa ao contêiner adaptativo a largura útil daquele aparelho. */
const medir = (view: RenderResult, width: number) =>
  fireEvent(view.getByTestId('adaptive-button-row'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width, height: 40 } },
  });

const direcao = (view: RenderResult) =>
  flat((view.getByTestId('adaptive-button-row') as unknown as { props: Record<string, unknown> }).props.style)
    .flexDirection;

/* ------------------------------ ações do cartão ---------------------------- */

describe('as ações do cartão de sugestão (§14)', () => {
  const acoes = (
    <AdaptiveButtonRow minItemWidth={200}>
      <Button label="Ver detalhes" variant="secondary" size="sm" fullWidth onPress={jest.fn()} />
      <Button label="Adicionar ao roteiro" size="sm" fullWidth onPress={jest.fn()} />
    </AdaptiveButtonRow>
  );

  /*
   * As larguras são as ÚTEIS dentro do cartão, não as da tela: descontadas as
   * margens da tela e o recuo do cartão. Num aparelho de 360dp sobram cerca de
   * 280dp — que é exatamente onde a fileira quebrava o rótulo.
   */
  it.each([
    ['320dp de tela', 240, 'column'],
    ['360dp de tela', 280, 'column'],
    ['390dp de tela', 310, 'column'],
    ['412dp de tela', 332, 'column'],
    ['tablet', 700, 'row'],
  ])('%s: empilha ou enfileira conforme o que cabe', (_nome, largura, esperado) => {
    const view = wrap(acoes);
    medir(view, largura);
    expect(direcao(view)).toBe(esperado);
  });

  it('os dois rótulos continuam inteiros — nada de "Adicionar ao r..."', () => {
    const view = wrap(acoes);
    medir(view, 280);

    expect(view.getByText('Adicionar ao roteiro')).toBeTruthy();
    expect(view.getByText('Ver detalhes')).toBeTruthy();
  });

  it('enquanto a largura não foi medida, aposta na fileira', () => {
    // Um quadro em coluna que depois vira fileira chamaria atenção à toa.
    const view = wrap(acoes);
    expect(direcao(view)).toBe('row');
  });

  it('um botão só nunca precisa empilhar', () => {
    const view = wrap(
      <AdaptiveButtonRow minItemWidth={200}>
        <Button label="Adicionar ao roteiro" size="sm" fullWidth onPress={jest.fn()} />
      </AdaptiveButtonRow>,
    );
    medir(view, 280);
    expect(direcao(view)).toBe('row');
  });
});

/* ----------------------------- cartão da Jornada --------------------------- */

const atividade = (over: Partial<ItineraryItem> = {}): ItineraryItem => ({
  id: 'i1',
  tripId: 't1',
  date: '2026-09-02',
  startTime: '01:59:00',
  endTime: '19:59:00',
  type: 'atividade',
  title: 'Passeio pelo bairro histórico',
  completed: false,
  sortOrder: 0,
  visibility: 'shared',
  ...over,
});

describe('as etiquetas da Jornada quebram em vez de sumir (§18)', () => {
  const linhaDeBadges = (view: RenderResult) => {
    const alvo = view.getByText('Atividade');
    // A linha é o contêiner que agrupa as etiquetas.
    type Node = { parent: Node | null; props?: Record<string, unknown> };
    let node: Node | null = alvo as unknown as Node;
    while (node) {
      const estilo = flat(node.props?.style);
      if (estilo.flexDirection === 'row' && estilo.flexWrap !== undefined) return estilo;
      node = node.parent;
    }
    return null;
  };

  it('a linha de etiquetas tem quebra — era ela que cortava "Compartilhado"', () => {
    const view = wrap(<ActivityCard item={atividade()} showVisibility />);
    expect(linhaDeBadges(view)?.flexWrap).toBe('wrap');
  });

  it('as três etiquetas existem, inclusive a de compartilhamento', () => {
    const view = wrap(<ActivityCard item={atividade()} showVisibility />);
    expect(view.getByText('Atividade')).toBeTruthy();
    expect(view.getByText('até 19:59')).toBeTruthy();
    expect(view.getByText('Compartilhado')).toBeTruthy();
  });
});

describe('o horário aparece sem segundos (§17)', () => {
  it('o trilho mostra HH:mm, não HH:mm:ss', () => {
    const view = wrap(<ActivityCard item={atividade()} />);
    expect(view.getByText('01:59')).toBeTruthy();
    expect(view.queryByText('01:59:00')).toBeNull();
  });

  it('o "até" também', () => {
    const view = wrap(<ActivityCard item={atividade()} />);
    expect(view.getByText('até 19:59')).toBeTruthy();
    expect(view.queryByText('até 19:59:00')).toBeNull();
  });

  it('sem horário, o trilho continua dizendo que não há', () => {
    const view = wrap(<ActivityCard item={atividade({ startTime: undefined })} />);
    expect(view.getByText('--:--')).toBeTruthy();
  });
});

describe('formatClockTime', () => {
  it.each([
    ['01:59:00', '01:59'],
    ['10:00:00', '10:00'],
    ['21:59:00', '21:59'],
    ['23:59', '23:59'],
    ['9:05', '09:05'],
    ['00:00:00.000', '00:00'],
  ])('%s → %s', (entrada, esperado) => {
    expect(formatClockTime(entrada)).toBe(esperado);
  });

  it.each([undefined, null, '', 'amanhã', '25:00', '10:70', '10'])(
    'não inventa formato para %p',
    (entrada) => {
      // Melhor não mostrar nada do que mostrar lixo formatado como hora.
      expect(formatClockTime(entrada as never)).toBeUndefined();
    },
  );
});
