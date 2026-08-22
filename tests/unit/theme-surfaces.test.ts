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

describe('hero badges over photography (§1–§4)', () => {
  const variants = ['info', 'rating', 'discount', 'neutral'] as const;

  // A fotografia é a mesma nos dois temas, então o tratamento também é.
  for (const [name, theme] of Object.entries({ light: lightTheme, dark: darkTheme })) {
    describe(name, () => {
      const badge = theme.colors.heroBadge;

      it.each([
        ['um céu totalmente branco', [255, 255, 255]],
        ['uma fachada clara', [220, 225, 235]],
        ['uma foto média', [128, 128, 128]],
        ['uma foto escura', [20, 20, 20]],
      ] as [string, [number, number, number]][])('stays readable over %s', (_label, photo) => {
        const surface = flatten(badge.surface, photo);

        for (const variant of variants) {
          const text = flatten(badge.foreground[variant], surface);
          expect(contrast(text, surface)).toBeGreaterThanOrEqual(4.5);
        }
      });

      it('keeps each meaning a distinct colour instead of flattening to white', () => {
        // §4: as cores semânticas continuam existindo; o que mudou foi de onde
        // vem o contraste.
        const distinct = new Set(variants.map((variant) => badge.foreground[variant]));
        expect(distinct.size).toBe(variants.length);
      });

      it('does not lean on the photo for its own surface', () => {
        const photo: [number, number, number] = [255, 255, 255];
        const surface = flatten(badge.surface, photo);
        expect(contrast(surface, photo)).toBeGreaterThanOrEqual(3);
      });
    });
  }

  it('uses one treatment across both themes', () => {
    expect(lightTheme.colors.heroBadge).toEqual(darkTheme.colors.heroBadge);
  });
});

/* -------------------------------------------------------------------------- */
/*  Refino do tema claro                                                       */
/* -------------------------------------------------------------------------- */

describe('light theme tem vocabulário próprio de superfície (§4)', () => {
  const { colors } = lightTheme;
  const page = flatten(colors.background, [255, 255, 255]);
  const card = flatten(colors.glass, page);

  it('não é branco puro no fundo — é um off-white frio', () => {
    const [r, g, b] = page;
    expect(page).not.toEqual([255, 255, 255]);
    // Frio: o azul acima do verde acima do vermelho é o que dá o tom da marca.
    expect(b).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(r);
  });

  it('dá papel próprio a campo, navegação, segmento e bolha da IA', () => {
    // O sintoma do claro anterior era este: todos estes papéis eram o mesmo
    // branco do card, então nada se separava de nada.
    for (const role of ['input', 'navigationActive', 'segmentTrack', 'surfaceAccent'] as const) {
      expect(distance(flatten(colors[role], card), card)).toBeGreaterThanOrEqual(4);
    }
  });

  it('mantém o campo de entrada abaixo do card e acima do trilho recuado', () => {
    const input = flatten(colors.input, card);
    const track = flatten(colors.segmentTrack, card);
    expect(luminance(input)).toBeLessThan(luminance(card));
    expect(luminance(track)).toBeLessThan(luminance(input));
  });

  it('separa a pastilha selecionada do trilho do segmented control', () => {
    const track = flatten(colors.segmentTrack, page);
    const selected = flatten(colors.segmentSelected, track);
    expect(distance(selected, track)).toBeGreaterThanOrEqual(8);
    expect(luminance(selected)).toBeGreaterThan(luminance(track));
  });

  it('dá à navbar uma aresta visível em vez de deixá-la flutuando em branco', () => {
    const nav = flatten(colors.navigation, page);
    const border = flatten(colors.navigationBorder, nav);
    expect(distance(border, nav)).toBeGreaterThanOrEqual(8);
    expect(luminance(border)).toBeLessThan(luminance(nav));
  });

  it('deixa o item ativo da navegação visível sobre a própria navbar', () => {
    // `ocean[50]` sobre branco era invisível: a aba ativa não se distinguia.
    const nav = flatten(colors.navigation, page);
    const active = flatten(colors.navigationActive, nav);
    expect(distance(active, nav)).toBeGreaterThanOrEqual(10);
  });

  it('faz a bolha da IA se destacar do fundo da conversa', () => {
    const bubble = flatten(colors.bubbleAssistant, page);
    const border = flatten(colors.bubbleAssistantBorder, bubble);
    expect(distance(bubble, page)).toBeGreaterThanOrEqual(4);
    expect(distance(border, bubble)).toBeGreaterThanOrEqual(8);
  });

  it('dá ao card de contexto da IA identidade de marca, não mais um branco', () => {
    const accent = flatten(colors.surfaceAccent, page);
    const [r, , b] = accent;
    expect(b).toBeGreaterThan(r + 8);
    expect(distance(accent, card)).toBeGreaterThanOrEqual(8);
  });

  it('usa tons soft que aparecem sobre branco', () => {
    // `ocean[50]`/`coral[50]` sumiam sobre o card — eram os "elementos
    // decorativos lavados" do relato.
    for (const soft of [colors.primarySoft, colors.accentSoft]) {
      expect(distance(flatten(soft, card), card)).toBeGreaterThanOrEqual(8);
    }
  });
});

describe('contraste do tema claro (§6)', () => {
  const { colors } = lightTheme;
  const page = flatten(colors.background, [255, 255, 255]);
  const card = flatten(colors.glass, page);

  it('mantém o texto secundário e o terciário legíveis', () => {
    for (const role of ['textSecondary', 'textTertiary'] as const) {
      expect(contrast(flatten(colors[role], page), page)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('passa em AA no botão primário, que antes ficava em 2.77:1', () => {
    const fill = flatten(colors.primary, card);
    expect(contrast(flatten(colors.textOnPrimary, fill), fill)).toBeGreaterThanOrEqual(4.5);
  });

  it('mantém o azul legível sobre a superfície soft da marca', () => {
    const soft = flatten(colors.primarySoft, card);
    expect(contrast(flatten(colors.primary, soft), soft)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('dark theme não regride com os papéis novos (§5)', () => {
  const { colors } = darkTheme;

  it('reaproveita exatamente os valores que os componentes já usavam', () => {
    // Este é o teste que prova a preservação: cada papel novo é, no escuro, o
    // mesmo valor que o componente lia antes de o papel existir.
    expect(colors.input).toBe(colors.surface);
    expect(colors.inputBorder).toBe(colors.border);
    expect(colors.navigation).toBe(colors.surfaceElevated);
    expect(colors.navigationBorder).toBe(colors.border);
    expect(colors.navigationActive).toBe(colors.primarySoft);
    expect(colors.segmentTrack).toBe(colors.surfaceMuted);
    expect(colors.segmentSelected).toBe(colors.surface);
    expect(colors.bubbleAssistant).toBe(colors.surface);
    expect(colors.bubbleAssistantBorder).toBe(colors.border);
    expect(colors.divider).toBe(colors.border);
  });

  it('mantém a paleta aprovada intacta', () => {
    expect(colors.primary).toBe('#38BDF8');
    expect(colors.primaryPressed).toBe('#7DD3FC');
    expect(colors.primarySoft).toBe('rgba(14,165,233,0.16)');
    expect(colors.textPrimary).toBe('#F8FAFC');
    expect(colors.textSecondary).toBe('#94A3B8');
    expect(colors.textTertiary).toBe('#64748B');
    expect(colors.accent).toBe('#FB7185');
    expect(colors.border).toBe('rgba(148,163,184,0.20)');
  });

  it('mantém a aurora do escuro como estava', () => {
    expect(darkTheme.aurora).toEqual({
      cyan: 'rgba(14,165,233,0.20)',
      blue: 'rgba(2,132,199,0.16)',
      rose: 'rgba(244,63,94,0.12)',
    });
  });

  it('claro e escuro continuam sendo paletas distintas, não uma inversão', () => {
    for (const role of ['background', 'surface', 'primary', 'textPrimary'] as const) {
      expect(lightTheme.colors[role]).not.toBe(darkTheme.colors[role]);
    }
  });
});
