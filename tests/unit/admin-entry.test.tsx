import { act, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';

import SettingsScreen from '@/app/profile/settings';
import { ToastProvider } from '@/components/ui';
import { ThemeProvider } from '@/theme';

/**
 * Visibilidade da entrada administrativa no Perfil (§17, §18, §42).
 *
 * O ponto do teste não é só "admin vê o item". É que, para conta comum, ele
 * **não existe na árvore** — não está desabilitado, não está marcado como
 * bloqueado, não está escondido por estilo. Uma consulta que retorna `null` é o
 * que distingue as duas coisas.
 */

const metrics: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const mockAuth = {
  user: { email: 'conta@easytrip.app' },
  isAdmin: false,
  signOut: jest.fn(),
  deleteAccount: jest.fn(),
};

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => mockAuth }));
jest.mock('@/providers/ConnectivityProvider', () => ({
  useConnectivity: () => ({ status: 'online' }),
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));
jest.mock('@/repositories', () => ({ dataSource: { kind: 'local' } }));
jest.mock('@/services/ai', () => ({ aiService: { kind: 'local' } }));
jest.mock('@/services/emergency', () => ({ EMERGENCY_COVERAGE: 30 }));

const renderSettings = async () => {
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <ToastProvider>
          <SettingsScreen />
        </ToastProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
  // A preferência de tema é lida do disco depois da montagem; sem este flush o
  // React reclama de atualização fora de `act`.
  await act(async () => undefined);
};

beforeEach(() => {
  mockAuth.isAdmin = false;
});

describe('profile settings', () => {
  it('shows the panel entry for an administrator', async () => {
    mockAuth.isAdmin = true;
    await renderSettings();

    expect(screen.getByText('Administração')).toBeTruthy();
    expect(screen.getByLabelText('Painel de Conteúdo')).toBeTruthy();
  });

  it('does not render the section at all for a normal account', async () => {
    await renderSettings();

    expect(screen.queryByText('Administração')).toBeNull();
    expect(screen.queryByLabelText('Painel de Conteúdo')).toBeNull();
    // E nada de "Bloqueado" ou variação — o item simplesmente não existe (§18).
    expect(screen.queryByText(/Bloqueado/i)).toBeNull();
  });

  it('keeps the ordinary settings untouched either way', async () => {
    await renderSettings();
    // Regressão: a seção nova não pode ter deslocado nem escondido o que já
    // existia na tela para a conta comum (§47).
    expect(screen.getByText('Aparência')).toBeTruthy();
    expect(screen.getByText('Privacidade e dados')).toBeTruthy();
    expect(screen.getByText('Conta')).toBeTruthy();
  });
});
