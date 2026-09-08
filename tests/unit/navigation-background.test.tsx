import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DefaultTheme } from 'expo-router/react-navigation';
import { Pressable, Text } from 'react-native';
import * as SystemUI from 'expo-system-ui';

import { ThemeProvider, useThemePreference, navigationThemeFrom } from '@/theme';
import { darkTheme, lightTheme } from '@/theme/theme';

/**
 * O fundo revelado durante a navegação (§15).
 *
 * O sintoma era uma área clara em tela cheia durante o "voltar" no Android. A
 * origem não estava nas telas — todas já pintam o próprio fundo — mas nas
 * camadas que existem *abaixo* delas e que ninguém tinha declarado: o tema do
 * `NavigationContainer`, a cena de cada aba e a janela nativa.
 *
 * Estes testes protegem as três. Nenhum deles compara pixels ou espia estrutura
 * interna de navegador: cada um afirma uma cor que precisa ser a do tema em um
 * ponto onde o padrão da biblioteca é claro.
 */

describe('tema de navegação', () => {
  it('usa o fundo do aplicativo, e não o cinza-claro padrão do React Navigation', () => {
    // Este é o valor que aparecia na tela. Se ele voltar, o teste cai.
    expect(DefaultTheme.colors.background).toBe('rgb(242, 242, 242)');

    const dark = navigationThemeFrom(darkTheme);
    expect(dark.colors.background).toBe(darkTheme.colors.background);
    expect(dark.colors.background).not.toBe(DefaultTheme.colors.background);
    expect(dark.dark).toBe(true);

    const light = navigationThemeFrom(lightTheme);
    expect(light.colors.background).toBe(lightTheme.colors.background);
    expect(light.colors.background).not.toBe(DefaultTheme.colors.background);
    expect(light.dark).toBe(false);
  });

  it('mantém `card` igual ao fundo, para o mesmo flash não reaparecer nos modais', () => {
    // `card` é a superfície de header e de cena modal. Herdado do tema padrão,
    // ele é branco puro — e a Central de notificações é justamente um modal.
    expect(navigationThemeFrom(darkTheme).colors.card).toBe(darkTheme.colors.background);
    expect(navigationThemeFrom(lightTheme).colors.card).toBe(lightTheme.colors.background);
  });

  it('mantém a paleta do produto no resto do tema', () => {
    const theme = navigationThemeFrom(darkTheme);
    expect(theme.colors.primary).toBe(darkTheme.colors.primary);
    expect(theme.colors.text).toBe(darkTheme.colors.textPrimary);
    expect(theme.colors.border).toBe(darkTheme.colors.border);
  });
});

/* ------------------------------ janela nativa ----------------------------- */

const setBackgroundColorAsync = SystemUI.setBackgroundColorAsync as jest.Mock;

function ModeSwitch() {
  const { setMode, scheme } = useThemePreference();
  return (
    <>
      <Text testID="scheme">{scheme}</Text>
      <Pressable testID="set-dark" onPress={() => setMode('dark')}>
        <Text>escuro</Text>
      </Pressable>
    </>
  );
}

describe('fundo da janela nativa', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    setBackgroundColorAsync.mockClear();
  });

  it('pinta a janela com o fundo do tema e acompanha a troca de aparência', async () => {
    render(
      <ThemeProvider>
        <ModeSwitch />
      </ThemeProvider>,
    );

    await waitFor(() =>
      expect(setBackgroundColorAsync).toHaveBeenCalledWith(lightTheme.colors.background),
    );

    fireEvent.press(screen.getByTestId('set-dark'));

    await waitFor(() =>
      expect(setBackgroundColorAsync).toHaveBeenCalledWith(darkTheme.colors.background),
    );
  });
});

/* ------------------------------- navegadores ------------------------------ */

const APP_DIR = join(__dirname, '..', '..', 'src', 'app');

function layoutFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return layoutFiles(path);
    return entry.name === '_layout.tsx' ? [path] : [];
  });
}

describe('cada navegador declara o próprio fundo', () => {
  /**
   * A correção global vive na raiz, mas um `_layout.tsx` novo pode nascer com
   * um `Stack` sem `contentStyle` — e aí a tela dele volta a revelar o fundo do
   * navegador durante a transição. Como a lista de layouts é lida do disco,
   * quem criar um amanhã descobre pelo teste, não pelo aparelho (§6).
   */
  const layouts = layoutFiles(APP_DIR);

  it('encontra os layouts de navegação do projeto', () => {
    expect(layouts.length).toBeGreaterThan(0);
  });

  it.each(layouts.map((path) => [path.slice(APP_DIR.length + 1), path]))(
    '%s',
    (_name, path) => {
      const source = readFileSync(path, 'utf8');

      // `<Stack ` / `<Stack>` / `<Stack\n` — e nunca `<Stack.Screen`.
      if (/<Stack[\s>]/.test(source)) {
        expect(source).toMatch(/contentStyle/);
        expect(source).toMatch(/colors\.background/);
      }

      if (/<Tabs[\s>]/.test(source)) {
        expect(source).toMatch(/sceneStyle/);
        expect(source).toMatch(/colors\.background/);
      }
    },
  );
});
