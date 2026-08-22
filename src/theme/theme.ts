import {
  coral,
  duration,
  fontFamily,
  hitSlop,
  HIT_TARGET,
  ocean,
  radius,
  semantic,
  slate,
  spacing,
  typography,
} from './tokens';

/**
 * Role-based palette. Screens reference roles (`surface`, `textSecondary`),
 * never raw ramp values, so light/dark stay consistent by construction.
 */
export interface Palette {
  /** App background behind everything, including the aurora. */
  background: string;
  /** Raised container: cards, sheets, inputs. */
  surface: string;
  /** A surface sitting on top of another surface. */
  surfaceElevated: string;
  /** Translucent glass fill (§69). */
  glass: string;
  glassBorder: string;
  /** Subtle fills for chips / inactive segments. */
  surfaceMuted: string;

  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  /** Text drawn on top of primary/accent fills. */
  textOnPrimary: string;
  /** Text drawn over photography. */
  textOnImage: string;

  primary: string;
  primaryPressed: string;
  primarySoft: string;
  accent: string;
  accentSoft: string;

  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  error: string;
  errorPressed: string;
  errorSoft: string;

  border: string;
  borderStrong: string;
  /** Linha divisória interna — mais leve que `border`, nunca estrutural. */
  divider: string;
  /** Scrim over hero photography to guarantee contrast (§75). */
  scrim: string;
  skeleton: string;

  /**
   * Papéis semânticos das superfícies que o tema claro precisava distinguir e
   * não distinguia (§4).
   *
   * No escuro cada um deles recebe exatamente o valor que o componente já usava
   * antes de existir o papel — `input` é o `surface` do escuro, `navigation` é o
   * `surfaceElevated`, e assim por diante. Por construção, portanto, o tema
   * escuro renderiza igual ao que foi aprovado; quem ganha vocabulário novo é
   * só o claro, onde tudo isso colapsava em branco.
   */
  /** Campo de entrada — recuado em relação ao card que o contém. */
  input: string;
  inputBorder: string;
  /** Dock flutuante e barras de navegação. */
  navigation: string;
  navigationBorder: string;
  /** Fundo do item ativo da navegação. */
  navigationActive: string;
  /** Trilho do segmented control e a pastilha selecionada. */
  segmentTrack: string;
  segmentSelected: string;
  /** Bolha da IA no chat — a do usuário usa `primary`. */
  bubbleAssistant: string;
  bubbleAssistantBorder: string;
  /** Card informativo com a identidade da marca (contexto da IA, destaques). */
  surfaceAccent: string;
  surfaceAccentBorder: string;

  /**
   * Chips de status e contagem regressiva (§32).
   *
   * Eles são desenhados por cima de fotografia, cuja luminosidade não tem
   * relação nenhuma com o tema do app: uma foto pode ser clara, escura, azul ou
   * muito detalhada. Por isso a legibilidade vem da própria superfície do chip
   * — um scrim opaco o bastante com borda — e não da imagem por baixo. O
   * significado é carregado por um ponto/ícone colorido, não pelo texto, que
   * permanece claro em qualquer cenário.
   */
  status: Record<TripStatusRole, TonalRole>;
  countdown: Record<CountdownRole, TonalRole>;

  /**
   * Ações desenhadas por cima de fotografia — os botões do hero (§7, §8).
   *
   * Não podem usar `glass`: aquele token descreve a superfície de um card sobre
   * a *página*, que no tema claro é branca por definição. Um botão branco com
   * ícone branco sobre a foto é ilegível. Aqui vale a mesma regra dos chips de
   * status: o contraste nasce da superfície do próprio botão, para a leitura
   * não depender da sorte da imagem.
   */
  onImage: TonalRole;

  /**
   * Badges sobre a fotografia do hero — categoria, tipo, avaliação, desconto
   * (§1–§4).
   *
   * A superfície e a borda são compartilhadas; só o texto muda de cor, e é ele
   * que carrega o significado. O scrim é forte o bastante para os tons claros
   * das rampas passarem em AA mesmo contra uma foto totalmente branca, que é o
   * pior caso possível — assim a cor semântica sobrevive sem depender da
   * imagem escolhida.
   */
  heroBadge: {
    surface: string;
    border: string;
    foreground: Record<HeroBadgeVariant, string>;
  };

  /**
   * Accent da comunidade no WhatsApp.
   *
   * Precisa de valores por tema porque o verde da marca (`#25D366`) rende
   * apenas 1.79:1 sobre a superfície clara — some. No claro usamos um verde
   * mais fechado, que mantém a leitura de "WhatsApp" com 4.85:1; no escuro o
   * verde da marca funciona como está. É só um accent: o protagonista da
   * seção continua sendo o Ocean Blue do Easy Trip.
   */
  whatsapp: TonalRole;
}

/** Estados da viagem, na nomenclatura visual (§25). */
export type TripStatusRole = 'planned' | 'active' | 'completed';

/**
 * Proximidade da viagem (§28). Deliberadamente não existe um papel `danger`:
 * uma viagem que acontece em 90 dias não é um erro nem uma emergência, então
 * ela nunca deve usar a semântica de perigo.
 */
export type CountdownRole = 'calm' | 'near' | 'imminent';

/** Significados que um badge sobre imagem precisa expressar (§6). */
export type HeroBadgeVariant = 'info' | 'rating' | 'discount' | 'neutral';

export interface TonalRole {
  background: string;
  foreground: string;
  border: string;
  /** Ponto/ícone que carrega o significado sem tingir o texto. */
  accent: string;
}

export interface Shadow {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  elevation: number;
}

export interface Theme {
  scheme: 'light' | 'dark';
  colors: Palette;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
  fontFamily: typeof fontFamily;
  duration: typeof duration;
  hitSlop: typeof hitSlop;
  hitTarget: number;
  /** Diffuse, light shadows (§73). */
  shadows: { sm: Shadow; md: Shadow; lg: Shadow };
  /** Aurora gradient stops (§68) — very low opacity, never hurts legibility. */
  aurora: { cyan: string; blue: string; rose: string };
}

/**
 * Superfície dos chips sobre fotografia. Idêntica nos dois temas de propósito:
 * o contraste precisa vir do chip, e a foto por baixo é a mesma no Claro e no
 * Escuro. Trocar esses valores por tema só reduziria contraste sem motivo.
 */
const chipSurface = {
  // 0.70 e não menos: é o ponto em que os tons claros das rampas (ocean 300,
  // amber 300, coral 200) ainda passam em AA sobre uma foto branca. Abaixo
  // disso só o texto branco sobrevive, e a cor semântica se perde.
  background: 'rgba(2,6,23,0.70)',
  foreground: '#FFFFFF',
  border: 'rgba(255,255,255,0.26)',
} as const;

const heroBadgeRole = {
  surface: chipSurface.background,
  border: chipSurface.border,
  foreground: {
    info: ocean[300],
    rating: '#FCD34D',
    // coral 200, e não 300: o 300 fica em 4.18:1 contra foto branca.
    discount: coral[200],
    neutral: chipSurface.foreground,
  },
} as const;

/** Botões do topo do hero — mesma família visual dos chips de status. */
const onImageRole: TonalRole = { ...chipSurface, accent: chipSurface.foreground };

const statusRoles: Record<TripStatusRole, TonalRole> = {
  planned: { ...chipSurface, accent: ocean[300] },
  active: { ...chipSurface, accent: '#34D399' },
  completed: { ...chipSurface, accent: slate[300] },
};

const countdownRoles: Record<CountdownRole, TonalRole> = {
  calm: { ...chipSurface, accent: slate[300] },
  near: { ...chipSurface, accent: ocean[300] },
  // Atenção moderada — âmbar, nunca vermelho de erro (§28).
  imminent: { ...chipSurface, accent: '#FBBF24' },
};

const lightPalette: Palette = {
  /*
   * Tema claro — refino (§4).
   *
   * O diagnóstico do claro anterior era simples: quase tudo era `#FFFFFF` ou
   * um branco a 1–2/255 dele. Fundo `slate[50]`, card branco, navbar branca,
   * pastilha do segmented control branca sobre trilho quase branco. Não havia
   * hierarquia de superfície nenhuma — só sombra tentando fazer o trabalho que
   * a cor deveria fazer — e os tons "soft" da marca (`ocean[50]`, `coral[50]`)
   * eram claros demais para aparecer sobre branco, o que deixava todo elemento
   * decorativo lavado.
   *
   * A correção é uma escala fria de verdade: o fundo desce para um off-white
   * azulado, o card sobe para branco puro (agora é ele o ponto mais alto), e
   * abaixo do fundo existe um degrau recuado (`surfaceMuted`, `input`) para
   * campos e trilhos. Três degraus visíveis, não três brancos.
   */
  background: '#EDF2F9',
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  // Quase opaco de propósito. A 0.72 o card ficava a 1/255 do fundo — sem
  // aresta própria, existindo só pela sombra — e qualquer coisa translúcida
  // deixava o gradiente da aurora vazar em manchas dentro dele. A 0.97 o card
  // é uma superfície de verdade e continua com um fio de translucidez.
  glass: 'rgba(255,255,255,0.97)',
  // A borda era branca *sobre* um preenchimento branco: ela apagava a aresta em
  // vez de defini-la. No claro a borda precisa ser mais escura que o card.
  glassBorder: 'rgba(15,23,42,0.09)',
  surfaceMuted: '#E3EBF5',

  textPrimary: slate[900],
  textSecondary: slate[600],
  // `slate[400]` rendia 2.27:1 sobre o fundo claro — era ele que deixava
  // rótulos de aba inativa e placeholders ilegíveis. Este tom frio passa em
  // AA (4.8:1) sem virar um segundo `textSecondary`.
  textTertiary: '#5B6B85',
  textOnPrimary: '#FFFFFF',
  textOnImage: '#FFFFFF',

  /*
   * O azul interativo do claro é o `ocean[700]`, não o `ocean[500]`.
   *
   * Texto branco sobre `ocean[500]` rende 2.77:1 — o botão principal do app
   * reprovava em AA, e "brand" como cor de texto sobre branco reprovava junto.
   * Com o 700 o botão vai a 5.87:1 e o texto de marca sobre superfície clara
   * acompanha. O ciano da identidade não some: ele continua vivo nos tons
   * soft, na aurora e no tema escuro, que é onde ele de fato brilha.
   */
  primary: ocean[700],
  primaryPressed: ocean[800],
  // `ocean[50]` (#F0F9FF) some sobre branco — era a causa dos elementos
  // decorativos lavados. O 100 é o primeiro degrau que se vê de verdade.
  primarySoft: ocean[100],
  accent: coral[600],
  accentSoft: coral[100],

  success: semantic.success,
  successSoft: semantic.successSoft,
  warning: semantic.warning,
  warningSoft: semantic.warningSoft,
  error: semantic.error,
  errorPressed: '#DC2626',
  errorSoft: semantic.errorSoft,

  border: '#DCE4EF',
  borderStrong: '#C3CFE0',
  divider: '#E6EDF6',
  scrim: 'rgba(2,6,23,0.45)',
  skeleton: '#DFE7F1',

  input: '#F5F8FC',
  inputBorder: '#DAE3EF',
  navigation: '#FFFFFF',
  // A navbar clara parecia solta na página porque era branca sobre quase
  // branco, sem aresta. Com o fundo azulado e uma borda visível ela volta a
  // ser uma superfície flutuante em vez de um retângulo perdido.
  navigationBorder: 'rgba(15,23,42,0.10)',
  navigationActive: '#DCEEFB',
  segmentTrack: '#E1EAF5',
  segmentSelected: '#FFFFFF',
  bubbleAssistant: '#FFFFFF',
  bubbleAssistantBorder: 'rgba(15,23,42,0.10)',
  surfaceAccent: '#E8F1FB',
  surfaceAccentBorder: 'rgba(3,105,161,0.22)',

  status: statusRoles,
  countdown: countdownRoles,
  onImage: onImageRole,
  heroBadge: heroBadgeRole,
  whatsapp: {
    background: 'rgba(37,211,102,0.14)',
    foreground: '#0B7A4B',
    border: 'rgba(11,122,75,0.22)',
    accent: '#0B7A4B',
  },
};

const darkPalette: Palette = {
  background: slate[950],
  surface: '#0B1220',
  surfaceElevated: slate[800],
  glass: 'rgba(30,41,59,0.66)',
  glassBorder: 'rgba(148,163,184,0.18)',
  surfaceMuted: 'rgba(148,163,184,0.12)',

  textPrimary: slate[50],
  textSecondary: slate[400],
  textTertiary: slate[500],
  textOnPrimary: '#FFFFFF',
  textOnImage: '#FFFFFF',

  primary: ocean[400],
  primaryPressed: ocean[300],
  primarySoft: 'rgba(14,165,233,0.16)',
  accent: coral[400],
  accentSoft: 'rgba(244,63,94,0.16)',

  success: '#34D399',
  successSoft: 'rgba(16,185,129,0.18)',
  warning: '#FBBF24',
  warningSoft: 'rgba(245,158,11,0.18)',
  error: '#F87171',
  // No escuro o botão já é um vermelho claro; pressionar tem de escurecer só um
  // passo, não saltar para o vermelho profundo do tema claro.
  errorPressed: '#EF4444',
  errorSoft: 'rgba(239,68,68,0.18)',

  border: 'rgba(148,163,184,0.20)',
  borderStrong: 'rgba(148,163,184,0.34)',
  divider: 'rgba(148,163,184,0.20)',
  scrim: 'rgba(2,6,23,0.60)',
  skeleton: 'rgba(148,163,184,0.16)',

  /*
   * Cada papel novo recebe aqui o valor que o componente correspondente já
   * usava: `input` era `surface`, `navigation` era `surfaceElevated`,
   * `navigationActive` era `primarySoft`, `segmentTrack` era `surfaceMuted`,
   * `segmentSelected` e `bubbleAssistant` eram `surface`, e todas as bordas
   * eram `border`. O escuro, portanto, renderiza exatamente como antes — só
   * `surfaceAccent` é novo, e só a tela da IA o utiliza.
   */
  input: '#0B1220',
  inputBorder: 'rgba(148,163,184,0.20)',
  navigation: slate[800],
  navigationBorder: 'rgba(148,163,184,0.20)',
  navigationActive: 'rgba(14,165,233,0.16)',
  segmentTrack: 'rgba(148,163,184,0.12)',
  segmentSelected: '#0B1220',
  bubbleAssistant: '#0B1220',
  bubbleAssistantBorder: 'rgba(148,163,184,0.20)',
  surfaceAccent: 'rgba(14,165,233,0.12)',
  surfaceAccentBorder: 'rgba(56,189,248,0.26)',

  status: statusRoles,
  countdown: countdownRoles,
  onImage: onImageRole,
  heroBadge: heroBadgeRole,
  whatsapp: {
    background: 'rgba(37,211,102,0.16)',
    foreground: '#4ADE80',
    border: 'rgba(74,222,128,0.24)',
    accent: '#25D366',
  },
};

/**
 * Android renders shadows far heavier than iOS; keep elevation conservative so
 * cards stay visually clean on both platforms (§73).
 *
 * Os dois esquemas são tabelas explícitas em vez de um multiplicador comum:
 * no claro a separação passou a vir da borda e da diferença tonal entre fundo e
 * card, então a sombra pode ser mais baixa e mais difusa — antes ela era a
 * *única* coisa separando o card do fundo e por isso lia como um halo cinza.
 * Os valores do escuro são exatamente os que já estavam em produção.
 */
const SHADOWS: Record<'light' | 'dark', Theme['shadows']> = {
  light: {
    sm: {
      shadowColor: '#0F172A',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.04,
      shadowRadius: 12,
      elevation: 1,
    },
    md: {
      shadowColor: '#0F172A',
      shadowOffset: { width: 0, height: 5 },
      shadowOpacity: 0.06,
      shadowRadius: 22,
      elevation: 2,
    },
    lg: {
      shadowColor: '#0F172A',
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.1,
      shadowRadius: 32,
      elevation: 5,
    },
  },
  dark: {
    sm: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.08,
      shadowRadius: 8,
      elevation: 1,
    },
    md: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.128,
      shadowRadius: 18,
      elevation: 3,
    },
    lg: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.192,
      shadowRadius: 28,
      elevation: 6,
    },
  },
};

function buildTheme(scheme: 'light' | 'dark'): Theme {
  return {
    scheme,
    colors: scheme === 'light' ? lightPalette : darkPalette,
    spacing,
    radius,
    typography,
    fontFamily,
    duration,
    hitSlop,
    hitTarget: HIT_TARGET,
    shadows: SHADOWS[scheme],
    aurora:
      scheme === 'light'
        ? {
            // Sobre o off-white azulado a aurora precisa de um pouco mais de
            // corpo para continuar sendo identidade e não sujeira — mas segue
            // baixa o bastante para nunca competir com o conteúdo (§68).
            cyan: 'rgba(14,165,233,0.22)',
            blue: 'rgba(56,189,248,0.16)',
            rose: 'rgba(244,63,94,0.10)',
          }
        : {
            cyan: 'rgba(14,165,233,0.20)',
            blue: 'rgba(2,132,199,0.16)',
            rose: 'rgba(244,63,94,0.12)',
          },
  };
}

export const lightTheme = buildTheme('light');
export const darkTheme = buildTheme('dark');
