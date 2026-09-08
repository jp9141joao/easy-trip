import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Platform } from 'react-native';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';

import { DateField, TimeField } from '@/components/ui';
import { ThemeProvider } from '@/theme';

/**
 * O SELETOR NATIVO DEPOIS DA MIGRAÇÃO DO `onChange` (§15).
 *
 * `@react-native-community/datetimepicker` 9 depreciou o retorno único que
 * multiplexava três desfechos num `event.type` — e avisava no console a cada
 * abertura: "DateTimePicker: `onChange` is deprecated".
 *
 * A troca por `onValueChange` / `onDismiss` / `onNeutralButtonPress` não é
 * textual, e é por isso que esta suíte existe. No Android o diálogo é
 * imperativo: quem decide se ele está aberto é o estado deste componente, e o
 * pacote reabre o diálogo enquanto esse estado for verdadeiro. Um cancelamento
 * que não zere o estado prende o campo — o campo continua funcionando na
 * seleção, então o defeito só apareceria com alguém tentando desistir.
 */

const metrics: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

/**
 * As props que o seletor nativo recebeu, na ordem em que ele foi montado.
 *
 * O prefixo `mock` é o que permite a fábrica de `jest.mock` — içada para o
 * topo do arquivo — enxergar a lista.
 */
const mockPickerProps: Record<string, unknown>[] = [];

jest.mock('@react-native-community/datetimepicker', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const react = require('react') as typeof import('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const rn = require('react-native') as typeof import('react-native');
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) => {
      mockPickerProps.push(props);
      return react.createElement(rn.View, { testID: 'native-picker' });
    },
  };
});

const last = () => mockPickerProps[mockPickerProps.length - 1];

const renderUI = (ui: ReactElement) =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>{ui}</ThemeProvider>
    </SafeAreaProvider>,
  );

/**
 * O ramo do Android é o que muda, e o ambiente de teste roda como iOS.
 *
 * `Platform.OS` é propriedade simples do módulo em ambos, então trocá-la e
 * devolvê-la é suficiente — e evita duplicar a suíte inteira só por causa de um
 * `if`.
 */
function asPlatform(os: 'ios' | 'android', run: () => void) {
  const original = Platform.OS;
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true, writable: true });
  try {
    run();
  } finally {
    Object.defineProperty(Platform, 'OS', {
      value: original,
      configurable: true,
      writable: true,
    });
  }
}

beforeEach(() => {
  mockPickerProps.length = 0;
});

describe('DateField', () => {
  it('não passa mais o `onChange` depreciado ao seletor nativo', () => {
    asPlatform('android', () => {
      renderUI(<DateField label="Início" value="2026-09-07" onChange={jest.fn()} />);
      fireEvent.press(screen.getByLabelText(/^Início\./));

      // O aviso do console nascia exatamente desta prop.
      expect(last().onChange).toBeUndefined();
      expect(typeof last().onValueChange).toBe('function');
      expect(typeof last().onDismiss).toBe('function');
    });
  });

  it('preserva valor inicial, mínimo e máximo', () => {
    const minimumDate = new Date(2026, 8, 1);
    const maximumDate = new Date(2026, 8, 30);

    asPlatform('android', () => {
      renderUI(
        <DateField
          label="Início"
          value="2026-09-07"
          onChange={jest.fn()}
          minimumDate={minimumDate}
          maximumDate={maximumDate}
        />,
      );
      fireEvent.press(screen.getByLabelText(/^Início\./));

      expect(last().minimumDate).toBe(minimumDate);
      expect(last().maximumDate).toBe(maximumDate);
      // O seletor abre no dia que o campo já tem, e não em hoje.
      expect((last().value as Date).getUTCDate()).toBe(7);
    });
  });

  it('escolher uma data entrega a data em ISO e fecha o seletor', () => {
    const onChange = jest.fn();

    asPlatform('android', () => {
      renderUI(<DateField label="Início" value="2026-09-07" onChange={onChange} />);
      fireEvent.press(screen.getByLabelText(/^Início\./));

      const { onValueChange } = last() as {
        onValueChange: (event: unknown, date: Date) => void;
      };
      act(() => onValueChange({ nativeEvent: {} }, new Date(2026, 8, 10)));

      expect(onChange).toHaveBeenCalledWith('2026-09-10');
      // Fechou: sem isto o pacote reabriria o diálogo no próximo render.
      expect(screen.queryByTestId('native-picker')).toBeNull();
    });
  });

  it('cancelar fecha o seletor e não altera o campo', () => {
    const onChange = jest.fn();

    asPlatform('android', () => {
      renderUI(<DateField label="Início" value="2026-09-07" onChange={onChange} />);
      fireEvent.press(screen.getByLabelText(/^Início\./));

      const { onDismiss } = last() as { onDismiss: () => void };
      act(() => onDismiss());

      expect(onChange).not.toHaveBeenCalled();
      expect(screen.queryByTestId('native-picker')).toBeNull();
    });
  });

  it('no iOS o seletor vive dentro da folha e só reporta a escolha', () => {
    const onChange = jest.fn();

    asPlatform('ios', () => {
      renderUI(<DateField label="Início" value="2026-09-07" onChange={onChange} />);
      fireEvent.press(screen.getByLabelText(/^Início\./));

      expect(last().onChange).toBeUndefined();
      expect(last().display).toBe('inline');

      const { onValueChange } = last() as {
        onValueChange: (event: unknown, date: Date) => void;
      };
      act(() => onValueChange({ nativeEvent: {} }, new Date(2026, 8, 11)));

      expect(onChange).toHaveBeenCalledWith('2026-09-11');
    });
  });
});

describe('TimeField', () => {
  it('escolher um horário entrega HH:MM em 24h e fecha o seletor', () => {
    const onChange = jest.fn();

    asPlatform('android', () => {
      renderUI(<TimeField label="Horário" value="09:30" onChange={onChange} />);
      fireEvent.press(screen.getByLabelText(/^Horário\./));

      expect(last().is24Hour).toBe(true);
      expect(last().onChange).toBeUndefined();

      const { onValueChange } = last() as {
        onValueChange: (event: unknown, date: Date) => void;
      };
      act(() => onValueChange({ nativeEvent: {} }, new Date(2026, 8, 10, 18, 5)));

      expect(onChange).toHaveBeenCalledWith('18:05');
      expect(screen.queryByTestId('native-picker')).toBeNull();
    });
  });

  it('cancelar fecha o seletor e não altera o horário', () => {
    const onChange = jest.fn();

    asPlatform('android', () => {
      renderUI(<TimeField label="Horário" value="09:30" onChange={onChange} />);
      fireEvent.press(screen.getByLabelText(/^Horário\./));

      const { onDismiss } = last() as { onDismiss: () => void };
      act(() => onDismiss());

      expect(onChange).not.toHaveBeenCalled();
      expect(screen.queryByTestId('native-picker')).toBeNull();
    });
  });

  it('o botão neutro também fecha — o ramo que o `event.type` antigo cobria', () => {
    const onChange = jest.fn();

    asPlatform('android', () => {
      renderUI(<TimeField label="Horário" value="09:30" onChange={onChange} />);
      fireEvent.press(screen.getByLabelText(/^Horário\./));

      const { onNeutralButtonPress } = last() as { onNeutralButtonPress: () => void };
      act(() => onNeutralButtonPress());

      expect(onChange).not.toHaveBeenCalled();
      expect(screen.queryByTestId('native-picker')).toBeNull();
    });
  });
});
