import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context';

import { useKeyboardVisible } from '@/hooks/useKeyboard';
import { useTheme, type Theme } from '@/theme';

/**
 * Quanto do fundo da tela o dock flutuante realmente esconde.
 *
 * DUAS TENTATIVAS, E POR QUE ESTA É DIFERENTE
 *
 * A primeira versão reservava `DOCK_CLEARANCE = 110`, um número fixo. A
 * segunda passou a CALCULAR: altura medida da barra + área segura inferior.
 * A conta estava certa no papel — e o vão continuou enorme no Android físico.
 *
 * Quando a conta certa dá errado, a premissa é que está errada. A premissa era
 * "a tela vai até o fundo da janela, e o dock flutua por cima dela". Se a tela
 * já terminar acima do dock — porque o navegador a insere, porque a área segura
 * já foi aplicada por um pai, ou por qualquer outro motivo —, somar a altura do
 * dock conta a mesma faixa DUAS vezes, e o resultado é exatamente o buraco
 * relatado.
 *
 * Esta versão não supõe nem uma coisa nem outra: ela MEDE a sobreposição.
 *
 *   dock.topY      — o topo da barra, em coordenadas da janela;
 *   coluna.bottomY — o fundo da coluna que contém o composer, idem;
 *   overlap        — quanto da coluna está atrás da barra: max(0, b − t).
 *
 * Se a coluna já termina acima da barra, `overlap` é zero e não se soma nada.
 * Se ela passa por baixo, soma-se exatamente o que está escondido. Nos dois
 * casos o composer para no mesmo lugar, e nenhum dos dois casos precisa ser
 * adivinhado.
 */

/** Onde a base do dock fica, em relação ao fundo da janela. */
export function dockBottomOffset(insets: EdgeInsets, theme: Theme): number {
  return Math.max(insets.bottom, theme.spacing.md);
}

/**
 * A altura que se assume enquanto nada foi medido.
 *
 * Derivada dos mesmos tokens que desenham o dock — alvo de toque mínimo, o
 * respiro interno da barra e as duas bordas —, não de um número observado num
 * aparelho. Vale por um quadro, e erra por poucos pontos.
 */
export function estimatedDockHeight(theme: Theme): number {
  return theme.hitTarget + theme.spacing.sm * 2 + 2;
}

/** O respiro que se quer VER entre o composer e a navbar (§11: 8–16pt). */
export function dockGap(theme: Theme): number {
  return theme.spacing.md;
}

interface Measurements {
  /** Topo da barra em coordenadas da janela. `null` até medir. */
  dockTopY: number | null;
  /** Fundo da coluna do composer em coordenadas da janela. `null` até medir. */
  columnBottomY: number | null;
}

interface DockMetricsApi extends Measurements {
  /** Quanto da coluna está escondido atrás do dock. Zero se ele não está lá. */
  overlap: number;
  /** `overlap` + o respiro. É o que o composer reserva embaixo. */
  clearance: number;
  visible: boolean;
  /** As duas medidas já chegaram? Enquanto não, `clearance` é estimativa. */
  measured: boolean;
}

const MeasurementsContext = createContext<Measurements>({ dockTopY: null, columnBottomY: null });
const ReportContext = createContext<{
  reportDockTop: (y: number) => void;
  reportColumnBottom: (y: number) => void;
}>({ reportDockTop: () => undefined, reportColumnBottom: () => undefined });

/** Ignora ruído sub-pixel: `measureInWindow` devolve fracionários a cada quadro. */
function settle(current: number | null, next: number): number | null {
  return current !== null && Math.abs(current - next) < 1 ? current : next;
}

export function DockMetricsProvider({ children }: { children: ReactNode }) {
  const [dockTopY, setDockTopY] = useState<number | null>(null);
  const [columnBottomY, setColumnBottomY] = useState<number | null>(null);

  const reportDockTop = useCallback((y: number) => setDockTopY((c) => settle(c, y)), []);
  const reportColumnBottom = useCallback((y: number) => setColumnBottomY((c) => settle(c, y)), []);

  const measurements = useMemo(() => ({ dockTopY, columnBottomY }), [dockTopY, columnBottomY]);
  const report = useMemo(
    () => ({ reportDockTop, reportColumnBottom }),
    [reportDockTop, reportColumnBottom],
  );

  return (
    <ReportContext.Provider value={report}>
      <MeasurementsContext.Provider value={measurements}>{children}</MeasurementsContext.Provider>
    </ReportContext.Provider>
  );
}

/** O que o dock usa para publicar a própria posição. */
export function useReportDockTop(): (y: number) => void {
  return useContext(ReportContext).reportDockTop;
}

/**
 * Envolve a coluna cujo último filho não pode ficar atrás do dock.
 *
 * Mede o próprio fundo em coordenadas da JANELA — e não a própria altura —,
 * porque a pergunta não é "que tamanho eu tenho" e sim "onde eu termino em
 * relação ao dock". A altura sozinha não responde isso, e foi por não
 * responder que as duas tentativas anteriores erraram.
 */
export function DockAwareColumn({
  children,
  style,
  testID,
}: {
  children: ReactNode;
  style?: object;
  testID?: string;
}) {
  const ref = useRef<View>(null);
  const report = useContext(ReportContext).reportColumnBottom;

  const medir = useCallback(
    (event: LayoutChangeEvent) => {
      const { y: localY, height: localH } = event.nativeEvent.layout;
      const node = ref.current;

      // Sem medida nativa, o layout local é o que existe.
      if (!node?.measureInWindow) {
        report(localY + localH);
        return;
      }

      // O valor do evento vale desde já: ele é relativo ao pai, não à janela,
      // mas existe AGORA. `measureInWindow` é assíncrono no React Native e
      // simplesmente não responde no renderer de teste — depender só dele
      // deixaria a folga presa na estimativa para sempre.
      report(localY + localH);

      node.measureInWindow((_x, y, _w, height) => {
        // Uma medida 0×0 não é medida: o nó ainda não foi posicionado.
        if (!Number.isFinite(y) || !Number.isFinite(height) || (y === 0 && height === 0)) return;
        report(y + height);
      });
    },
    [report],
  );

  return (
    <View ref={ref} testID={testID} style={style} onLayout={medir} collapsable={false}>
      {children}
    </View>
  );
}

/**
 * A folga que o composer precisa reservar embaixo.
 *
 * Enquanto as duas medidas não chegam, usa a estimativa antiga — que reserva
 * espaço A MAIS, nunca a menos. Reservar de menos esconderia o campo de texto
 * atrás do dock, que é o erro pior dos dois.
 */
export function useDockMetrics(): DockMetricsApi {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();
  const { dockTopY, columnBottomY } = useContext(MeasurementsContext);

  return useMemo(() => {
    const measured = dockTopY !== null && columnBottomY !== null;

    if (keyboardVisible) {
      // O dock sai de cena com o teclado (`(tabs)/_layout.tsx` devolve `null`).
      // Quem levanta o composer é o `KeyboardAvoidingView`, medindo a
      // sobreposição real do teclado — aqui não há nada a reservar.
      return { dockTopY, columnBottomY, overlap: 0, clearance: 0, visible: false, measured };
    }

    const overlap = measured
      ? Math.max(0, columnBottomY! - dockTopY!)
      : estimatedDockHeight(theme) + dockBottomOffset(insets, theme);

    return {
      dockTopY,
      columnBottomY,
      overlap,
      clearance: overlap + dockGap(theme),
      visible: true,
      measured,
    };
  }, [columnBottomY, dockTopY, insets, keyboardVisible, theme]);
}
