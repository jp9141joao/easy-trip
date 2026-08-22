import { render, screen } from '@testing-library/react-native';
import { View } from 'react-native';

import AdminLayout from '@/app/admin/_layout';

/**
 * O guarda da rota `/admin` (§23, §41).
 *
 * O que está sendo verificado não é só "usuário comum é redirecionado", mas que
 * ele é redirecionado **sem o painel montar**. Por isso o `Stack` mockado tem um
 * `testID`: se ele aparecer na árvore para uma conta comum, houve renderização
 * indevida — que é o frame de painel que o §23 proíbe.
 */

const mockRedirect = jest.fn();
// O painel real é o `Stack` deste layout; o `testID` é como o teste enxerga se
// ele chegou a montar.
const mockStack = () => <View testID="admin-stack" />;

jest.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => {
    mockRedirect(href);
    return null;
  },
  Stack: () => mockStack(),
}));

const mockAuth = {
  initializing: false,
  isAuthenticated: true,
  isAdmin: false,
};

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => mockAuth,
}));

beforeEach(() => {
  mockRedirect.mockClear();
  mockAuth.initializing = false;
  mockAuth.isAuthenticated = true;
  mockAuth.isAdmin = false;
});

describe('admin route guard', () => {
  it('opens the panel for an administrator', () => {
    mockAuth.isAdmin = true;
    render(<AdminLayout />);

    expect(screen.getByTestId('admin-stack')).toBeTruthy();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('sends a normal account away without ever mounting the panel', () => {
    render(<AdminLayout />);

    expect(mockRedirect).toHaveBeenCalledWith('/(tabs)');
    expect(screen.queryByTestId('admin-stack')).toBeNull();
  });

  it('sends a signed-out visitor to the login screen', () => {
    mockAuth.isAuthenticated = false;
    render(<AdminLayout />);

    expect(mockRedirect).toHaveBeenCalledWith('/(auth)/login');
    expect(screen.queryByTestId('admin-stack')).toBeNull();
  });

  it('shows neither the panel nor a blank crash while the session resolves', () => {
    // Enquanto a sessão não resolveu, `isAdmin` ainda é `false` por definição.
    // O painel não pode aparecer, e a tela também não pode quebrar (§14, §23).
    mockAuth.initializing = true;
    mockAuth.isAdmin = true;
    const view = render(<AdminLayout />);

    expect(screen.queryByTestId('admin-stack')).toBeNull();
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(view.toJSON()).not.toBeNull();
  });
});
