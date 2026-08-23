import { View } from 'react-native';

import { AppText, DateField, MoneyField, SelectField, TextField } from '@/components/ui';
import type { ReviewGroup, ReviewItem } from '@/domain/aiActionReview';
import { CURRENCIES, GOAL_TYPES, type CurrencyCode, type Trip } from '@/domain/types';
import { formatMoney } from '@/lib/currency';
import { GOAL_TYPE_LABEL } from '@/lib/labels';
import { useTheme } from '@/theme';
import { ActionRow } from './ActionRow';

/**
 * Orçamento: um antes e um depois, lado a lado.
 *
 * A comparação é o conteúdo inteiro desta tela. "Atualizar orçamento para
 * R$ 12.000" sem dizer que hoje são R$ 10.000 pede uma confirmação às cegas —
 * e alterar orçamento muda como toda a tela de Gastos é lida (§3-D).
 */
export function BudgetActionPreview({
  group,
  trip,
  onToggleItem,
  onEdit,
  expandedKey,
  onToggleExpanded,
}: {
  group: ReviewGroup;
  trip: Trip;
  onToggleItem: (key: string) => void;
  onEdit: (key: string, patch: Record<string, unknown>) => void;
  expandedKey: string | null;
  onToggleExpanded: (key: string) => void;
}) {
  const theme = useTheme();
  const item = group.items.find(
    (candidate): candidate is Extract<ReviewItem, { kind: 'budget' }> => candidate.kind === 'budget',
  );
  if (!item) return null;

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <AppText variant="bodySmall" color="secondary">
          Orçamento atual
        </AppText>
        <AppText variant="bodySmall" mono>
          {formatMoney(trip.budgetTotal, trip.budgetCurrency)}
        </AppText>
      </View>

      <ActionRow
        title="Novo orçamento"
        trailing={formatMoney(item.value.budgetTotal, trip.budgetCurrency)}
        included={item.included}
        warnings={item.warnings}
        editable
        expanded={expandedKey === item.key}
        onToggleIncluded={() => onToggleItem(item.key)}
        onToggleExpanded={() => onToggleExpanded(item.key)}
      >
        <MoneyField
          label="Novo orçamento"
          value={item.value.budgetTotal}
          currency={trip.budgetCurrency}
          onChange={(budgetTotal) =>
            onEdit(item.key, { budgetTotal: budgetTotal ?? item.value.budgetTotal })
          }
        />
      </ActionRow>
    </View>
  );
}

/** Meta ligada à viagem — `Goal.tripId` já existe, então o vínculo é real. */
export function GoalActionPreview({
  group,
  onToggleItem,
  onEdit,
  expandedKey,
  onToggleExpanded,
}: {
  group: ReviewGroup;
  onToggleItem: (key: string) => void;
  onEdit: (key: string, patch: Record<string, unknown>) => void;
  expandedKey: string | null;
  onToggleExpanded: (key: string) => void;
}) {
  const theme = useTheme();
  const item = group.items.find(
    (candidate): candidate is Extract<ReviewItem, { kind: 'goal' }> => candidate.kind === 'goal',
  );
  if (!item) return null;

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <ActionRow
        title={item.value.title}
        subtitle={[
          GOAL_TYPE_LABEL[item.value.goalType],
          item.value.deadline ? `até ${item.value.deadline}` : undefined,
        ]
          .filter(Boolean)
          .join(' · ')}
        trailing={`${item.value.targetValue} ${item.value.unit}`}
        included={item.included}
        warnings={item.warnings}
        editable
        expanded={expandedKey === item.key}
        onToggleIncluded={() => onToggleItem(item.key)}
        onToggleExpanded={() => onToggleExpanded(item.key)}
      >
        <TextField
          label="Título"
          value={item.value.title}
          onChangeText={(title) => onEdit(item.key, { title })}
        />
        <SelectField
          label="Tipo"
          value={item.value.goalType}
          options={GOAL_TYPES.map((type) => ({ value: type, label: GOAL_TYPE_LABEL[type] }))}
          onChange={(goalType) => onEdit(item.key, { goalType })}
        />
        {/*
          `Goal.unit` é texto livre no domínio: pode ser "BRL", mas também
          "países" ou "dias". O campo de dinheiro só aparece quando a unidade é
          mesmo uma moeda — nos outros casos ele formataria "12 países" como
          "R$ 12,00", que é pior do que um campo simples.
        */}
        {(CURRENCIES as readonly string[]).includes(item.value.unit) ? (
          <MoneyField
            label="Meta"
            value={item.value.targetValue}
            currency={item.value.unit as CurrencyCode}
            onChange={(targetValue) =>
              onEdit(item.key, { targetValue: targetValue ?? item.value.targetValue })
            }
          />
        ) : (
          <TextField
            label={`Meta (${item.value.unit})`}
            value={String(item.value.targetValue)}
            keyboardType="numeric"
            onChangeText={(text) => {
              const parsed = Number(text.replace(',', '.'));
              if (Number.isFinite(parsed) && parsed > 0) {
                onEdit(item.key, { targetValue: parsed });
              }
            }}
          />
        )}
        <DateField
          label="Prazo"
          value={item.value.deadline}
          onChange={(deadline) => onEdit(item.key, { deadline })}
        />
      </ActionRow>
    </View>
  );
}
