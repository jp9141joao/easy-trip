import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useColorScheme } from 'react-native';

import { prefsStorage } from '@/lib/storage';
import { darkTheme, lightTheme, type Theme } from './theme';

/** Preferência de aparência escolhida em Perfil › Configurações. */
export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'themeMode';

export interface ThemePreference {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  /**
   * False até a preferência salva ter sido lida do disco. O splash continua
   * cobrindo a tela nesse intervalo, que é o que evita o flash de
   * "tema errado → tema correto" na inicialização (§2).
   */
  hydrated: boolean;
  /** Esquema efetivamente aplicado — resolve `system` para claro ou escuro. */
  scheme: 'light' | 'dark';
}

const ThemeContext = createContext<Theme>(lightTheme);
const ThemePreferenceContext = createContext<ThemePreference | null>(null);

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const stored = await prefsStorage.get<ThemeMode>(STORAGE_KEY, 'system');
      if (!active) return;
      // Um valor corrompido no disco não deve travar o app num tema inválido.
      if (isThemeMode(stored)) setModeState(stored);
      setHydrated(true);
    })();
    return () => {
      active = false;
    };
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    // Estado primeiro: a troca precisa ser imediata na tela, sem esperar o
    // disco. A escrita é fire-and-forget porque nada depende do resultado dela.
    setModeState(next);
    void prefsStorage.set(STORAGE_KEY, next);
  }, []);

  // Com `system`, o `useColorScheme` já é reativo: mudar o tema do próprio
  // celular com o app aberto reflete aqui sem nenhum trabalho extra (§39).
  const scheme: 'light' | 'dark' =
    mode === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : mode;

  // `lightTheme`/`darkTheme` são constantes de módulo, então a identidade do
  // objeto só muda quando o esquema muda de fato — nenhum consumidor de
  // `useTheme` re-renderiza à toa (§37).
  const theme = useMemo(() => (scheme === 'dark' ? darkTheme : lightTheme), [scheme]);

  const preference = useMemo<ThemePreference>(
    () => ({ mode, setMode, hydrated, scheme }),
    [mode, setMode, hydrated, scheme],
  );

  return (
    <ThemePreferenceContext.Provider value={preference}>
      <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
    </ThemePreferenceContext.Provider>
  );
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

export function useThemePreference(): ThemePreference {
  const context = useContext(ThemePreferenceContext);
  if (!context) {
    throw new Error('useThemePreference precisa estar dentro de <ThemeProvider>');
  }
  return context;
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
