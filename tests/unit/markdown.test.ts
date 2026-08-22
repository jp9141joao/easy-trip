import {
  inlineToPlainText,
  markdownToPlainText,
  parseInline,
  parseMarkdown,
  stripHtmlTags,
} from '@/lib/markdown';

/**
 * Markdown do Gemini (§3).
 *
 * O defeito reportado no aparelho era literal: a resposta chegava com
 * `#### 3. Experiência Gastronômica` e `**Les Antiquaires**`, e a tela mostrava
 * exatamente esses caracteres. Ou seja, o problema não era estilo — era que o
 * parser não reconhecia nível 4, lista numerada nem link, e tudo que ele não
 * reconhecia descia inteiro para um parágrafo.
 *
 * Por isso o teste central aqui não é "o negrito virou negrito", e sim: **não
 * sobra sintaxe em lugar nenhum**.
 */

const RESPOSTA_DO_MODELO = `### Dicas úteis

**Orçamento disponível:** R$ 30.000

#### 3. Experiência Gastronômica

**Les Antiquaires**

- **Estilo:** Bistrô francês
- **Região:** Saint-Germain

1. Museu
2. Restaurante
3. Passeio

Veja o [site oficial](https://exemplo.com/paris) para horários.`;

/** Todo texto que o usuário veria, de todos os blocos. */
function textoVisivel(source: string): string {
  return parseMarkdown(source)
    .map((block) => {
      switch (block.kind) {
        case 'heading':
        case 'paragraph':
        case 'quote':
          return inlineToPlainText(block.content);
        case 'bullets':
        case 'ordered':
          return block.items.map(inlineToPlainText).join('\n');
        case 'code':
          return block.text;
        case 'rule':
          return '';
      }
    })
    .join('\n');
}

describe('nenhuma sintaxe crua chega à tela (§3)', () => {
  it('consome os marcadores da resposta real que apareceu no aparelho', () => {
    const visivel = textoVisivel(RESPOSTA_DO_MODELO);

    // O sintoma exato do relato.
    expect(visivel).not.toContain('####');
    expect(visivel).not.toContain('###');
    expect(visivel).not.toContain('**');
    expect(visivel).toContain('Experiência Gastronômica');
    expect(visivel).toContain('Les Antiquaires');
    expect(visivel).toContain('Orçamento disponível');
  });

  it('não deixa hífen estrutural virar texto', () => {
    const [bloco] = parseMarkdown('- Museu\n- Restaurante');
    expect(bloco).toEqual({
      kind: 'bullets',
      items: [
        [{ kind: 'text', text: 'Museu' }],
        [{ kind: 'text', text: 'Restaurante' }],
      ],
    });
  });

  it('preserva hífen que é hífen', () => {
    expect(textoVisivel('Paris - a cidade luz')).toBe('Paris - a cidade luz');
  });
});

describe('blocos', () => {
  it('reconhece títulos de H1 a H4', () => {
    const blocos = parseMarkdown('# Um\n\n## Dois\n\n### Três\n\n#### Quatro');
    expect(blocos.map((b) => (b.kind === 'heading' ? b.level : null))).toEqual([1, 2, 3, 4]);
  });

  it('achata H5 e H6 em nível 4 em vez de devolvê-los como parágrafo', () => {
    // Se voltassem a ser parágrafo, os `#####` reapareceriam na tela.
    const blocos = parseMarkdown('##### Cinco\n\n###### Seis');
    expect(blocos.every((b) => b.kind === 'heading' && b.level === 4)).toBe(true);
  });

  it('separa lista numerada de lista com bullets', () => {
    const blocos = parseMarkdown('1. Museu\n2. Restaurante\n\n- Passeio');
    expect(blocos[0]).toMatchObject({ kind: 'ordered', start: 1 });
    expect(blocos[1]).toMatchObject({ kind: 'bullets' });
  });

  it('respeita o número inicial da lista, que o modelo costuma continuar', () => {
    const [bloco] = parseMarkdown('3. Terceiro\n4. Quarto');
    expect(bloco).toMatchObject({ kind: 'ordered', start: 3 });
  });

  it('mantém as quebras de linha dentro de um parágrafo', () => {
    const [bloco] = parseMarkdown('Primeira linha\nSegunda linha');
    expect(bloco.kind).toBe('paragraph');
    expect(textoVisivel('Primeira linha\nSegunda linha')).toBe('Primeira linha\nSegunda linha');
  });

  it('entende citação, regra horizontal e bloco de código', () => {
    const blocos = parseMarkdown('> Aviso\n\n---\n\n```\nconst x = 1;\n```');
    expect(blocos.map((b) => b.kind)).toEqual(['quote', 'rule', 'code']);
  });

  it('não interpreta marcação dentro do bloco de código', () => {
    const [bloco] = parseMarkdown('```\n# não é título\n```');
    expect(bloco).toEqual({ kind: 'code', text: '# não é título' });
  });
});

describe('inline', () => {
  it('reconhece negrito, itálico e negrito-itálico', () => {
    expect(parseInline('**a** _b_ *c* ***d***')).toEqual([
      { kind: 'strong', text: 'a' },
      { kind: 'text', text: ' ' },
      { kind: 'em', text: 'b' },
      { kind: 'text', text: ' ' },
      { kind: 'em', text: 'c' },
      { kind: 'text', text: ' ' },
      { kind: 'strongEm', text: 'd' },
    ]);
  });

  it('reconhece negrito colado na pontuação, como o modelo escreve', () => {
    expect(parseInline('**Estilo:** Bistrô')).toEqual([
      { kind: 'strong', text: 'Estilo:' },
      { kind: 'text', text: ' Bistrô' },
    ]);
  });

  it('não transforma sublinhado no meio de palavra em itálico', () => {
    // `trip_id_final` é um identificador, não ênfase.
    expect(parseInline('use trip_id_final aqui')).toEqual([
      { kind: 'text', text: 'use trip_id_final aqui' },
    ]);
  });

  it('reconhece código inline', () => {
    expect(parseInline('rode `npm test` agora')).toContainEqual({ kind: 'code', text: 'npm test' });
  });
});

describe('segurança (§3)', () => {
  it('só vira link o que passa pela validação de URL externa', () => {
    expect(parseInline('[site](https://exemplo.com/x)')).toEqual([
      { kind: 'link', text: 'site', href: 'https://exemplo.com/x' },
    ]);
  });

  it('promove http a https, como o resto do app', () => {
    const [token] = parseInline('[site](http://exemplo.com/)');
    expect(token).toEqual({ kind: 'link', text: 'site', href: 'https://exemplo.com/' });
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'file:///etc/passwd',
    'intent://scan/#Intent;scheme=zxing;end',
  ])('não deixa %s virar algo tocável', (endereco) => {
    const tokens = parseInline(`[toque aqui](${endereco})`);
    expect(tokens.some((token) => token.kind === 'link')).toBe(false);
    // O rótulo continua legível — o que se perde é só a ação.
    expect(inlineToPlainText(tokens)).toBe('toque aqui');
  });

  it('não deixa HTML do modelo virar marcação', () => {
    expect(stripHtmlTags('<script>alert(1)</script>ok')).toBe('alert(1)ok');
    expect(stripHtmlTags('<img src=x onerror=y>')).toBe('');
    // Comparação matemática não é tag.
    expect(stripHtmlTags('quando a < b e c > d')).toBe('quando a < b e c > d');
  });

  it('remove HTML antes de qualquer interpretação inline', () => {
    expect(inlineToPlainText(parseInline('<b>oi</b>'))).toBe('oi');
  });
});

describe('markdownToPlainText', () => {
  it('devolve a frase sem a pontuação estrutural, para o leitor de tela', () => {
    const texto = markdownToPlainText('## Título\n\n- **Item** um');
    expect(texto).toBe('Título\nItem um');
  });
});
