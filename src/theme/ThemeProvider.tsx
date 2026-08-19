import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import { darkTheme, lightTheme, type Theme } from './theme';

const ThemeContext = createContext<Theme>(lightTheme);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme();
  const theme = useMemo(() => (scheme === 'dark' ? darkTheme : lightTheme), [scheme]);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

/**
 * Builds memoised styles that depend on the theme.
 *
 * Usage:
 * ```ts
 * const styles = useThemedStyles((t) => ({ box: { padding: t.spacing.lg } }));
 * ```
 */
export function useThemedStyles<T>(factory: (theme: Theme) => T): T {
  const theme = useTheme();
  // Intentionally keyed on `theme` alone: callers pass an inline factory whose
  // identity changes every render, which would defeat the memo entirely.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => factory(theme), [theme]);
}
