import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { ReminderField } from '@/components/collaboration/ReminderField';
import { ThemeProvider } from '@/theme';

async function renderField(onSet = jest.fn()) {
  render(
    <ThemeProvider>
      <ReminderField
        label="Embarque"
        anchorAt="2099-08-30T12:00:00.000Z"
        onSet={onSet}
        onClear={jest.fn()}
      />
    </ThemeProvider>,
  );
  await act(async () => undefined);
  fireEvent.press(screen.getByText('Me lembrar do embarque'));
  return onSet;
}

describe('lembrete personalizado', () => {
  it('oferece Personalizado junto aos cinco intervalos fixos', async () => {
    await renderField();

    expect(screen.getByText('15 minutos antes')).toBeTruthy();
    expect(screen.getByText('30 minutos antes')).toBeTruthy();
    expect(screen.getByText('1 hora antes')).toBeTruthy();
    expect(screen.getByText('3 horas antes')).toBeTruthy();
    expect(screen.getByText('1 dia antes')).toBeTruthy();
    expect(screen.getByText('Personalizado')).toBeTruthy();
  });

  it('converte o intervalo digitado em minutos e o entrega ao repositório', async () => {
    const onSet = await renderField();

    fireEvent.press(screen.getByText('Personalizado'));
    fireEvent.changeText(screen.getByLabelText('Intervalo personalizado em minutos'), '120');
    fireEvent.press(screen.getByText('Salvar personalizado'));

    expect(onSet).toHaveBeenCalledTimes(1);
    expect(onSet).toHaveBeenCalledWith(120);
  });

  it('não aceita um personalizado além do teto de sete dias', async () => {
    const onSet = await renderField();

    fireEvent.press(screen.getByText('Personalizado'));
    fireEvent.changeText(screen.getByLabelText('Intervalo personalizado em minutos'), '10081');
    fireEvent.press(screen.getByText('Salvar personalizado'));

    expect(onSet).not.toHaveBeenCalled();
    expect(screen.getByText('Informe de 1 a 10080 minutos.')).toBeTruthy();
  });
});
