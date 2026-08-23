import { AlertTriangle, Check, ChevronDown, Copy } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui';
import type { ReviewWarning } from '@/domain/aiActionReview';
import { useTheme } from '@/theme';

/**
 * A casca de um item na revisão: marcar/desmarcar, o motivo de um item ter
 * nascido desmarcado, e o formulário de edição quando aberto.
 *
 * Existe separada porque as quatro previews (roteiro, checklist, despesa, meta)
 * precisam exatamente do mesmo comportamento de seleção e de aviso — e porque a
 * regra de acessibilidade fica em um lugar só: o estado de marcado vai no
 * `accessibilityState`, e o aviso vai no *rótulo*, não apenas na cor do ícone.
 */
export function ActionRow({
  title,
  subtitle,
  trailing,
  included,
  warnings,
  editable = false,
  expanded = false,
  onToggleIncluded,
  onToggleExpanded,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Valor à direita — normalmente dinheiro ou horário. */
  trailing?: string;
  included: boolean;
  warnings: ReviewWarning[];
  editable?: boolean;
  expanded?: boolean;
  onToggleIncluded: () => void;
  onToggleExpanded?: () => void;
  /** Campos de edição, exibidos quando `expanded`. */
  children?: ReactNode;
}) {
  const theme = useTheme();

  const warningText = warnings.map((warning) => warning.message).join('. ');

  return (
    <View
      style={{
        borderRadius: theme.radius.smallCard,
        borderWidth: 1,
        borderColor: warnings.length > 0 ? theme.colors.warning : theme.colors.border,
        backgroundColor: theme.colors.surface,
        overflow: 'hidden',
      }}
    >
      <Pressable
        onPress={onToggleIncluded}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: included }}
        accessibilityLabel={[title, subtitle, trailing, warningText].filter(Boolean).join('. ')}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: theme.spacing.md,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.md,
          minHeight: theme.hitTarget,
          backgroundColor: pressed ? theme.colors.surfaceMuted : 'transparent',
        })}
      >
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            marginTop: 1,
            borderWidth: 2,
            borderColor: included ? theme.colors.primary : theme.colors.borderStrong,
            backgroundColor: included ? theme.colors.primary : 'transparent',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {included ? <Check size={14} color={theme.colors.textOnPrimary} /> : null}
        </View>

        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="bodySmall" weight="semibold">
            {title}
          </AppText>
          {subtitle ? (
            <AppText variant="caption" color="secondary">
              {subtitle}
            </AppText>
          ) : null}

          {warnings.map((warning) => (
            <View
              key={warning.kind}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}
            >
              {warning.kind === 'duplicate' ? (
                <Copy size={12} color={theme.colors.warning} />
              ) : (
                <AlertTriangle size={12} color={theme.colors.warning} />
              )}
              <AppText variant="caption" color="warning" style={{ flex: 1 }}>
                {warning.message}
              </AppText>
            </View>
          ))}
        </View>

        {trailing ? (
          <AppText variant="bodySmall" weight="semibold" mono>
            {trailing}
          </AppText>
        ) : null}

        {editable && onToggleExpanded ? (
          <Pressable
            onPress={onToggleExpanded}
            hitSlop={theme.hitSlop}
            accessibilityRole="button"
            accessibilityLabel={expanded ? `Fechar edição de ${title}` : `Editar ${title}`}
            accessibilityState={{ expanded }}
            style={{ paddingLeft: theme.spacing.xs, paddingTop: 2 }}
          >
            <ChevronDown
              size={18}
              color={theme.colors.textSecondary}
              style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }}
            />
          </Pressable>
        ) : null}
      </Pressable>

      {expanded && children ? (
        <View
          style={{
            gap: theme.spacing.md,
            paddingHorizontal: theme.spacing.md,
            paddingBottom: theme.spacing.md,
            borderTopWidth: 1,
            borderTopColor: theme.colors.divider,
            paddingTop: theme.spacing.md,
          }}
        >
          {children}
        </View>
      ) : null}
    </View>
  );
}
