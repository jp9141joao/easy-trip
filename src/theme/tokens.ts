/**
 * Easy Trip 2.0 — Design tokens.
 *
 * Single source of truth for colour, spacing, radius, typography and elevation.
 * Screens must never hardcode hex values or magic numbers; they consume these
 * tokens through `useTheme()`.
 */

/** Ocean Blue — the Easy Trip signature colour. */
export const ocean = {
  50: '#F0F9FF',
  100: '#E0F2FE',
  200: '#BAE6FD',
  300: '#7DD3FC',
  400: '#38BDF8',
  500: '#0EA5E9',
  600: '#0284C7',
  700: '#0369A1',
  800: '#075985',
  900: '#0C4A6E',
  950: '#082F49',
} as const;

/** Coral / Rose accent. */
export const coral = {
  50: '#FFF1F2',
  100: '#FFE4E6',
  200: '#FECDD3',
  300: '#FDA4AF',
  400: '#FB7185',
  500: '#F43F5E',
  600: '#E11D48',
  700: '#BE123C',
  800: '#9F1239',
  900: '#881337',
} as const;

/** Neutral slate ramp. */
export const slate = {
  50: '#F8FAFC',
  100: '#F1F5F9',
  200: '#E2E8F0',
  300: '#CBD5E1',
  400: '#94A3B8',
  500: '#64748B',
  600: '#475569',
  700: '#334155',
  800: '#1E293B',
  900: '#0F172A',
  950: '#020617',
} as const;

export const semantic = {
  success: '#10B981',
  successSoft: '#D1FAE5',
  warning: '#F59E0B',
  warningSoft: '#FEF3C7',
  error: '#EF4444',
  errorSoft: '#FEE2E2',
  info: ocean[500],
  infoSoft: ocean[100],
} as const;

/** Spacing scale (§71). Padding horizontal padrão mobile: `screen`. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 40,
  /** Standard horizontal gutter for mobile screens. */
  screen: 20,
} as const;

/** Border radius scale (§72). Generous radii are part of the visual signature. */
export const radius = {
  input: 16,
  button: 16,
  smallCard: 18,
  card: 24,
  heroCard: 28,
  modal: 28,
  pill: 999,
} as const;

/** Font families — resolved to the loaded Google Fonts. */
export const fontFamily = {
  /** Outfit — headings & display. */
  display: 'Outfit_700Bold',
  displayMedium: 'Outfit_600SemiBold',
  /** Plus Jakarta Sans — UI & body. */
  body: 'PlusJakartaSans_400Regular',
  bodyMedium: 'PlusJakartaSans_500Medium',
  bodySemiBold: 'PlusJakartaSans_600SemiBold',
  bodyBold: 'PlusJakartaSans_700Bold',
  /** JetBrains Mono — financial values & figures. */
  mono: 'JetBrainsMono_500Medium',
  monoBold: 'JetBrainsMono_700Bold',
} as const;

/**
 * Type ramp (§70). `size` is the base size — components pass it through
 * `scaledFont` so the OS text-size preference is respected.
 */
export const typography = {
  display: { size: 32, lineHeight: 38, family: fontFamily.display },
  h1: { size: 28, lineHeight: 34, family: fontFamily.display },
  h2: { size: 22, lineHeight: 28, family: fontFamily.displayMedium },
  h3: { size: 18, lineHeight: 24, family: fontFamily.bodySemiBold },
  body: { size: 16, lineHeight: 24, family: fontFamily.body },
  bodySmall: { size: 14, lineHeight: 20, family: fontFamily.body },
  caption: { size: 12, lineHeight: 16, family: fontFamily.body },
  button: { size: 15, lineHeight: 20, family: fontFamily.bodySemiBold },
  label: { size: 12, lineHeight: 16, family: fontFamily.bodySemiBold },
} as const;

export type TypographyVariant = keyof typeof typography;

/** Minimum comfortable touch target (§77). */
export const HIT_TARGET = 44;

export const hitSlop = { top: 8, bottom: 8, left: 8, right: 8 } as const;

/** Animation durations — kept short and subtle (§81). */
export const duration = {
  fast: 120,
  base: 200,
  slow: 320,
} as const;
