/**
 * Human-readable pt-BR labels for domain enums.
 * Keeping them in one place stops the same enum being spelled three
 * different ways across screens.
 */

import { RESERVATION_CATEGORIES, type ReservationType } from '@/domain/reservations';
import type {
  AdvisorStatus,
  ChecklistCategory,
  ConsultationStatus,
  CostLevel,
  ExpenseCategory,
  GoalType,
  ItineraryType,
  PlaceType,
  Priority,
  TravelStyle,
} from '@/domain/types';

export const ITINERARY_TYPE_LABEL: Record<ItineraryType, string> = {
  voo: 'Voo',
  hospedagem: 'Hospedagem',
  refeicao: 'Refeição',
  atracao: 'Atração',
  transporte: 'Transporte',
  atividade: 'Atividade',
  outro: 'Outro',
};

export const CHECKLIST_CATEGORY_LABEL: Record<ChecklistCategory, string> = {
  documentos: 'Documentos',
  saude: 'Saúde',
  mala: 'Mala',
  reservas: 'Reservas',
  financeiro: 'Financeiro',
  outros: 'Outros',
};

export const EXPENSE_CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  hospedagem: 'Hospedagem',
  alimentacao: 'Alimentação',
  transporte: 'Transporte',
  lazer: 'Lazer',
  compras: 'Compras',
  outros: 'Outros',
};

/**
 * O rótulo de cada modalidade de reserva.
 *
 * Fonte única: `RESERVATION_CATEGORIES` já carrega rótulo, plural e emoji, e
 * derivá-lo aqui evita duas listas que se afastam — foi assim que "Tickets"
 * sobreviveu em três telas depois de o produto passar a chamar isto de
 * Reservas.
 */
export const RESERVATION_TYPE_LABEL: Record<ReservationType, string> = Object.fromEntries(
  RESERVATION_CATEGORIES.map((category) => [category.type, category.label]),
) as Record<ReservationType, string>;

export const GOAL_TYPE_LABEL: Record<GoalType, string> = {
  economia: 'Economia',
  destino: 'Destino',
  preparacao: 'Preparação',
  frequencia: 'Frequência',
};

export const TRAVEL_STYLE_LABEL: Record<TravelStyle, string> = {
  aventura: 'Aventura',
  cultural: 'Cultural',
  gastronomico: 'Gastronômico',
  relaxamento: 'Relaxamento',
  economico: 'Econômico',
  luxo: 'Luxo',
  corporativo: 'Corporativo',
  familia: 'Família',
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
};

/** §55 — the prototype's misspelled "Economit" is corrected here. */
export const COST_LEVEL_LABEL: Record<CostLevel, string> = {
  economy: 'Econômico',
  moderate: 'Moderado',
  luxury: 'Luxo',
};

export const PLACE_TYPE_LABEL: Record<PlaceType, string> = {
  hotel: 'Hotel',
  restaurant: 'Restaurante',
  attraction: 'Atração',
};

export const ADVISOR_STATUS_LABEL: Record<AdvisorStatus, string> = {
  online: 'Online',
  offline: 'Offline',
  busy: 'Ocupado',
};

export const CONSULTATION_STATUS_LABEL: Record<ConsultationStatus, string> = {
  requested: 'Solicitada',
  scheduled: 'Agendada',
  cancelled: 'Cancelada',
  completed: 'Concluída',
};

/** §46 — a request is never announced as a confirmed booking. */
export const CONSULTATION_STATUS_HINT: Record<ConsultationStatus, string> = {
  requested: 'Aguardando confirmação do especialista',
  scheduled: 'Confirmada pelo especialista',
  cancelled: 'Cancelada',
  completed: 'Consultoria realizada',
};
