/**
 * Markdown do modelo → estrutura que a UI sabe desenhar (§50).
 *
 * O Gemini responde em Markdown porque o prompt do BFF pede resposta
 * estruturada em tópicos. Antes, o que chegava com `####` ou `1.` não era
 * reconhecido por ninguém e descia inteiro para um parágrafo — o usuário via
 * `#### 3. Experiência Gastronômica` literalmente na tela. Este módulo é o
 * inverso disso: tudo que tem função de formatação vira estrutura, e o que não
 * vira estrutura vira texto — nunca sintaxe visível.
 *
 * O parser mora fora do componente de propósito. Assim o contrato "isto vira
 * um título de nível 4, aquilo vira um item de lista" pode ser testado sem
 * renderizar nada, e a tela só decide como cada bloco se parece.
 *
 * SEGURANÇA
 *
 * Nada aqui produz HTML, e nada do que sai daqui é interpretado como HTML: os
 * blocos viram componentes React Native, onde `<script>` é só um texto sem
 * significado nenhum. Ainda assim removemos sequências que *pareçam* tags, para
 * que uma resposta contaminada não desenhe lixo na tela.
 *
 * Links passam por `normalizeExternalUrl` (§11) na hora de virar token: o que
 * não for `http`/`https` não vira link, vira o próprio rótulo em texto simples.
 * `javascript:`, `data:`, `file:` e `intent:` nunca chegam a ser tocáveis.
 */

import { normalizeExternalUrl } from './url';

export type InlineToken =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'em'; text: string }
  | { kind: 'strongEm'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string };

export type HeadingLevel = 1 | 2 | 3 | 4;

export type MarkdownBlock =
  | { kind: 'heading'; level: HeadingLevel; content: InlineToken[] }
  | { kind: 'paragraph'; content: InlineToken[] }
  | { kind: 'bullets'; items: InlineToken[][] }
  | { kind: 'ordered'; items: InlineToken[][]; start: number }
  | { kind: 'quote'; content: InlineToken[] }
  | { kind: 'code'; text: string }
  | { kind: 'rule' };

/** Remove sequências com cara de tag HTML, preservando `a < b`. */
export function stripHtmlTags(value: string): string {
  return value.replace(/<\/?[a-zA-Z][^<>]*>/g, '');
}

const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*(\d{1,3})[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const FENCE = /^\s*```/;

/**
 * Quebra o texto em blocos.
 *
 * Linhas em branco separam blocos; dentro de um parágrafo as quebras simples
 * são preservadas, porque o modelo usa quebra de linha como quebra de linha —
 * juntar tudo num parágrafo só (o comportamento antigo) grudava frases que
 * foram escritas separadas.
 */
export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = (source ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];

  let paragraph: string[] = [];
  let bullets: string[] = [];
  let ordered: { start: number; items: string[] } | null = null;
  let quote: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push({ kind: 'paragraph', content: parseInline(paragraph.join('\n')) });
    paragraph = [];
  };
  const flushBullets = () => {
    if (!bullets.length) return;
    blocks.push({ kind: 'bullets', items: bullets.map(parseInline) });
    bullets = [];
  };
  const flushOrdered = () => {
    if (!ordered) return;
    blocks.push({ kind: 'ordered', start: ordered.start, items: ordered.items.map(parseInline) });
    ordered = null;
  };
  const flushQuote = () => {
    if (!quote.length) return;
    blocks.push({ kind: 'quote', content: parseInline(quote.join('\n')) });
    quote = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushBullets();
    flushOrdered();
    flushQuote();
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trimEnd();

    // Bloco de código: consumido inteiro, sem interpretar nada lá dentro.
    if (FENCE.test(line)) {
      flushAll();
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !FENCE.test(lines[index])) {
        body.push(lines[index]);
        index += 1;
      }
      if (body.length) blocks.push({ kind: 'code', text: body.join('\n') });
      continue;
    }

    if (!line.trim()) {
      flushAll();
      continue;
    }

    if (RULE.test(line)) {
      flushAll();
      blocks.push({ kind: 'rule' });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushAll();
      // `#####` e `######` viram nível 4: abaixo disso não há degrau
      // tipográfico que o usuário consiga distinguir, e o que não pode
      // acontecer de jeito nenhum é a linha voltar a ser um parágrafo com os
      // jogos-da-velha à mostra.
      const level = Math.min(heading[1].length, 4) as HeadingLevel;
      blocks.push({ kind: 'heading', level, content: parseInline(heading[2]) });
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet) {
      flushParagraph();
      flushOrdered();
      flushQuote();
      bullets.push(bullet[1]);
      continue;
    }

    const numbered = ORDERED.exec(line);
    if (numbered) {
      flushParagraph();
      flushBullets();
      flushQuote();
      if (!ordered) ordered = { start: Number(numbered[1]), items: [] };
      ordered.items.push(numbered[2]);
      continue;
    }

    const quoted = QUOTE.exec(line);
    if (quoted) {
      flushParagraph();
      flushBullets();
      flushOrdered();
      quote.push(quoted[1]);
      continue;
    }

    flushBullets();
    flushOrdered();
    flushQuote();
    paragraph.push(line.trim());
  }

  flushAll();
  return blocks;
}

// O endereço aceita um nível de parênteses aninhados — `.../alert(1)` e as
// URLs da Wikipédia caem nesse caso, e sem isso sobrava um `)` solto na frase.
const LINK = /^\[([^\]]*)\]\(\s*((?:[^()\s]|\([^()\s]*\))+)\s*\)/;
const CODE = /^`([^`\n]+)`/;
const STRONG_EM = /^\*\*\*([^\n]+?)\*\*\*/;
const STRONG_STAR = /^\*\*([^\n]+?)\*\*/;
const STRONG_UNDER = /^__([^\n]+?)__/;
const EM_STAR = /^\*([^*\n]+?)\*/;
const EM_UNDER = /^_([^_\n]+?)_/;

/** `_` só abre ênfase fora de uma palavra — `snake_case_id` não é itálico. */
const WORD = /[A-Za-z0-9À-ÿ]/;

/**
 * Converte a linha em tokens inline.
 *
 * O varredor é manual em vez de um `split` por regex porque precisa olhar o
 * caractere anterior (para o `_`) e porque a ordem importa: `***` tem de ser
 * tentado antes de `**`, e `**` antes de `*`.
 */
export function parseInline(raw: string): InlineToken[] {
  const source = stripHtmlTags(raw ?? '');
  const tokens: InlineToken[] = [];
  let buffer = '';

  const flush = () => {
    if (buffer) {
      tokens.push({ kind: 'text', text: buffer });
      buffer = '';
    }
  };

  let index = 0;
  while (index < source.length) {
    const rest = source.slice(index);
    const char = source[index];

    if (char === '[') {
      const match = LINK.exec(rest);
      if (match) {
        const href = normalizeExternalUrl(match[2]);
        const label = match[1] || match[2];
        flush();
        // Endereço que não é web não vira toque — só o rótulo sobrevive (§11).
        if (href) tokens.push({ kind: 'link', text: label, href });
        else tokens.push({ kind: 'text', text: label });
        index += match[0].length;
        continue;
      }
    }

    if (char === '`') {
      const match = CODE.exec(rest);
      if (match) {
        flush();
        tokens.push({ kind: 'code', text: match[1] });
        index += match[0].length;
        continue;
      }
    }

    if (char === '*') {
      const strongEm = STRONG_EM.exec(rest);
      if (strongEm) {
        flush();
        tokens.push({ kind: 'strongEm', text: strongEm[1] });
        index += strongEm[0].length;
        continue;
      }
      const strong = STRONG_STAR.exec(rest);
      if (strong) {
        flush();
        tokens.push({ kind: 'strong', text: strong[1] });
        index += strong[0].length;
        continue;
      }
      const em = EM_STAR.exec(rest);
      if (em) {
        flush();
        tokens.push({ kind: 'em', text: em[1] });
        index += em[0].length;
        continue;
      }
    }

    if (char === '_') {
      const previous = index > 0 ? source[index - 1] : '';
      const insideWord = WORD.test(previous);
      if (!insideWord) {
        const strong = STRONG_UNDER.exec(rest);
        if (strong) {
          flush();
          tokens.push({ kind: 'strong', text: strong[1] });
          index += strong[0].length;
          continue;
        }
        const em = EM_UNDER.exec(rest);
        if (em && !WORD.test(source[index + em[0].length] ?? '')) {
          flush();
          tokens.push({ kind: 'em', text: em[1] });
          index += em[0].length;
          continue;
        }
      }
    }

    buffer += char;
    index += 1;
  }

  flush();
  return tokens;
}

/**
 * Texto puro de um conjunto de tokens — usado pelo rótulo de acessibilidade,
 * para o leitor de tela ouvir a frase e não a pontuação do Markdown.
 */
export function inlineToPlainText(tokens: InlineToken[]): string {
  return tokens.map((token) => token.text).join('');
}

/** Versão sem marcação do documento inteiro (rótulos, prévias, buscas). */
export function markdownToPlainText(source: string): string {
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
    .filter(Boolean)
    .join('\n');
}
