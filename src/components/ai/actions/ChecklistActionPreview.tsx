import { View } from 'react-native';

import { AppText, Button, SelectField, TextField } from '@/components/ui';
import type { ReviewGroup, ReviewItem } from '@/domain/aiActionReview';
import { CHECKLIST_CATEGORIES } from '@/domain/types';
import { CHECKLIST_CATEGORY_LABEL } from '@/lib/labels';
import { useTheme } from '@/theme';
import { ActionRow } from './ActionRow';

/**
 * Itens sugeridos para o checklist.
 *
 * "Selecionar todos" existe porque a proposta chega com as possíveis duplicatas
 * já desmarcadas: quem olhou e concluiu que não são duplicata precisa de um
 * toque para aceitar tudo, e não de seis (§3-C, §22).
 */
export function ChecklistActionPreview({
  group,
  expandedKey,
  onToggleItem,
  onToggleExpanded,
  onEdit,
  onSelectAll,
}: {
  group: ReviewGroup;
  expandedKey: string | null;
  onToggleItem: (key: string) => void;
  onToggleExpanded: (key: string) => void;
  onEdit: (key: string, patch: Record<string, unknown>) => void;
  onSelectAll: () => void;
}) {
  const theme = useTheme();

  const items = group.items.filter(
    (item): item is Extract<ReviewItem, { kind: 'checklist' }> => item.kind === 'checklist',
  );
  const allSelected = items.every((item) => item.included);

  return (
    <View style={{ gap: theme.spacing.sm }}>
      {!allSelected ? (
        <View style={{ alignItems: 'flex-start' }}>
          <Button label="Selecionar todos" variant="ghost" size="sm" onPress={onSelectAll} />
        </View>
      ) : null}

      {items.map((item) => (
        <ActionRow
          key={item.key}
          title={item.value.label}
          subtitle={CHECKLIST_CATEGORY_LABEL[item.value.category]}
          included={item.included}
          warnings={item.warnings}
          editable
          expanded={expandedKey === item.key}
          onToggleIncluded={() => onToggleItem(item.key)}
          onToggleExpanded={() => onToggleExpanded(item.key)}
        >
          <TextField
            label="Item"
            value={item.value.label}
            onChangeText={(label) => onEdit(item.key, { label })}
          />
          <SelectField
            label="Categoria"
            value={item.value.category}
            options={CHECKLIST_CATEGORIES.map((category) => ({
              value: category,
              label: CHECKLIST_CATEGORY_LABEL[category],
            }))}
            onChange={(category) => onEdit(item.key, { category })}
          />
        </ActionRow>
      ))}

      {items.length === 0 ? (
        <AppText variant="caption" color="secondary">
          Nenhum item sugerido.
        </AppText>
      ) : null}
    </View>
  );
}
