import { View } from 'react-native';

import { AppText, DateField, SelectField, TextField, TimeField } from '@/components/ui';
import type { ReviewGroup, ReviewItem } from '@/domain/aiActionReview';
import { ITINERARY_TYPES } from '@/domain/types';
import { formatWeekdayDate } from '@/lib/date';
import { ITINERARY_TYPE_LABEL } from '@/lib/labels';
import { useTheme } from '@/theme';
import { ActionRow } from './ActionRow';

/**
 * A proposta de roteiro, agrupada por dia — a mesma leitura da tela de Roteiro.
 *
 * Uma lista plana de oito itens fora de ordem não é revisável; o que a pessoa
 * confere é "o dia 23 faz sentido?". Por isso o agrupamento por data existe
 * aqui e não só na tela final.
 */
export function ItineraryActionPreview({
  group,
  expandedKey,
  onToggleItem,
  onToggleExpanded,
  onEdit,
}: {
  group: ReviewGroup;
  expandedKey: string | null;
  onToggleItem: (key: string) => void;
  onToggleExpanded: (key: string) => void;
  onEdit: (key: string, patch: Record<string, unknown>) => void;
}) {
  const theme = useTheme();

  const items = group.items.filter(
    (item): item is Extract<ReviewItem, { kind: 'itinerary' }> => item.kind === 'itinerary',
  );

  const byDate = new Map<string, typeof items>();
  for (const item of items) {
    byDate.set(item.value.date, [...(byDate.get(item.value.date) ?? []), item]);
  }

  return (
    <View style={{ gap: theme.spacing.md }}>
      {[...byDate.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, dayItems]) => (
          <View key={date} style={{ gap: theme.spacing.sm }}>
            <AppText variant="caption" color="secondary" weight="semibold" uppercase>
              {formatWeekdayDate(date)}
            </AppText>

            {dayItems.map((item) => (
              <ActionRow
                key={item.key}
                title={item.value.title}
                subtitle={[
                  ITINERARY_TYPE_LABEL[item.value.type],
                  item.value.placeName,
                  item.value.description,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                trailing={item.value.startTime}
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
                <DateField
                  label="Data"
                  value={item.value.date}
                  onChange={(nextDate) => onEdit(item.key, { date: nextDate })}
                />
                <TimeField
                  label="Início"
                  value={item.value.startTime}
                  onChange={(startTime) => onEdit(item.key, { startTime })}
                />
                <SelectField
                  label="Tipo"
                  value={item.value.type}
                  options={ITINERARY_TYPES.map((type) => ({
                    value: type,
                    label: ITINERARY_TYPE_LABEL[type],
                  }))}
                  onChange={(type) => onEdit(item.key, { type })}
                />
              </ActionRow>
            ))}
          </View>
        ))}
    </View>
  );
}
