import { Fragment, useMemo } from 'react';
import { View } from 'react-native';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme';

/**
 * Small Markdown renderer for AI replies and article bodies (§50, §58).
 *
 * Supports the subset both actually produce — headings, bullets, bold, italic
 * and paragraphs. A full Markdown library would be a web-oriented dependency
 * for very little gain here.
 */

type Block =
  | { kind: 'h2' | 'h3' | 'paragraph'; text: string }
  | { kind: 'bullet'; items: string[] };

function parseBlocks(source: string): Block[] {
  const lines = source.split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let bullets: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ kind: 'paragraph', text: paragraph.join(' ').trim() });
      paragraph = [];
    }
  };
  const flushBullets = () => {
    if (bullets.length) {
      blocks.push({ kind: 'bullet', items: bullets });
      bullets = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (!line.trim()) {
      flushParagraph();
      flushBullets();
      continue;
    }

    if (line.startsWith('### ')) {
      flushParagraph();
      flushBullets();
      blocks.push({ kind: 'h3', text: line.slice(4) });
      continue;
    }
    if (line.startsWith('## ')) {
      flushParagraph();
      flushBullets();
      blocks.push({ kind: 'h2', text: line.slice(3) });
      continue;
    }
    if (line.startsWith('# ')) {
      flushParagraph();
      flushBullets();
      blocks.push({ kind: 'h2', text: line.slice(2) });
      continue;
    }
    if (/^[-*]\s+/.test(line.trim())) {
      flushParagraph();
      bullets.push(line.trim().replace(/^[-*]\s+/, ''));
      continue;
    }

    flushBullets();
    paragraph.push(line.trim());
  }

  flushParagraph();
  flushBullets();
  return blocks;
}

/** Renders `**bold**`, `*italic*` and `_italic_` inline spans. */
function InlineText({
  text,
  color = 'primary',
  variant = 'body',
}: {
  text: string;
  color?: 'primary' | 'secondary' | 'onPrimary';
  variant?: 'body' | 'bodySmall';
}) {
  const parts = useMemo(() => text.split(/(\*\*[^*]+\*\*|_[^_]+_|\*[^*]+\*)/g), [text]);

  return (
    <AppText variant={variant} color={color}>
      {parts.map((part, index) => {
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
          return (
            <AppText key={index} variant={variant} color={color} weight="bold">
              {part.slice(2, -2)}
            </AppText>
          );
        }
        if (
          (part.startsWith('_') && part.endsWith('_') && part.length > 2) ||
          (part.startsWith('*') && part.endsWith('*') && part.length > 2)
        ) {
          return (
            <AppText key={index} variant={variant} color={color} style={{ fontStyle: 'italic' }}>
              {part.slice(1, -1)}
            </AppText>
          );
        }
        return <Fragment key={index}>{part}</Fragment>;
      })}
    </AppText>
  );
}

export function Markdown({
  content,
  color = 'primary',
  variant = 'body',
}: {
  content: string;
  color?: 'primary' | 'secondary' | 'onPrimary';
  variant?: 'body' | 'bodySmall';
}) {
  const theme = useTheme();
  const blocks = useMemo(() => parseBlocks(content), [content]);

  return (
    <View style={{ gap: theme.spacing.md }}>
      {blocks.map((block, index) => {
        if (block.kind === 'h2') {
          return (
            <AppText key={index} variant="h3" color={color} style={{ marginTop: index ? 4 : 0 }}>
              {block.text}
            </AppText>
          );
        }
        if (block.kind === 'h3') {
          return (
            <AppText key={index} variant="body" weight="bold" color={color}>
              {block.text}
            </AppText>
          );
        }
        if (block.kind === 'bullet') {
          return (
            <View key={index} style={{ gap: 6 }}>
              {block.items.map((item, itemIndex) => (
                <View
                  key={itemIndex}
                  style={{ flexDirection: 'row', gap: theme.spacing.sm, paddingRight: 4 }}
                >
                  <AppText variant={variant} color={color}>
                    •
                  </AppText>
                  <View style={{ flex: 1 }}>
                    <InlineText text={item} color={color} variant={variant} />
                  </View>
                </View>
              ))}
            </View>
          );
        }
        return <InlineText key={index} text={block.text} color={color} variant={variant} />;
      })}
    </View>
  );
}
