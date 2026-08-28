import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';

import { TripCoverField } from '@/components/trip';
import type { Trip } from '@/domain/types';
import { ThemeProvider } from '@/theme';
import { ToastProvider } from '@/components/ui';

/**
 * A tela de troca de capa (§3, §6, §57.1–§57.4, §57.9 do handoff).
 *
 * A REGRA QUE ESTA SUÍTE PROTEGE: escolher não é enviar.
 *
 * A imagem escolhida vira prévia e fica em memória até a confirmação. Quem abre,
 * escolhe e desiste não deixa nada no Storage — e "Cancelar" tem de devolver a
 * tela ao estado exato de antes.
 */

const mockPick = jest.fn();
jest.mock('@/lib/imagePicker', () => ({
  pickTripCoverImage: () => mockPick(),
}));

const mockReplace = jest.fn();
const mockRemove = jest.fn();
jest.mock('@/hooks/useTrips', () => ({
  useTripCover: () => ({
    replace: { mutateAsync: mockReplace, isPending: false, isError: false },
    remove: { mutateAsync: mockRemove, isPending: false, isError: false },
  }),
}));

const trip = (patch: Partial<Trip> = {}): Trip => ({
  id: 't1',
  userId: 'u1',
  destinationCity: 'Tóquio',
  destinationCountry: 'Japão',
  countryCode: 'JP',
  timezone: 'Asia/Tokyo',
  startDate: '2026-09-18',
  endDate: '2026-09-27',
  coverImageUrl: 'https://images.unsplash.com/photo-tokyo',
  budgetTotal: 10000,
  budgetCurrency: 'BRL',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  ...patch,
});

const escolhida = {
  status: 'picked' as const,
  file: { uri: 'file:///cache/nova.jpg', name: 'nova.jpg', mimeType: 'image/jpeg', size: 2048 },
};

const metrics: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

// O toast é ancorado no topo seguro da tela, então precisa das métricas — sem
// elas `useSafeAreaInsets` lança e o aviso derruba a árvore inteira em vez de
// aparecer.
function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <ToastProvider>{children}</ToastProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const montar = (patch: Partial<Trip> = {}) =>
  render(<TripCoverField trip={trip(patch)} />, { wrapper });

beforeEach(() => {
  mockPick.mockReset();
  mockReplace.mockReset().mockResolvedValue(trip());
  mockRemove.mockReset().mockResolvedValue(trip());
});

describe('escolher e pré-visualizar (§57.1, §57.2)', () => {
  it('oferece a ação de alterar a imagem', () => {
    expect(montar().getByText('Alterar imagem da viagem')).toBeTruthy();
  });

  it('mostra a prévia e não envia nada ainda', async () => {
    mockPick.mockResolvedValue(escolhida);
    const view = montar();

    fireEvent.press(view.getByText('Alterar imagem da viagem'));

    await waitFor(() => expect(view.getByText('Confirmar')).toBeTruthy());
    expect(view.getByLabelText('Prévia da nova capa da viagem')).toBeTruthy();
    // O ponto do fluxo em dois passos: escolher não escreve no Storage.
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('envia quando a pessoa confirma', async () => {
    mockPick.mockResolvedValue(escolhida);
    const view = montar();

    fireEvent.press(view.getByText('Alterar imagem da viagem'));
    await waitFor(() => view.getByText('Confirmar'));
    fireEvent.press(view.getByText('Confirmar'));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(escolhida.file));
  });
});

describe('cancelar não altera nada (§57.3)', () => {
  it('descarta a prévia e volta ao estado anterior', async () => {
    mockPick.mockResolvedValue(escolhida);
    const view = montar();

    fireEvent.press(view.getByText('Alterar imagem da viagem'));
    await waitFor(() => view.getByText('Cancelar'));
    fireEvent.press(view.getByText('Cancelar'));

    await waitFor(() => expect(view.getByText('Alterar imagem da viagem')).toBeTruthy());
    expect(view.queryByText('Confirmar')).toBeNull();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('cancelar no seletor do sistema também não envia', async () => {
    mockPick.mockResolvedValue({ status: 'cancelled' });
    const view = montar();

    fireEvent.press(view.getByText('Alterar imagem da viagem'));

    await waitFor(() => expect(mockPick).toHaveBeenCalled());
    expect(view.queryByText('Confirmar')).toBeNull();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe('erros do seletor (§6)', () => {
  /*
   * Estes três casos mostram um aviso (toast), e o toast remonta a árvore. As
   * consultas vão por `screen`, e não pelo objeto devolvido no `render`: aquele
   * guarda uma referência que fica velha quando a árvore é remontada, e o
   * sintoma é um "unmounted component" que não tem nada a ver com o que se está
   * medindo.
   */
  it('permissão negada não vira prévia nem envio', async () => {
    mockPick.mockResolvedValue({ status: 'denied' });
    montar();

    fireEvent.press(screen.getByText('Alterar imagem da viagem'));

    await waitFor(() => expect(mockPick).toHaveBeenCalled());
    expect(screen.queryByText('Confirmar')).toBeNull();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('arquivo recusado não vira prévia nem envio', async () => {
    mockPick.mockResolvedValue({ status: 'rejected', message: 'A imagem precisa ter no máximo 5 MB.' });
    montar();

    fireEvent.press(screen.getByText('Alterar imagem da viagem'));

    await waitFor(() => expect(mockPick).toHaveBeenCalled());
    expect(screen.queryByText('Confirmar')).toBeNull();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('falha no envio mantém a capa anterior e não deixa a tela travada', async () => {
    mockPick.mockResolvedValue(escolhida);
    mockReplace.mockRejectedValue(new Error('rede indisponível'));
    montar();

    fireEvent.press(screen.getByText('Alterar imagem da viagem'));
    await waitFor(() => screen.getByText('Confirmar'));
    fireEvent.press(screen.getByText('Confirmar'));

    // Sem spinner infinito: os botões continuam lá para uma nova tentativa.
    await waitFor(() => expect(screen.getByText('Confirmar')).toBeTruthy());
    expect(screen.getByText('Cancelar')).toBeTruthy();
  });
});

describe('restaurar a imagem padrão (§3)', () => {
  it('só é oferecido quando existe capa enviada', () => {
    expect(montar().queryByText('Restaurar imagem padrão')).toBeNull();
    expect(
      montar({ coverImagePath: 't1/cover-a.jpg' }).getByText('Restaurar imagem padrão'),
    ).toBeTruthy();
  });

  it('confirma antes de remover', async () => {
    const view = montar({ coverImagePath: 't1/cover-a.jpg' });

    fireEvent.press(view.getByText('Restaurar imagem padrão'));

    await waitFor(() => expect(view.getByText('Restaurar a imagem padrão?')).toBeTruthy());
    // A remoção não acontece só por abrir o diálogo.
    expect(mockRemove).not.toHaveBeenCalled();

    fireEvent.press(view.getByText('Restaurar'));
    await waitFor(() => expect(mockRemove).toHaveBeenCalled());
  });

  it('explica de qual imagem a viagem está usando', () => {
    expect(
      montar().getByText(/Capa sugerida a partir do destino/),
    ).toBeTruthy();
    expect(
      montar({ coverImagePath: 't1/cover-a.jpg' }).getByText(/Imagem enviada por você/),
    ).toBeTruthy();
  });
});
