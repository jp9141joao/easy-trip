/**
 * Ações acionáveis da Easy Trip IA — o contrato entre o que o modelo *propõe* e
 * o que o Easy Trip pode *gravar*.
 *
 * A regra que este arquivo existe para tornar verificável: **texto livre do
 * modelo nunca vira comando**. A Edge Function devolve duas coisas separadas —
 * a resposta humana (`content`, Markdown, só para ler) e uma lista de propostas
 * estruturadas (`actions`). Nada aqui é extraído por regex de Markdown, e
 * nenhuma proposta chega ao banco sem passar por três portas:
 *
 *   1. saída estruturada do Gemini (schema declarado à API);
 *   2. validação no servidor, na Edge Function;
 *   3. validação **de novo** aqui, no cliente, antes de qualquer gravação.
 *
 * A terceira não é redundância: a segunda protege o servidor de um modelo que
 * ignorou o schema, e a terceira protege o banco de qualquer coisa que chegue
 * pela rede — inclusive de um servidor comprometido ou de uma resposta forjada.
 *
 * SEGURANÇA POR AUSÊNCIA
 *
 * Assim como em `aiGrounding.ts`, a barreira mais forte é o que este tipo
 * **não** consegue expressar. Não existe ação de excluir, de editar registro
 * existente, de mexer em perfil, papel, documento, arquivo ou outra viagem.
 * Não existe campo de URL — então não há por onde um `javascript:` entrar. Não
 * existe `Ticket`, porque bilhete é documento real do usuário e uma sugestão da
 * IA não é um documento. Um modelo que invente `{"type":"trip.delete"}` produz
 * um valor que a união discriminada simplesmente descarta.
 *
 * VÍNCULO COM A VIAGEM
 *
 * `tripId` **não** vem do modelo. O modelo nunca vê o id da viagem (ver
 * `buildTripContext`, que manda destino e datas, nunca a chave). Quem carimba o
 * vínculo é o cliente, no momento em que recebe a proposta, usando a viagem em
 * que a conversa está. O executor confere o carimbo de novo na hora de gravar —
 * é isso que impede uma proposta de Paris de ser aplicada depois que o usuário
 * trocou para Tóquio (§14).
 */

import { z } from 'zod';

import { createId } from '@/lib/id';
import { isValidISODate } from '@/lib/date';
import {
  CHECKLIST_CATEGORIES,
  CURRENCIES,
  EXPENSE_CATEGORIES,
  GOAL_TYPES,
  ITINERARY_TYPES,
  type ChecklistCategory,
  type ChecklistItem,
  type CurrencyCode,
  type ExpenseCategory,
  type GoalType,
  type ItineraryItem,
  type ItineraryType,
  type Priority,
  type Trip,
} from './types';

/* -------------------------------- limites --------------------------------- */

/**
 * Tudo que sai do modelo é tamanho não confiável (§12).
 *
 * Os limites são baixos de propósito: uma proposta útil cabe folgada neles, e
 * uma proposta com mil itens de roteiro é um ataque ou um defeito — nos dois
 * casos, não é para gravar.
 */
export const AI_ACTION_LIMITS = {
  /** Uma proposta composta razoável é roteiro + despesas + checklist + meta. */
  maxActions: 4,
  maxItemsPerAction: 20,
  maxLabel: 80,
  maxTitle: 120,
  maxText: 400,
  /** Teto por despesa proposta. Acima disso o usuário digita à mão. */
  maxAmount: 1_000_000,
  maxBudget: 100_000_000,
  maxGoalTarget: 100_000_000,
} as const;

export const AI_ACTION_TYPES = [
  'itinerary.add',
  'checklist.add',
  'expenses.add',
  'budget.update',
  'goal.add',
] as const;

export type AIActionType = (typeof AI_ACTION_TYPES)[number];

/* --------------------------------- tipos ---------------------------------- */

interface AIActionBase {
  /** Identidade local da proposta. Serve para o estado de "já aplicada". */
  id: string;
  /** Carimbado pelo cliente, nunca pelo modelo. */
  tripId: string;
  label: string;
}

export interface AIItineraryProposalItem {
  title: string;
  date: string;
  startTime?: string;
  endTime?: string;
  type: ItineraryType;
  description?: string;
  placeName?: string;
}

export interface AddItineraryAction extends AIActionBase {
  type: 'itinerary.add';
  items: AIItineraryProposalItem[];
}

export interface AIChecklistProposalItem {
  label: string;
  category: ChecklistCategory;
  priority?: Priority;
  dueDate?: string;
}

export interface AddChecklistAction extends AIActionBase {
  type: 'checklist.add';
  items: AIChecklistProposalItem[];
}

export interface AIExpenseProposalItem {
  description: string;
  category: ExpenseCategory;
  amount: number;
  currency: CurrencyCode;
  transactionDate: string;
  /**
   * `true` = a IA chutou o valor; `false` = o usuário informou o valor na
   * conversa ("minha passagem custou R$ 3.200").
   *
   * **Não é coluna do banco** — `expenses` não tem campo de estimativa, e
   * inventar um no TypeScript criaria um dado que não sobrevive ao INSERT
   * (§19). O sinal vive só na proposta: a tela o usa para rotular, e o executor
   * o converte em algo que o modelo atual comporta — o prefixo
   * `Estimativa — ` na descrição, que é texto de verdade e persiste.
   *
   * O padrão é `true`: na dúvida, é estimativa. Chamar de fato um chute é o
   * erro caro; chamar de estimativa um valor informado só custa um prefixo.
   */
  estimated: boolean;
}

export interface AddExpensesAction extends AIActionBase {
  type: 'expenses.add';
  items: AIExpenseProposalItem[];
}

export interface UpdateBudgetAction extends AIActionBase {
  type: 'budget.update';
  budgetTotal: number;
}

export interface AIGoalProposal {
  title: string;
  goalType: GoalType;
  targetValue: number;
  unit: string;
  deadline?: string;
}

export interface AddGoalAction extends AIActionBase {
  type: 'goal.add';
  goal: AIGoalProposal;
}

export type AITripAction =
  | AddItineraryAction
  | AddChecklistAction
  | AddExpensesAction
  | UpdateBudgetAction
  | AddGoalAction;

/* -------------------------------- schemas --------------------------------- */

const text = (min: number, max: number) => z.string().trim().min(min).max(max);

/**
 * Número utilizável: finito, não-NaN, dentro do teto.
 *
 * `NaN` e `Infinity` sobrevivem a um `typeof === 'number'` e viram `null` no
 * INSERT ou um total impossível na tela — por isso a checagem é explícita, e
 * não uma consequência da versão do zod em uso.
 */
const money = (max: number) =>
  z
    .number()
    .refine((value) => Number.isFinite(value), 'valor não finito')
    .gt(0)
    .max(max);

const isoDate = z.string().refine(isValidISODate, 'data inválida');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const enumOf = <T extends string>(values: readonly T[]) =>
  z.enum(values as unknown as [T, ...T[]]);

/**
 * Campo acessório: valor ruim vira *campo ausente*, não item recusado.
 *
 * A distinção decide o que sobra de uma proposta quase boa. Um item de roteiro
 * sem título ou sem data não é um item — recusar é a única leitura possível.
 * Já "Torre Eiffel, 24 de agosto, às 99:99" é um item legítimo com um horário
 * que o modelo errou: descartá-lo inteiro custaria uma sugestão útil para
 * salvar o usuário de um campo que ele nem veria. O horário some, o item fica,
 * e a revisão mostra o item sem horário — que é exatamente o que se sabe.
 *
 * É o mesmo critério do `aiGrounding.ts`: derruba-se o campo que não se pode
 * sustentar, não o trabalho inteiro.
 */
const loose = <T>(schema: z.ZodType<T>) => schema.optional().catch(undefined);

/** Igual, mas com um valor de repouso — enums que têm um "outro" honesto. */
const looseWithDefault = <T extends string>(values: readonly T[], fallback: T) =>
  enumOf(values).optional().default(fallback).catch(fallback);

const itineraryProposalItemSchema = z.object({
  title: text(2, AI_ACTION_LIMITS.maxTitle),
  date: isoDate,
  startTime: loose(time),
  endTime: loose(time),
  type: looseWithDefault(ITINERARY_TYPES, 'outro'),
  description: loose(text(1, AI_ACTION_LIMITS.maxText)),
  placeName: loose(text(1, 200)),
});

const checklistProposalItemSchema = z.object({
  label: text(2, AI_ACTION_LIMITS.maxTitle),
  category: looseWithDefault(CHECKLIST_CATEGORIES, 'outros'),
  priority: loose(enumOf(['low', 'medium', 'high'] as const)),
  dueDate: loose(isoDate),
});

const expenseProposalItemSchema = z.object({
  description: text(2, AI_ACTION_LIMITS.maxTitle),
  category: looseWithDefault(EXPENSE_CATEGORIES, 'outros'),
  // Valor e data **não** são acessórios: uma despesa sem eles não é despesa.
  amount: money(AI_ACTION_LIMITS.maxAmount),
  transactionDate: isoDate,
  currency: loose(enumOf(CURRENCIES)),
  estimated: z.boolean().optional().default(true).catch(true),
});

const goalProposalSchema = z.object({
  title: text(2, AI_ACTION_LIMITS.maxTitle),
  goalType: looseWithDefault(GOAL_TYPES, 'economia'),
  targetValue: money(AI_ACTION_LIMITS.maxGoalTarget),
  unit: text(1, 20).optional().default('BRL').catch('BRL'),
  deadline: loose(isoDate),
});

const labelSchema = text(2, AI_ACTION_LIMITS.maxLabel);

const DEFAULT_LABEL: Record<AIActionType, string> = {
  'itinerary.add': 'Adicionar ao roteiro',
  'checklist.add': 'Adicionar ao checklist',
  'expenses.add': 'Adicionar às despesas',
  'budget.update': 'Atualizar orçamento',
  'goal.add': 'Criar meta',
};

/* -------------------------------- parsing --------------------------------- */

/**
 * Aproveita os itens válidos e descarta os inválidos, em vez de recusar a
 * proposta inteira: um horário malformado em um item de quatro não deveria
 * custar os outros três. O que não pode acontecer é o item inválido *entrar*.
 */
function collect<T>(raw: unknown, schema: z.ZodType<T>): T[] {
  if (!Array.isArray(raw)) return [];
  const kept: T[] = [];
  for (const entry of raw.slice(0, AI_ACTION_LIMITS.maxItemsPerAction)) {
    const parsed = schema.safeParse(entry);
    if (parsed.success) kept.push(parsed.data);
  }
  return kept;
}

function parseAction(entry: unknown, trip: Trip): AITripAction | null {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const raw = entry as Record<string, unknown>;

  const type = raw.type;
  // Tipo desconhecido é descartado sem cerimônia — inclusive um `trip.delete`
  // que o modelo tenha inventado (§31).
  if (typeof type !== 'string' || !(AI_ACTION_TYPES as readonly string[]).includes(type)) {
    return null;
  }
  const actionType = type as AIActionType;

  const parsedLabel = labelSchema.safeParse(raw.label);
  const base = {
    id: createId(),
    tripId: trip.id,
    label: parsedLabel.success ? parsedLabel.data : DEFAULT_LABEL[actionType],
  };

  switch (actionType) {
    case 'itinerary.add': {
      const items = collect(raw.items, itineraryProposalItemSchema);
      if (items.length === 0) return null;
      return { ...base, type: actionType, items };
    }

    case 'checklist.add': {
      const items = collect(raw.items, checklistProposalItemSchema);
      if (items.length === 0) return null;
      return { ...base, type: actionType, items };
    }

    case 'expenses.add': {
      const items = collect(raw.items, expenseProposalItemSchema).map((item) => ({
        ...item,
        // Moeda ausente é a da viagem — não um palpite. Converter só acontece
        // depois, com cotação real, no executor (§20).
        currency: item.currency ?? trip.budgetCurrency,
      }));
      if (items.length === 0) return null;
      return { ...base, type: actionType, items };
    }

    case 'budget.update': {
      const parsed = money(AI_ACTION_LIMITS.maxBudget).safeParse(raw.budgetTotal);
      if (!parsed.success) return null;
      return { ...base, type: actionType, budgetTotal: parsed.data };
    }

    case 'goal.add': {
      const parsed = goalProposalSchema.safeParse(raw.goal);
      if (!parsed.success) return null;
      return { ...base, type: actionType, goal: parsed.data };
    }
  }
}

/**
 * Converte o que veio da rede em propostas que o Easy Trip aceita discutir.
 *
 * Só isto: converter e descartar. Nada aqui grava, e o retorno ainda **não** é
 * autorização nenhuma — é o que a tela tem permissão para *mostrar*.
 */
export function parseAIActions(raw: unknown, trip: Trip): AITripAction[] {
  if (!Array.isArray(raw)) return [];

  const actions: AITripAction[] = [];
  const seenTypes = new Set<AIActionType>();

  for (const entry of raw) {
    if (actions.length >= AI_ACTION_LIMITS.maxActions) break;
    const action = parseAction(entry, trip);
    if (!action) continue;
    // Uma proposta por tipo. Dois `itinerary.add` na mesma resposta são um
    // modelo se repetindo, e a tela de revisão não teria como distingui-los.
    if (seenTypes.has(action.type)) continue;
    seenTypes.add(action.type);
    actions.push(action);
  }

  return actions;
}

/* ------------------------------- inspeção --------------------------------- */

export function countActionItems(action: AITripAction): number {
  switch (action.type) {
    case 'itinerary.add':
    case 'checklist.add':
    case 'expenses.add':
      return action.items.length;
    case 'budget.update':
    case 'goal.add':
      return 1;
  }
}

/** Linha curta do card: "4 itens de roteiro". */
export function describeAction(action: AITripAction): string {
  switch (action.type) {
    case 'itinerary.add':
      return `${action.items.length} ${action.items.length === 1 ? 'item' : 'itens'} de roteiro`;
    case 'checklist.add':
      return `${action.items.length} ${action.items.length === 1 ? 'item' : 'itens'} de checklist`;
    case 'expenses.add':
      return `${action.items.length} ${action.items.length === 1 ? 'despesa' : 'despesas'}`;
    case 'budget.update':
      return 'Novo orçamento';
    case 'goal.add':
      return 'Nova meta';
  }
}

/* ------------------------------- conferências ------------------------------ */

/**
 * A data proposta cai dentro da viagem?
 *
 * Uma sugestão para 5 de setembro numa viagem que termina em 31 de agosto não é
 * gravada em silêncio: a revisão a marca e a deixa desmarcada, e quem decide
 * mantê-la é o usuário (§21).
 */
export function isWithinTrip(date: string, trip: Trip): boolean {
  if (!isValidISODate(date)) return false;
  return date >= trip.startDate && date <= trip.endDate;
}

/** Sem acento, sem pontuação, sem caixa — para comparar texto escrito por gente. */
export function normalizeForCompare(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Deduplicação **conservadora** (§22).
 *
 * Igual normalizado, ou um contendo o outro com tamanho comparável: "Visitar
 * Museu do Louvre" e "Museu do Louvre" são a mesma coisa; "Louvre" e "Almoço
 * perto do Louvre" não são. Errar para o lado de não marcar é barato — o
 * usuário vê os dois itens e resolve. Errar para o outro lado esconderia uma
 * sugestão legítima atrás de um aviso.
 */
function looksLikeSame(a: string, b: string): boolean {
  const left = normalizeForCompare(a);
  const right = normalizeForCompare(b);
  if (!left || !right) return false;
  if (left === right) return true;

  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  if (shorter.length < 4) return false;
  if (!longer.includes(shorter)) return false;
  return shorter.length / longer.length >= 0.6;
}

export function findItineraryDuplicate(
  item: AIItineraryProposalItem,
  existing: ItineraryItem[],
): ItineraryItem | undefined {
  return existing.find(
    (current) => current.date === item.date && looksLikeSame(current.title, item.title),
  );
}

export function findChecklistDuplicate(
  item: AIChecklistProposalItem,
  existing: ChecklistItem[],
): ChecklistItem | undefined {
  return existing.find((current) => looksLikeSame(current.label, item.label));
}

/**
 * Prefixo que carrega o "isto é um chute" para dentro do modelo atual de
 * despesa, que não tem coluna para isso. Ver `AIExpenseProposalItem.estimated`.
 */
export const ESTIMATE_PREFIX = 'Estimativa — ';

export function describeExpenseDescription(item: AIExpenseProposalItem): string {
  if (!item.estimated) return item.description;
  if (normalizeForCompare(item.description).startsWith(normalizeForCompare(ESTIMATE_PREFIX))) {
    return item.description;
  }
  return `${ESTIMATE_PREFIX}${item.description}`;
}

/* --------------------------- confirmação em texto -------------------------- */

/**
 * A frase é uma confirmação da proposta que já está na tela?
 *
 * O caso que motivou isto: a proposta aparece, a pessoa escreve "pode aplicar",
 * e a frase vira mais uma pergunta ao Gemini — que responde "revise e confirme
 * no aplicativo" sobre uma proposta que ele não tem como reabrir. Duas
 * chamadas pagas, nenhuma gravação, e uma conversa em círculos. Quem sabe qual
 * é a proposta é o cliente, que a tem na mão.
 *
 * A lista é curta e **fechada** de propósito. Ela não interpreta intenção: ela
 * reconhece um punhado de frases inequívocas e curtas. Qualquer coisa mais
 * longa ou ambígua — "pode aplicar, mas troca o horário do Louvre" — não casa,
 * e segue para o modelo, que é quem sabe lidar com um pedido de ajuste.
 *
 * E reconhecer não é aplicar: a tela abre a **revisão**, com os itens à vista.
 * Uma frase de três palavras não é consentimento para gravar às cegas.
 */
const CONFIRMATION_PHRASES = [
  'aprovar',
  'aprovado',
  'aprova',
  'pode aplicar',
  'pode adicionar',
  'pode implementar',
  'pode incluir',
  'aplicar',
  'aplique',
  'implementar',
  'implemente',
  'adicionar',
  'adicione',
  'confirmar',
  'confirma',
  'confirmo',
  'confirmado',
  'sim pode aplicar',
  'sim implemente',
  'sim pode adicionar',
  'sim aplique',
  'sim confirmo',
  'ok pode aplicar',
  'ok aplicar',
  'isso pode aplicar',
  'pode salvar',
  'salvar',
];

/** Teto de tamanho: acima disso a frase carrega pedido, não só confirmação. */
const MAX_CONFIRMATION_WORDS = 4;

export function isApplyConfirmation(text: string): boolean {
  const normalized = normalizeForCompare(text);
  if (!normalized) return false;
  if (normalized.split(' ').length > MAX_CONFIRMATION_WORDS) return false;
  return CONFIRMATION_PHRASES.some((phrase) => normalized === normalizeForCompare(phrase));
}
