/**
 * Validation schemas (§91). Forms use these through
 * `react-hook-form` + `@hookform/resolvers/zod` — validation is never
 * re-implemented inline in a screen.
 */

import { z } from 'zod';
import { pt } from 'zod/locales';

import { isValidISODate } from '@/lib/date';
import {
  CHECKLIST_CATEGORIES,
  CURRENCIES,
  EXPENSE_CATEGORIES,
  GOAL_TYPES,
  ITINERARY_TYPES,
  TICKET_TYPES,
  TRAVEL_STYLES,
} from './types';

// Any message we do not override explicitly still comes out in pt-BR.
z.config(pt());

const isoDate = z
  .string()
  .min(1, 'Informe uma data')
  .refine(isValidISODate, 'Data inválida (use AAAA-MM-DD)');

const optionalTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário inválido (use HH:mm)')
  .optional()
  .or(z.literal('').transform(() => undefined));

const currency = z.enum(CURRENCIES as [string, ...string[]]);

/* --------------------------------- auth ---------------------------------- */

// Trim BEFORE validating: mobile keyboards and autofill routinely append a
// trailing space, and rejecting that as "E-mail inválido" would be wrong.
export const emailSchema = z
  .string()
  .trim()
  .min(1, 'Informe seu e-mail')
  .email('E-mail inválido')
  .transform((value) => value.toLowerCase());

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Informe sua senha'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const registerSchema = z
  .object({
    name: z.string().trim().min(2, 'Informe seu nome'),
    email: emailSchema,
    password: z
      .string()
      .min(8, 'A senha precisa ter ao menos 8 caracteres')
      .regex(/[a-zA-Z]/, 'Inclua ao menos uma letra')
      .regex(/\d/, 'Inclua ao menos um número'),
    confirmPassword: z.string(),
    defaultCurrency: currency,
    travelStyle: z.enum(TRAVEL_STYLES as [string, ...string[]]).optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'As senhas não conferem',
    path: ['confirmPassword'],
  });
export type RegisterInput = z.infer<typeof registerSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

/**
 * Redefinição de senha. Mesmas regras do cadastro, e propositalmente as mesmas
 * mensagens: uma senha que serviria para criar a conta precisa servir para
 * recuperá-la, senão o usuário descobre a divergência no pior momento.
 */
export const resetPasswordSchema = z
  .object({
    password: z
      .string()
      .min(8, 'A senha precisa ter ao menos 8 caracteres')
      .regex(/[a-zA-Z]/, 'Inclua ao menos uma letra')
      .regex(/\d/, 'Inclua ao menos um número'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'As senhas não conferem',
    path: ['confirmPassword'],
  });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/* --------------------------------- trip ---------------------------------- */

export const tripSchema = z
  .object({
    destinationCity: z.string().trim().min(2, 'Informe o destino'),
    destinationCountry: z.string().trim().min(2, 'Informe o país'),
    countryCode: z
      .string()
      .trim()
      .length(2, 'Use o código de 2 letras do país')
      .transform((value) => value.toUpperCase()),
    timezone: z.string().min(1, 'Informe o fuso horário do destino'),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    startDate: isoDate,
    endDate: isoDate,
    budgetTotal: z.number({ error: 'Informe um valor' }).min(0, 'O orçamento não pode ser negativo'),
    budgetCurrency: currency,
    coverImageUrl: z.string().url('URL inválida').optional().or(z.literal('').transform(() => undefined)),
  })
  .refine((data) => data.endDate >= data.startDate, {
    message: 'A data de volta deve ser igual ou posterior à de ida',
    path: ['endDate'],
  });
export type TripInput = z.infer<typeof tripSchema>;

/* ------------------------------- itinerary -------------------------------- */

export const itineraryItemSchema = z
  .object({
    date: isoDate,
    startTime: optionalTime,
    endTime: optionalTime,
    type: z.enum(ITINERARY_TYPES as [string, ...string[]]),
    title: z.string().trim().min(2, 'Informe um título'),
    description: z.string().trim().max(1000).optional(),
    placeName: z.string().trim().max(200).optional(),
    reservationReference: z.string().trim().max(120).optional(),
  })
  .refine((data) => !data.startTime || !data.endTime || data.endTime >= data.startTime, {
    message: 'O horário final deve ser depois do inicial',
    path: ['endTime'],
  });
export type ItineraryItemInput = z.infer<typeof itineraryItemSchema>;

/* ------------------------------- checklist -------------------------------- */

export const checklistItemSchema = z.object({
  label: z.string().trim().min(2, 'Descreva o item'),
  category: z.enum(CHECKLIST_CATEGORIES as [string, ...string[]]),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  dueDate: isoDate.optional().or(z.literal('').transform(() => undefined)),
});
export type ChecklistItemInput = z.infer<typeof checklistItemSchema>;

/* -------------------------------- expense --------------------------------- */

export const expenseSchema = z.object({
  description: z.string().trim().min(2, 'Descreva a despesa'),
  category: z.enum(EXPENSE_CATEGORIES as [string, ...string[]]),
  amount: z.number({ error: 'Informe um valor' }).positive('O valor deve ser maior que zero'),
  currency,
  transactionDate: isoDate,
});
export type ExpenseInput = z.infer<typeof expenseSchema>;

/* --------------------------------- ticket --------------------------------- */

export const ticketSchema = z.object({
  type: z.enum(TICKET_TYPES as [string, ...string[]]),
  title: z.string().trim().min(2, 'Informe um título'),
  provider: z.string().trim().max(120).optional(),
  reference: z.string().trim().max(120).optional(),
  origin: z.string().trim().max(120).optional(),
  destination: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(1000).optional(),
});
export type TicketInput = z.infer<typeof ticketSchema>;

/* -------------------------------- journal --------------------------------- */

export const journalEntrySchema = z.object({
  entryDate: isoDate,
  content: z.string().trim().min(1, 'Escreva algo para registrar'),
  placeName: z.string().trim().max(200).optional(),
});
export type JournalEntryInput = z.infer<typeof journalEntrySchema>;

/* ---------------------------------- goal ---------------------------------- */

export const goalSchema = z.object({
  type: z.enum(GOAL_TYPES as [string, ...string[]]),
  title: z.string().trim().min(2, 'Informe um título'),
  targetValue: z.number({ error: 'Informe a meta' }).positive('A meta deve ser maior que zero'),
  currentValue: z.number().min(0, 'O progresso não pode ser negativo'),
  unit: z.string().trim().min(1, 'Informe a unidade'),
  deadline: isoDate.optional().or(z.literal('').transform(() => undefined)),
  tripId: z.string().optional(),
});
export type GoalInput = z.infer<typeof goalSchema>;

export const goalContributionSchema = z.object({
  amount: z.number({ error: 'Informe um valor' }).positive('Informe um valor maior que zero'),
});
export type GoalContributionInput = z.infer<typeof goalContributionSchema>;

/* -------------------------------- profile --------------------------------- */

export const profileSchema = z.object({
  name: z.string().trim().min(2, 'Informe seu nome'),
  phone: z.string().trim().max(30).optional(),
  homeCity: z.string().trim().max(120).optional(),
  homeCountry: z.string().trim().max(120).optional(),
  homeTimezone: z.string().trim().optional(),
  travelStyle: z.enum(TRAVEL_STYLES as [string, ...string[]]).optional(),
  defaultCurrency: currency,
});
export type ProfileInput = z.infer<typeof profileSchema>;

/* ------------------------------ consultation ------------------------------ */

export const consultationSchema = z.object({
  advisorId: z.string().min(1),
  scheduledAt: z.string().min(1, 'Escolha uma data'),
  notes: z.string().trim().max(1000).optional(),
});
export type ConsultationInput = z.infer<typeof consultationSchema>;

/* ------------------------------- reservation ------------------------------ */

export const reservationRequestSchema = z.object({
  requestedFor: z.string().min(1, 'Escolha data e horário'),
  partySize: z
    .number({ error: 'Informe quantas pessoas' })
    .int('Use um número inteiro')
    .min(1, 'Pelo menos 1 pessoa')
    .max(50, 'Para grupos maiores, fale com o estabelecimento'),
  notes: z.string().trim().max(500).optional(),
});
export type ReservationRequestInput = z.infer<typeof reservationRequestSchema>;

/* ---------------------------- admin: conteúdo ----------------------------- */

/**
 * Os formulários administrativos **não** têm campo de URL de imagem.
 *
 * Ele existia até a F8 ("Imagem (URL)") e era a metade aberta do P-04: colar o
 * endereço de uma foto do Unsplash é o que fazia o produto depender de um host
 * de terceiro para exibir o próprio conteúdo. A imagem agora é escolhida no
 * aparelho e enviada para o bucket `content` (`EditorialImageField`), e o valor
 * gravado em `imageUrl`/`avatarUrl` é o que o Storage devolve — nunca texto
 * digitado. Por isso `imageUrl` saiu destes schemas: não há mais um campo de
 * texto para validar.
 */

export const articleFormSchema = z.object({
  title: z.string().trim().min(4, 'Informe um título').max(140),
  category: z.string().trim().min(2, 'Informe a categoria').max(40),
  authorName: z.string().trim().min(2, 'Informe o autor').max(80),
  content: z.string().trim().min(80, 'O artigo está muito curto'),
  estimatedReadMinutes: z
    .number({ error: 'Informe o tempo de leitura' })
    .int('Use um número inteiro')
    .min(1)
    .max(60),
  status: z.enum(['draft', 'published']),
});
export type ArticleFormInput = z.infer<typeof articleFormSchema>;

export const placeFormSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(140),
  type: z.enum(['hotel', 'restaurant', 'attraction']),
  city: z.string().trim().min(2, 'Informe a cidade').max(80),
  country: z.string().trim().min(2, 'Informe o país').max(80),
  description: z.string().trim().max(2000).optional(),
  address: z.string().trim().max(240).optional(),
  phone: z.string().trim().max(40).optional(),
  /**
   * Reaproveita `partnerUrl`, o campo que a tela de detalhes já lia (§9). Um
   * `externalUrl` novo criaria dois campos para a mesma coisa e deixaria o
   * conteúdo antigo com o botão errado.
   */
  partnerUrl: z.string().trim().optional(),
  rating: z.number().min(0).max(5).optional(),
  priceLevel: z.number().int().min(1).max(4).optional(),
  amenities: z.array(z.string().trim().min(1)).max(20).optional(),
});
export type PlaceFormInput = z.infer<typeof placeFormSchema>;

/**
 * Cadastro de oferta (F9 — a UI que faltava para a decisão D-06).
 *
 * A modelagem é a da F3 e não muda aqui: `status` decide rascunho/publicado,
 * `activeFrom`/`activeUntil` decidem a vigência e `sortOrder` decide a ordem na
 * faixa da Home. O formulário só passa a existir; as regras continuam onde
 * estavam — na policy `offers_read` e em `listOffers`.
 *
 * `discountValue` é `text` no banco de propósito: "15" (percentual), "800"
 * (fixo) e "Últimas vagas" (rótulo) convivem na mesma coluna, e o que dá
 * sentido ao valor é `discountType`.
 */
export const offerFormSchema = z
  .object({
    destination: z.string().trim().min(2, 'Informe o destino').max(140),
    description: z.string().trim().min(20, 'Descreva a oferta').max(2000),
    price: z.number().min(0).max(1_000_000).optional(),
    priceCurrency: z.string().trim().length(3).optional(),
    discountType: z.enum(['percentage', 'fixed', 'label']).optional(),
    discountValue: z.string().trim().max(60).optional(),
    costLevel: z.enum(['economy', 'moderate', 'luxury']),
    weatherSummary: z.string().trim().max(140).optional(),
    bestTime: z.string().trim().max(140).optional(),
    thingsToDo: z.array(z.string().trim().min(1)).max(12).optional(),
    activeFrom: z.string().trim().optional(),
    activeUntil: z.string().trim().optional(),
    partnerUrl: z.string().trim().optional(),
    status: z.enum(['draft', 'published']),
    sortOrder: z.number().int().min(0).max(9999),
  })
  // Uma vigência invertida não é recusada por nenhuma constraint do banco — e
  // produziria uma oferta que nunca aparece, sem que ninguém entenda por quê.
  .refine(
    (value) => !value.activeFrom || !value.activeUntil || value.activeFrom <= value.activeUntil,
    { path: ['activeUntil'], message: 'O fim da vigência não pode ser antes do início' },
  );
export type OfferFormInput = z.infer<typeof offerFormSchema>;

/**
 * Cadastro de especialista (F9 — o outro lado da D-06).
 *
 * `status` é presença (pode atender agora?) e `active` é cadastro (faz parte do
 * time?). São campos diferentes e a tela precisa deixar isso explícito: tirar
 * alguém do diretório é `active`, e não marcar `offline` para sempre.
 */
export const advisorFormSchema = z.object({
  name: z.string().trim().min(3, 'Informe o nome').max(120),
  specialty: z.string().trim().min(2, 'Informe a especialidade').max(80),
  bio: z.string().trim().max(600).optional(),
  rating: z.number().min(0).max(5).optional(),
  status: z.enum(['online', 'offline', 'busy']),
  active: z.boolean(),
});
export type AdvisorFormInput = z.infer<typeof advisorFormSchema>;

/* --------------------------- admin: saída da IA --------------------------- */

/**
 * O que a IA tem permissão para devolver.
 *
 * Estes schemas são a primeira linha do §22/§58, e funcionam por *ausência*:
 * `rating`, `averagePrice`, `priceLevel`, `openingHours`, `latitude` e
 * `longitude` simplesmente não existem aqui. Ainda que o modelo os invente e os
 * coloque na resposta, eles não têm por onde entrar no formulário — o schema os
 * descarta antes de qualquer tela ver.
 *
 * Uma nota inventada não é um erro de conteúdo: é uma informação falsa exibida
 * ao usuário como se o Easy Trip a tivesse verificado. Por isso a barreira é
 * estrutural e não uma instrução no prompt, que o modelo pode ignorar.
 */
export const generatedArticleSchema = z.object({
  title: z.string().trim().min(4).max(140),
  category: z.string().trim().min(2).max(40),
  content: z.string().trim().min(80),
  estimatedReadMinutes: z.number().int().min(1).max(60),
  imagePrompt: z.string().trim().max(600).optional(),
});
export type GeneratedArticle = z.infer<typeof generatedArticleSchema>;

export const generatedPlaceDraftSchema = z.object({
  name: z.string().trim().min(2).max(140).optional(),
  type: z.enum(['hotel', 'restaurant']),
  description: z.string().trim().min(20).max(2000).optional(),
  city: z.string().trim().max(80).optional(),
  country: z.string().trim().max(80).optional(),
  address: z.string().trim().max(240).optional(),
  phone: z.string().trim().max(40).optional(),
  partnerUrl: z.string().trim().max(400).optional(),
  amenities: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
  imageSearchQuery: z.string().trim().max(200).optional(),
});
export type GeneratedPlaceDraft = z.infer<typeof generatedPlaceDraftSchema>;
