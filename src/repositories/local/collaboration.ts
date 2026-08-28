/**
 * Colaboração, notificações, lembretes, reservas e sugestões — fonte local.
 *
 * O QUE É REAL AQUI E O QUE NÃO É (§68)
 *
 * O modo demonstração guarda de verdade tudo o que depende só deste aparelho:
 * reservas, lembretes, notificações e a entrega de um lembrete vencido
 * funcionam inteiras, com persistência real, e sobrevivem a fechar o
 * aplicativo. Sugestões também — vindas do catálogo de lugares que já está
 * embarcado, marcadas honestamente como `catalog`.
 *
 * O que NÃO funciona é o que exige uma segunda pessoa: convidar, aceitar,
 * mudar permissão. Não existe segunda conta neste modo, e não há servidor para
 * mediar. A resposta a isso não é um botão que finge ter enviado um convite —
 * é `DemoUnavailableError`, que a tela transforma em "Disponível quando
 * conectado". Um convite falso seria a pior coisa que este arquivo poderia
 * fazer: a pessoa acharia que a viagem foi compartilhada.
 */

import { PLACES } from '@/data/catalog';
import type {
  AppNotification,
  Reminder,
  Reservation,
  TripMember,
  TripSuggestion,
} from '@/domain/types';
import type { NotificationData } from '@/domain/notifications';
import type { SuggestionCategory } from '@/domain/suggestions';
import { MINIMUM_SUGGESTIONS } from '@/domain/suggestions';
import { DEFAULT_VISIBILITY } from '@/domain/visibility';
import { ATTACHMENT_POLICY, validateUpload } from '@/domain/upload';
import { nowISO } from '@/lib/date';
import { deleteStoredFile, persistFile } from '@/lib/files';
import { createId } from '@/lib/id';
import type {
  MembershipRepository,
  NotificationRepository,
  ReminderRepository,
  SuggestionRepository,
  TravelReservationRepository,
} from '../types';
import { LocalCollection } from './collection';

/**
 * O erro que a interface reconhece para dizer "Disponível quando conectado".
 *
 * Um tipo próprio, e não uma `Error` com mensagem combinada: a tela precisa
 * distinguir "este recurso não existe neste modo" de "deu erro ao convidar", e
 * comparar strings de mensagem seria uma ligação que quebra na primeira revisão
 * de texto.
 */
export class DemoUnavailableError extends Error {
  constructor(readonly feature: string) {
    super(`${feature} exige conexão com o Easy Trip.`);
    this.name = 'DemoUnavailableError';
  }
}

export const notifications = new LocalCollection<AppNotification>('notifications');
export const reminders = new LocalCollection<Reminder>('reminders');
export const travelReservations = new LocalCollection<Reservation>('travelReservations');
export const suggestions = new LocalCollection<TripSuggestion>('tripSuggestions');

/* -------------------------------- membros --------------------------------- */

/**
 * A viagem local tem um membro: quem a criou.
 *
 * A lista existe de verdade (e não devolve vazio) para que a tela de Viajantes
 * seja a mesma nos dois modos — mostrando "Você · Proprietário" e explicando
 * que convidar exige conexão. Uma tela que só existisse conectada teria de ser
 * escrita duas vezes.
 */
export function createLocalMembership(
  tripOwner: (tripId: string) => Promise<string | null>,
): MembershipRepository {
  const unavailable = (feature: string) => () => Promise.reject(new DemoUnavailableError(feature));

  return {
    // O modo local não possui colaboração histórica nem diretório de perfis.
    // A lista ativa abaixo continua resolvendo o proprietário e a UI omite o
    // rótulo de autoria quando não há um nome confirmado.
    async memberNames() {
      return {};
    },
    async listMembers(tripId) {
      const ownerId = await tripOwner(tripId);
      if (!ownerId) return [];
      const timestamp = nowISO();
      return [
        {
          id: `${tripId}:${ownerId}`,
          tripId,
          userId: ownerId,
          role: 'owner',
          createdAt: timestamp,
          updatedAt: timestamp,
        } satisfies TripMember,
      ];
    },
    listInvites: async () => [],
    listPendingInvitesForUser: async () => [],
    invite: unavailable('Convidar viajantes'),
    acceptInvite: unavailable('Aceitar convites'),
    declineInvite: unavailable('Recusar convites'),
    cancelInvite: unavailable('Cancelar convites'),
    setRole: unavailable('Alterar permissões'),
    removeMember: unavailable('Remover viajantes'),
    transferOwnership: unavailable('Transferir a propriedade da viagem'),
    leave: unavailable('Sair da viagem'),
    async myRole(tripId, userId) {
      const ownerId = await tripOwner(tripId);
      return ownerId && ownerId === userId ? 'owner' : null;
    },
  };
}

/* ----------------------------- notificações ------------------------------- */

export const localNotificationRepository: NotificationRepository = {
  async list(userId) {
    const rows = await notifications.find((n) => n.userId === userId);
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },
  async markRead(id) {
    await notifications.update(id, { readAt: nowISO() });
  },
  async markAllRead(userId) {
    const pending = await notifications.find((n) => n.userId === userId && !n.readAt);
    const readAt = nowISO();
    for (const item of pending) await notifications.update(item.id, { readAt });
  },
  remove: (id) => notifications.remove(id),

  /**
   * A mesma regra da função `deliver_due_reminders` do Postgres (0010), no
   * aparelho: lembrete vencido e ainda não entregue vira notificação, e
   * `sentAt` é o que impede a segunda entrega.
   */
  async deliverDueReminders(userId) {
    const now = Date.now();
    const due = await reminders.find(
      (r) => r.userId === userId && !r.sentAt && new Date(r.remindAt).getTime() <= now,
    );

    for (const reminder of due) {
      await reminders.update(reminder.id, { sentAt: nowISO() });
      const data: NotificationData = {
        tripId: reminder.tripId,
        entityType: reminder.entityType,
        entityId: reminder.entityId,
        reminderId: reminder.id,
      };
      await notifications.insert({
        id: createId(),
        userId,
        type: reminder.entityType === 'reservation' ? 'reservation_reminder' : 'trip_reminder',
        title: reminder.title,
        body: reminder.body,
        data,
        createdAt: nowISO(),
      });
    }

    return due.length;
  },
};

/* -------------------------------- lembretes ------------------------------- */

export const localReminderRepository: ReminderRepository = {
  listByTrip: (tripId, userId) =>
    reminders.find((r) => r.tripId === tripId && r.userId === userId),

  async upsert(input) {
    const existing = await reminders.find(
      (r) =>
        r.userId === input.userId &&
        r.entityType === input.entityType &&
        r.entityId === input.entityId &&
        r.anchor === input.anchor,
    );
    // Trocar o "quanto antes" repõe o lembrete: `sentAt` volta a ficar vazio,
    // senão um lembrete já entregue nunca mais dispararia depois de reajustado.
    if (existing[0]) {
      return reminders.update(existing[0].id, { ...input, sentAt: undefined });
    }
    return reminders.insert({ ...input, id: createId(), createdAt: nowISO() });
  },

  remove: (id) => reminders.remove(id),

  async removeForEntity(userId, entityId, anchor) {
    await reminders.removeWhere(
      (r) => r.userId === userId && r.entityId === entityId && r.anchor === anchor,
    );
  },
};

/* -------------------------------- reservas -------------------------------- */

export const localTravelReservationRepository: TravelReservationRepository = {
  async listByTrip(tripId) {
    const rows = await travelReservations.find((r) => r.tripId === tripId);
    return rows.sort((a, b) => (a.startAt ?? '') .localeCompare(b.startAt ?? ''));
  },
  async create(input) {
    const timestamp = nowISO();
    return travelReservations.insert({
      ...input,
      visibility: input.visibility ?? DEFAULT_VISIBILITY.reservation,
      id: createId(),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  },
  update: (id, patch) => travelReservations.update(id, { ...patch, updatedAt: nowISO() }),
  async remove(id) {
    const reservation = await travelReservations.byId(id);
    if (reservation?.fileUrl) deleteStoredFile(reservation.fileUrl);
    await reminders.removeWhere((r) => r.entityId === id && r.entityType === 'reservation');
    await travelReservations.remove(id);
  },
  async uploadDocument(_userId, tripId, file) {
    // A mesma política do adaptador remoto: o que a tela aceita não pode
    // depender de o aplicativo estar conectado.
    const validation = validateUpload(file, ATTACHMENT_POLICY);
    if (!validation.ok) throw new Error(validation.message);
    return persistFile(['reservations', tripId], file);
  },
};

/* ------------------------------- sugestões -------------------------------- */

/**
 * Sugestões locais saem do catálogo embarcado, e só dele.
 *
 * Não há Gemini neste modo — não há BFF. Então `ensure` faz o que pode fazer
 * honestamente: procura lugares reais da cidade do destino e os transforma em
 * sugestões marcadas como `catalog`. Se o catálogo não conhecer a cidade, a
 * lista volta menor que o mínimo, e a tela diz isso em vez de inventar.
 */
export function createLocalSuggestions(
  tripCity: (tripId: string) => Promise<string | null>,
): SuggestionRepository {
  return {
    async listByTrip(tripId) {
      const rows = await suggestions.find((s) => s.tripId === tripId);
      return rows.sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
    },

    async ensure(tripId, options) {
      const existing = await suggestions.find((s) => s.tripId === tripId);
      if (!options?.force && existing.length >= MINIMUM_SUGGESTIONS) return existing;

      const city = await tripCity(tripId);
      if (!city) return existing;

      const known = new Set(existing.map((s) => s.title.toLowerCase()));
      const candidates = PLACES.filter(
        (place) => place.city.toLowerCase() === city.toLowerCase(),
      ).filter((place) => !known.has(place.name.toLowerCase()));

      const timestamp = nowISO();
      for (const place of candidates.slice(0, 8)) {
        await suggestions.insert({
          id: createId(),
          tripId,
          title: place.name,
          category: categoryForPlace(place.type),
          // A descrição vem do catálogo. Preço, nota e horário ficam de fora
          // de propósito (§41): eles envelhecem, e uma sugestão não é a ficha
          // do lugar — quem quer o detalhe abre a ficha, onde o dado tem data.
          description: place.description ?? `${place.name}, em ${place.city}.`,
          placeName: place.name,
          area: place.address ?? undefined,
          latitude: place.latitude,
          longitude: place.longitude,
          reason: `Está no catálogo do Easy Trip para ${place.city}.`,
          source: 'catalog',
          placeId: place.id,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }

      return suggestions.find((s) => s.tripId === tripId);
    },

    remove: (id) => suggestions.remove(id),
  };
}

function categoryForPlace(type: 'hotel' | 'restaurant' | 'attraction'): SuggestionCategory {
  if (type === 'restaurant') return 'gastronomia';
  if (type === 'attraction') return 'atracoes';
  return 'lugares';
}
