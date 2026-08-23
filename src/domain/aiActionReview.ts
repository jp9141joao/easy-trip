/**
 * O estado da tela de revisão — a etapa entre "a IA propôs" e "o Easy Trip
 * gravou".
 *
 * Está aqui, e não dentro do componente, porque é a parte que precisa ser
 * verificável sem montar um BottomSheet: quais itens já vêm marcados, o que é
 * possível duplicata, o que cai fora do período da viagem, e — principalmente —
 * que a lista devolvida ao executor contém **apenas** o que o usuário deixou
 * marcado, com as edições que ele fez.
 *
 * O ponto de partida é conservador: um item suspeito nasce **desmarcado**, com
 * o motivo à vista. Desmarcado não é proibido — quem quiser mantém, é um toque.
 * O contrário (marcado por padrão, aviso pequeno ao lado) transformaria o aviso
 * em decoração, porque a maioria confirma sem ler (§21, §22).
 */

import {
  findChecklistDuplicate,
  findItineraryDuplicate,
  isWithinTrip,
  type AIChecklistProposalItem,
  type AIExpenseProposalItem,
  type AIGoalProposal,
  type AIItineraryProposalItem,
  type AITripAction,
} from './aiActions';
import type { ChecklistItem, ItineraryItem, Trip } from './types';

/** Por que este item nasceu desmarcado — texto que a revisão mostra. */
export interface ReviewWarning {
  kind: 'duplicate' | 'outsideTrip';
  message: string;
}

interface ReviewItemBase {
  /** Estável dentro da revisão; serve de `key` e de alvo das edições. */
  key: string;
  included: boolean;
  warnings: ReviewWarning[];
}

export type ReviewItem =
  | (ReviewItemBase & { kind: 'itinerary'; value: AIItineraryProposalItem })
  | (ReviewItemBase & { kind: 'checklist'; value: AIChecklistProposalItem })
  | (ReviewItemBase & { kind: 'expense'; value: AIExpenseProposalItem })
  | (ReviewItemBase & { kind: 'budget'; value: { budgetTotal: number } })
  | (ReviewItemBase & { kind: 'goal'; value: AIGoalProposal });

export interface ReviewGroup {
  actionId: string;
  action: AITripAction;
  /** O grupo inteiro entra? Espelha "nenhum item marcado" nos dois sentidos. */
  enabled: boolean;
  items: ReviewItem[];
}

export interface ReviewContext {
  trip: Trip;
  itinerary: ItineraryItem[];
  checklist: ChecklistItem[];
}

const outsideTripWarning = (date: string): ReviewWarning => ({
  kind: 'outsideTrip',
  message: `${date} está fora do período da viagem`,
});

const duplicateWarning = (label: string): ReviewWarning => ({
  kind: 'duplicate',
  message: `Possível duplicata de "${label}"`,
});

export function buildReviewGroups(actions: AITripAction[], ctx: ReviewContext): ReviewGroup[] {
  return actions.map((action) => {
    const items = buildItems(action, ctx);
    return {
      actionId: action.id,
      action,
      enabled: items.some((item) => item.included),
      items,
    };
  });
}

function buildItems(action: AITripAction, ctx: ReviewContext): ReviewItem[] {
  switch (action.type) {
    case 'itinerary.add':
      return action.items.map((value, index) => {
        const warnings: ReviewWarning[] = [];
        if (!isWithinTrip(value.date, ctx.trip)) warnings.push(outsideTripWarning(value.date));
        const duplicate = findItineraryDuplicate(value, ctx.itinerary);
        if (duplicate) warnings.push(duplicateWarning(duplicate.title));
        return {
          kind: 'itinerary' as const,
          key: `${action.id}:${index}`,
          value,
          warnings,
          included: warnings.length === 0,
        };
      });

    case 'checklist.add':
      return action.items.map((value, index) => {
        const duplicate = findChecklistDuplicate(value, ctx.checklist);
        const warnings = duplicate ? [duplicateWarning(duplicate.label)] : [];
        return {
          kind: 'checklist' as const,
          key: `${action.id}:${index}`,
          value,
          warnings,
          included: warnings.length === 0,
        };
      });

    case 'expenses.add':
      /*
       * Despesa não é deduplicada (§22): dois almoços de R$ 60 no mesmo dia são
       * normais, e marcá-los como suspeitos treinaria o usuário a ignorar o
       * aviso justamente onde ele importa — no roteiro e no checklist.
       *
       * A data continua sendo conferida: uma despesa fora do período da viagem
       * é quase sempre engano de quem propôs.
       */
      return action.items.map((value, index) => {
        const warnings = isWithinTrip(value.transactionDate, ctx.trip)
          ? []
          : [outsideTripWarning(value.transactionDate)];
        return {
          kind: 'expense' as const,
          key: `${action.id}:${index}`,
          value,
          warnings,
          included: warnings.length === 0,
        };
      });

    case 'budget.update':
      return [
        {
          kind: 'budget' as const,
          key: `${action.id}:0`,
          value: { budgetTotal: action.budgetTotal },
          warnings: [],
          included: true,
        },
      ];

    case 'goal.add':
      return [
        {
          kind: 'goal' as const,
          key: `${action.id}:0`,
          value: action.goal,
          warnings: [],
          included: true,
        },
      ];
  }
}

/* -------------------------------- edições --------------------------------- */

export function toggleItem(groups: ReviewGroup[], key: string): ReviewGroup[] {
  return groups.map((group) => {
    if (!group.items.some((item) => item.key === key)) return group;
    const items = group.items.map((item) =>
      item.key === key ? { ...item, included: !item.included } : item,
    );
    // Desmarcar o último item desliga o grupo, e marcar qualquer um o religa:
    // um grupo "ativo" sem item nenhum seria um botão que promete e não entrega.
    return { ...group, items, enabled: items.some((item) => item.included) };
  });
}

export function toggleGroup(groups: ReviewGroup[], actionId: string): ReviewGroup[] {
  return groups.map((group) => {
    if (group.actionId !== actionId) return group;
    const enabled = !group.enabled;
    return {
      ...group,
      enabled,
      items: group.items.map((item) => ({ ...item, included: enabled })),
    };
  });
}

export function selectAll(groups: ReviewGroup[], actionId: string): ReviewGroup[] {
  return groups.map((group) =>
    group.actionId === actionId
      ? { ...group, enabled: true, items: group.items.map((item) => ({ ...item, included: true })) }
      : group,
  );
}

/**
 * Aplica uma edição de campo a um item.
 *
 * O tipo do patch acompanha o do item — não há como colar um `amount` num item
 * de checklist, porque o `ReviewItem` correspondente não tem esse campo.
 */
export function editItem(
  groups: ReviewGroup[],
  key: string,
  patch: Partial<AIItineraryProposalItem & AIChecklistProposalItem & AIExpenseProposalItem & AIGoalProposal & { budgetTotal: number }>,
): ReviewGroup[] {
  return groups.map((group) => ({
    ...group,
    items: group.items.map((item) =>
      item.key === key
        ? ({ ...item, value: { ...item.value, ...patch } } as ReviewItem)
        : item,
    ),
  }));
}

/* --------------------------- de volta para ações --------------------------- */

/**
 * O que efetivamente vai para o executor.
 *
 * Grupo desligado sai inteiro; item desmarcado sai do grupo; ação que ficou sem
 * item nenhum some da lista. `tripId` e `id` são preservados da proposta
 * original — a revisão edita conteúdo, nunca vínculo.
 */
export function reviewToActions(groups: ReviewGroup[]): AITripAction[] {
  const actions: AITripAction[] = [];

  for (const group of groups) {
    if (!group.enabled) continue;
    const included = group.items.filter((item) => item.included);
    if (included.length === 0) continue;

    const { action } = group;
    switch (action.type) {
      case 'itinerary.add':
        actions.push({
          ...action,
          items: included
            .filter((item): item is Extract<ReviewItem, { kind: 'itinerary' }> => item.kind === 'itinerary')
            .map((item) => item.value),
        });
        break;
      case 'checklist.add':
        actions.push({
          ...action,
          items: included
            .filter((item): item is Extract<ReviewItem, { kind: 'checklist' }> => item.kind === 'checklist')
            .map((item) => item.value),
        });
        break;
      case 'expenses.add':
        actions.push({
          ...action,
          items: included
            .filter((item): item is Extract<ReviewItem, { kind: 'expense' }> => item.kind === 'expense')
            .map((item) => item.value),
        });
        break;
      case 'budget.update': {
        const item = included.find(
          (candidate): candidate is Extract<ReviewItem, { kind: 'budget' }> => candidate.kind === 'budget',
        );
        if (item) actions.push({ ...action, budgetTotal: item.value.budgetTotal });
        break;
      }
      case 'goal.add': {
        const item = included.find(
          (candidate): candidate is Extract<ReviewItem, { kind: 'goal' }> => candidate.kind === 'goal',
        );
        if (item) actions.push({ ...action, goal: item.value });
        break;
      }
    }
  }

  return actions;
}

/** Quantos itens estão marcados no total — habilita/desabilita o botão final. */
export function countSelected(groups: ReviewGroup[]): number {
  return groups.reduce(
    (total, group) =>
      total + (group.enabled ? group.items.filter((item) => item.included).length : 0),
    0,
  );
}
