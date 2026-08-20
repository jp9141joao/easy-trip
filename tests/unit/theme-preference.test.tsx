import { fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Pressable, Text } from 'react-native';

import { ThemeProvider, useTheme, useThemePreference, type ThemeMode } from '@/theme';

/**
 * A preferência de aparência (§2) precisa de três garantias: aplicar na hora,
 * sobreviver ao fechamento do app e não deixar o app renderizar com o tema
 * errado antes de ter lido o disco.
 */

function Probe() {
  const theme = useTheme();
  const { mode, setMode, hydrated } = useThemePreference();

  return (
    <>
      <Text testID="scheme">{theme.scheme}</Text>
      <Text testID="mode">{mode}</Text>
      <Text testID="hydrated">{String(hydrated)}</Text>
      <Text testID="background">{theme.colors.background}</Text>
      {(['light', 'dark', 'system'] as ThemeMode[]).map((value) => (
        <Pressable key={value} testID={`set-${value}`} onPress={() => setMode(value)}>
          <Text>{value}</Text>
        </Pressable>
      ))}
    </>
  );
}

const renderProbe = () =>
  render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('theme preference', () => {
  it('reports hydration once the stored preference has been read', async () => {
    const view = renderProbe();

    await waitFor(() => expect(view.getByTestId('hydrated')).toHaveTextContent('true'));
    // Sem nada salvo, o padrão é acompanhar o aparelho.
    expect(view.getByTestId('mode')).toHaveTextContent('system');
  });

  it('applies an explicit choice immediately', async () => {
    const view = renderProbe();
    await waitFor(() => expect(view.getByTestId('hydrated')).toHaveTextContent('true'));

    fireEvent.press(view.getByTestId('set-dark'));
    expect(view.getByTestId('scheme')).toHaveTextContent('dark');

    fireEvent.press(view.getByTestId('set-light'));
    expect(view.getByTestId('scheme')).toHaveTextContent('light');
  });

  it('gives light and dark genuinely different surfaces', async () => {
    const view = renderProbe();
    await waitFor(() => expect(view.getByTestId('hydrated')).toHaveTextContent('true'));

    fireEvent.press(view.getByTestId('set-light'));
    const light = view.getByTestId('background').props.children;

    fireEvent.press(view.getByTestId('set-dark'));
    const dark = view.getByTestId('background').props.children;

    expect(light).not.toBe(dark);
  });

  it('restores the choice on the next launch', async () => {
    const first = renderProbe();
    await waitFor(() => expect(first.getByTestId('hydrated')).toHaveTextContent('true'));
    fireEvent.press(first.getByTestId('set-dark'));
    first.unmount();

    // Segunda "abertura" do app: monta tudo de novo, lendo do storage.
    const second = renderProbe();
    await waitFor(() => expect(second.getByTestId('hydrated')).toHaveTextContent('true'));
    expect(second.getByTestId('mode')).toHaveTextContent('dark');
    expect(second.getByTestId('scheme')).toHaveTextContent('dark');
  });

  it('falls back to system when the stored value is not a valid mode', async () => {
    const first = renderProbe();
    await waitFor(() => expect(first.getByTestId('hydrated')).toHaveTextContent('true'));
    fireEvent.press(first.getByTestId('set-dark'));
    first.unmount();

    // Simula um valor corrompido no disco sob a mesma chave.
    const keys = await AsyncStorage.getAllKeys();
    const themeKey = keys.find((key) => key.includes('themeMode'));
    expect(themeKey).toBeDefined();
    await AsyncStorage.setItem(themeKey!, JSON.stringify('neon'));

    const second = renderProbe();
    await waitFor(() => expect(second.getByTestId('hydrated')).toHaveTextContent('true'));
    expect(second.getByTestId('mode')).toHaveTextContent('system');
  });
});
