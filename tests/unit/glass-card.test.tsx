import { render } from '@testing-library/react-native';
import { StyleSheet, Text, type ViewStyle } from 'react-native';

import { GlassCard } from '@/components/ui';

/**
 * Sombra e recorte precisam viver em camadas separadas (§5).
 *
 * Acumular `elevation` + `borderRadius` + `overflow: 'hidden'` num único View
 * faz o Android pintar o fundo como um retângulo de cantos retos dentro do card
 * arredondado, e ainda recorta a própria sombra que o card desenha.
 */

interface Node {
  type: string;
  props?: { style?: unknown };
  children?: unknown[] | null;
}

function collect(node: unknown, out: ViewStyle[] = []): ViewStyle[] {
  if (!node || typeof node !== 'object') return out;
  const current = node as Node;
  const style = StyleSheet.flatten(current.props?.style as ViewStyle) ?? {};
  if (Object.keys(style).length > 0) out.push(style);
  for (const child of current.children ?? []) collect(child, out);
  return out;
}

describe('GlassCard layering', () => {
  const styles = () =>
    collect(
      render(
        <GlassCard elevation="md">
          <Text>conteúdo</Text>
        </GlassCard>,
      ).toJSON(),
    );

  it('never puts the shadow on the view that clips', () => {
    for (const style of styles()) {
      const casts = Number(style.elevation ?? 0) > 0 || Number(style.shadowOpacity ?? 0) > 0;
      if (casts) expect(style.overflow).not.toBe('hidden');
    }
  });

  it('still clips its content to a rounded corner', () => {
    const clipping = styles().filter((style) => style.overflow === 'hidden');
    expect(clipping).toHaveLength(1);
    expect(Number(clipping[0].borderRadius)).toBeGreaterThan(0);
  });

  it('nests the inner radius inside the border so the corners line up', () => {
    const all = styles();
    const shell = all.find((style) => Number(style.borderWidth ?? 0) > 0);
    const clip = all.find((style) => style.overflow === 'hidden');

    expect(shell).toBeDefined();
    expect(clip).toBeDefined();
    expect(Number(clip!.borderRadius)).toBe(
      Number(shell!.borderRadius) - Number(shell!.borderWidth),
    );
  });

  it('paints the shell so Android has something to cast the shadow from', () => {
    const shell = styles().find((style) => Number(style.elevation ?? 0) > 0);
    expect(shell?.backgroundColor).toBeTruthy();
  });
});
