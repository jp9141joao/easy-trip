import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Reminder, Reservation } from '@/domain/types';
import { anchorLabel, type ReservationType } from '@/domain/reservations';
import { computeRemindAt, type ReminderAnchor } from '@/domain/reminders';
import { useAuth } from '@/providers/AuthProvider';
import { dataSource, type UploadableFile } from '@/repositories';
import { queryKeys } from './queryKeys';

/**
 * Reservas de viagem (§22–§29).
 *
 * O que a interface chama de "Reservas" é o que a 0011 continua guardando na
 * tabela `tickets` — o nome da tabela é histórico e renomeá-lo custaria uma
 * migration destrutiva sobre dados em produção sem mudar nada que o usuário
 * perceba. Deste arquivo para cima, "ticket" não existe mais.
 */
export function useReservations(tripId?: string) {
  return useQuery({
    queryKey: queryKeys.tripReservations(tripId ?? 'none'),
    queryFn: () => dataSource.travelReservations.listByTrip(tripId!),
    enabled: Boolean(tripId),
  });
}

export type ReservationInput = Omit<
  Reservation,
  'id' | 'tripId' | 'createdAt' | 'updatedAt' | 'filePath' | 'fileUrl' | 'mimeType' | 'createdBy'
>;

export function useReservationMutations(tripId: string) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.tripReservations(tripId) });

  const create = useMutation({
    mutationFn: async ({ input, file }: { input: ReservationInput; file?: UploadableFile }) => {
      // O documento sobe ANTES do registro. Se a ordem fosse a inversa e o
      // upload falhasse, sobraria uma reserva prometendo um anexo que não
      // existe — e a tela não teria como distinguir isso de "ainda carregando".
      const stored = file
        ? await dataSource.travelReservations.uploadDocument(user!.id, tripId, file)
        : undefined;

      return dataSource.travelReservations.create({
        ...input,
        tripId,
        createdBy: user!.id,
        filePath: stored?.url,
        mimeType: stored?.mimeType,
      });
    },
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: async ({
      id,
      patch,
      file,
    }: {
      id: string;
      patch: Partial<Reservation>;
      file?: UploadableFile;
    }) => {
      const stored = file
        ? await dataSource.travelReservations.uploadDocument(user!.id, tripId, file)
        : undefined;
      return dataSource.travelReservations.update(id, {
        ...patch,
        ...(stored ? { filePath: stored.url, mimeType: stored.mimeType } : {}),
      });
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => dataSource.travelReservations.remove(id),
    onSuccess: async () => {
      await Promise.all([
        invalidate(),
        // Os lembretes daquela reserva somem junto (trigger da 0011). Sem esta
        // invalidação a tela continuaria mostrando o sino aceso para uma
        // reserva que não existe mais.
        queryClient.invalidateQueries({
          queryKey: queryKeys.reminders(tripId, user?.id ?? 'anonymous'),
        }),
      ]);
    },
  });

  return { create, update, remove };
}

/* -------------------------------- lembretes ------------------------------- */

export function useReminders(tripId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: queryKeys.reminders(tripId ?? 'none', user?.id ?? 'anonymous'),
    queryFn: () => dataSource.reminders.listByTrip(tripId!, user!.id),
    enabled: Boolean(tripId && user?.id),
  });
}

/**
 * Ativar/desativar "🔔 Me lembrar" para um instante de uma reserva.
 *
 * O lembrete é do usuário, e por isso a mutação não pergunta permissão de
 * edição: um `viewer` pode ativar lembretes nas reservas que enxerga. Ele não
 * está mudando a viagem — está mudando a própria agenda (§31).
 */
export function useReminderMutations(tripId: string) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: queryKeys.reminders(tripId, user?.id ?? 'anonymous'),
    });

  const set = useMutation({
    mutationFn: async ({
      reservation,
      anchor,
      minutesBefore,
    }: {
      reservation: Reservation;
      anchor: ReminderAnchor;
      minutesBefore: number;
    }) => {
      const anchorAt = anchor === 'start' ? reservation.startAt : reservation.endAt;
      const remindAt = computeRemindAt(anchorAt, minutesBefore);

      // `computeRemindAt` devolve vazio quando o instante já passou. Criar o
      // lembrete assim mesmo faria a Central anunciar "Check-in amanhã" para um
      // check-in de ontem na próxima abertura.
      if (!remindAt) {
        throw new Error('Este horário já passou — não dá para criar um lembrete para ele.');
      }

      return dataSource.reminders.upsert({
        userId: user!.id,
        tripId,
        entityType: 'reservation',
        entityId: reservation.id,
        anchor,
        remindAt,
        title: `${anchorLabel(reservation.type, anchor)} — ${reservation.title}`,
        body: reservationReminderBody(reservation, anchor),
      });
    },
    onSuccess: invalidate,
  });

  const clear = useMutation({
    mutationFn: ({ entityId, anchor }: { entityId: string; anchor: ReminderAnchor }) =>
      dataSource.reminders.removeForEntity(user!.id, entityId, anchor),
    onSuccess: invalidate,
  });

  return { set, clear };
}

function reservationReminderBody(reservation: Reservation, anchor: ReminderAnchor): string {
  const at = anchor === 'start' ? reservation.startAt : reservation.endAt;
  const time = at
    ? new Date(at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : undefined;
  const place = reservation.address ?? reservation.origin ?? reservation.provider;
  return [place, time && `${anchorLabel(reservation.type, anchor)} às ${time}`]
    .filter(Boolean)
    .join(' · ');
}

/** O lembrete configurado para um instante, se houver. */
export function findReminder(
  reminders: Reminder[],
  entityId: string,
  anchor: ReminderAnchor,
): Reminder | undefined {
  return reminders.find((r) => r.entityId === entityId && r.anchor === anchor);
}

/** Reservas agrupadas por modalidade, na ordem das categorias (§23). */
export function groupReservations(
  reservations: Reservation[],
): Record<ReservationType, Reservation[]> {
  const groups = {} as Record<ReservationType, Reservation[]>;
  for (const reservation of reservations) {
    (groups[reservation.type] ??= []).push(reservation);
  }
  return groups;
}
