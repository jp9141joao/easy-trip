/**
 * Lembretes (§30–§32).
 *
 * Um lembrete é POR PESSOA. Maria ativar "me lembrar" no check-in não faz João
 * receber nada — e é essa frase que decide o modelo: o lembrete não é um campo
 * da reserva, é um registro do usuário que aponta para ela.
 */

import type { ISODateTime } from './types';

export type ReminderEntityType = 'reservation' | 'itinerary_item' | 'trip';

/** Qual instante da entidade originou o lembrete. Ver `reminderAnchors`. */
export type ReminderAnchor = 'start' | 'end';

export interface Reminder {
  id: string;
  userId: string;
  tripId: string;
  entityType: ReminderEntityType;
  entityId: string;
  anchor: ReminderAnchor;
  remindAt: ISODateTime;
  title: string;
  body?: string;
  /** Quando virou notificação na Central. `undefined` = ainda não venceu. */
  sentAt?: ISODateTime;
  createdAt: ISODateTime;
}

/** As opções do seletor, em minutos antes do instante-âncora. */
export interface ReminderOffset {
  minutes: number;
  label: string;
}

export const REMINDER_OFFSETS: readonly ReminderOffset[] = [
  { minutes: 15, label: '15 minutos antes' },
  { minutes: 30, label: '30 minutos antes' },
  { minutes: 60, label: '1 hora antes' },
  { minutes: 180, label: '3 horas antes' },
  { minutes: 1440, label: '1 dia antes' },
] as const;

/** Limite do "Personalizado": uma semana. Além disso o lembrete deixa de lembrar. */
export const MAX_REMINDER_MINUTES = 7 * 24 * 60;

export function reminderOffsetLabel(minutes: number): string {
  const known = REMINDER_OFFSETS.find((option) => option.minutes === minutes);
  if (known) return known.label;
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `${days} ${days === 1 ? 'dia antes' : 'dias antes'}`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} ${hours === 1 ? 'hora antes' : 'horas antes'}`;
  }
  return `${minutes} minutos antes`;
}

/**
 * O instante em que o lembrete dispara.
 *
 * Devolve `undefined` quando a data-âncora não existe ou quando o disparo já
 * ficou no passado. A segunda parte importa: criar um lembrete vencido faria a
 * Central mostrar "Check-in amanhã" na abertura seguinte, para um check-in que
 * já passou. Não avisar é melhor do que avisar errado.
 */
export function computeRemindAt(
  anchorAt: ISODateTime | undefined,
  minutesBefore: number,
  now: Date = new Date(),
): ISODateTime | undefined {
  if (!anchorAt) return undefined;
  const anchor = new Date(anchorAt);
  if (Number.isNaN(anchor.getTime())) return undefined;
  const remindAt = new Date(anchor.getTime() - minutesBefore * 60_000);
  if (remindAt.getTime() <= now.getTime()) return undefined;
  return remindAt.toISOString();
}

/**
 * Quanto tempo antes este lembrete foi configurado — para a tela poder mostrar
 * o seletor já na posição certa ao reabrir.
 */
export function offsetMinutesBetween(
  remindAt: ISODateTime,
  anchorAt: ISODateTime,
): number | undefined {
  const remind = new Date(remindAt).getTime();
  const anchor = new Date(anchorAt).getTime();
  if (Number.isNaN(remind) || Number.isNaN(anchor)) return undefined;
  const minutes = Math.round((anchor - remind) / 60_000);
  return minutes >= 0 ? minutes : undefined;
}
