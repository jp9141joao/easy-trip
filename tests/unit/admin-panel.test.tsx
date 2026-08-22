import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';

import AdminPanelScreen from '@/app/admin/index';
import { ThemeProvider } from '@/theme';

/**
 * O painel diz quais módulos existem e quais têm IA (§22, §48, §49, §50, §66).
 *
 * Desde a F9 os quatro módulos existem — Em Alta e Especialistas deixaram de
 * ser cartões "Em breve" e ganharam cadastro de verdade, que era o que a D-06
 * previa. O §66 continua valendo e agora pode ser verificado no lugar certo:
 * os dois cadastros novos seguem declarados como manuais, e nenhum dos dois
 * ganhou "Preencher com IA" no caminho.
 */

const metrics: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const mockPush = jest.fn();

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ profile: { name: 'Chefe', role: 'admin' } }),
}));

const renderPanel = async () => {
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <AdminPanelScreen />
      </ThemeProvider>
    </SafeAreaProvider>,
  );
  await act(async () => undefined);
};

beforeEach(() => mockPush.mockClear());

describe('painel de conteúdo', () => {
  it('opens every module', async () => {
    await renderPanel();

    for (const label of ['Comunidade', 'Restaurantes e Hotéis', 'Em Alta', 'Especialistas']) {
      expect(screen.getByLabelText(label).props.accessibilityRole).toBe('button');
    }
  });

  it('routes each module to its own admin screen', async () => {
    await renderPanel();

    const rotas: [string, string][] = [
      ['Comunidade', '/admin/community'],
      ['Restaurantes e Hotéis', '/admin/places'],
      ['Em Alta', '/admin/offers'],
      ['Especialistas', '/admin/advisors'],
    ];

    for (const [label, href] of rotas) {
      mockPush.mockClear();
      fireEvent.press(screen.getByLabelText(label));
      expect(mockPush).toHaveBeenCalledWith(href);
    }
  });

  it('marks Comunidade and Places as AI-assisted', async () => {
    await renderPanel();
    expect(screen.getAllByText('Preenchimento com IA disponível')).toHaveLength(2);
  });

  it('states that Ofertas and Especialistas stay manual (§48, §49, §66)', async () => {
    await renderPanel();

    expect(screen.getByText('Em Alta')).toBeTruthy();
    expect(screen.getByText('Especialistas')).toBeTruthy();
    expect(screen.getAllByText('Cadastro manual, sem IA')).toHaveLength(2);
  });

  it('no longer shows any module as "Em breve" (§22)', async () => {
    await renderPanel();

    // O selo continua existindo no componente, para um módulo futuro que nasça
    // antes da tela. O que não pode existir é um cartão que abre nada — e
    // hoje, nenhum abre.
    expect(screen.queryByText('Em breve')).toBeNull();
  });

  it('offers no AI action on the panel itself', async () => {
    await renderPanel();
    expect(screen.queryByText(/Preencher com IA/)).toBeNull();
  });
});
