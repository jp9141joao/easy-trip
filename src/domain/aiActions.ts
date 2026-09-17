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
import { isValidISODate, todayISO } from '@/lib/date';
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
  /**
   * O texto de uma entrada de diário. Mesmo número do servidor (`LIMITS`).
   *
   * `maxText` (400) é a medida de um item de roteiro; um dia contado em um ou
   * dois parágrafos não cabe nele, e cortar pela metade devolveria à pessoa um
   * registro truncado. `journal_entries.content` é `text` e não impõe teto —
   * então o teto é este.
   */
  maxJournalContent: 1_500,
} as const;

export const AI_ACTION_TYPES = [
  'itinerary.add',
  'checklist.add',
  'expenses.add',
  'budget.update',
  'goal.add',
  'journal.add',
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

/**
 * Uma entrada de diário proposta — os campos REAIS de `journal_entries`.
 *
 * NÃO HÁ TÍTULO, e a ausência é a parte importante. `JournalEntry` tem
 * `entry_date`, `content`, `place_name`, coordenadas e visibilidade; não tem
 * título, e o formulário do Diário também não pede um. Um campo `title` aqui
 * seria um dado que a IA produz, a revisão mostra e o INSERT joga fora — a
 * mesma armadilha que a nota de `estimated` descreve para a despesa.
 *
 * Coordenadas ficam de fora por outro motivo: latitude e longitude são o que o
 * aparelho MEDIU quando a pessoa estava lá. Um modelo que as preenchesse
 * estaria afirmando uma presença física que não houve.
 */
export interface AIJournalProposal {
  entryDate: string;
  content: string;
  placeName?: string;
  /**
   * A data ainda não chegou — então isto é um PLANO, não um relato.
   *
   * `true` = a entrada descreve um dia que ainda está por vir; `false` = a
   * data já passou.
   *
   * **Não vem do modelo e não é coluna do banco.** É derivado aqui, de
   * `entryDate` contra o hoje do fuso da viagem, justamente porque um modelo
   * que se declarasse "retrospectivo" seria acreditado. A distinção existe
   * porque um diário afirma vivência: "visitei o Fushimi Inari" escrito antes
   * da viagem é uma memória que ninguém teve.
   *
   * Como `estimated` na despesa, o sinal vive só na proposta — a tela o usa
   * para rotular, e o executor o converte no que o modelo de dados comporta:
   * o prefixo `Planejado — ` no texto, que persiste (§19 do contrato de
   * despesas, mesmo raciocínio).
   */
  planned: boolean;
}

export interface AddJournalAction extends AIActionBase {
  type: 'journal.add';
  journal: AIJournalProposal;
}

export type AITripAction =
  | AddItineraryAction
  | AddChecklistAction
  | AddExpensesAction
  | UpdateBudgetAction
  | AddGoalAction
  | AddJournalAction;

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

/**
 * Só os três campos que a tabela guarda. Nada de `title`, nada de coordenada.
 *
 * `planned` **não** está aqui de propósito: ele não vem da rede. É derivado
 * depois, em `parseAction`, comparando a data com o hoje da viagem — um modelo
 * que se declarasse retrospectivo não pode ser acreditado sobre isso.
 */
const journalProposalSchema = z.object({
  entryDate: isoDate,
  content: text(2, AI_ACTION_LIMITS.maxJournalContent),
  placeName: loose(text(1, 200)),
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
  'journal.add': 'Adicionar ao diário',
};

/**
 * A data ainda não chegou?
 *
 * Comparação de string ISO, que ordena como data — e o `today` recebido é o do
 * fuso do DESTINO, não o do aparelho: alguém em São Paulo planejando o dia 18
 * em Tóquio está atrás do calendário do lugar sobre o qual escreve.
 *
 * O dia de HOJE conta como planejado. Às nove da manhã, "hoje" ainda é quase
 * todo futuro, e chamar de relato o que não aconteceu é o erro que importa
 * evitar; o inverso custa um rótulo a mais.
 */
export function isPlannedEntryDate(entryDate: string, today: string): boolean {
  if (!isValidISODate(entryDate) || !isValidISODate(today)) return true;
  return entryDate >= today;
}

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

function parseAction(entry: unknown, trip: Trip, today: string): AITripAction | null {
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
      const items = dedupeExpenses(
        collect(raw.items, expenseProposalItemSchema).map((item) => ({
          ...item,
          // Moeda ausente é a da viagem — não um palpite. Converter só acontece
          // depois, com cotação real, no executor (§20).
          currency: item.currency ?? trip.budgetCurrency,
        })),
      );
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

    case 'journal.add': {
      // `journal` é o campo do contrato; `items[0]` é a mesma tolerância que o
      // servidor tem, para o caso de o modelo repetir a forma dos outros tipos.
      const payload =
        raw.journal ?? (Array.isArray(raw.items) ? raw.items[0] : undefined);
      const parsed = journalProposalSchema.safeParse(payload);
      if (!parsed.success) return null;
      return {
        ...base,
        type: actionType,
        journal: {
          ...parsed.data,
          // Derivado, nunca lido do payload: ver `AIJournalProposal.planned`.
          planned: isPlannedEntryDate(parsed.data.entryDate, today),
        },
      };
    }
  }
}

/**
 * Duas linhas idênticas na MESMA proposta são o modelo se repetindo (§15).
 *
 * O critério é exato — mesma descrição normalizada, mesma data, mesmo valor —
 * e não o `looksLikeSame` do roteiro. Dois almoços de ¥ 1.500 no dia 18 podem
 * ser dois almoços de verdade; "Almoço" e "Almoço" com o mesmo centavo no mesmo
 * dia é uma repetição. Errar para o lado de manter as duas é barato: a revisão
 * mostra as duas e a pessoa desmarca uma.
 *
 * Isto NÃO compara com as despesas já gravadas na viagem — quem faz esse
 * recorte é o contexto enviado ao modelo (regra 20 do prompt) e, na tela, a
 * revisão. Uma varredura de duplicata contra o banco inteiro é o "sistema
 * enorme" que o §15 pede para não construir.
 */
function dedupeExpenses(items: AIExpenseProposalItem[]): AIExpenseProposalItem[] {
  const seen = new Set<string>();
  const kept: AIExpenseProposalItem[] = [];
  for (const item of items) {
    const key = `${normalizeForCompare(item.description)}|${item.transactionDate}|${item.amount}|${item.currency}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(item);
  }
  return kept;
}

/**
 * Converte o que veio da rede em propostas que o Easy Trip aceita discutir.
 *
 * Só isto: converter e descartar. Nada aqui grava, e o retorno ainda **não** é
 * autorização nenhuma — é o que a tela tem permissão para *mostrar*.
 */
export function parseAIActions(
  raw: unknown,
  trip: Trip,
  /**
   * O hoje do DESTINO, `AAAA-MM-DD` — o mesmo `trip.today` que vai no contexto
   * do modelo. Só o diário o usa, para separar plano de relato.
   *
   * O padrão é a data do aparelho: serve a testes e a qualquer chamador que
   * não tenha o fuso à mão, e erra no máximo por um dia — para o lado de
   * chamar de planejado o que já passou, que é o lado inofensivo.
   */
  today: string = todayISO(),
): AITripAction[] {
  if (!Array.isArray(raw)) return [];

  const actions: AITripAction[] = [];
  const seenTypes = new Set<AIActionType>();

  for (const entry of raw) {
    if (actions.length >= AI_ACTION_LIMITS.maxActions) break;
    const action = parseAction(entry, trip, today);
    if (!action) continue;
    // Uma proposta por tipo. Dois `itinerary.add` na mesma resposta são um
    // modelo se repetindo, e a tela de revisão não teria como distingui-los.
    if (seenTypes.has(action.type)) continue;
    seenTypes.add(action.type);
    actions.push(action);
  }

  return actions;
}

/* ------------------------ coerência texto×proposta ------------------------ */

/**
 * Frases que prometem uma proposta ou um controle de aplicação na tela.
 *
 * A Edge Function aplica a mesma regra antes de responder, mas o cliente
 * precisa repeti-la depois de `parseAIActions`: a Function publicada pode estar
 * atrasada em relação ao aplicativo e, mesmo numa resposta nova, uma action
 * pode passar pela validação do servidor e ser recusada pela validação local.
 * Em ambos os casos, contar o array cru deixaria o texto prometer um card que
 * este cliente não tem como renderizar.
 */
const ACTION_PROMISE_PATTERNS = [
  /\b(revise|revisar)\b/i,
  /\b(confirme|confirmar|confirma)\b/i,
  /\b(toque|clique)\b[^.!?\n]{0,60}\b(implementar|aplicar|adicionar)\b/i,
  /\bbot(ão|ao)\b[^.!?\n]{0,40}\b(implementar|aplicar|revisar)\b/i,
  /\bpreparei\b[^.!?\n]{0,40}\b(a )?(proposta|sugest(?:ão|ao|ões|oes|\w*))\b/i,
  /\b(proposta|sugest(?:ão|ao|ões|oes|\w*))\b[^.!?\n]{0,40}\babaixo\b/i,
  /\b(adicione|adicionar|aplique|aplicar|implemente|implementar)\b[^.!?\n]{0,40}\babaixo\b/i,
  /\bse quiser\b[^.!?\n]{0,30}\b(aplico|adiciono|implemento|incluo)\b/i,
  /\bposso (adicionar|aplicar|implementar|registrar|incluir)\b/i,
  /*
   * O SUBSTANTIVO ESCAPAVA — e era exatamente o que o modelo escrevia.
   *
   * "A proposta está pronta para revisão e aplicação." passou intacta no
   * aparelho, com zero actions: `revise|revisar` pega o verbo, e o texto
   * trazia o SUBSTANTIVO. Não foi azar de redação. O system prompt manda
   * escrever que "a proposta está pronta para revisão" — então esta é a frase
   * mais provável do fluxo, e era a única que o filtro não via.
   *
   * Sem action, "revisão", "aplicação", "aplicar" e "implementar" apontam
   * todos para um controle que não existe na tela.
   */
  /\brevis(?:ão|ao|ões|oes)\b/i,
  /\baplica(?:ção|cao|ções|coes)\b/i,
  /\b(implementar|implemente|implemento|aplicar|aplique|aplico)\b/i,
  /\bpropost[ao]\b[^.!?\n]{0,40}\bpront[ao]\b/i,
  /\bpront[ao]\b[^.!?\n]{0,40}\b(propost|sugest|roteiro)/i,
  /*
   * Espelho das linhas equivalentes do servidor: a promessa que se nomeia pelo
   * CONTEÚDO ("preparei um diário", "montei as despesas") não usa as palavras
   * "proposta" nem "sugestão", e com zero actions aponta para um card ausente.
   * Os verbos de execução vêm junto porque afirmam uma gravação que não houve.
   */
  /\b(preparei|montei|escrevi|criei|gerei|deixei|fiz)\b[^.!?\n]{0,40}\b(di(?:á|a)rio|entrada de di(?:á|a)rio|registro)\b/i,
  /\b(preparei|montei|criei|gerei|lancei|lan(?:ç|c)ei|listei|fiz)\b[^.!?\n]{0,40}\b(despesas?|gastos?|previs(?:ão|ao) de (?:despesas?|gastos?))\b/i,
  /*
   * A promessa com o substantivo do ROTEIRO — a que aparece quando uma
   * consulta é respondida com um dia montado e o portão de intenção descarta
   * a proposta. Sem esta linha, "preparei 5 atividades para o dia 18" fica no
   * histórico apontando para um cartão que não existe.
   *
   * Exige um verbo de PRODUÇÃO: "você possui 7 atividades no dia 18" descreve
   * o que já existe, não casa aqui, e é a resposta certa para uma consulta.
   */
  /\b(preparei|montei|criei|gerei|organizei|planejei|fiz|deixei)\b[^.!?\n]{0,40}\b(atividades?|paradas?|roteiro|itiner(?:á|a)rio|programa(?:ç|c)(?:ão|ao)|checklist|itens?|metas?|or(?:ç|c)amento)\b/i,
  /*
   * "abaixo" NÃO entra aqui, e a ausência é deliberada.
   *
   * "Suas despesas estão abaixo do orçamento" é a resposta CERTA para "estou
   * gastando demais?" — uma pergunta de leitura, que corretamente não traz
   * action. Um padrão com "abaixo" apagaria justamente a resposta boa. A frase
   * que promete um card ("a proposta abaixo") já é pega pelo padrão de
   * `proposta|sugestão` acima, que exige o substantivo.
   */
  /\b(di(?:á|a)rio|despesas?|gastos?)\b[^.!?\n]{0,40}\bpront[ao]s?\b/i,
];

/**
 * A FRASE QUE NEGA A PROPOSTA É O OPOSTO DE UMA PROMESSA — e não pode ser cortada.
 *
 * "Não consegui montar um roteiro completo — o que segue é só o que tenho, sem
 * proposta para aplicar." contém "aplicar", e por isso caía no filtro assim que
 * os verbos soltos entraram. Cortá-la seria remover justamente a honestidade
 * que `discloseIncompleteItinerary` acabou de acrescentar, e devolver a pessoa
 * ao texto genérico.
 *
 * A distinção não é de vocabulário, é de sinal: prometer aplicação e declarar
 * que não há o que aplicar usam as mesmas palavras. Esta guarda lê o sinal.
 */
const HONEST_ABSENCE = [
  /\bn(?:ão|ao)\s+(?:consegui|foi poss(?:í|i)vel|tenho|h(?:á|a)|existe|existem)\b/i,
  /\bsem\s+(?:proposta|sugest(?:ão|ao)|nada)\b/i,
  /\bnada\s+(?:para|pra)\s+(?:aplicar|implementar|revisar|adicionar)\b/i,
  /\bn(?:ão|ao)\s+(?:cheguei|montei|produzi)\b/i,
];

/** A frase declara ausência de proposta? Então ela FICA. */
function declaresAbsence(sentence: string): boolean {
  return HONEST_ABSENCE.some((pattern) => pattern.test(sentence));
}

function splitActionPromiseSentences(line: string): string[] {
  return (line.match(/[^.!?]+[.!?]?/g) ?? []).map((sentence) => sentence.trim()).filter(Boolean);
}

/**
 * Um marcador de lista sem texto — "- ", "* ", "1. " — e mais nada.
 *
 * É o resíduo que sobra quando o corte de promessas leva embora o conteúdo de
 * um item de lista. Renderizado pelo `Markdown`, vira uma bolha com um "•"
 * solto: o defeito visto no Android (§4 do handoff).
 */
function isBareListMarker(line: string): boolean {
  return /^\s*(?:[-*+]|\d{1,3}[.)])\s*$/.test(line);
}

/**
 * Tem alguma coisa para a pessoa LER?
 *
 * Letra ou dígito. Pontuação sozinha — um traço, um bullet, dois pontos — não
 * é resposta, e uma bolha com isso dentro fica no histórico sem dizer nada.
 */
export function hasRenderableText(content: string | undefined | null): boolean {
  if (typeof content !== 'string') return false;
  return /[\p{L}\p{N}]/u.test(content);
}

/**
 * Garante que o texto persistido só prometa revisão/aplicação quando uma
 * action **validada pelo cliente** existe na mesma resposta.
 *
 * Não tenta fabricar uma action a partir do texto. Remove apenas as frases que
 * fariam referência a um card inexistente e preserva o restante da resposta.
 */
export function enforceAIActionPromiseCoherence(
  content: string,
  validActionCount: number,
): { content: string; stripped: number } {
  if (validActionCount > 0) return { content, stripped: 0 };

  /*
   * Linha a linha, como no servidor (`supabase/functions/ai-chat/protocol.ts`).
   *
   * Juntar tudo com espaço achatava a resposta inteira num parágrafo — o
   * roteiro perdia a lista — e deixava para trás o marcador de um item cujo
   * texto tinha sido cortado. Uma linha "- " vira uma bolha com um "•" e nada
   * mais, que é exatamente o que apareceu no aparelho.
   */
  let stripped = 0;
  const linhas: string[] = [];

  for (const linha of content.split('\n')) {
    if (linha.trim().length === 0) {
      linhas.push('');
      continue;
    }

    const sentences = splitActionPromiseSentences(linha);
    const kept = sentences.filter(
      (sentence) =>
        declaresAbsence(sentence) ||
        !ACTION_PROMISE_PATTERNS.some((pattern) => pattern.test(sentence)),
    );
    stripped += sentences.length - kept.length;

    const rebuilt = kept.join(' ').replace(/[ \t]+/g, ' ').trimEnd();
    if (rebuilt.trim().length === 0 || isBareListMarker(rebuilt)) continue;
    linhas.push(rebuilt);
  }

  if (stripped === 0) return { content, stripped: 0 };

  const rebuilt = linhas.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (hasRenderableText(rebuilt)) return { content: rebuilt, stripped };

  return {
    content:
      'Não consegui montar uma proposta aplicável com o que tenho aqui. ' +
      'Me diga a data e os lugares (ou o valor, no caso de um gasto) e eu preparo.',
    stripped,
  };
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
    case 'journal.add':
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
    case 'journal.add':
      return action.journal.planned ? 'Registro planejado' : 'Nova entrada de diário';
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

/**
 * O mesmo mecanismo do `ESTIMATE_PREFIX`, para o diário.
 *
 * `journal_entries` não tem coluna para "isto ainda não aconteceu", e criar uma
 * exigiria migration — que o §30 do pedido proíbe e que, de todo modo, seria
 * uma coluna nova no banco para carregar um aviso. O aviso é texto, e texto é o
 * que a tabela guarda.
 *
 * A linha entra ANTES do conteúdo e sobrevive à edição na revisão: quem reler a
 * entrada em dezembro precisa saber que ela foi escrita em setembro, sobre um
 * dia que ainda não tinha chegado.
 */
export const PLANNED_JOURNAL_PREFIX = 'Planejado — ';

export function describeJournalContent(journal: AIJournalProposal): string {
  if (!journal.planned) return journal.content;
  if (normalizeForCompare(journal.content).startsWith(normalizeForCompare(PLANNED_JOURNAL_PREFIX))) {
    return journal.content;
  }
  return `${PLANNED_JOURNAL_PREFIX}${journal.content}`;
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
  'sim',
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
