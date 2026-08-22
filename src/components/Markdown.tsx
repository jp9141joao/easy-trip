import { Fragment, useMemo } from 'react';
import { Linking, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { AppText } from '@/components/ui';
import {
  inlineToPlainText,
  parseMarkdown,
  type HeadingLevel,
  type InlineToken,
  type MarkdownBlock,
} from '@/lib/markdown';
import { useTheme } from '@/theme';
import type { TypographyVariant } from '@/theme/tokens';

/**
 * Renderiza o Markdown das respostas da IA e dos artigos da comunidade (§50, §58).
 *
 * A gramática vive em `@/lib/markdown`; aqui só existe aparência. O que este
 * arquivo garante é que **nenhuma sintaxe chega à tela**: todo `#`, `**`, `-`,
 * `1.` ou `[]()` com função de formatação é consumido pelo parser e sai como
 * hierarquia tipográfica — tamanho, peso e espaçamento, não cor — para a
 * estrutura sobreviver a quem não distingue cores.
 *
 * Nenhum HTML é executado: o retorno do modelo vira `<Text>`/`<View>`, jamais
 * uma WebView. Links são validados antes de virar toque (`normalizeExternalUrl`)
 * e abrem no navegador do sistema.
 */

type ColorRole = 'primary' | 'secondary' | 'onPrimary';

export interface MarkdownProps {
  content: string;
  color?: ColorRole;
  variant?: 'body' | 'bodySmall';
}

async function openLink(href: string) {
  try {
    await WebBrowser.openBrowserAsync(href);
  } catch {
    try {
      await Linking.openURL(href);
    } catch {
      // Um link que o aparelho recusa abrir não tem tratamento útil aqui: o
      // conteúdo continua legível e o toque simplesmente não faz nada.
    }
  }
}

/** Degraus de título: nível 1 é o maior, 4 ainda é visivelmente um título. */
const HEADING_VARIANT: Record<HeadingLevel, TypographyVariant> = {
  1: 'h2',
  2: 'h3',
  3: 'body',
  4: 'bodySmall',
};

function Inline({
  tokens,
  color,
  variant,
}: {
  tokens: InlineToken[];
  color: ColorRole;
  variant: 'body' | 'bodySmall';
}) {
  return (
    <AppText variant={variant} color={color}>
      {tokens.map((token, index) => {
        switch (token.kind) {
          case 'strong':
            return (
              <AppText key={index} variant={variant} color={color} weight="bold">
                {token.text}
              </AppText>
            );
          case 'em':
            return (
              <AppText key={index} variant={variant} color={color} style={{ fontStyle: 'italic' }}>
                {token.text}
              </AppText>
            );
          case 'strongEm':
            return (
              <AppText
                key={index}
                variant={variant}
                color={color}
                weight="bold"
                style={{ fontStyle: 'italic' }}
              >
                {token.text}
              </AppText>
            );
          case 'code':
            return (
              <AppText key={index} variant={variant} color={color} mono>
                {token.text}
              </AppText>
            );
          case 'link':
            return (
              <AppText
                key={index}
                variant={variant}
                color={color === 'onPrimary' ? 'onPrimary' : 'brand'}
                weight="semibold"
                style={{ textDecorationLine: 'underline' }}
                accessibilityRole="link"
                accessibilityLabel={`${token.text}. Abre no navegador.`}
                onPress={() => void openLink(token.href)}
              >
                {token.text}
              </AppText>
            );
          default:
            return <Fragment key={index}>{token.text}</Fragment>;
        }
      })}
    </AppText>
  );
}

function ListItem({
  marker,
  tokens,
  color,
  variant,
}: {
  marker: string;
  tokens: InlineToken[];
  color: ColorRole;
  variant: 'body' | 'bodySmall';
}) {
  const theme = useTheme();

  return (
    <View style={{ flexDirection: 'row', gap: theme.spacing.sm, paddingRight: theme.spacing.xs }}>
      <AppText
        variant={variant}
        color={color === 'onPrimary' ? 'onPrimary' : 'brand'}
        weight="semibold"
        // O marcador é decorativo: o leitor de tela já anuncia o texto do item.
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={{ minWidth: marker.length > 1 ? 20 : 10 }}
      >
        {marker}
      </AppText>
      <View style={{ flex: 1 }}>
        <Inline tokens={tokens} color={color} variant={variant} />
      </View>
    </View>
  );
}

function Block({
  block,
  first,
  color,
  variant,
}: {
  block: MarkdownBlock;
  first: boolean;
  color: ColorRole;
  variant: 'body' | 'bodySmall';
}) {
  const theme = useTheme();

  switch (block.kind) {
    case 'heading':
      return (
        <AppText
          variant={HEADING_VARIANT[block.level]}
          color={color}
          weight={block.level >= 3 ? 'bold' : undefined}
          accessibilityRole="header"
          accessibilityLabel={inlineToPlainText(block.content)}
          style={{ marginTop: first ? 0 : theme.spacing.xs }}
        >
          {inlineToPlainText(block.content)}
        </AppText>
      );

    case 'bullets':
      return (
        <View style={{ gap: theme.spacing.sm }}>
          {block.items.map((item, index) => (
            <ListItem key={index} marker="•" tokens={item} color={color} variant={variant} />
          ))}
        </View>
      );

    case 'ordered':
      return (
        <View style={{ gap: theme.spacing.sm }}>
          {block.items.map((item, index) => (
            <ListItem
              key={index}
              marker={`${block.start + index}.`}
              tokens={item}
              color={color}
              variant={variant}
            />
          ))}
        </View>
      );

    case 'quote':
      return (
        <View
          style={{
            borderLeftWidth: 3,
            borderLeftColor: theme.colors.primary,
            paddingLeft: theme.spacing.md,
          }}
        >
          <Inline tokens={block.content} color={color} variant={variant} />
        </View>
      );

    case 'code':
      return (
        <View
          style={{
            backgroundColor: theme.colors.surfaceMuted,
            borderRadius: theme.radius.smallCard,
            padding: theme.spacing.md,
          }}
        >
          <AppText variant={variant} color={color} mono>
            {block.text}
          </AppText>
        </View>
      );

    case 'rule':
      return <View style={{ height: 1, backgroundColor: theme.colors.divider }} />;

    default:
      return <Inline tokens={block.content} color={color} variant={variant} />;
  }
}

export function Markdown({ content, color = 'primary', variant = 'body' }: MarkdownProps) {
  const theme = useTheme();
  const blocks = useMemo(() => parseMarkdown(content), [content]);

  return (
    <View style={{ gap: theme.spacing.md }}>
      {blocks.map((block, index) => (
        <Block key={index} block={block} first={index === 0} color={color} variant={variant} />
      ))}
    </View>
  );
}
