/**
 * O único lugar onde uma proposta da IA vira registro.
 *
 * Fica fora da tela de propósito. A `advisor.tsx` renderiza, revisa, confirma e
 * mostra o resultado; ela não sabe como se grava um item de roteiro, e um
 * `switch` gigante dentro dela seria a forma mais rápida de a regra de
 * autorização acabar espalhada por JSX.
 *
 * O QUE ESTA CAMADA GARANTE
 *
 *  1. **A viagem confere.** Toda ação carrega o `tripId` carimbado quando a
 *     proposta chegou. Aqui ele é comparado com a viagem que está sendo
 *     gravada agora. Uma proposta feita na conversa de Paris não entra em
 *     Tóquio — nem por engano, nem por payload forjado (§14).
 *  2. **Nada de `service_role`.** A gravação usa o `DataSource` da própria
 *     sessão. Em produção é o `SupabaseDataSource`, e quem autoriza de verdade
 *     é a RLS, no banco. O Gemini não escreve; o usuário escreve, com a
 *     permissão que ele já tinha (§13, §30).
 *  3. **Falha parcial é relatada, não escondida.** Não há transação que cubra
 *     roteiro + despesa + checklist nos dois adaptadores, então o relatório diz
 *     item a item o que entrou e o que não entrou. "Plano implementado" quando
 *     metade falhou é a mentira que este formato de retorno impede (§9, §24).
 *
 * O QUE ESTA CAMADA NÃO FAZ
 *
 * Não exclui, não edita registro existente, não toca em perfil, papel,
 * documento, arquivo, ticket, seguro ou outra viagem. Não porque haja um `if`
 * proibindo — porque `AITripAction` não consegue expressar nenhuma dessas
 * coisas.
 */

import {
  countActionItems,
  describeExpenseDescription,
  type AITripAction,
  type AIActionType,
} from '@/domain/aiActions';
import type { Trip } from '@/domain/types';
import { DEFAULT_VISIBILITY, type Visibility } from '@/domain/visibility';
import { formatMoney } from '@/lib/currency';
import { isValidISODate } from '@/lib/date';
import { dataSource as defaultDataSource } from '@/repositories';
import type { DataSource } from '@/repositories/types';
import { buildExpenseRecord } from './expenseWrite';

export interface AIActionContext {
  trip: Trip;
  userId: string;
  /** Injetável para teste; em produção é sempre o adaptador da sessão. */
  source?: DataSource;
  /**
   * Quem vê o que a IA acabou de criar (§16).
   *
   * Escolhido na folha de revisão, por tipo de conteúdo. Ausente = os defaults
   * do domínio, que já são os certos: roteiro e checklist compartilhados,
   * despesa privada. A folha só oferece a escolha quando a viagem tem mais de
   * um viajante — numa viagem individual as duas opções são a mesma coisa.
   */
  visibility?: {
    itinerary?: Visibility;
    checklist?: Visibility;
    expense?: Visibility;
  };
}

/** Um registro que este executor criou — a matéria-prima do "Desfazer". */
export interface AICreatedRecord {
  kind: 'itinerary' | 'checklist' | 'expense' | 'goal';
  id: string;
}

export interface AIActionFailure {
  label: string;
  reason: string;
}

export interface AIActionOutcome {
  actionId: string;
  type: AIActionType;
  ok: boolean;
  succeeded: number;
  failed: AIActionFailure[];
  /** Frase exibida ao usuário: "4 itens adicionados ao roteiro". */
  summary: string;
}

export interface AIActionReport {
  outcomes: AIActionOutcome[];
  created: AICreatedRecord[];
  /** Tudo que foi tentado entrou. */
  ok: boolean;
  /** Algo entrou e algo falhou — o caso que nunca pode virar "Sucesso!". */
  partial: boolean;
  /**
   * O "Desfazer" pode ser oferecido?
   *
   * Só quando tudo que a execução produziu foram registros *novos*, cujos ids
   * conhecemos. Uma atualização de orçamento altera um registro que já existia,
   * e desfazê-la seria escrever por cima de um valor que pode ter mudado desde
   * então — então ela simplesmente não vem com "Desfazer" (§23).
   */
  undoable: boolean;
}

const EMPTY_REPORT: AIActionReport = {
  outcomes: [],
  created: [],
  ok: true,
  partial: false,
  undoable: false,
};

/** Mensagem curta para o usuário; `null` quando a ação está apta a gravar. */
function rejectionReason(action: AITripAction, trip: Trip): string | null {
  if (action.tripId !== trip.id) {
    return 'Esta sugestão foi feita para outra viagem.';
  }

  switch (action.type) {
    case 'itinerary.add':
      return action.items.every((item) => isValidISODate(item.date))
        ? null
        : 'Há datas inválidas na sugestão.';
    case 'expenses.add':
      return action.items.every(
        (item) =>
          isValidISODate(item.transactionDate) && Number.isFinite(item.amount) && item.amount > 0,
      )
        ? null
        : 'Há valores ou datas inválidos na sugestão.';
    case 'budget.update':
      return Number.isFinite(action.budgetTotal) && action.budgetTotal > 0
        ? null
        : 'O novo orçamento não é um valor válido.';
    case 'goal.add':
      return Number.isFinite(action.goal.targetValue) && action.goal.targetValue > 0
        ? null
        : 'A meta não tem um valor válido.';
    case 'checklist.add':
      return action.items.length > 0 ? null : 'Não há itens para adicionar.';
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Não foi possível gravar.';
}

function pluralItems(count: number): string {
  return count === 1 ? '1 item' : `${count} itens`;
}

/* ------------------------------ execução ---------------------------------- */

async function runItinerary(
  action: Extract<AITripAction, { type: 'itinerary.add' }>,
  ctx: Required<AIActionContext>,
  created: AICreatedRecord[],
): Promise<AIActionOutcome> {
  const existing = await ctx.source.itinerary.listByTrip(ctx.trip.id);
  // A ordem dentro do dia continua sendo do domínio: cada item novo entra
  // depois do que já estava naquela data.
  const nextOrder = new Map<string, number>();
  for (const item of existing) {
    nextOrder.set(item.date, Math.max(nextOrder.get(item.date) ?? 0, item.sortOrder + 1));
  }

  const failed: AIActionFailure[] = [];
  let succeeded = 0;

  for (const item of action.items) {
    const sortOrder = nextOrder.get(item.date) ?? 0;
    try {
      const record = await ctx.source.itinerary.create({
        tripId: ctx.trip.id,
        date: item.date,
        startTime: item.startTime,
        endTime: item.endTime,
        type: item.type,
        title: item.title,
        description: item.description,
        placeName: item.placeName,
        completed: false,
        sortOrder,
        visibility: ctx.visibility?.itinerary ?? DEFAULT_VISIBILITY.itinerary,
      });
      created.push({ kind: 'itinerary', id: record.id });
      nextOrder.set(item.date, sortOrder + 1);
      succeeded += 1;
    } catch (error) {
      failed.push({ label: item.title, reason: describeError(error) });
    }
  }

  return {
    actionId: action.id,
    type: action.type,
    ok: failed.length === 0,
    succeeded,
    failed,
    summary: `${pluralItems(succeeded)} ${succeeded === 1 ? 'adicionado' : 'adicionados'} ao roteiro`,
  };
}

async function runChecklist(
  action: Extract<AITripAction, { type: 'checklist.add' }>,
  ctx: Required<AIActionContext>,
  created: AICreatedRecord[],
): Promise<AIActionOutcome> {
  const failed: AIActionFailure[] = [];
  let succeeded = 0;

  for (const item of action.items) {
    try {
      const record = await ctx.source.checklist.create({
        tripId: ctx.trip.id,
        label: item.label,
        category: item.category,
        priority: item.priority,
        dueDate: item.dueDate,
        completed: false,
        visibility: ctx.visibility?.checklist ?? DEFAULT_VISIBILITY.checklist,
      });
      created.push({ kind: 'checklist', id: record.id });
      succeeded += 1;
    } catch (error) {
      failed.push({ label: item.label, reason: describeError(error) });
    }
  }

  return {
    actionId: action.id,
    type: action.type,
    ok: failed.length === 0,
    succeeded,
    failed,
    summary: `${pluralItems(succeeded)} ${succeeded === 1 ? 'adicionado' : 'adicionados'} ao checklist`,
  };
}

async function runExpenses(
  action: Extract<AITripAction, { type: 'expenses.add' }>,
  ctx: Required<AIActionContext>,
  created: AICreatedRecord[],
): Promise<AIActionOutcome> {
  const failed: AIActionFailure[] = [];
  let succeeded = 0;
  /** Só soma o que está na moeda do orçamento — o resto não tem soma honesta. */
  let totalInBudgetCurrency = 0;

  for (const item of action.items) {
    try {
      const record = await ctx.source.expenses.create(
        await buildExpenseRecord(ctx.trip, ctx.userId, {
          // O "isto é uma estimativa" viaja na descrição porque é onde o modelo
          // de dados atual comporta essa informação (§19).
          description: describeExpenseDescription(item),
          category: item.category,
          amount: item.amount,
          currency: item.currency,
          transactionDate: item.transactionDate,
          visibility: ctx.visibility?.expense ?? DEFAULT_VISIBILITY.expense,
        }),
      );
      created.push({ kind: 'expense', id: record.id });
      totalInBudgetCurrency += record.amountInBudgetCurrency ?? 0;
      succeeded += 1;
    } catch (error) {
      failed.push({ label: item.description, reason: describeError(error) });
    }
  }

  const total = formatMoney(totalInBudgetCurrency, ctx.trip.budgetCurrency);
  return {
    actionId: action.id,
    type: action.type,
    ok: failed.length === 0,
    succeeded,
    failed,
    summary:
      succeeded === 0
        ? 'Nenhuma despesa adicionada'
        : `${total} em ${succeeded === 1 ? 'despesa adicionada' : 'despesas adicionadas'}`,
  };
}

async function runBudget(
  action: Extract<AITripAction, { type: 'budget.update' }>,
  ctx: Required<AIActionContext>,
): Promise<AIActionOutcome> {
  try {
    await ctx.source.trips.update(ctx.trip.id, { budgetTotal: action.budgetTotal });
    return {
      actionId: action.id,
      type: action.type,
      ok: true,
      succeeded: 1,
      failed: [],
      summary: `Orçamento atualizado para ${formatMoney(action.budgetTotal, ctx.trip.budgetCurrency)}`,
    };
  } catch (error) {
    return {
      actionId: action.id,
      type: action.type,
      ok: false,
      succeeded: 0,
      failed: [{ label: 'Orçamento', reason: describeError(error) }],
      summary: 'Orçamento não foi atualizado',
    };
  }
}

async function runGoal(
  action: Extract<AITripAction, { type: 'goal.add' }>,
  ctx: Required<AIActionContext>,
  created: AICreatedRecord[],
): Promise<AIActionOutcome> {
  try {
    const record = await ctx.source.goals.create({
      userId: ctx.userId,
      // A meta nasce vinculada à viagem da conversa — `Goal.tripId` já existe
      // no domínio, então não há integração artificial a inventar (§3-E).
      tripId: ctx.trip.id,
      type: action.goal.goalType,
      title: action.goal.title,
      targetValue: action.goal.targetValue,
      currentValue: 0,
      unit: action.goal.unit,
      status: 'active',
      deadline: action.goal.deadline,
    });
    created.push({ kind: 'goal', id: record.id });
    return {
      actionId: action.id,
      type: action.type,
      ok: true,
      succeeded: 1,
      failed: [],
      summary: `Meta "${action.goal.title}" criada`,
    };
  } catch (error) {
    return {
      actionId: action.id,
      type: action.type,
      ok: false,
      succeeded: 0,
      failed: [{ label: action.goal.title, reason: describeError(error) }],
      summary: 'Meta não foi criada',
    };
  }
}

/**
 * Aplica as ações já revisadas e confirmadas pelo usuário.
 *
 * Recebe as ações **como a revisão as deixou** — itens desmarcados já saíram,
 * edições já entraram. Ainda assim tudo é conferido de novo aqui: a tela é
 * quem monta a lista, e uma camada que grava não confia em quem a chama.
 */
export async function executeAIActions(
  actions: AITripAction[],
  context: AIActionContext,
): Promise<AIActionReport> {
  if (actions.length === 0) return EMPTY_REPORT;

  const ctx: Required<AIActionContext> = {
    trip: context.trip,
    userId: context.userId,
    source: context.source ?? defaultDataSource,
    visibility: context.visibility ?? {},
  };

  const outcomes: AIActionOutcome[] = [];
  const created: AICreatedRecord[] = [];
  let touchedExistingRecord = false;

  for (const action of actions) {
    if (countActionItems(action) === 0) continue;

    const rejection = rejectionReason(action, ctx.trip);
    if (rejection) {
      outcomes.push({
        actionId: action.id,
        type: action.type,
        ok: false,
        succeeded: 0,
        failed: [{ label: action.label, reason: rejection }],
        summary: rejection,
      });
      continue;
    }

    switch (action.type) {
      case 'itinerary.add':
        outcomes.push(await runItinerary(action, ctx, created));
        break;
      case 'checklist.add':
        outcomes.push(await runChecklist(action, ctx, created));
        break;
      case 'expenses.add':
        outcomes.push(await runExpenses(action, ctx, created));
        break;
      case 'budget.update':
        touchedExistingRecord = true;
        outcomes.push(await runBudget(action, ctx));
        break;
      case 'goal.add':
        outcomes.push(await runGoal(action, ctx, created));
        break;
    }
  }

  const anySucceeded = outcomes.some((outcome) => outcome.succeeded > 0);
  const anyFailed = outcomes.some((outcome) => !outcome.ok);

  return {
    outcomes,
    created,
    ok: !anyFailed,
    partial: anySucceeded && anyFailed,
    undoable: created.length > 0 && !touchedExistingRecord,
  };
}

/**
 * Remove **apenas** os registros que a execução acabou de criar.
 *
 * Nenhuma busca por semelhança, nenhuma varredura por data: a lista de ids é a
 * que o próprio executor devolveu. Um "Desfazer" que procurasse "os itens
 * parecidos com os que adicionei" acabaria apagando algo que o usuário já
 * tinha, e é exatamente esse tipo de undo frágil que a §23 proíbe.
 */
export async function undoAIActions(
  report: AIActionReport,
  context: AIActionContext,
): Promise<{ removed: number; failed: number }> {
  const source = context.source ?? defaultDataSource;
  let removed = 0;
  let failed = 0;

  for (const record of report.created) {
    try {
      switch (record.kind) {
        case 'itinerary':
          await source.itinerary.remove(record.id);
          break;
        case 'checklist':
          await source.checklist.remove(record.id);
          break;
        case 'expense':
          await source.expenses.remove(record.id);
          break;
        case 'goal':
          await source.goals.remove(record.id);
          break;
      }
      removed += 1;
    } catch {
      failed += 1;
    }
  }

  return { removed, failed };
}

/** Linhas do resultado, na forma que a tela mostra: ✓ o que entrou, ⚠ o que não. */
export function summarizeReport(report: AIActionReport): { tone: 'success' | 'warning' | 'error'; lines: string[] }[] {
  return report.outcomes.map((outcome) => ({
    tone: outcome.ok ? 'success' : outcome.succeeded > 0 ? 'warning' : 'error',
    lines: [
      outcome.summary,
      ...outcome.failed.map((failure) => `${failure.label}: ${failure.reason}`),
    ],
  }));
}
