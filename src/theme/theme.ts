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
  errorSoft: string;

  border: string;
  borderStrong: string;
  /** Scrim over hero photography to guarantee contrast (§75). */
  scrim: string;
  skeleton: string;
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

const lightPalette: Palette = {
  background: slate[50],
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  glass: 'rgba(255,255,255,0.72)',
  glassBorder: 'rgba(255,255,255,0.85)',
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
  errorSoft: semantic.errorSoft,

  border: slate[200],
  borderStrong: slate[300],
  scrim: 'rgba(2,6,23,0.45)',
  skeleton: slate[200],
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
  errorSoft: 'rgba(239,68,68,0.18)',

  border: 'rgba(148,163,184,0.20)',
  borderStrong: 'rgba(148,163,184,0.34)',
  scrim: 'rgba(2,6,23,0.60)',
  skeleton: 'rgba(148,163,184,0.16)',
};

function buildShadows(scheme: 'light' | 'dark'): Theme['shadows'] {
  // Android renders shadows far heavier than iOS; keep elevation conservative
  // so cards stay visually clean on both platforms (§73).
  const color = scheme === 'light' ? '#0F172A' : '#000000';
  const boost = scheme === 'light' ? 1 : 1.6;
  return {
    sm: {
      shadowColor: color,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.05 * boost,
      shadowRadius: 8,
      elevation: 1,
    },
    md: {
      shadowColor: color,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.08 * boost,
      shadowRadius: 18,
      elevation: 3,
    },
    lg: {
      shadowColor: color,
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.12 * boost,
      shadowRadius: 28,
      elevation: 6,
    },
  };
}

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
    shadows: buildShadows(scheme),
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
