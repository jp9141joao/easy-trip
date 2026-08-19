/**
 * Easy Trip 2.0 — domain model.
 *
 * Golden rule (§12): a Trip exists exactly once, and every operational record
 * carries the `tripId` it belongs to. Values that can be derived
 * (status, daysLeft, totalSpent, remainingBudget, progress) are NEVER stored —
 * they live in `src/domain/selectors.ts`.
 */

export type ISODate = string; // YYYY-MM-DD
export type ISODateTime = string; // ISO 8601 UTC

export type CurrencyCode = 'BRL' | 'USD' | 'EUR' | 'GBP' | 'JPY' | 'CHF' | 'CAD' | 'AUD' | 'ARS';

export const CURRENCIES: readonly CurrencyCode[] = [
  'BRL',
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'CHF',
  'CAD',
  'AUD',
  'ARS',
] as const;

export type TravelStyle =
  | 'aventura'
  | 'cultural'
  | 'gastronomico'
  | 'relaxamento'
  | 'economico'
  | 'luxo'
  | 'corporativo'
  | 'familia';

export const TRAVEL_STYLES: readonly TravelStyle[] = [
  'aventura',
  'cultural',
  'gastronomico',
  'relaxamento',
  'economico',
  'luxo',
  'corporativo',
  'familia',
] as const;

export interface User {
  id: string;
  email: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface Profile {
  userId: string;
  name: string;
  phone?: string;
  avatarUrl?: string;
  homeCity?: string;
  homeCountry?: string;
  /** IANA timezone, e.g. `America/Sao_Paulo`. */
  homeTimezone?: string;
  travelStyle?: TravelStyle;
  defaultCurrency: CurrencyCode;
}

export interface Trip {
  id: string;
  userId: string;
  destinationCity: string;
  destinationCountry: string;
  /** ISO 3166-1 alpha-2, uppercase. Drives SOS and locale lookups. */
  countryCode: string;
  latitude?: number;
  longitude?: number;
  /** IANA timezone of the destination. */
  timezone: string;
  startDate: ISODate;
  endDate: ISODate;
  coverImageUrl?: string;
  budgetTotal: number;
  budgetCurrency: CurrencyCode;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/** Derived, never persisted (§31). */
export type TripStatus = 'upcoming' | 'active' | 'completed';

export type ItineraryType =
  | 'voo'
  | 'hospedagem'
  | 'refeicao'
  | 'atracao'
  | 'transporte'
  | 'atividade'
  | 'outro';

export const ITINERARY_TYPES: readonly ItineraryType[] = [
  'voo',
  'hospedagem',
  'refeicao',
  'atracao',
  'transporte',
  'atividade',
  'outro',
] as const;

export interface ItineraryItem {
  id: string;
  tripId: string;
  date: ISODate;
  /** HH:mm */
  startTime?: string;
  endTime?: string;
  type: ItineraryType;
  title: string;
  description?: string;
  placeName?: string;
  latitude?: number;
  longitude?: number;
  reservationReference?: string;
  completed: boolean;
  sortOrder: number;
}

export type ChecklistCategory =
  | 'documentos'
  | 'saude'
  | 'mala'
  | 'reservas'
  | 'financeiro'
  | 'outros';

export const CHECKLIST_CATEGORIES: readonly ChecklistCategory[] = [
  'documentos',
  'saude',
  'mala',
  'reservas',
  'financeiro',
  'outros',
] as const;

export type Priority = 'low' | 'medium' | 'high';

export interface ChecklistItem {
  id: string;
  tripId: string;
  label: string;
  category: ChecklistCategory;
  completed: boolean;
  priority?: Priority;
  dueDate?: ISODate;
  createdAt: ISODateTime;
}

export type ExpenseCategory =
  | 'hospedagem'
  | 'alimentacao'
  | 'transporte'
  | 'lazer'
  | 'compras'
  | 'outros';

export const EXPENSE_CATEGORIES: readonly ExpenseCategory[] = [
  'hospedagem',
  'alimentacao',
  'transporte',
  'lazer',
  'compras',
  'outros',
] as const;

export interface Expense {
  id: string;
  tripId: string;
  userId: string;
  category: ExpenseCategory;
  /** Amount in `currency`, the currency actually paid. */
  amount: number;
  currency: CurrencyCode;
  /**
   * Amount converted into the trip's budget currency. Stored together with the
   * rate + timestamp so a historical expense never silently changes value when
   * the FX market moves (§41).
   */
  amountInBudgetCurrency?: number;
  exchangeRate?: number;
  exchangeRateTimestamp?: ISODateTime;
  transactionDate: ISODate;
  description: string;
  createdAt: ISODateTime;
}

export interface JournalEntry {
  id: string;
  tripId: string;
  userId: string;
  entryDate: ISODate;
  content: string;
  latitude?: number;
  longitude?: number;
  placeName?: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface JournalMedia {
  id: string;
  journalEntryId: string;
  fileUrl: string;
  mimeType: string;
  sortOrder: number;
}

export type TicketType = 'voo' | 'hospedagem' | 'atracao' | 'transporte' | 'outro';

export const TICKET_TYPES: readonly TicketType[] = [
  'voo',
  'hospedagem',
  'atracao',
  'transporte',
  'outro',
] as const;

export interface Ticket {
  id: string;
  tripId: string;
  userId: string;
  type: TicketType;
  title: string;
  provider?: string;
  reference?: string;
  startDateTime?: ISODateTime;
  endDateTime?: ISODateTime;
  origin?: string;
  destination?: string;
  fileUrl?: string;
  mimeType?: string;
  notes?: string;
}

export type GoalType = 'economia' | 'destino' | 'preparacao' | 'frequencia';

export const GOAL_TYPES: readonly GoalType[] = [
  'economia',
  'destino',
  'preparacao',
  'frequencia',
] as const;

export type GoalStatus = 'active' | 'completed' | 'cancelled';

export interface Goal {
  id: string;
  userId: string;
  tripId?: string;
  type: GoalType;
  title: string;
  targetValue: number;
  currentValue: number;
  unit: string;
  status: GoalStatus;
  deadline?: ISODate;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export type CostLevel = 'economy' | 'moderate' | 'luxury';

export interface Offer {
  id: string;
  destination: string;
  description: string;
  price?: number;
  /** Currency the `price` is expressed in — never the destination's currency. */
  priceCurrency?: CurrencyCode;
  discountType?: 'percentage' | 'fixed' | 'label';
  discountValue?: number | string;
  costLevel: CostLevel;
  imageUrl: string;
  weatherSummary?: string;
  bestTime?: string;
  thingsToDo: string[];
  activeFrom?: ISODate;
  activeUntil?: ISODate;
  partnerUrl?: string;
}

export interface Article {
  id: string;
  slug: string;
  title: string;
  category: string;
  imageUrl?: string;
  authorName: string;
  content: string;
  publishedAt: ISODateTime;
  estimatedReadMinutes: number;
  status: 'draft' | 'published';
}

export interface ArticleLike {
  articleId: string;
  userId: string;
  createdAt: ISODateTime;
}

export type PlaceType = 'hotel' | 'restaurant' | 'attraction';

export interface Place {
  id: string;
  externalProviderId?: string;
  name: string;
  type: PlaceType;
  rating?: number;
  /** 1–4, comparable to the common $-$$$$ scale. */
  priceLevel?: number;
  averagePrice?: number;
  currency?: CurrencyCode;
  city: string;
  country: string;
  address?: string;
  phone?: string;
  openingHours?: string[];
  description?: string;
  latitude?: number;
  longitude?: number;
  imageUrl?: string;
  amenities?: string[];
  partnerUrl?: string;
}

export interface PlaceFavorite {
  placeId: string;
  userId: string;
  createdAt: ISODateTime;
}

export type AdvisorStatus = 'online' | 'offline' | 'busy';

export interface Advisor {
  id: string;
  name: string;
  specialty: string;
  avatarUrl?: string;
  rating?: number;
  status: AdvisorStatus;
  bio?: string;
}

export type ConsultationStatus = 'requested' | 'scheduled' | 'cancelled' | 'completed';

export interface Consultation {
  id: string;
  userId: string;
  advisorId: string;
  scheduledAt: ISODateTime;
  status: ConsultationStatus;
  notes?: string;
}

export type ReservationStatus = 'requested' | 'confirmed' | 'cancelled';

/**
 * A reservation *request* (§54). Never rendered as "Reserva confirmada" unless
 * a provider actually confirmed it.
 */
export interface ReservationRequest {
  id: string;
  userId: string;
  tripId?: string;
  placeId: string;
  placeName: string;
  requestedFor: ISODateTime;
  partySize: number;
  notes?: string;
  status: ReservationStatus;
  createdAt: ISODateTime;
}

export interface AIConversation {
  id: string;
  userId: string;
  tripId?: string;
  title?: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export type AIRole = 'user' | 'assistant' | 'system';

export interface AIMessage {
  id: string;
  conversationId: string;
  role: AIRole;
  content: string;
  createdAt: ISODateTime;
}

/** Travel insurance policy, surfaced by the SOS screen (§66). */
export interface InsurancePolicy {
  id: string;
  userId: string;
  tripId?: string;
  provider: string;
  policyNumber: string;
  emergencyPhone?: string;
  fileUrl?: string;
  validUntil?: ISODate;
}
