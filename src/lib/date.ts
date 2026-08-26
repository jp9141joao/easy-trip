/**
 * Date helpers (§92).
 *
 * Date-only values are plain `YYYY-MM-DD` strings and are compared
 * lexicographically — that is exact and completely timezone-free, which is why
 * we never route calendar dates through `Date` arithmetic.
 * Timestamps are ISO 8601 UTC.
 */

import type { ISODate, ISODateTime } from '@/domain/types';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidISODate(value: string): value is ISODate {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(y, m);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Today in the device's local calendar, as `YYYY-MM-DD`. */
export function todayISO(now: Date = new Date()): ISODate {
  return toISODate(now);
}

/** Formats a `Date` using its *local* calendar fields. */
export function toISODate(date: Date): ISODate {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function nowISO(): ISODateTime {
  return new Date().toISOString();
}

/** Parses `YYYY-MM-DD` into a UTC-noon Date, immune to DST edge cases. */
export function parseISODate(value: ISODate): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

/** Whole days from `from` to `to` (negative when `to` is in the past). */
export function daysBetween(from: ISODate, to: ISODate): number {
  const ms = parseISODate(to).getTime() - parseISODate(from).getTime();
  return Math.round(ms / 86_400_000);
}

export function addDays(value: ISODate, amount: number): ISODate {
  const date = parseISODate(value);
  date.setUTCDate(date.getUTCDate() + amount);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Inclusive range check. */
export function isWithin(value: ISODate, start: ISODate, end: ISODate): boolean {
  return value >= start && value <= end;
}

const MONTHS_PT = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
];

/** `2026-03-04` → `4 de mar`. */
export function formatShortDate(value: ISODate): string {
  if (!isValidISODate(value)) return value;
  const [, m, d] = value.split('-').map(Number);
  return `${d} de ${MONTHS_PT[m - 1]}`;
}

/** `2026-03-04` → `4 de mar de 2026`. */
export function formatLongDate(value: ISODate): string {
  if (!isValidISODate(value)) return value;
  const [y, m, d] = value.split('-').map(Number);
  return `${d} de ${MONTHS_PT[m - 1]} de ${y}`;
}

/** `2026-03-04`,`2026-03-11` → `4 – 11 de mar` (or spans months/years). */
export function formatDateRange(start: ISODate, end: ISODate): string {
  if (!isValidISODate(start) || !isValidISODate(end)) return `${start} – ${end}`;
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  if (sy === ey && sm === em) return `${sd} – ${ed} de ${MONTHS_PT[sm - 1]}`;
  if (sy === ey) return `${sd} de ${MONTHS_PT[sm - 1]} – ${ed} de ${MONTHS_PT[em - 1]}`;
  return `${formatLongDate(start)} – ${formatLongDate(end)}`;
}

/** `2026-03-04` → `qua, 4 de mar`. */
export function formatWeekdayDate(value: ISODate): string {
  if (!isValidISODate(value)) return value;
  const weekdays = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const date = parseISODate(value);
  return `${weekdays[date.getUTCDay()]}, ${formatShortDate(value)}`;
}

/** Normalises free-form time input to `HH:mm`, or `null` when unparseable. */
/**
 * "10:00:00" → "10:00". O que a pessoa lê é hora e minuto (§17 do handoff).
 *
 * O `time` do Postgres chega pelo PostgREST como `HH:MM:SS`, e o cartão da
 * Jornada mostrava exatamente isso: "01:59:00", "até 19:59:00". Os segundos
 * não dizem nada sobre um passeio, ocupam espaço numa linha que já disputa
 * lugar com as etiquetas, e empurravam "Compartilhado" para fora do cartão.
 *
 * O corte é só de APRESENTAÇÃO: quem guarda o valor continua guardando o que
 * veio. Devolve `undefined` para o que não é hora — melhor não mostrar nada do
 * que mostrar lixo formatado.
 */
export function formatClockTime(value?: string | null): string | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /^\s*(\d{1,2}):([0-5]\d)(?::[0-5]\d)?(?:\.\d+)?\s*$/.exec(value);
  if (!match) return undefined;
  const hours = Number(match[1]);
  if (hours > 23) return undefined;
  return `${String(hours).padStart(2, '0')}:${match[2]}`;
}

export function normalizeTime(value: string): string | null {
  const match = value.trim().match(/^(\d{1,2})[:h]?(\d{2})?$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** "há 2h", "agora", "há 3 dias" — used for cache freshness labels (§62). */
export function formatRelativeTime(timestamp: ISODateTime, now: Date = new Date()): string {
  const diffMs = now.getTime() - new Date(timestamp).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'há 1 dia' : `há ${days} dias`;
}
