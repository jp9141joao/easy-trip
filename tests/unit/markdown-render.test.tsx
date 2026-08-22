import { fireEvent, render } from '@testing-library/react-native';

import { Markdown } from '@/components/Markdown';

/**
 * O que o usuário efetivamente enxerga (§3).
 *
 * O teste do parser prova a gramática; este prova a tela. Ele varre a árvore
 * renderizada procurando qualquer string com sintaxe de Markdown — se sobrar
 * um `###` em qualquer nó de texto, é exatamente o defeito do relato voltando.
 */

const mockOpenBrowser = jest.fn(async (_url: string) => undefined);
jest.mock('expo-web-browser', () => ({
  openBrowserAsync: (url: string) => mockOpenBrowser(url),
}));

interface Node {
  type?: string;
  props?: Record<string, unknown>;
  children?: unknown[] | null;
}

/** Todo texto renderizado, em ordem. */
function textos(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') {
    out.push(node);
    return out;
  }
  if (!node || typeof node !== 'object') return out;
  for (const child of (node as Node).children ?? []) textos(child, out);
  return out;
}

const RESPOSTA = `### Dicas úteis

**Orçamento disponível:** R$ 30.000

#### 3. Experiência Gastronômica

- Museu
- Restaurante

1. Chegada
2. Passeio`;

beforeEach(() => mockOpenBrowser.mockClear());

describe('mensagem da IA renderizada', () => {
  const arvore = () => render(<Markdown content={RESPOSTA} variant="bodySmall" />).toJSON();

  it('não mostra nenhum caractere de sintaxe na tela', () => {
    for (const texto of textos(arvore())) {
      expect(texto).not.toMatch(/^#{1,6}\s/);
      expect(texto).not.toContain('**');
    }
  });

  it('mostra o conteúdo dos títulos como texto de verdade', () => {
    const todos = textos(arvore()).join('|');
    expect(todos).toContain('Dicas úteis');
    expect(todos).toContain('3. Experiência Gastronômica');
  });

  it('desenha o marcador das listas em vez de repetir o hífen', () => {
    const todos = textos(arvore());
    expect(todos).toContain('•');
    expect(todos).toContain('Museu');
    // A lista numerada mantém os números como marcador, não como texto do item.
    expect(todos).toContain('1.');
    expect(todos).toContain('Chegada');
  });

  it('dá aos títulos um papel de acessibilidade, não só um tamanho de fonte', () => {
    const view = render(<Markdown content={RESPOSTA} />);
    expect(view.getByRole('header', { name: 'Dicas úteis' })).toBeTruthy();
  });

  it('separa hierarquia por peso e tamanho, não por cor', () => {
    const h3 = render(<Markdown content="### Título" />).toJSON();
    const paragrafo = render(<Markdown content="Título" />).toJSON();

    const estilo = (node: unknown): Record<string, unknown> => {
      const found: Record<string, unknown>[] = [];
      const visit = (n: unknown) => {
        if (!n || typeof n !== 'object') return;
        const current = n as Node;
        if (current.props?.style) found.push(current.props.style as Record<string, unknown>);
        for (const child of current.children ?? []) visit(child);
      };
      visit(node);
      return Object.assign({}, ...found.flat());
    };

    const tituloStyle = estilo(h3);
    const paragrafoStyle = estilo(paragrafo);
    expect(tituloStyle.fontFamily).not.toBe(paragrafoStyle.fontFamily);
    // A cor não é o que distingue: as duas usam o mesmo `textPrimary`.
    expect(tituloStyle.color).toBe(paragrafoStyle.color);
  });
});

describe('links dentro da resposta', () => {
  it('abre no navegador do sistema quando o endereço é válido', () => {
    const view = render(<Markdown content="Veja o [site](https://exemplo.com/x)." />);
    fireEvent.press(view.getByRole('link', { name: 'site. Abre no navegador.' }));
    expect(mockOpenBrowser).toHaveBeenCalledWith('https://exemplo.com/x');
  });

  it('não cria nada tocável para um esquema que não é web', () => {
    const view = render(<Markdown content="[toque](javascript:alert(1))" />);
    expect(view.queryByRole('link')).toBeNull();
    expect(textos(view.toJSON()).join('')).toContain('toque');
  });
});
