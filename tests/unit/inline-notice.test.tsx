import { render } from '@testing-library/react-native';

import { InlineNotice } from '@/components/ui/Feedback';

/**
 * O React Native derruba a tela inteira com "Text strings must be rendered
 * within a <Text> component" se uma string cair como filha direta de uma View.
 * É o que acontecia com texto interpolado (`texto {valor}`), que chega como
 * array de nós e não como string — e derrubou a etapa 3 da criação de viagem.
 */

/** Forma mínima da árvore renderizada que este teste percorre. */
type Node = string | null | { type: string; children?: unknown[] | null };

/** Caminho até a primeira string solta fora de um <Text>, se houver. */
function findUnwrappedText(node: Node, path: string[] = []): string | null {
  if (node === null) return null;
  if (typeof node === 'string') {
    return node.trim() === '' ? null : `${path.join(' > ')} > "${node}"`;
  }

  const here = [...path, node.type];
  // Dentro de um Text, strings são exatamente o que deve existir.
  if (node.type === 'Text') return null;

  for (const child of node.children ?? []) {
    const found = findUnwrappedText(child as Node, here);
    if (found) return found;
  }
  return null;
}

describe('InlineNotice text children', () => {
  it('renders a plain string without leaving it loose in a View', () => {
    const tree = render(<InlineNotice>Escolha um destino da lista.</InlineNotice>).toJSON();

    expect(findUnwrappedText(tree as Node)).toBeNull();
  });

  it('wraps interpolated text, which arrives as an array of nodes', () => {
    const country = 'Itália';
    const { getByText } = render(
      <InlineNotice tone="success">
        Clima, fuso horário e contatos de emergência desta viagem já usarão {country}.
      </InlineNotice>,
    );

    // O texto aparece de fato — antes o conteúdo sumia junto com o erro.
    expect(getByText(/Itália/)).toBeTruthy();
  });

  it('leaves interpolated text wrapped in a Text node', () => {
    const tree = render(
      <InlineNotice tone="warning">
        Não temos cotação confiável para {'USD'} → {'BRL'}.
      </InlineNotice>,
    ).toJSON();

    expect(findUnwrappedText(tree as Node)).toBeNull();
  });

  it('still lets a caller pass its own JSX through untouched', () => {
    const { getByText } = render(
      <InlineNotice tone="warning">
        <InlineNotice>Aviso aninhado</InlineNotice>
      </InlineNotice>,
    );

    expect(getByText('Aviso aninhado')).toBeTruthy();
  });
});
