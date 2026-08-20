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
  /** Scrim over hero photography to guarantee contrast (§75). */
  scrim: string;
  skeleton: string;

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
  background: 'rgba(2,6,23,0.62)',
  foreground: '#FFFFFF',
  border: 'rgba(255,255,255,0.24)',
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
  background: slate[50],
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  // Quase opaco de propósito. A 0.72 o card ficava a 1/255 do fundo — sem
  // aresta própria, existindo só pela sombra — e qualquer coisa translúcida
  // deixava o gradiente da aurora vazar em manchas dentro dele. A 0.96 o card
  // é uma superfície de verdade e continua com um fio de translucidez.
  glass: 'rgba(255,255,255,0.96)',
  // A borda era branca *sobre* um preenchimento branco: ela apagava a aresta em
  // vez de defini-la. No claro a borda precisa ser mais escura que o card.
  glassBorder: 'rgba(15,23,42,0.08)',
  surfaceMuted: slate[100],

  textPrimary: slate[900],
  textSecondary: slate[600],
  textTertiary: slate[400],
  textOnPrimary: '#FFFFFF',
  textOnImage: '#FFFFFF',

  primary: ocean[500],
  primaryPressed: ocean[600],
  primarySoft: ocean[50],
  accent: coral[500],
  accentSoft: coral[50],

  success: semantic.success,
  successSoft: semantic.successSoft,
  warning: semantic.warning,
  warningSoft: semantic.warningSoft,
  error: semantic.error,
  errorPressed: '#DC2626',
  errorSoft: semantic.errorSoft,

  border: slate[200],
  borderStrong: slate[300],
  scrim: 'rgba(2,6,23,0.45)',
  skeleton: slate[200],

  status: statusRoles,
  countdown: countdownRoles,
  onImage: onImageRole,
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
  scrim: 'rgba(2,6,23,0.60)',
  skeleton: 'rgba(148,163,184,0.16)',

  status: statusRoles,
  countdown: countdownRoles,
  onImage: onImageRole,
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
            cyan: 'rgba(14,165,233,0.16)',
            blue: 'rgba(56,189,248,0.12)',
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
