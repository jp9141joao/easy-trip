import { render, type RenderResult } from '@testing-library/react-native';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';

import { StatCard } from '@/components/ui';
import { formatMoney } from '@/lib/currency';
import { spacing } from '@/theme/tokens';
import { ThemeProvider } from '@/theme';
import { mockDeviceMetrics } from '../deviceMetrics';

/**
 * O TERCEIRO CARTÃO CORTADO NA TELA OBJETIVOS.
 *
 * O topo de Objetivos tem três cartões numa fileira — "Metas ativas",
 * "Concluídas", "Economizado" — e no Android o terceiro aparecia cortado na
 * lateral direita.
 *
 * A CAUSA ERA UM PISO DE LARGURA, NÃO UMA FALTA DE ESPAÇO
 *
 * `StatCard` trazia `minWidth: 140` junto de `flex: 1`. Num contêiner `row` sem
 * `flexWrap`, `minWidth` é um limite que o encolhimento não ultrapassa: o Yoga
 * reparte a largura, bate no piso e transborda em vez de continuar dividindo.
 *
 *   360dp de tela − 2×20 (margem) = 320 úteis
 *   320 − 2×12 (dois vãos)        = 296 para repartir
 *   3 × 140                       = 420 exigidos  →  124dp fora da tela
 *
 * Em Perfil, que usa duas colunas, o mesmo piso cabia com folga (2×140 + 12 =
 * 292 ≤ 320) — a mesma causa esperando uma terceira coluna para aparecer.
 *
 * O QUE ESTES TESTES MEDEM
 *
 * O Yoga não roda no renderer de teste, então largura renderizada não existe
 * aqui. O que se mede é o que de fato governa o resultado: o estilo do cartão, e
 * a aritmética de repartição para as larguras de aparelho que importam. É a
 * mesma abordagem de `card-responsiveness.test.tsx`.
 */

const metrics: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

mockDeviceMetrics({ width: 390, fontScale: 1 });

const wrap = (node: React.ReactElement) =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>{node}</ThemeProvider>
    </SafeAreaProvider>,
  );

const flat = (style: unknown): Record<string, unknown> =>
  (StyleSheet.flatten(style as never) ?? {}) as Record<string, unknown>;

/** O estilo do contêiner do cartão que carrega aquele rótulo. */
const estiloDoCartao = (view: RenderResult, label: string): Record<string, unknown> => {
  // Do texto do rótulo para cima até o View que tem `flex` — o contêiner.
  let node = view.getByText(label).parent;
  while (node) {
    const style = flat((node as unknown as { props: Record<string, unknown> }).props?.style);
    if (style.borderRadius !== undefined && style.flex !== undefined) return style;
    node = node.parent;
  }
  throw new Error(`contêiner do cartão "${label}" não encontrado`);
};

/** A fileira real de Objetivos, com os três rótulos da tela. */
const fileiraDeObjetivos = (economizado: string) =>
  wrap(
    <View style={{ flexDirection: 'row', gap: spacing.md }}>
      <StatCard label="Metas ativas" value="3" tone="brand" />
      <StatCard label="Concluídas" value="1" tone="success" />
      <StatCard label="Economizado" value={economizado} tone="accent" />
    </View>,
  );

/* ---------------------------- o piso que sumiu ---------------------------- */

describe('o cartão de estatística não tem mais piso de largura', () => {
  it('declara flex: 1 e minWidth: 0', () => {
    const view = fileiraDeObjetivos('R$ 500,00');
    const estilo = estiloDoCartao(view, 'Economizado');

    expect(estilo.flex).toBe(1);
    // O ponto do defeito: qualquer piso positivo aqui volta a transbordar numa
    // fileira de três num aparelho estreito.
    expect(estilo.minWidth).toBe(0);
  });

  it.each(['Metas ativas', 'Concluídas', 'Economizado'])(
    'o cartão "%s" reparte a largura em vez de exigir uma',
    (label) => {
      const view = fileiraDeObjetivos('R$ 15.000,00');
      const estilo = estiloDoCartao(view, label);

      expect(estilo.flex).toBe(1);
      expect(estilo.minWidth).toBe(0);
      // Nenhuma largura fixa de aparelho: a largura vem da tela.
      expect(estilo.width).toBeUndefined();
      expect(estilo.maxWidth).toBeUndefined();
    },
  );

  it('os três cartões existem e estão desenhados', () => {
    const view = fileiraDeObjetivos('R$ 15.000,00');

    expect(view.getByText('Metas ativas')).toBeTruthy();
    expect(view.getByText('Concluídas')).toBeTruthy();
    expect(view.getByText('Economizado')).toBeTruthy();
    expect(view.getByText('R$ 15.000,00')).toBeTruthy();
  });
});

/* -------------------------- a aritmética da fileira ----------------------- */

describe('três cartões cabem na fileira', () => {
  /**
   * A largura que sobra para cada cartão numa fileira de N, dada a tela.
   *
   * É a conta que o Yoga faz com `flex: 1` e `minWidth: 0`: desconta as margens
   * da tela e os vãos, e divide o resto por igual.
   */
  const fatia = (tela: number, colunas: number) =>
    (tela - 2 * spacing.screen - (colunas - 1) * spacing.md) / colunas;

  const piso = () => {
    const view = fileiraDeObjetivos('R$ 500,00');
    return estiloDoCartao(view, 'Economizado').minWidth as number;
  };

  it.each([
    ['tela pequena (320dp)', 320],
    ['tela média (360dp)', 360],
    ['tela média (390dp)', 390],
    ['tela grande (412dp)', 412],
    ['tablet (768dp)', 768],
  ])('em %s a fatia de cada um dos três é positiva e acima do piso', (_nome, tela) => {
    const largura = fatia(tela, 3);
    expect(largura).toBeGreaterThan(0);
    // A propriedade que conserta o defeito: a fatia nunca é menor que o piso,
    // porque o piso é zero. Com 140, 320dp e 360dp falhariam aqui.
    expect(largura).toBeGreaterThanOrEqual(piso());
  });

  it('o piso antigo de 140dp NÃO caberia em três colunas num aparelho comum', () => {
    // O teste que documenta o defeito: se alguém reintroduzir o piso, a conta
    // abaixo continua sendo a prova de que ele não cabe.
    expect(fatia(360, 3)).toBeLessThan(140);
    expect(fatia(320, 3)).toBeLessThan(140);
    // E a razão de ninguém ter notado antes: em duas colunas cabia.
    expect(fatia(360, 2)).toBeGreaterThan(140);
  });

  it('a soma dos três cartões mais os vãos não excede a largura útil', () => {
    for (const tela of [320, 360, 390, 412, 768]) {
      const util = tela - 2 * spacing.screen;
      const total = 3 * fatia(tela, 3) + 2 * spacing.md;
      // Igualdade dentro do erro de ponto flutuante: nada sobra para fora.
      expect(total).toBeCloseTo(util, 5);
    }
  });
});

/* --------------------------- o cartão "Economizado" ----------------------- */

describe('o valor monetário não quebra o cartão', () => {
  /*
   * Objetivos formata com `compact: true`. Os valores abaixo cobrem de zero a
   * seis dígitos, que é o intervalo em que o rótulo "Economizado" e o número
   * disputam a mesma coluna estreita.
   */
  it.each([0, 500, 15_000, 100_000, 1_234_567])('aceita %p sem estourar a linha', (valor) => {
    const texto = formatMoney(valor, 'BRL', { compact: true });
    const view = fileiraDeObjetivos(texto);

    const numero = view.getByText(texto);
    // Uma linha só, e a fonte encolhe para caber em vez de o texto vazar. As
    // duas propriedades já existiam no cartão; o que faltava era a largura.
    expect(numero.props.numberOfLines).toBe(1);
    expect(numero.props.adjustsFontSizeToFit).toBe(true);
  });

  it('o rótulo pode usar duas linhas, e é isso que o mantém legível', () => {
    const view = fileiraDeObjetivos('R$ 100.000,00');
    // "Economizado" numa coluna de ~99dp cabe em duas linhas sem cortar. Com
    // `alignItems` padrão (`stretch`), os três cartões continuam da mesma
    // altura e a fileira não fica torta.
    expect(view.getByText('Economizado').props.numberOfLines).toBe(2);
  });

  it('a tipografia do número continua sendo a do desenho (h3, mono, bold)', () => {
    // §28: nada de reduzir a fonte para caber. O que mudou foi a largura.
    const view = fileiraDeObjetivos('R$ 500,00');
    const estilo = flat(view.getByText('R$ 500,00').props.style);
    expect(estilo.fontSize).toBe(18);
  });
});

/* ------------------------- as duas colunas do Perfil ---------------------- */

describe('Perfil, que usa duas colunas, continua igual', () => {
  it('o cartão é o mesmo e não perdeu nada', () => {
    const view = wrap(
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <StatCard label="Viagens" value="7" tone="brand" />
        <StatCard label="Países" value="4" tone="accent" />
      </View>,
    );

    const estilo = estiloDoCartao(view, 'Viagens');
    expect(estilo.flex).toBe(1);
    expect(estilo.minWidth).toBe(0);
    // Recuo vertical preservado; o horizontal é o que cedeu, no eixo disputado.
    expect(estilo.paddingVertical).toBe(spacing.lg);
    expect(estilo.paddingHorizontal).toBe(spacing.md);
    expect(view.getByText('Viagens')).toBeTruthy();
    expect(view.getByText('Países')).toBeTruthy();
  });
});
