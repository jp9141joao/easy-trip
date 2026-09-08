import { DarkTheme, DefaultTheme, type Theme as NavigationTheme } from 'expo-router/react-navigation';

import type { Theme } from './theme';

/**
 * O tema que o React Navigation usa para pintar o que NÃO é tela (§15).
 *
 * O Expo Router monta o `NavigationContainer` por conta própria e não expõe a
 * prop `theme`, então o container cai no `DefaultTheme` — claro, com
 * `background: rgb(242,242,242)`. Esse valor não é decorativo: o `Background`
 * de `@react-navigation/elements` o aplica na raiz de **cada cena de aba**, e o
 * Native Stack o usa como `contentStyle` padrão de qualquer stack que não
 * declare um.
 *
 * Era daí que vinha a área branca ao voltar: a cena volta a ser anexada e o
 * `Background` — uma view sozinha, sem filhos a medir — pinta no primeiro
 * frame, enquanto o conteúdo escuro da tela ainda está sendo remontado por
 * cima. Por alguns frames o que se vê é o cinza-claro do tema padrão em tela
 * cheia.
 *
 * Sobrescrever o container inteiro com um `<ThemeProvider>` corrige a origem: o
 * padrão de fundo do navegador passa a ser o fundo do aplicativo, e qualquer
 * navegador criado daqui para frente nasce certo sem precisar repetir
 * `contentStyle`.
 *
 * `card` recebe o mesmo valor de `background` de propósito. No React Navigation
 * `card` é a superfície do header e das cenas de modal; deixá-lo branco traria
 * de volta exatamente o mesmo flash em outro lugar.
 */
export function navigationThemeFrom(theme: Theme): NavigationTheme {
  const base = theme.scheme === 'dark' ? DarkTheme : DefaultTheme;

  return {
    ...base,
    dark: theme.scheme === 'dark',
    colors: {
      ...base.colors,
      background: theme.colors.background,
      card: theme.colors.background,
      primary: theme.colors.primary,
      text: theme.colors.textPrimary,
      border: theme.colors.border,
      notification: theme.colors.error,
    },
  };
}
