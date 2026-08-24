import { fireEvent, render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';

import LoginScreen from '@/app/(auth)/login';
import RegisterScreen from '@/app/(auth)/register';
import { PasswordField, SearchInput, TextField, ToastProvider } from '@/components/ui';
import { ThemeProvider } from '@/theme';

/**
 * O retângulo amarelo do autofill escapando do campo arredondado.
 *
 * O DEFEITO NO ANDROID: quando o Google Password Manager preenche um campo, o
 * sistema pinta **o retângulo inteiro** do `TextInput` nativo de amarelo. O
 * arredondamento do Easy Trip vive na `View` que embrulha o campo, não no
 * `TextInput` — e sem recorte o amarelo do filho passava por cima dos cantos.
 * Resultado: campo arredondado por fora, quadrado por dentro.
 *
 * A CORREÇÃO QUE NÃO SE FAZ: desligar o autofill. Isso apagaria o sintoma
 * tirando um recurso de acessibilidade e de segurança de quem usa gerenciador
 * de senhas — não é conserto, é remoção. Por isso metade desta suíte mede que o
 * autofill continua **ligado**.
 */

const metrics: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const renderUI = (ui: ReactElement) =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider>
        <ToastProvider>{ui}</ToastProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  Link: ({ children }: { children: unknown }) => children,
  useLocalSearchParams: () => ({}),
}));
jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({
    signIn: jest.fn(),
    signUp: jest.fn(),
    mode: 'supabase',
    recoveryError: null,
  }),
}));

type Node = { props: Record<string, unknown>; parent: Node | null };

const flat = (style: unknown): Record<string, unknown> =>
  (StyleSheet.flatten(style as never) ?? {}) as Record<string, unknown>;

/**
 * Sobe a partir do `TextInput` até a caixa que desenha o arredondamento.
 *
 * É essa caixa que precisa recortar: ela tem o raio, e o `TextInput` é o filho
 * que pinta o retângulo. Procurar por `borderRadius` — em vez de contar
 * ancestrais — mantém o teste válido se a árvore ganhar um nível.
 */
const caixaArredondada = (input: Node): Record<string, unknown> => {
  let node: Node | null = input.parent;
  while (node) {
    const style = flat(node.props.style);
    if (typeof style.borderRadius === 'number' && style.borderRadius > 0) return style;
    node = node.parent;
  }
  throw new Error('Nenhum ancestral com borderRadius encontrado.');
};

describe('A. o campo recorta o que o sistema pinta dentro dele', () => {
  it('TextField: a caixa arredondada tem overflow hidden', () => {
    const view = renderUI(<TextField label="E-mail" value="" onChangeText={() => {}} />);
    const caixa = caixaArredondada(view.getByLabelText('E-mail') as unknown as Node);

    expect(caixa.borderRadius).toBeGreaterThan(0);
    expect(caixa.overflow).toBe('hidden');
  });

  it('PasswordField: idem, e o botão do olho continua dentro', () => {
    const view = renderUI(<PasswordField label="Senha" value="" onChangeText={() => {}} />);
    const caixa = caixaArredondada(view.getByLabelText('Senha') as unknown as Node);

    expect(caixa.overflow).toBe('hidden');
    expect(view.getByLabelText('Mostrar senha')).toBeTruthy();
  });

  it('SearchInput: a mesma regra na pílula de busca', () => {
    const view = renderUI(<SearchInput value="" onChangeText={() => {}} />);
    const caixa = caixaArredondada(view.getByLabelText('Buscar') as unknown as Node);

    expect(caixa.overflow).toBe('hidden');
  });

  it('recortar não cria borda dupla nem muda a borda de foco', () => {
    const view = renderUI(<TextField label="E-mail" value="" onChangeText={() => {}} />);
    const input = view.getByLabelText('E-mail');

    const repouso = caixaArredondada(input as unknown as Node);
    expect(repouso.borderWidth).toBe(1);

    fireEvent(input, 'focus');
    const focado = caixaArredondada(view.getByLabelText('E-mail') as unknown as Node);
    // A borda de foco continua existindo, e continua sendo uma só.
    expect(focado.borderWidth).toBe(1.5);
    expect(flat((input as unknown as Node).props.style).borderWidth).toBeUndefined();
  });
});

describe('B. o autofill continua ligado', () => {
  it('login: e-mail e senha se anunciam ao gerenciador de senhas', () => {
    const view = renderUI(<LoginScreen />);

    const email = view.getByLabelText('E-mail');
    expect(email.props.autoComplete).toBe('email');
    expect(email.props.textContentType).toBe('emailAddress');

    const senha = view.getByLabelText('Senha');
    expect(senha.props.autoComplete).toBe('current-password');
    expect(senha.props.textContentType).toBe('password');
  });

  it('cadastro: nome, e-mail e as duas senhas também', () => {
    const view = renderUI(<RegisterScreen />);

    expect(view.getByLabelText('Nome').props.autoComplete).toBe('name');
    expect(view.getByLabelText('E-mail').props.autoComplete).toBe('email');
    // `new-password` é o que faz o gerenciador oferecer uma senha gerada.
    for (const campo of view.getAllByLabelText(/senha/i)) {
      if (campo.props.autoComplete) expect(campo.props.autoComplete).toBe('new-password');
    }
  });

  it('nenhum campo de autenticação desliga o preenchimento', () => {
    for (const tela of [<LoginScreen key="l" />, <RegisterScreen key="r" />]) {
      const view = renderUI(tela);
      expect(view.queryAllByHintText('off')).toHaveLength(0);
      expect(view.UNSAFE_queryAllByProps({ autoComplete: 'off' })).toHaveLength(0);
      expect(view.UNSAFE_queryAllByProps({ importantForAutofill: 'no' })).toHaveLength(0);
      view.unmount();
    }
  });

  it('os campos de senha continuam mascarados e com o olho funcionando', () => {
    const view = renderUI(<PasswordField label="Senha" value="segredo" onChangeText={() => {}} />);

    expect(view.getByLabelText('Senha').props.secureTextEntry).toBe(true);
    fireEvent.press(view.getByLabelText('Mostrar senha'));
    expect(view.getByLabelText('Senha').props.secureTextEntry).toBe(false);
    expect(view.getByLabelText('Ocultar senha')).toBeTruthy();
  });
});
