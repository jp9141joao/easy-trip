/**
 * Reservas — o que era "Tickets" (§22–§29).
 *
 * A mudança não é de rótulo. `Ticket` guardava um documento com título e anexo;
 * `Reservation` guarda uma reserva: tem modalidade, localizador, horários e os
 * campos que só fazem sentido naquela modalidade.
 *
 * FORMA DO REGISTRO
 *
 * O que toda reserva tem — tipo, título, fornecedor, localizador, início, fim,
 * origem, destino, endereço, situação, anexo — é coluna no banco: é por esses
 * campos que a lista ordena, agrupa e ancora lembretes.
 *
 * O que é específico de uma modalidade vive em `details`, um JSONB validado
 * aqui por um schema por tipo. A alternativa seria ~25 colunas anuláveis das
 * quais cada linha usaria cinco — e uma tabela que não diz mais nada sobre o
 * que é obrigatório para o quê.
 *
 * Nada neste arquivo inventa dado. Não há geração de QR (§28), não há status
 * "confirmado" que o aplicativo tenha decidido sozinho, e campo que a pessoa
 * não preencheu fica vazio em vez de receber um valor plausível.
 */

import { z } from 'zod';

import type { ISODateTime } from './types';
import type { Visibility } from './visibility';

export const RESERVATION_TYPES = [
  'flight',
  'hotel',
  'car',
  'park_ticket',
  'train',
  'bus',
  'other',
] as const;
export type ReservationType = (typeof RESERVATION_TYPES)[number];

export type ReservationStatusValue = 'confirmed' | 'pending' | 'cancelled';

/**
 * As categorias da landing de Reservas (§23), na ordem em que aparecem.
 *
 * `other` não é uma categoria oferecida para criação — ninguém quer reservar
 * "outro". Ela existe porque a normalização da 0011 mandou para lá as reservas
 * cujo tipo antigo (`transporte`) não tinha tradução, e essas reservas precisam
 * continuar aparecendo em algum lugar.
 */
export interface ReservationCategory {
  type: ReservationType;
  label: string;
  /** Plural para o título da seção. */
  plural: string;
  emoji: string;
  /** `false` para a categoria que só recebe registros históricos. */
  creatable: boolean;
}

export const RESERVATION_CATEGORIES: readonly ReservationCategory[] = [
  { type: 'flight', label: 'Voo', plural: 'Voos', emoji: '✈️', creatable: true },
  { type: 'hotel', label: 'Hospedagem', plural: 'Hospedagens', emoji: '🏨', creatable: true },
  { type: 'car', label: 'Carro', plural: 'Carros', emoji: '🚗', creatable: true },
  { type: 'park_ticket', label: 'Ingresso', plural: 'Ingressos', emoji: '🎟️', creatable: true },
  { type: 'train', label: 'Trem', plural: 'Trens', emoji: '🚆', creatable: true },
  { type: 'bus', label: 'Ônibus', plural: 'Ônibus', emoji: '🚌', creatable: true },
  { type: 'other', label: 'Outra', plural: 'Outras', emoji: '📄', creatable: false },
] as const;

export function reservationCategory(type: ReservationType): ReservationCategory {
  return RESERVATION_CATEGORIES.find((c) => c.type === type) ?? RESERVATION_CATEGORIES[6];
}

/* ------------------------------ detalhes por tipo ------------------------- */

const shortText = z.string().trim().max(80);
const note = z.string().trim().max(400);

/**
 * Cada schema descreve só o que aquela modalidade acrescenta. Todos os campos
 * são opcionais de propósito: uma reserva registrada às pressas no aeroporto,
 * com título e localizador e mais nada, é um registro legítimo e útil. O que
 * não pode é o campo existir com valor inventado.
 */
export const flightDetailsSchema = z.object({
  flightNumber: shortText.optional(),
  departureTerminal: shortText.optional(),
  arrivalTerminal: shortText.optional(),
  seat: shortText.optional(),
  baggage: note.optional(),
});

export const hotelDetailsSchema = z.object({
  room: shortText.optional(),
  phone: shortText.optional(),
  guests: z.number().int().min(1).max(30).optional(),
});

export const carDetailsSchema = z.object({
  model: shortText.optional(),
  category: shortText.optional(),
  driver: shortText.optional(),
});

export const parkTicketDetailsSchema = z.object({
  quantity: z.number().int().min(1).max(50).optional(),
  /** Onde retirar/apresentar, quando não é o mesmo do endereço. */
  entrance: shortText.optional(),
});

export const railDetailsSchema = z.object({
  seat: shortText.optional(),
  carriage: shortText.optional(),
  platform: shortText.optional(),
});

export const emptyDetailsSchema = z.object({});

export const RESERVATION_DETAILS_SCHEMA = {
  flight: flightDetailsSchema,
  hotel: hotelDetailsSchema,
  car: carDetailsSchema,
  park_ticket: parkTicketDetailsSchema,
  train: railDetailsSchema,
  bus: railDetailsSchema,
  other: emptyDetailsSchema,
} as const;

export type FlightDetails = z.infer<typeof flightDetailsSchema>;
export type HotelDetails = z.infer<typeof hotelDetailsSchema>;
export type CarDetails = z.infer<typeof carDetailsSchema>;
export type ParkTicketDetails = z.infer<typeof parkTicketDetailsSchema>;
export type RailDetails = z.infer<typeof railDetailsSchema>;

export type ReservationDetails =
  | FlightDetails
  | HotelDetails
  | CarDetails
  | ParkTicketDetails
  | RailDetails
  | Record<string, never>;

/**
 * Lê o JSONB que veio do banco com o schema do tipo.
 *
 * `catch` em vez de `throw`: um `details` com um campo a mais (escrito por uma
 * versão futura do aplicativo) não pode impedir a reserva de aparecer na lista.
 * O que o schema garante é que nada malformado chegue à tela como se fosse
 * dado bom — os campos desconhecidos simplesmente não são lidos.
 */
export function parseReservationDetails(
  type: ReservationType,
  raw: unknown,
): ReservationDetails {
  const schema = RESERVATION_DETAILS_SCHEMA[type] ?? emptyDetailsSchema;
  const result = schema.safeParse(raw ?? {});
  return result.success ? (result.data as ReservationDetails) : {};
}

/* --------------------------------- o registro ----------------------------- */

export interface Reservation {
  id: string;
  tripId: string;
  /** Quem criou. Preenchido pelo banco (trigger `set_created_by`, 0009). */
  createdBy?: string;
  visibility: Visibility;
  type: ReservationType;
  title: string;
  /** Companhia aérea, rede hoteleira, locadora, operadora ferroviária. */
  provider?: string;
  /** Localizador / código de confirmação. Coluna `reference` no banco. */
  confirmationCode?: string;
  startAt?: ISODateTime;
  endAt?: ISODateTime;
  origin?: string;
  destination?: string;
  address?: string;
  notes?: string;
  status: ReservationStatusValue;
  details: ReservationDetails;
  /** Caminho no Storage. A URL para abrir agora é derivada (`fileUrl`). */
  filePath?: string;
  fileUrl?: string;
  mimeType?: string;
  /** Valor original de `type` antes da normalização da 0011, quando houve. */
  legacyType?: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/* ------------------------------- rótulos de campo ------------------------- */

/**
 * O mesmo instante significa coisas diferentes conforme a modalidade, e a tela
 * tem de dizer qual. "Início" num hotel é check-in; num voo é a partida.
 * Chamar os dois de "Início" faria a reserva parecer um formulário genérico.
 */
export interface ReservationTimeLabels {
  start?: string;
  end?: string;
}

export const RESERVATION_TIME_LABELS: Record<ReservationType, ReservationTimeLabels> = {
  flight: { start: 'Partida', end: 'Chegada' },
  hotel: { start: 'Check-in', end: 'Check-out' },
  car: { start: 'Retirada', end: 'Devolução' },
  park_ticket: { start: 'Data e horário' },
  train: { start: 'Partida', end: 'Chegada' },
  bus: { start: 'Partida', end: 'Chegada' },
  other: { start: 'Início', end: 'Fim' },
};

export interface ReservationPlaceLabels {
  origin?: string;
  destination?: string;
  address?: string;
}

export const RESERVATION_PLACE_LABELS: Record<ReservationType, ReservationPlaceLabels> = {
  flight: { origin: 'Origem', destination: 'Destino' },
  hotel: { address: 'Endereço' },
  car: { origin: 'Local de retirada', destination: 'Local de devolução' },
  park_ticket: { address: 'Endereço' },
  train: { origin: 'Origem', destination: 'Destino' },
  bus: { origin: 'Origem', destination: 'Destino' },
  other: { origin: 'Origem', destination: 'Destino', address: 'Endereço' },
};

/** Como a reserva se chama quando o campo `provider` está preenchido. */
export const RESERVATION_PROVIDER_LABEL: Record<ReservationType, string> = {
  flight: 'Companhia aérea',
  hotel: 'Hospedagem',
  car: 'Locadora',
  park_ticket: 'Atração',
  train: 'Empresa',
  bus: 'Empresa',
  other: 'Fornecedor',
};

/* ------------------------------ momentos de lembrete ---------------------- */

/**
 * Quais instantes de uma reserva merecem "🔔 Me lembrar" (§30).
 *
 * Ingresso tem um só — não existe "fim do ingresso" que alguém queira ser
 * lembrado. Carro tem dois, e o da devolução é justamente o que as pessoas
 * esquecem.
 */
export function reminderAnchors(type: ReservationType): ('start' | 'end')[] {
  if (type === 'park_ticket') return ['start'];
  if (type === 'other') return ['start'];
  return ['start', 'end'];
}

export function anchorLabel(type: ReservationType, anchor: 'start' | 'end'): string {
  const labels = RESERVATION_TIME_LABELS[type];
  return (anchor === 'start' ? labels.start : labels.end) ?? 'Horário';
}
