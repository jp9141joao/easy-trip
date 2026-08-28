import { fireEvent, render } from '@testing-library/react-native';

import { SuggestionsEntryCard } from '@/components/trip';
import { TripTabs } from '@/features/trip/TripScaffold';
import { ThemeProvider } from '@/theme';

/**
 * Sugestões saiu da navbar principal e virou um degrau da Jornada (§15–§18, §59).
 *
 * O QUE ESTA SUÍTE PROTEGE
 *
 * Duas coisas que é fácil fazer pela metade: tirar a pastilha e esquecer a
 * entrada nova (a funcionalidade some), ou criar a entrada e esquecer de tirar a
 * pastilha (dois caminhos para a mesma tela, um deles marcando uma aba que não
 * existe mais).
 */

const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: (p: string) => mockPush(p), replace: (p: string) => mockReplace(p) }),
}));

jest.mock('@/hooks/useCollaboration', () => ({
  useTripPermissions: () => ({ status: 'ready', role: 'owner', canEdit: true, memberCount: 1 }),
}));

beforeEach(() => {
  mockPush.mockClear();
  mockReplace.mockClear();
});

describe('a navbar principal da viagem (§15)', () => {
  const montar = () =>
    render(<TripTabs tripId="t1" active="itinerary" />, { wrapper: ThemeProvider });

  it('tem exatamente Roteiro, Carteira e Reservas', () => {
    const view = montar();

    expect(view.getByText('Roteiro')).toBeTruthy();
    expect(view.getByText('Carteira')).toBeTruthy();
    expect(view.getByText('Reservas')).toBeTruthy();
  });

  it('não oferece Sugestões como seção de primeiro nível', () => {
    expect(montar().queryByText('Sugestões')).toBeNull();
  });

  it('continua navegando entre as três que ficaram', () => {
    fireEvent.press(montar().getByText('Carteira'));
    expect(mockReplace).toHaveBeenCalledWith('/trip/t1/finance');
  });
});

describe('a entrada dentro da Jornada (§16, §59)', () => {
  const montar = () =>
    render(<SuggestionsEntryCard tripId="t1" city="Tóquio" />, { wrapper: ThemeProvider });

  it('abre a tela de Sugestões existente, com o tripId certo', () => {
    fireEvent.press(montar().getByLabelText('Sugestões para Tóquio'));

    expect(mockPush).toHaveBeenCalledWith('/trip/t1/suggestions');
    // Uma rota só: não foi criada uma segunda tela de Sugestões.
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('usa `push`, para que voltar devolva a pessoa à Jornada (§17)', () => {
    /*
     * `replace` trocaria a Jornada pela tela de Sugestões na pilha, e o botão
     * voltar sairia da viagem inteira. Como Sugestões passou a ser um degrau
     * ABAIXO, o empilhamento é que faz o caminho de volta existir.
     */
    fireEvent.press(montar().getByLabelText('Sugestões para Tóquio'));

    expect(mockPush).toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('nomeia o destino para quem usa leitor de tela (§47)', () => {
    const view = montar();
    expect(view.getByLabelText('Sugestões para Tóquio')).toBeTruthy();
    expect(view.getByText('Sugestões')).toBeTruthy();
  });
});
