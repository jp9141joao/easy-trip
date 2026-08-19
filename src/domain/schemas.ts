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
