import { render } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';

import BootScreen from '@/app/index';
import { ThemeProvider } from '@/theme';
import { lightTheme } from '@/theme/theme';

/**
 * Nenhuma rota fica sem fundo enquanto decide o que mostrar (§7, §17).
 *
 * A tela de entrada precisa ler o disco antes de saber para onde mandar a
 * pessoa. Esse intervalo é curto, mas existe — e se ele renderizar `null`, o que
 * fica na tela é a janela nativa. Este teste prende o comportamento: o frame
 * indeciso é uma superfície opaca com a cor do tema, não o vazio.
 */

// A leitura nunca resolve: é assim que o teste consegue observar exatamente o
// frame em que a decisão ainda não foi tomada.
jest.mock('@/lib/storage', () => ({
  prefsStorage: {
    get: () => new Promise(() => {}),
    set: jest.fn(async () => undefined),
  },
}));

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ isAuthenticated: false, recoveryPending: false }),
}));

jest.mock('expo-router', () => ({
  Redirect: () => null,
}));

describe('primeiro frame da rota de entrada', () => {
  it('pinta o fundo do tema em vez de renderizar nada', () => {
    const tree = render(
      <ThemeProvider>
        <BootScreen />
      </ThemeProvider>,
    ).toJSON();

    expect(tree).not.toBeNull();

    const style = StyleSheet.flatten(
      (Array.isArray(tree) ? tree[0] : tree)?.props?.style,
    ) as ViewStyle;

    expect(style.flex).toBe(1);
    expect(style.backgroundColor).toBe(lightTheme.colors.background);
  });
});
