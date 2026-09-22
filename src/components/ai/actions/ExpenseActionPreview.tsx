import { Info } from 'lucide-react-native';
import { View } from 'react-native';

import { AppText, Badge, DateField, InlineNotice, MoneyField, SelectField, TextField } from '@/components/ui';
import type { ReviewGroup, ReviewItem } from '@/domain/aiActionReview';
import { EXPENSE_CATEGORIES, type CurrencyCode, type Trip } from '@/domain/types';
import { formatMoney } from '@/lib/currency';
import { EXPENSE_CATEGORY_LABEL } from '@/lib/labels';
import { useTheme } from '@/theme';
import { ActionRow } from './ActionRow';

/**
 * Despesas propostas.
 *
 * DUAS COISAS QUE ESTA TELA NÃO PODE ERRAR
 *
 * **Estimativa não vira fato.** Toda proposta aparece com a etiqueta
 * "Estimativa", e é assim que ela será gravada — a
 * descrição vai para o banco prefixada, porque `expenses` não tem coluna para
 * isso e inventar uma no TypeScript criaria um campo que morre no INSERT (§19).
 *
 * **Moeda não se mistura.** O total é somado *por moeda*. Se a proposta tem
 * € 50 e R$ 300, aparecem dois totais, não um. A conversão acontece na
 * gravação, com a cotação real do serviço de câmbio — e se não houver cotação,
 * a despesa entra na moeda em que foi paga e a tela de Gastos sinaliza, como já
 * fazia. Nenhuma taxa é inventada aqui para o resumo ficar redondo (§20, §41).
 */
export function ExpenseActionPreview({
  group,
  trip,
  expandedKey,
  onToggleItem,
  onToggleExpanded,
  onEdit,
}: {
  group: ReviewGroup;
  trip: Trip;
  expandedKey: string | null;
  onToggleItem: (key: string) => void;
  onToggleExpanded: (key: string) => void;
  onEdit: (key: string, patch: Record<string, unknown>) => void;
}) {
  const theme = useTheme();

  const items = group.items.filter(
    (item): item is Extract<ReviewItem, { kind: 'expense' }> => item.kind === 'expense',
  );
  const selected = items.filter((item) => item.included);

  const totals = new Map<CurrencyCode, number>();
  for (const item of selected) {
    totals.set(item.value.currency, (totals.get(item.value.currency) ?? 0) + item.value.amount);
  }

  const anyEstimated = selected.length > 0;
  const foreignCurrency = selected.some((item) => item.value.currency !== trip.budgetCurrency);

  return (
    <View style={{ gap: theme.spacing.sm }}>
      {items.map((item) => (
        <ActionRow
          key={item.key}
          title={item.value.description}
          subtitle={EXPENSE_CATEGORY_LABEL[item.value.category]}
          trailing={formatMoney(item.value.amount, item.value.currency)}
          included={item.included}
          warnings={item.warnings}
          editable
          expanded={expandedKey === item.key}
          onToggleIncluded={() => onToggleItem(item.key)}
          onToggleExpanded={() => onToggleExpanded(item.key)}
        >
          <View style={{ flexDirection: 'row' }}>
            <Badge
              label="Estimativa da IA"
              tone="warning"
            />
          </View>

          <TextField
            label="Descrição"
            value={item.value.description}
            onChangeText={(description) => onEdit(item.key, { description })}
          />
          <MoneyField
            label="Valor"
            value={item.value.amount}
            currency={item.value.currency}
            onChange={(amount) => onEdit(item.key, { amount: amount ?? item.value.amount })}
          />
          <SelectField
            label="Categoria"
            value={item.value.category}
            options={EXPENSE_CATEGORIES.map((category) => ({
              value: category,
              label: EXPENSE_CATEGORY_LABEL[category],
            }))}
            onChange={(category) => onEdit(item.key, { category })}
          />
          <DateField
            label="Data"
            value={item.value.transactionDate}
            onChange={(transactionDate) => onEdit(item.key, { transactionDate })}
          />
        </ActionRow>
      ))}

      {selected.length > 0 ? (
        <View
          style={{
            gap: 2,
            paddingTop: theme.spacing.sm,
            borderTopWidth: 1,
            borderTopColor: theme.colors.divider,
          }}
        >
          {[...totals.entries()].map(([currency, total]) => (
            <View
              key={currency}
              style={{ flexDirection: 'row', justifyContent: 'space-between' }}
            >
              <AppText variant="bodySmall" color="secondary">
                {anyEstimated ? 'Total estimado' : 'Total'}
                {totals.size > 1 ? ` (${currency})` : ''}
              </AppText>
              <AppText variant="bodySmall" weight="semibold" mono>
                {formatMoney(total, currency)}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}

      {anyEstimated ? (
        <InlineNotice icon={Info} tone="warning">
          Valores marcados como estimativa são um ponto de partida para planejar, não preços
          consultados agora. Ajuste o que souber antes de adicionar.
        </InlineNotice>
      ) : null}

      {foreignCurrency ? (
        <InlineNotice icon={Info}>
          Há valores em moeda diferente da do orçamento ({trip.budgetCurrency}). A conversão usa a
          cotação real no momento de salvar — e, se não houver cotação disponível, a despesa é
          registrada na moeda original.
        </InlineNotice>
      ) : null}
    </View>
  );
}
