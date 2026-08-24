/**
 * Central de notificações (§7, §32, §54).
 *
 * O sino passa a ter duas fontes, e a diferença entre elas não é cosmética:
 *
 *   DERIVADAS   `useAlerts` — "orçamento perto do limite", "3 itens pendentes".
 *               Recalculadas a partir do estado atual, sempre verdadeiras
 *               agora, sem estado de lido porque não há o que ler: some quando
 *               deixa de ser verdade.
 *
 *   PERSISTIDAS este arquivo — "João convidou você", "Check-in amanhã".
 *               São EVENTOS: têm instante, precisam de lido/não lido, e não
 *               podem ser recalculadas porque o que as originou pode não
 *               existir mais.
 *
 * Só as persistidas contam para o badge. Se as derivadas contassem, o número
 * nunca chegaria a zero — um orçamento em 85% ficaria eternamente "não lido".
 */

import type { ISODateTime } from './types';
import type { InvitableRole } from './collaboration';

export const NOTIFICATION_TYPES = [
  'trip_invite',
  'trip_invite_accepted',
  'trip_member_removed',
  'trip_role_changed',
  'trip_daily_briefing',
  'reservation_reminder',
  'trip_reminder',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * O que a notificação carrega para saber para onde levar e o que oferecer.
 *
 * Nunca texto de exibição: `title` e `body` são congelados no instante do
 * evento, e é isso que faz "João convidou você para Paris" continuar legível
 * depois que a viagem for renomeada ou o convite respondido.
 */
export interface NotificationData {
  tripId?: string;
  inviteId?: string;
  role?: InvitableRole;
  destination?: string;
  startDate?: string;
  endDate?: string;
  entityType?: string;
  entityId?: string;
  reminderId?: string;
  /** Data local da viagem, para o briefing. Ver `getZoneDate`. */
  date?: string;
}

export interface AppNotification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  data: NotificationData;
  readAt?: ISODateTime;
  createdAt: ISODateTime;
}

export function isUnread(notification: AppNotification): boolean {
  return !notification.readAt;
}

export function unreadCount(notifications: AppNotification[]): number {
  return notifications.reduce((total, item) => (isUnread(item) ? total + 1 : total), 0);
}

/**
 * Um convite só é acionável enquanto está pendente.
 *
 * A notificação de convite é apagada pelo banco quando o convite é respondido
 * (0010), então na prática esta função quase nunca devolve `false` para uma
 * notificação viva. "Quase nunca" não é "nunca": entre o toque em Aceitar e a
 * lista ser recarregada, os botões continuam na tela, e sem esta checagem o
 * segundo toque produziria um erro em vez de nada.
 */
export function isActionableInvite(notification: AppNotification): boolean {
  return notification.type === 'trip_invite' && Boolean(notification.data.inviteId);
}

/** Para onde a notificação leva quando tocada. `undefined` = não leva a lugar nenhum. */
export function notificationHref(notification: AppNotification): string | undefined {
  const { tripId, entityType } = notification.data;
  if (!tripId) return undefined;

  switch (notification.type) {
    case 'reservation_reminder':
      return `/trip/${tripId}/reservations`;
    case 'trip_reminder':
      return entityType === 'itinerary_item' ? `/trip/${tripId}/itinerary` : `/trip/${tripId}`;
    case 'trip_daily_briefing':
      return `/trip/${tripId}/itinerary`;
    case 'trip_role_changed':
    case 'trip_invite_accepted':
      return `/trip/${tripId}/members`;
    case 'trip_member_removed':
      // A viagem não é mais alcançável — levar para lá daria um 404 com cara
      // de defeito, quando a informação é justamente que o acesso acabou.
      return undefined;
    default:
      return undefined;
  }
}
