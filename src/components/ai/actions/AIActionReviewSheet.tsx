import { Info } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { AppText, BottomSheet, Button, ButtonRow, InlineNotice } from '@/components/ui';
import {
  buildReviewGroups,
  countSelected,
  editItem,
  reviewToActions,
  selectAll,
  toggleGroup,
  toggleItem,
  type ReviewGroup,
} from '@/domain/aiActionReview';
import type { AITripAction } from '@/domain/aiActions';
import type { ChecklistItem, ItineraryItem, Trip } from '@/domain/types';
import { useTheme } from '@/theme';
import { ChecklistActionPreview } from './ChecklistActionPreview';
import { ExpenseActionPreview } from './ExpenseActionPreview';
import { ItineraryActionPreview } from './ItineraryActionPreview';
import { BudgetActionPreview, GoalActionPreview } from './SimpleActionPreview';

/**
 * "Revisar antes de adicionar" — a etapa que separa uma sugestão de uma
 * gravação.
 *
 * Não é um formulário paralelo: os campos são os mesmos `TextField`,
 * `DateField`, `TimeField`, `MoneyField` e `SelectField` que a pessoa já usa
 * para criar um item de roteiro ou uma despesa à mão. Uma tela de revisão com
 * regras próprias de edição seria uma segunda maneira de escrever no mesmo
 * lugar, e as duas divergiriam (§11).
 *
 * O estado da revisão é montado uma vez, quando a folha abre. Não é recalculado
 * a cada render de propósito: a pessoa desmarca um item, e ele precisa
 * continuar desmarcado — se os grupos fossem derivados das props, cada render
 * desfaria o que ela acabou de fazer.
 */
export function AIActionReviewSheet({
  visible,
  actions,
  trip,
  itinerary,
  checklist,
  pending,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  actions: AITripAction[];
  trip: Trip;
  itinerary: ItineraryItem[];
  checklist: ChecklistItem[];
  pending: boolean;
  onCancel: () => void;
  onConfirm: (actions: AITripAction[]) => void;
}) {
  const theme = useTheme();
  const [groups, setGroups] = useState<ReviewGroup[]>([]);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setGroups(buildReviewGroups(actions, { trip, itinerary, checklist }));
    setExpandedKey(null);
    // Reabrir a folha refaz a revisão do zero — inclusive as conferências de
    // duplicata, que dependem do que já existe na viagem *agora*.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const selected = countSelected(groups);
  const warned = groups.some((group) => group.items.some((item) => item.warnings.length > 0));

  return (
    <BottomSheet
      visible={visible}
      onClose={pending ? () => undefined : onCancel}
      title="Revisar antes de adicionar"
      subtitle={`Nada é gravado em ${trip.destinationCity} até você confirmar.`}
    >
      <View style={{ gap: theme.spacing.lg }}>
        {warned ? (
          <InlineNotice icon={Info} tone="warning">
            Alguns itens vieram desmarcados: são possíveis duplicatas ou datas fora do período da
            viagem. Marque os que quiser manter mesmo assim.
          </InlineNotice>
        ) : null}

        <ScrollView
          style={{ maxHeight: 420 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ gap: theme.spacing.xl, paddingBottom: theme.spacing.sm }}
        >
          {groups.map((group) => (
            <View key={group.actionId} style={{ gap: theme.spacing.md }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: theme.spacing.sm,
                }}
              >
                <AppText variant="body" weight="semibold" style={{ flex: 1 }}>
                  {group.action.label}
                </AppText>
                <Button
                  label={group.enabled ? 'Remover' : 'Incluir'}
                  variant="ghost"
                  size="sm"
                  onPress={() => setGroups((current) => toggleGroup(current, group.actionId))}
                />
              </View>

              {group.enabled ? (
                <ActionGroupPreview
                  group={group}
                  trip={trip}
                  expandedKey={expandedKey}
                  onToggleItem={(key) => setGroups((current) => toggleItem(current, key))}
                  onToggleExpanded={(key) =>
                    setExpandedKey((current) => (current === key ? null : key))
                  }
                  onEdit={(key, patch) => setGroups((current) => editItem(current, key, patch))}
                  onSelectAll={() => setGroups((current) => selectAll(current, group.actionId))}
                />
              ) : (
                <AppText variant="caption" color="tertiary">
                  Este bloco não será aplicado.
                </AppText>
              )}
            </View>
          ))}
        </ScrollView>

        <ButtonRow>
          <View style={{ flex: 1 }}>
            <Button label="Cancelar" variant="secondary" fullWidth onPress={onCancel} disabled={pending} />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label={selected === 0 ? 'Nada selecionado' : `Adicionar ${selected} ${selected === 1 ? 'item' : 'itens'}`}
              fullWidth
              loading={pending}
              disabled={selected === 0}
              haptic
              onPress={() => onConfirm(reviewToActions(groups))}
            />
          </View>
        </ButtonRow>
      </View>
    </BottomSheet>
  );
}

function ActionGroupPreview({
  group,
  trip,
  expandedKey,
  onToggleItem,
  onToggleExpanded,
  onEdit,
  onSelectAll,
}: {
  group: ReviewGroup;
  trip: Trip;
  expandedKey: string | null;
  onToggleItem: (key: string) => void;
  onToggleExpanded: (key: string) => void;
  onEdit: (key: string, patch: Record<string, unknown>) => void;
  onSelectAll: () => void;
}) {
  switch (group.action.type) {
    case 'itinerary.add':
      return (
        <ItineraryActionPreview
          group={group}
          expandedKey={expandedKey}
          onToggleItem={onToggleItem}
          onToggleExpanded={onToggleExpanded}
          onEdit={onEdit}
        />
      );
    case 'checklist.add':
      return (
        <ChecklistActionPreview
          group={group}
          expandedKey={expandedKey}
          onToggleItem={onToggleItem}
          onToggleExpanded={onToggleExpanded}
          onEdit={onEdit}
          onSelectAll={onSelectAll}
        />
      );
    case 'expenses.add':
      return (
        <ExpenseActionPreview
          group={group}
          trip={trip}
          expandedKey={expandedKey}
          onToggleItem={onToggleItem}
          onToggleExpanded={onToggleExpanded}
          onEdit={onEdit}
        />
      );
    case 'budget.update':
      return (
        <BudgetActionPreview
          group={group}
          trip={trip}
          expandedKey={expandedKey}
          onToggleItem={onToggleItem}
          onToggleExpanded={onToggleExpanded}
          onEdit={onEdit}
        />
      );
    case 'goal.add':
      return (
        <GoalActionPreview
          group={group}
          expandedKey={expandedKey}
          onToggleItem={onToggleItem}
          onToggleExpanded={onToggleExpanded}
          onEdit={onEdit}
        />
      );
  }
}
