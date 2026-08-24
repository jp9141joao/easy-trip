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
import { VisibilityField } from '@/components/collaboration';
import { DEFAULT_VISIBILITY, type Visibility } from '@/domain/visibility';
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
  isShared = false,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  actions: AITripAction[];
  trip: Trip;
  itinerary: ItineraryItem[];
  checklist: ChecklistItem[];
  pending: boolean;
  /** A viagem tem mais de um viajante? Só então a visibilidade é uma escolha. */
  isShared?: boolean;
  onCancel: () => void;
  onConfirm: (actions: AITripAction[], visibility: ActionVisibility) => void;
}) {
  const theme = useTheme();
  const [groups, setGroups] = useState<ReviewGroup[]>([]);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  /**
   * A visibilidade do que a IA vai criar (§16).
   *
   * Uma escolha por TIPO de conteúdo, e não uma só para tudo, porque os
   * defaults são diferentes por um motivo: roteiro e checklist são logística
   * do grupo, despesa é o extrato de alguém. Uma chave única forçaria a pessoa
   * a escolher entre expor o gasto ou esconder o roteiro.
   */
  const [itineraryVisibility, setItineraryVisibility] = useState<Visibility>(
    DEFAULT_VISIBILITY.itinerary,
  );
  const [checklistVisibility, setChecklistVisibility] = useState<Visibility>(
    DEFAULT_VISIBILITY.checklist,
  );
  const [expenseVisibility, setExpenseVisibility] = useState<Visibility>(
    DEFAULT_VISIBILITY.expense,
  );

  useEffect(() => {
    if (!visible) return;
    setGroups(buildReviewGroups(actions, { trip, itinerary, checklist }));
    setExpandedKey(null);
    // Reabrir a folha refaz a revisão do zero — inclusive as conferências de
    // duplicata, que dependem do que já existe na viagem *agora*.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const selected = countSelected(groups);

  /**
   * Quais tipos de conteúdo esta revisão contém.
   *
   * Um seletor de visibilidade para uma categoria que não está sendo criada
   * seria uma pergunta sobre nada — e a folha já é longa.
   */
  const kinds = {
    itinerary: groups.some((group) => group.enabled && group.action.type === 'itinerary.add'),
    checklist: groups.some((group) => group.enabled && group.action.type === 'checklist.add'),
    expense: groups.some((group) => group.enabled && group.action.type === 'expenses.add'),
  };
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

        {/*
          Os seletores ficam no fim, depois da lista: a pergunta "quem vê isto"
          só faz sentido depois de a pessoa ter decidido o que entra. E somem
          inteiros em viagem individual — lá as duas opções são a mesma coisa.
        */}
        {isShared ? (
          <View style={{ gap: theme.spacing.md, paddingTop: theme.spacing.md }}>
            {kinds.itinerary ? (
              <VisibilityField
                value={itineraryVisibility}
                onChange={setItineraryVisibility}
                scope="Visibilidade dos itens de roteiro"
              />
            ) : null}
            {kinds.checklist ? (
              <VisibilityField
                value={checklistVisibility}
                onChange={setChecklistVisibility}
                scope="Visibilidade dos itens de checklist"
              />
            ) : null}
            {kinds.expense ? (
              <VisibilityField
                value={expenseVisibility}
                onChange={setExpenseVisibility}
                scope="Visibilidade das despesas"
              />
            ) : null}
          </View>
        ) : null}

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
              onPress={() =>
                onConfirm(reviewToActions(groups), {
                  itinerary: itineraryVisibility,
                  checklist: checklistVisibility,
                  expense: expenseVisibility,
                })
              }
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

/** O que a folha devolve junto com as ações revisadas. */
export interface ActionVisibility {
  itinerary: Visibility;
  checklist: Visibility;
  expense: Visibility;
}
