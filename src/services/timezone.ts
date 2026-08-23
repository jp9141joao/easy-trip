/**
 * Timezone module (§63).
 *
 * The original prototype's strongest module, preserved and made exact:
 * everything is computed from IANA zones through `Intl.DateTimeFormat`, so DST
 * and fractional offsets (Asia/Kathmandu +05:45, Australia/Adelaide +09:30)
 * come out right. Fixed numeric offsets are never used.
 */

import { toISODate } from '@/lib/date';

export interface ZoneClock {
  timezone: string;
  /** HH:mm in that zone. */
  time: string;
  /** e.g. `qua, 19 de ago`. */
  date: string;
  /** Minutes from UTC — may be fractional-hour, e.g. 345. */
  offsetMinutes: number;
  /** `GMT+09:00` */
  offsetLabel: string;
  isDay: boolean;
  hour: number;
}

export interface TimezoneComparison {
  origin: ZoneClock;
  destination: ZoneClock;
  /** destination − origin, in minutes. */
  differenceMinutes: number;
  /** "3 horas à frente", "1h30 atrás", "mesmo horário". */
  differenceLabel: string;
}

/** True when the runtime can actually resolve IANA zones. */
export function supportsTimezones(): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo' }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/**
 * Offset of `timezone` from UTC in minutes, at the given instant.
 * Works by formatting the instant as wall-clock time in the zone and taking the
 * difference — the only approach that stays correct across DST boundaries.
 */
export function getOffsetMinutes(timezone: string, at: Date = new Date()): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts = formatter.formatToParts(at);
  const lookup: Record<string, string> = {};
  for (const part of parts) lookup[part.type] = part.value;

  const wallClockAsUtc = Date.UTC(
    Number(lookup.year),
    Number(lookup.month) - 1,
    Number(lookup.day),
    Number(lookup.hour) % 24,
    Number(lookup.minute),
    Number(lookup.second),
  );

  // Drop milliseconds from the instant so the difference lands on whole minutes.
  const instant = Math.floor(at.getTime() / 1000) * 1000;
  return Math.round((wallClockAsUtc - instant) / 60_000);
}

export function formatOffsetLabel(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  const hours = String(Math.floor(abs / 60)).padStart(2, '0');
  const minutes = String(abs % 60).padStart(2, '0');
  return `GMT${sign}${hours}:${minutes}`;
}

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export function getZoneClock(timezone: string, at: Date = new Date()): ZoneClock {
  const offsetMinutes = getOffsetMinutes(timezone, at);
  // Shift the instant by the zone offset, then read UTC fields — this gives the
  // zone's wall clock without depending on the device's own timezone.
  const shifted = new Date(at.getTime() + offsetMinutes * 60_000);

  const hour = shifted.getUTCHours();
  const minute = shifted.getUTCMinutes();

  return {
    timezone,
    time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    date: `${WEEKDAYS[shifted.getUTCDay()]}, ${shifted.getUTCDate()} de ${MONTHS[shifted.getUTCMonth()]}`,
    offsetMinutes,
    offsetLabel: formatOffsetLabel(offsetMinutes),
    isDay: hour >= 6 && hour < 18,
    hour,
  };
}

/**
 * A data de calendário **no destino**, como `YYYY-MM-DD`.
 *
 * Existe por causa de uma pergunta banal: "monte meu roteiro de amanhã". Quando
 * o viajante está em São Paulo às 23h e a viagem é para Tóquio, "amanhã" no
 * aparelho e "amanhã" no destino são dias diferentes — e o item iria para a
 * data errada sem que ninguém percebesse, porque as duas respostas parecem
 * certas (§21).
 *
 * Mesmo truque de `getZoneClock`: desloca o instante pelo offset da zona e lê
 * os campos UTC, o que atravessa horário de verão sem caso especial. Se o
 * runtime não resolver zonas IANA, cai na data do aparelho — que é a melhor
 * resposta disponível, e continua sendo uma data real.
 */
export function getZoneDate(timezone: string, at: Date = new Date()): string {
  try {
    const shifted = new Date(at.getTime() + getOffsetMinutes(timezone, at) * 60_000);
    const year = shifted.getUTCFullYear();
    const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
    const day = String(shifted.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch {
    return toISODate(at);
  }
}

export function describeDifference(differenceMinutes: number): string {
  if (differenceMinutes === 0) return 'Mesmo horário';

  const ahead = differenceMinutes > 0;
  const abs = Math.abs(differenceMinutes);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;

  let magnitude: string;
  if (hours === 0) magnitude = `${minutes} min`;
  else if (minutes === 0) magnitude = hours === 1 ? '1 hora' : `${hours} horas`;
  else magnitude = `${hours}h${String(minutes).padStart(2, '0')}`;

  return `${magnitude} ${ahead ? 'à frente' : 'atrás'}`;
}

export function compareTimezones(
  originTimezone: string,
  destinationTimezone: string,
  at: Date = new Date(),
): TimezoneComparison {
  const origin = getZoneClock(originTimezone, at);
  const destination = getZoneClock(destinationTimezone, at);
  const differenceMinutes = destination.offsetMinutes - origin.offsetMinutes;

  return {
    origin,
    destination,
    differenceMinutes,
    differenceLabel: describeDifference(differenceMinutes),
  };
}

/** The device's own IANA zone, used as the default origin. */
export function getDeviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo';
  } catch {
    return 'America/Sao_Paulo';
  }
}

/** Short city-ish label from an IANA zone: `Asia/Tokyo` → `Tokyo`. */
export function timezoneCityLabel(timezone: string): string {
  return timezone.split('/').pop()?.replace(/_/g, ' ') ?? timezone;
}
