import { darkTheme, lightTheme } from '@/theme/theme';

/**
 * Hierarquia de superfícies e sombras.
 *
 * O tema escuro já estava correto e não pode regredir enquanto o claro é
 * ajustado (§10), então os valores dele estão fixados aqui exatamente como
 * estavam em produção.
 */

/** Compõe uma cor `rgba()` sobre um fundo opaco, devolvendo o RGB resultante. */
function flatten(color: string, backdrop: [number, number, number]): [number, number, number] {
  const rgba = color.match(/^rgba?\(([^)]+)\)$/);
  if (rgba) {
    const [r, g, b, a = '1'] = rgba[1].split(',').map((part) => part.trim());
    const alpha = Number(a);
    return [Number(r), Number(g), Number(b)].map((channel, index) =>
      Math.round(alpha * channel + (1 - alpha) * backdrop[index]),
    ) as [number, number, number];
  }

  const hex = color.replace('#', '');
  return [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)) as [
    number,
    number,
    number,
  ];
}

/** Distância perceptual grosseira, suficiente para "dá para ver a diferença?". */
function distance(a: [number, number, number], b: [number, number, number]): number {
  return Math.max(...a.map((channel, index) => Math.abs(channel - b[index])));
}

const luminance = ([r, g, b]: [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

describe('light surfaces (§8)', () => {
  const background = flatten(lightTheme.colors.background, [255, 255, 255]);
  const card = flatten(lightTheme.colors.glass, background);
  const border = flatten(lightTheme.colors.glassBorder, card);
  const inset = flatten(lightTheme.colors.surfaceMuted, card);

  it('gives the card an edge that reads against the page, not just a shadow', () => {
    // No claro a diferença tonal entre um card branco e um fundo quase branco é
    // inerentemente pequena (~5/255), então quem delimita o card é a borda. Se
    // ela não se destacar do *fundo*, a aresta do card dissolve na página e só
    // sobra a sombra para separá-los — que era exatamente o sintoma do halo.
    expect(distance(border, background)).toBeGreaterThanOrEqual(8);
  });

  it('draws a border that defines the edge rather than erasing it', () => {
    // A borda era branca sobre preenchimento branco — mais clara que aquilo que
    // deveria delimitar.
    expect(luminance(border)).toBeLessThan(luminance(card));
    expect(distance(border, card)).toBeGreaterThanOrEqual(8);
  });

  it('keeps the card continuous with a nested opaque surface', () => {
    // Um filho com `colors.surface` dentro de um card não pode aparecer como um
    // retângulo branco solto: as duas superfícies têm de coincidir.
    const nested = flatten(lightTheme.colors.surface, card);
    expect(distance(nested, card)).toBeLessThanOrEqual(1);
  });

  it('gives inset regions a tone below the card, not above it', () => {
    expect(luminance(inset)).toBeLessThan(luminance(card));
  });

  it('stacks background → card → inset as three distinct steps', () => {
    expect(luminance(background)).toBeLessThan(luminance(card));
    expect(luminance(inset)).toBeLessThan(luminance(background));
  });
});

describe('light shadows (§6, §7)', () => {
  it('is softer than dark on every level', () => {
    for (const level of ['sm', 'md', 'lg'] as const) {
      expect(lightTheme.shadows[level].shadowOpacity).toBeLessThan(
        darkTheme.shadows[level].shadowOpacity,
      );
    }
  });

  it('stays diffuse rather than tight and dark', () => {
    for (const level of ['sm', 'md', 'lg'] as const) {
      expect(lightTheme.shadows[level].shadowRadius).toBeGreaterThanOrEqual(
        darkTheme.shadows[level].shadowRadius,
      );
    }
  });

  it('does not switch shadows off to hide the problem', () => {
    for (const level of ['sm', 'md', 'lg'] as const) {
      expect(lightTheme.shadows[level].shadowOpacity).toBeGreaterThan(0);
      expect(lightTheme.shadows[level].elevation).toBeGreaterThan(0);
    }
  });
});

describe('dark theme must not regress (§10)', () => {
  it('keeps the surface tokens it shipped with', () => {
    expect(darkTheme.colors.background).toBe('#020617');
    expect(darkTheme.colors.surface).toBe('#0B1220');
    expect(darkTheme.colors.surfaceElevated).toBe('#1E293B');
    expect(darkTheme.colors.glass).toBe('rgba(30,41,59,0.66)');
    expect(darkTheme.colors.glassBorder).toBe('rgba(148,163,184,0.18)');
    expect(darkTheme.colors.surfaceMuted).toBe('rgba(148,163,184,0.12)');
  });

  it('keeps the shadows it shipped with', () => {
    expect(darkTheme.shadows).toEqual({
      sm: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
        elevation: 1,
      },
      md: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.128,
        shadowRadius: 18,
        elevation: 3,
      },
      lg: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.192,
        shadowRadius: 28,
        elevation: 6,
      },
    });
  });

  it('keeps glass lighter than the background, which is what makes it read as a card', () => {
    const background = flatten(darkTheme.colors.background, [0, 0, 0]);
    const card = flatten(darkTheme.colors.glass, background);
    const border = flatten(darkTheme.colors.glassBorder, card);

    expect(luminance(card)).toBeGreaterThan(luminance(background));
    // No escuro a borda é mais clara que o card — o oposto do tema claro, e é
    // assim que tem de ser.
    expect(luminance(border)).toBeGreaterThan(luminance(card));
  });
});

/** Contraste WCAG entre duas cores opacas. */
function contrast(a: [number, number, number], b: [number, number, number]): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const relative = ([r, g, b2]: [number, number, number]) =>
    0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b2);

  const [high, low] = [relative(a), relative(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

describe('actions drawn over photography (§7, §8)', () => {
  // A foto por baixo é a mesma nos dois temas, então o tratamento também é.
  const themes = { light: lightTheme, dark: darkTheme };

  for (const [name, theme] of Object.entries(themes)) {
    describe(name, () => {
      const { onImage } = theme.colors;

      it.each([
        ['um céu totalmente branco', [255, 255, 255]],
        ['uma foto clara', [220, 225, 235]],
        ['uma foto média', [128, 128, 128]],
        ['uma foto escura', [20, 20, 20]],
      ] as [string, [number, number, number]][])(
        'keeps the icon legible over %s',
        (_label, photo) => {
          const surface = flatten(onImage.background, photo);
          const icon = flatten(onImage.foreground, surface);
          expect(contrast(icon, surface)).toBeGreaterThanOrEqual(4.5);
        },
      );

      it('never lets the button surface disappear into a bright photo', () => {
        const photo: [number, number, number] = [255, 255, 255];
        const surface = flatten(onImage.background, photo);
        // O bug era exatamente este: superfície branca sobre foto clara.
        expect(contrast(surface, photo)).toBeGreaterThanOrEqual(3);
      });
    });
  }

  it('uses the same treatment in both themes, because a photo is a photo', () => {
    expect(lightTheme.colors.onImage).toEqual(darkTheme.colors.onImage);
  });
});
