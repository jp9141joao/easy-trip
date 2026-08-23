/**
 * Easy Trip IA (§47–§50).
 *
 * The assistant is a *contextual concierge*, not a generic chatbot: the caller
 * always supplies the active trip's real data.
 *
 * Two implementations (§118):
 *  - `RemoteAIService` — posts to the BFF, which holds GEMINI_API_KEY and calls
 *    Gemini server-side. The key never enters the bundle (§49, CA-06).
 *  - `LocalAIService` — no Gemini call at all. It answers from the trip's real
 *    numbers and labels every reply as locally generated, so the UI never
 *    implies a model responded (§1, §100).
 */

import type {
  AIMessage,
  ChecklistItem,
  CurrencyCode,
  Expense,
  ItineraryItem,
  Place,
  Profile,
  Trip,
  TripStatus,
} from '@/domain/types';
import { config } from '@/lib/config';
import { formatMoney } from '@/lib/currency';
import { formatShortDate, formatWeekdayDate } from '@/lib/date';
import {
  CHECKLIST_CATEGORY_LABEL,
  EXPENSE_CATEGORY_LABEL,
  ITINERARY_TYPE_LABEL,
} from '@/lib/labels';
import { postJson, ServiceError } from './http';
import { getZoneDate } from './timezone';

/** Structured context handed to the model (§47). */
export interface AITripContext {
  trip: {
    destinationCity: string;
    destinationCountry: string;
    startDate: string;
    endDate: string;
    status: TripStatus;
    daysUntil: number;
    budgetTotal: number;
    totalSpent: number;
    remainingBudget: number;
    currency: CurrencyCode;
    timezone: string;
    /**
     * A data de hoje **no destino**, `YYYY-MM-DD`.
     *
     * Sem ela o modelo não tem como resolver "amanhã" — e um assistente que
     * chuta a data de hoje coloca o item no dia errado com toda a confiança do
     * mundo. Vai no contexto, e não no prompt do sistema, porque muda a cada
     * pergunta (§21).
     */
    today: string;
  };
  expenses: { category: string; amount: number; currency: string; date: string; description: string }[];
  itinerary: { date: string; time?: string; type: string; title: string; placeName?: string }[];
  checklist: { label: string; category: string; completed: boolean }[];
  profile: { travelStyle?: string; defaultCurrency: string };
  places?: { name: string; type: string; rating?: number }[];
}

export interface AIReply {
  content: string;
  /** True when produced locally instead of by Gemini — surfaced as a badge. */
  local: boolean;
  /**
   * Propostas estruturadas, **ainda cruas**.
   *
   * Deliberadamente `unknown[]`: este serviço não conhece `Trip`, e é por isso
   * que ele não tem como carimbar o vínculo com a viagem. Quem valida e carimba
   * é `parseAIActions`, no cliente, com a viagem em que a conversa está — ver
   * `src/domain/aiActions.ts`. Enquanto o valor está aqui, ele é só o que
   * chegou pela rede: nada que tenha passado por este campo tem autorização
   * nenhuma.
   */
  actions: unknown[];
}

export interface AIService {
  readonly kind: 'gemini' | 'local';
  send(params: {
    prompt: string;
    context: AITripContext | null;
    history: AIMessage[];
    accessToken?: string;
  }): Promise<AIReply>;
}

/* ------------------------------ remote (BFF) ------------------------------ */

class RemoteAIService implements AIService {
  readonly kind = 'gemini' as const;

  async send({
    prompt,
    context,
    history,
    accessToken,
  }: {
    prompt: string;
    context: AITripContext | null;
    history: AIMessage[];
    accessToken?: string;
  }): Promise<AIReply> {
    const response = await postJson<{ content?: string; actions?: unknown; error?: string }>(
      `${config.bffUrl.replace(/\/$/, '')}/ai-chat`,
      {
        prompt,
        context,
        // Only the recent turns travel — the BFF caps and sanitises anyway.
        history: history.slice(-12).map(({ role, content }) => ({ role, content })),
      },
      { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} },
    );

    if (!response.content) {
      throw new ServiceError('parse', response.error ?? 'O assistente não retornou resposta.');
    }
    return {
      content: response.content,
      local: false,
      actions: Array.isArray(response.actions) ? response.actions : [],
    };
  }
}

/* ------------------------------- local mode ------------------------------- */

const LOCAL_NOTICE =
  '_Resposta gerada localmente pelo Easy Trip a partir dos dados reais da sua viagem. ' +
  'O assistente Gemini fica disponível quando o backend está configurado._';

/**
 * Answers from the trip's own numbers. It never claims to be Gemini and never
 * invents facts about the destination — it reports what the app actually knows.
 */
class LocalAIService implements AIService {
  readonly kind = 'local' as const;

  async send({ prompt, context }: { prompt: string; context: AITripContext | null }): Promise<AIReply> {
    if (!context) {
      return {
        content:
          'Selecione uma viagem ativa para eu analisar seu roteiro, checklist e orçamento.\n\n' +
          LOCAL_NOTICE,
        local: true,
        actions: [],
      };
    }

    const intent = detectIntent(prompt);
    const body = (() => {
      switch (intent) {
        case 'budget':
          return budgetAnswer(context);
        case 'checklist':
          return checklistAnswer(context);
        case 'itinerary':
          return itineraryAnswer(context);
        case 'packing':
          return packingAnswer(context);
        case 'restaurants':
          return restaurantsAnswer(context);
        default:
          return overviewAnswer(context);
      }
    })();

    return {
      content: `${body}\n\n${LOCAL_NOTICE}`,
      local: true,
      actions: localActions(intent, context),
    };
  }
}

/**
 * O que o modo demonstração tem permissão para *propor*.
 *
 * A regra é a mesma que rege as respostas locais: só sai daqui o que o Easy
 * Trip realmente sabe. Um checklist de essenciais de viagem é conhecimento do
 * produto, não do destino — vale para Paris e para Tóquio, e não afirma nada
 * sobre nenhum dos dois.
 *
 * Por isso o modo local **não** propõe roteiro nem despesa estimada: os dois
 * exigiriam saber o que existe no destino e quanto custa, e inventar isso
 * localmente seria exatamente a fabricação que o resto deste arquivo evita
 * (§19, §25). Quem propõe roteiro e estimativa é o Gemini, com o rótulo de
 * estimativa que a revisão exibe.
 *
 * A saída é crua de propósito: passa pelo mesmo `parseAIActions` do caminho
 * remoto. Um item malformado aqui é descartado pela mesma porta.
 */
const LOCAL_CHECKLIST_ESSENTIALS: { label: string; category: string }[] = [
  { label: 'Documento de identidade ou passaporte', category: 'documentos' },
  { label: 'Seguro viagem', category: 'reservas' },
  { label: 'Cartão de crédito habilitado para o exterior', category: 'financeiro' },
  { label: 'Adaptador de tomada', category: 'mala' },
  { label: 'Carregador portátil', category: 'mala' },
  { label: 'Remédios de uso contínuo', category: 'saude' },
];

function localActions(intent: Intent, context: AITripContext): unknown[] {
  if (intent !== 'checklist' && intent !== 'packing') return [];

  const already = new Set(
    context.checklist.map((item) => item.label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')),
  );
  const missing = LOCAL_CHECKLIST_ESSENTIALS.filter(
    (item) => !already.has(item.label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')),
  );
  if (missing.length === 0) return [];

  return [
    {
      type: 'checklist.add',
      label: `Adicionar ${missing.length} ${missing.length === 1 ? 'item' : 'itens'} ao checklist`,
      items: missing,
    },
  ];
}

type Intent = 'budget' | 'checklist' | 'itinerary' | 'packing' | 'restaurants' | 'overview';

function detectIntent(prompt: string): Intent {
  const text = prompt.toLowerCase();
  const has = (...terms: string[]) => terms.some((term) => text.includes(term));

  if (has('gast', 'orçament', 'orcament', 'dinheiro', 'custo', 'caro', 'econom')) return 'budget';
  if (has('checklist', 'falta', 'pendent', 'lista')) return 'checklist';
  if (has('roteiro', 'itinerá', 'itinera', 'programa', 'dia ', 'dias')) return 'itinerary';
  if (has('levar', 'mala', 'roupa', 'clima', 'tempo', 'frio', 'calor')) return 'packing';
  if (has('restaurant', 'comer', 'comida', 'jantar', 'almoç')) return 'restaurants';
  return 'overview';
}

function budgetAnswer(context: AITripContext): string {
  const { trip, expenses } = context;
  const currency = trip.currency;
  const lines: string[] = [`## Orçamento de ${trip.destinationCity}`];

  lines.push(
    `- Orçamento: **${formatMoney(trip.budgetTotal, currency)}**`,
    `- Gasto: **${formatMoney(trip.totalSpent, currency)}**`,
    `- Restante: **${formatMoney(trip.remainingBudget, currency)}**`,
  );

  if (trip.remainingBudget < 0) {
    lines.push(
      '',
      `Você **ultrapassou o orçamento** em ${formatMoney(Math.abs(trip.remainingBudget), currency)}.`,
    );
  } else if (trip.budgetTotal > 0) {
    const used = Math.round((trip.totalSpent / trip.budgetTotal) * 100);
    lines.push('', `Você usou ${used}% do previsto.`);
  }

  if (expenses.length === 0) {
    lines.push('', 'Ainda não há despesas registradas nesta viagem.');
    return lines.join('\n');
  }

  const byCategory = new Map<string, number>();
  for (const expense of expenses) {
    byCategory.set(expense.category, (byCategory.get(expense.category) ?? 0) + expense.amount);
  }
  const ranked = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);

  lines.push('', '### Onde o dinheiro foi');
  for (const [category, total] of ranked.slice(0, 4)) {
    const label = EXPENSE_CATEGORY_LABEL[category as keyof typeof EXPENSE_CATEGORY_LABEL] ?? category;
    lines.push(`- ${label}: ${formatMoney(total, currency)}`);
  }

  const top = ranked[0];
  if (top) {
    const label = EXPENSE_CATEGORY_LABEL[top[0] as keyof typeof EXPENSE_CATEGORY_LABEL] ?? top[0];
    lines.push('', `Seu maior gasto está em **${label}** — é onde um corte tem mais efeito.`);
  }

  return lines.join('\n');
}

function checklistAnswer(context: AITripContext): string {
  const pending = context.checklist.filter((item) => !item.completed);
  const lines = [`## Checklist de ${context.trip.destinationCity}`];

  if (context.checklist.length === 0) {
    return [...lines, '', 'Seu checklist está vazio. Que tal começar pelos documentos?'].join('\n');
  }

  const done = context.checklist.length - pending.length;
  lines.push('', `Concluídos: **${done} de ${context.checklist.length}**.`);

  if (pending.length === 0) {
    return [...lines, '', 'Tudo pronto — não há pendências no checklist.'].join('\n');
  }

  const grouped = new Map<string, string[]>();
  for (const item of pending) {
    const label = CHECKLIST_CATEGORY_LABEL[item.category as keyof typeof CHECKLIST_CATEGORY_LABEL] ?? item.category;
    grouped.set(label, [...(grouped.get(label) ?? []), item.label]);
  }

  lines.push('', '### Ainda faltam');
  for (const [category, items] of grouped) {
    lines.push(`**${category}**`);
    items.forEach((item) => lines.push(`- ${item}`));
  }

  if (context.trip.daysUntil > 0) {
    lines.push('', `Faltam ${context.trip.daysUntil} dias para embarcar.`);
  }

  return lines.join('\n');
}

function itineraryAnswer(context: AITripContext): string {
  const lines = [`## Roteiro de ${context.trip.destinationCity}`];

  if (context.itinerary.length === 0) {
    return [
      ...lines,
      '',
      'Não há atividades planejadas ainda.',
      '',
      `Sua viagem vai de ${formatShortDate(context.trip.startDate)} a ${formatShortDate(context.trip.endDate)} — comece adicionando a chegada e a hospedagem.`,
    ].join('\n');
  }

  const byDate = new Map<string, typeof context.itinerary>();
  for (const item of context.itinerary) {
    byDate.set(item.date, [...(byDate.get(item.date) ?? []), item]);
  }

  for (const [date, items] of [...byDate.entries()].sort()) {
    lines.push('', `### ${formatWeekdayDate(date)}`);
    for (const item of items) {
      const type = ITINERARY_TYPE_LABEL[item.type as keyof typeof ITINERARY_TYPE_LABEL] ?? item.type;
      const time = item.time ? `${item.time} — ` : '';
      const place = item.placeName ? ` (${item.placeName})` : '';
      lines.push(`- ${time}**${item.title}**${place} · ${type}`);
    }
  }

  const days = new Set(context.itinerary.map((i) => i.date)).size;
  lines.push('', `${context.itinerary.length} atividades distribuídas em ${days} dia(s).`);
  return lines.join('\n');
}

function packingAnswer(context: AITripContext): string {
  return [
    `## O que levar para ${context.trip.destinationCity}`,
    '',
    'Abra a tela **Clima** para ver a previsão real do destino — ela vem de uma fonte meteorológica ao vivo, com data e hora de atualização.',
    '',
    'Com base no que já está registrado na sua viagem:',
    `- Período: ${formatShortDate(context.trip.startDate)} a ${formatShortDate(context.trip.endDate)}`,
    `- Destino: ${context.trip.destinationCity}, ${context.trip.destinationCountry}`,
    '',
    'Não vou estimar temperatura de cabeça — prefiro te mandar para o dado real do que arriscar um palpite.',
  ].join('\n');
}

function restaurantsAnswer(context: AITripContext): string {
  const places = context.places ?? [];
  const lines = [`## Onde comer em ${context.trip.destinationCity}`];

  if (places.length === 0) {
    return [
      ...lines,
      '',
      `Ainda não tenho lugares catalogados para ${context.trip.destinationCity}.`,
      '',
      'Abra **Restaurantes e Hotéis** para pesquisar o diretório completo.',
    ].join('\n');
  }

  lines.push('');
  for (const place of places.slice(0, 6)) {
    const rating = place.rating ? ` · ${place.rating.toFixed(1)}★` : '';
    lines.push(`- **${place.name}**${rating}`);
  }
  lines.push('', 'Toque em um lugar no diretório para ver horários, contato e mapa.');
  return lines.join('\n');
}

function overviewAnswer(context: AITripContext): string {
  const { trip } = context;
  const pending = context.checklist.filter((item) => !item.completed).length;

  const statusLine =
    trip.status === 'upcoming'
      ? `Faltam **${trip.daysUntil} dias** para embarcar.`
      : trip.status === 'active'
        ? 'Sua viagem está **em andamento**.'
        : 'Esta viagem já foi **concluída**.';

  return [
    `## ${trip.destinationCity}, ${trip.destinationCountry}`,
    '',
    `${formatShortDate(trip.startDate)} a ${formatShortDate(trip.endDate)}. ${statusLine}`,
    '',
    '### Situação atual',
    `- Orçamento restante: **${formatMoney(trip.remainingBudget, trip.currency)}** de ${formatMoney(trip.budgetTotal, trip.currency)}`,
    `- Atividades no roteiro: **${context.itinerary.length}**`,
    `- Pendências no checklist: **${pending}**`,
    '',
    'Posso detalhar seu **orçamento**, seu **roteiro** ou o que **falta no checklist** — é só pedir.',
  ].join('\n');
}

/* -------------------------------- selection ------------------------------- */

export const aiService: AIService = config.hasBff ? new RemoteAIService() : new LocalAIService();

/** Quick suggestion chips (§50). */
export const AI_SUGGESTIONS = [
  'Monte um roteiro para amanhã',
  'O que falta no meu checklist?',
  'Quanto devo reservar para amanhã?',
  'Estou gastando demais?',
  'Como está meu roteiro?',
  'Sugira restaurantes',
] as const;

/** Builds the model context from the app's real records. */
export function buildTripContext(params: {
  trip: Trip;
  status: TripStatus;
  daysUntil: number;
  totalSpent: number;
  remainingBudget: number;
  expenses: Expense[];
  itinerary: ItineraryItem[];
  checklist: ChecklistItem[];
  profile: Profile | null;
  places?: Place[];
}): AITripContext {
  return {
    trip: {
      destinationCity: params.trip.destinationCity,
      destinationCountry: params.trip.destinationCountry,
      startDate: params.trip.startDate,
      endDate: params.trip.endDate,
      status: params.status,
      daysUntil: params.daysUntil,
      budgetTotal: params.trip.budgetTotal,
      totalSpent: params.totalSpent,
      remainingBudget: params.remainingBudget,
      currency: params.trip.budgetCurrency,
      timezone: params.trip.timezone,
      today: getZoneDate(params.trip.timezone),
    },
    expenses: params.expenses.map((expense) => ({
      category: expense.category,
      amount: expense.amountInBudgetCurrency ?? expense.amount,
      currency: params.trip.budgetCurrency,
      date: expense.transactionDate,
      description: expense.description,
    })),
    itinerary: params.itinerary.map((item) => ({
      date: item.date,
      time: item.startTime,
      type: item.type,
      title: item.title,
      placeName: item.placeName,
    })),
    checklist: params.checklist.map((item) => ({
      label: item.label,
      category: item.category,
      completed: item.completed,
    })),
    profile: {
      travelStyle: params.profile?.travelStyle,
      defaultCurrency: params.profile?.defaultCurrency ?? params.trip.budgetCurrency,
    },
    places: params.places?.map((place) => ({
      name: place.name,
      type: place.type,
      rating: place.rating,
    })),
  };
}
