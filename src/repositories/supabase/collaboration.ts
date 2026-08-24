/**
 * Colaboração, notificações, lembretes, reservas e sugestões — Postgres + RLS.
 *
 * DUAS FORMAS DE ESCREVER, E A DIFERENÇA IMPORTA
 *
 *  1. Tabela direta (`from('reminders').insert(...)`) para o que é dado: a RLS
 *     decide linha a linha e a policy é a autorização inteira.
 *
 *  2. `rpc(...)` para o que é PROTOCOLO: convidar, aceitar, recusar, mudar
 *     papel, remover, sair. Essas operações têm pré-condições que uma `with
 *     check` não expressa sem virar ilegível — não convidar duas vezes, não
 *     aceitar convite alheio, o proprietário não sair deixando a viagem sem
 *     dono. Elas moram em funções `security definer` (0008/0010), e
 *     `trip_members`/`trip_invites` não têm policy de escrita nenhuma. O
 *     cliente não escolhe qual caminho usar: só existe um.
 *
 * Nenhum método daqui recebe o `userId` de quem age para fins de autorização.
 * Onde ele aparece na assinatura é para montar chave de cache ou filtrar linha
 * própria — a identidade que vale é a do JWT.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  AppNotification,
  Reminder,
  Reservation,
  TripInvite,
  TripMember,
  TripSuggestion,
} from '@/domain/types';
import type { InvitableRole, TripRole } from '@/domain/collaboration';
import { parseReservationDetails, type ReservationType } from '@/domain/reservations';
import {
  MINIMUM_SUGGESTIONS,
  findSimilar,
  generatedSuggestionListSchema,
  normalizeGeneratedSuggestion,
  type SuggestionCategory,
} from '@/domain/suggestions';
import { DEFAULT_VISIBILITY, parseVisibility } from '@/domain/visibility';
import { config } from '@/lib/config';
import { nowISO } from '@/lib/date';
import { postJson } from '@/services/http';
import { deleteMirror } from '@/lib/fileMirror';
import { OrphanFileError, removeObjects } from './fileLifecycle';
import type {
  MembershipRepository,
  NotificationRepository,
  ReminderRepository,
  SuggestionRepository,
  TravelReservationRepository,
  UploadableFile,
  StoredFile,
} from '../types';

type Row = Record<string, any>;

export interface CollaborationDeps {
  db: () => SupabaseClient;
  unwrap: <T>(result: { data: T | null; error: { message: string } | null }) => T;
  unwrapList: <T>(result: { data: T[] | null; error: { message: string } | null }) => T[];
  prune: (row: Row) => Row;
  /** Cópia local quando existe, URL assinada quando não. Ver D-04. */
  openableUrl: (bucket: string, path: string | null) => Promise<string | undefined>;
  uploadAttachment: (userId: string, tripId: string, file: UploadableFile) => Promise<StoredFile>;
  attachmentsBucket: string;
}

/**
 * Traduz o erro do Postgres para algo que a tela possa mostrar.
 *
 * As funções da 0008 levantam exceções com mensagem escrita para o usuário
 * final ("Nenhuma conta Easy Trip com este e-mail"). O supabase-js as entrega
 * embrulhadas com prefixo de RPC e detalhes de conexão; sem esta função, a
 * tela mostraria o embrulho.
 */
function rpcError(error: { message: string; details?: string; hint?: string }): Error {
  const message = error.message ?? 'Não foi possível concluir a operação.';
  const clean = message.replace(/^.*?:\s*/, '').trim();
  return new Error(clean || message);
}

/* -------------------------------- mappers --------------------------------- */

const toMember = (row: Row, names: Record<string, string>): TripMember => ({
  id: row.id,
  tripId: row.trip_id,
  userId: row.user_id,
  role: row.role as TripRole,
  name: names[row.user_id],
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toInvite = (row: Row, names: Record<string, string>): TripInvite => ({
  id: row.id,
  tripId: row.trip_id,
  invitedUserId: row.invited_user_id,
  invitedBy: row.invited_by,
  role: row.role as InvitableRole,
  status: row.status,
  invitedName: names[row.invited_user_id],
  createdAt: row.created_at,
  respondedAt: row.responded_at ?? undefined,
});

const toNotification = (row: Row): AppNotification => ({
  id: row.id,
  userId: row.user_id,
  type: row.type,
  title: row.title,
  body: row.body ?? undefined,
  data: (row.data ?? {}) as AppNotification['data'],
  readAt: row.read_at ?? undefined,
  createdAt: row.created_at,
});

const toReminder = (row: Row): Reminder => ({
  id: row.id,
  userId: row.user_id,
  tripId: row.trip_id,
  entityType: row.entity_type,
  entityId: row.entity_id,
  anchor: row.anchor,
  remindAt: row.remind_at,
  title: row.title,
  body: row.body ?? undefined,
  sentAt: row.sent_at ?? undefined,
  createdAt: row.created_at,
});

const toSuggestion = (row: Row): TripSuggestion => ({
  id: row.id,
  tripId: row.trip_id,
  title: row.title,
  category: row.category as SuggestionCategory,
  description: row.description,
  placeName: row.place_name ?? undefined,
  area: row.area ?? undefined,
  latitude: row.latitude ?? undefined,
  longitude: row.longitude ?? undefined,
  estimatedDurationMinutes: row.estimated_duration_minutes ?? undefined,
  reason: row.reason ?? undefined,
  source: row.source,
  placeId: row.place_id ?? undefined,
  createdBy: row.created_by ?? undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/* ------------------------------- membership ------------------------------- */

export function createMembershipRepository(deps: CollaborationDeps): MembershipRepository {
  const { db, unwrapList } = deps;

  /**
   * Id → nome, e nada mais. Vem da função `trip_member_profiles`, que devolve
   * duas colunas para os viajantes desta viagem. `profiles` continua fechado
   * (§52): telefone, cidade e estilo de viagem não pertencem a quem divide um
   * roteiro.
   */
  async function memberNames(tripId: string): Promise<Record<string, string>> {
    const { data, error } = await db().rpc('trip_member_profiles', { target_trip: tripId });
    if (error) return {};
    return Object.fromEntries(
      ((data ?? []) as Row[]).map((row) => [row.user_id, row.name as string]),
    );
  }

  async function callRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await db().rpc(fn, args);
    if (error) throw rpcError(error);
    return data as T;
  }

  return {
    async listMembers(tripId) {
      const [names, result] = await Promise.all([
        memberNames(tripId),
        db().from('trip_members').select('*').eq('trip_id', tripId),
      ]);
      const rows = unwrapList<Row>(result);
      // Proprietário primeiro, depois por nome: a lista sempre abre dizendo de
      // quem é a viagem.
      return rows
        .map((row) => toMember(row, names))
        .sort((a, b) => {
          if (a.role === 'owner' && b.role !== 'owner') return -1;
          if (b.role === 'owner' && a.role !== 'owner') return 1;
          return (a.name ?? '').localeCompare(b.name ?? '', 'pt-BR');
        });
    },

    async listInvites(tripId) {
      const [names, result] = await Promise.all([
        memberNames(tripId),
        db()
          .from('trip_invites')
          .select('*')
          .eq('trip_id', tripId)
          .eq('status', 'pending')
          .order('created_at', { ascending: false }),
      ]);
      return unwrapList<Row>(result).map((row) => toInvite(row, names));
    },

    async listPendingInvitesForUser(userId) {
      const result = await db()
        .from('trip_invites')
        .select('*')
        .eq('invited_user_id', userId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      return unwrapList<Row>(result).map((row) => toInvite(row, {}));
    },

    async invite(tripId, email, role) {
      const row = await callRpc<Row>('create_trip_invite', {
        target_trip: tripId,
        target_email: email,
        target_role: role,
      });
      return toInvite(row, {});
    },

    async acceptInvite(inviteId) {
      const row = await callRpc<Row>('accept_trip_invite', { invite: inviteId });
      return toMember(row, {});
    },

    declineInvite: (inviteId) => callRpc<void>('decline_trip_invite', { invite: inviteId }),
    cancelInvite: (inviteId) => callRpc<void>('cancel_trip_invite', { invite: inviteId }),

    async setRole(tripId, userId, role) {
      const row = await callRpc<Row>('set_trip_member_role', {
        target_trip: tripId,
        target_user: userId,
        new_role: role,
      });
      return toMember(row, {});
    },

    removeMember: (tripId, userId) =>
      callRpc<void>('remove_trip_member', { target_trip: tripId, target_user: userId }),

    leave: (tripId) => callRpc<void>('leave_trip', { target_trip: tripId }),

    async myRole(tripId, userId) {
      const result = await db()
        .from('trip_members')
        .select('role')
        .eq('trip_id', tripId)
        .eq('user_id', userId)
        .maybeSingle();
      if (result.error) return null;
      return (result.data?.role as TripRole | undefined) ?? null;
    },
  };
}

/* ------------------------------ notifications ----------------------------- */

export function createNotificationRepository(deps: CollaborationDeps): NotificationRepository {
  const { db, unwrapList } = deps;

  return {
    async list(userId) {
      const result = await db()
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(100);
      return unwrapList<Row>(result).map(toNotification);
    },

    async markRead(id) {
      const { error } = await db()
        .from('notifications')
        .update({ read_at: nowISO() })
        .eq('id', id)
        .is('read_at', null);
      if (error) throw new Error(error.message);
    },

    async markAllRead(userId) {
      const { error } = await db()
        .from('notifications')
        .update({ read_at: nowISO() })
        .eq('user_id', userId)
        .is('read_at', null);
      if (error) throw new Error(error.message);
    },

    async remove(id) {
      const { error } = await db().from('notifications').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },

    /**
     * Sem push do sistema, quem entrega o lembrete é a abertura do aplicativo
     * (§33). A função no Postgres é a mesma que o cron chamaria, e o `sent_at`
     * é o que impede a entrega dupla quando os dois rodam.
     */
    async deliverDueReminders() {
      const { data, error } = await db().rpc('deliver_due_reminders');
      if (error) return 0;
      return typeof data === 'number' ? data : 0;
    },
  };
}

/* -------------------------------- reminders ------------------------------- */

export function createReminderRepository(deps: CollaborationDeps): ReminderRepository {
  const { db, unwrap, unwrapList, prune } = deps;

  return {
    async listByTrip(tripId, userId) {
      const result = await db()
        .from('reminders')
        .select('*')
        .eq('trip_id', tripId)
        .eq('user_id', userId);
      return unwrapList<Row>(result).map(toReminder);
    },

    async upsert(input) {
      const result = await db()
        .from('reminders')
        .upsert(
          prune({
            user_id: input.userId,
            trip_id: input.tripId,
            entity_type: input.entityType,
            entity_id: input.entityId,
            anchor: input.anchor,
            remind_at: input.remindAt,
            title: input.title,
            body: input.body,
            // Reajustar o "quanto antes" repõe o lembrete. Sem zerar `sent_at`,
            // um lembrete já entregue nunca mais dispararia.
            sent_at: null,
          }),
          { onConflict: 'user_id,entity_type,entity_id,anchor' },
        )
        .select()
        .single();
      return toReminder(unwrap<Row>(result));
    },

    async remove(id) {
      const { error } = await db().from('reminders').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },

    async removeForEntity(userId, entityId, anchor) {
      const { error } = await db()
        .from('reminders')
        .delete()
        .eq('user_id', userId)
        .eq('entity_id', entityId)
        .eq('anchor', anchor);
      if (error) throw new Error(error.message);
    },
  };
}

/* ------------------------------- reservations ----------------------------- */

export function createTravelReservationRepository(
  deps: CollaborationDeps,
): TravelReservationRepository {
  const { db, unwrap, unwrapList, prune, openableUrl, uploadAttachment, attachmentsBucket } = deps;

  /**
   * A linha vira `Reservation`. `reference` é o localizador — não há coluna
   * `confirmation_code` nova de propósito: duas colunas para o mesmo dado
   * garantiriam que metade das telas leria a errada (0011).
   */
  async function toReservation(row: Row): Promise<Reservation> {
    return {
      id: row.id,
      tripId: row.trip_id,
      createdBy: row.created_by ?? row.user_id ?? undefined,
      visibility: parseVisibility(row.visibility, DEFAULT_VISIBILITY.reservation),
      type: row.type as ReservationType,
      title: row.title,
      provider: row.provider ?? undefined,
      confirmationCode: row.reference ?? undefined,
      startAt: row.start_date_time ?? undefined,
      endAt: row.end_date_time ?? undefined,
      origin: row.origin ?? undefined,
      destination: row.destination ?? undefined,
      address: row.address ?? undefined,
      notes: row.notes ?? undefined,
      status: row.status ?? 'confirmed',
      details: parseReservationDetails(row.type as ReservationType, row.details),
      filePath: row.file_path ?? undefined,
      fileUrl: await openableUrl(attachmentsBucket, row.file_path),
      mimeType: row.mime_type ?? undefined,
      legacyType: row.legacy_type ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at ?? row.created_at,
    };
  }

  const toRow = (input: Partial<Reservation> & { tripId?: string; createdBy?: string }): Row =>
    prune({
      trip_id: input.tripId,
      // `user_id` continua sendo NOT NULL desde a 0001 e sempre significou o
      // criador. Preenchê-lo mantém a linha válida sem precisar de migration
      // destrutiva; `created_by` é escrito pelo trigger, a partir do JWT.
      user_id: input.createdBy,
      type: input.type,
      title: input.title,
      provider: input.provider,
      reference: input.confirmationCode,
      start_date_time: input.startAt,
      end_date_time: input.endAt,
      origin: input.origin,
      destination: input.destination,
      address: input.address,
      notes: input.notes,
      status: input.status,
      details: input.details,
      visibility: input.visibility,
      file_path: input.filePath,
      mime_type: input.mimeType,
    });

  return {
    async listByTrip(tripId) {
      const result = await db()
        .from('tickets')
        .select('*')
        .eq('trip_id', tripId)
        .order('start_date_time', { ascending: true, nullsFirst: false });
      return Promise.all(unwrapList<Row>(result).map(toReservation));
    },

    async create(input) {
      const result = await db()
        .from('tickets')
        .insert(
          toRow({
            ...input,
            visibility: input.visibility ?? DEFAULT_VISIBILITY.reservation,
          }),
        )
        .select()
        .single();
      return toReservation(unwrap<Row>(result));
    },

    async update(id, patch) {
      const result = await db().from('tickets').update(toRow(patch)).eq('id', id).select().single();
      return toReservation(unwrap<Row>(result));
    },

    /**
     * Apaga a reserva, o documento e — pelo trigger da 0011 — os lembretes que
     * qualquer membro tinha nela.
     *
     * ORDEM: arquivo primeiro, linha depois (a mesma do `fileLifecycle`). Se a
     * linha saísse antes e a remoção do arquivo falhasse, sobraria lixo
     * invisível: sem a linha, ninguém sabe mais qual caminho remover.
     *
     * O CASO NOVO DA COLABORAÇÃO: um editor pode apagar uma reserva
     * compartilhada que OUTRA pessoa criou, e o arquivo dela vive sob o prefixo
     * `{uid-do-criador}/`. A policy de Storage não deixa o editor removê-lo — e
     * está certa: ele não pode escrever na pasta de outra conta.
     *
     * Então o arquivo fica. Isso NÃO é vazamento: a leitura compartilhada
     * depende de `can_read_shared_attachment` (0009), que exige uma linha
     * `shared` apontando para aquele caminho. Sem a linha, o objeto volta a ser
     * alcançável apenas por quem o enviou. Apagar a reserva revoga o acesso de
     * todo mundo automaticamente; o que sobra é um arquivo na própria pasta do
     * criador, que ele mesmo pode remover.
     *
     * A alternativa — recusar a exclusão — deixaria uma reserva cancelada presa
     * no roteiro do grupo porque quem a criou não está por perto.
     */
    async remove(id) {
      const existing = await db()
        .from('tickets')
        .select('file_path, created_by, user_id')
        .eq('id', id)
        .maybeSingle();

      const row = existing.data as Row | null;
      const path: string | undefined = row?.file_path ?? undefined;
      const viewer = (await db().auth.getSession()).data.session?.user.id ?? null;
      const owner: string | undefined = row?.created_by ?? row?.user_id ?? undefined;

      if (path && viewer && owner === viewer) {
        const surviving = await removeObjects({ db, userId: viewer }, attachmentsBucket, [path]);
        // Só falha quando o arquivo é DESTA pessoa e ainda assim resistiu: aí é
        // erro de verdade, e apagar a linha criaria o órfão do P-07.
        if (surviving.length > 0) throw new OrphanFileError(surviving);
        deleteMirror(attachmentsBucket, path);
      }

      const { error } = await db().from('tickets').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },

    uploadDocument: uploadAttachment,
  };
}

/* ------------------------------- suggestions ------------------------------ */

interface SuggestionTripInfo {
  id: string;
  destinationCity: string;
  destinationCountry: string;
  startDate: string;
  endDate: string;
  suggestionsRefreshedAt?: string;
}

export function createSuggestionRepository(
  deps: CollaborationDeps,
  getTrip: (tripId: string) => Promise<SuggestionTripInfo | null>,
  getAccessToken: () => Promise<string | undefined>,
): SuggestionRepository {
  const { db, unwrapList } = deps;

  async function readAll(tripId: string): Promise<TripSuggestion[]> {
    const result = await db()
      .from('trip_suggestions')
      .select('*')
      .eq('trip_id', tripId)
      .order('created_at', { ascending: true });
    return unwrapList<Row>(result).map(toSuggestion);
  }

  /**
   * Primeiro o catálogo real (§41.1).
   *
   * Um lugar de `public.places` tem nome verificado, endereço e coordenada de
   * verdade. Uma sugestão da IA tem uma descrição plausível. Entre as duas, a
   * primeira ganha sempre — a IA entra para completar o que falta, não para
   * substituir o que já existe.
   */
  async function seedFromCatalog(
    trip: SuggestionTripInfo,
    existing: TripSuggestion[],
  ): Promise<number> {
    const result = await db()
      .from('places')
      .select('*')
      .ilike('city', trip.destinationCity)
      .limit(12);
    const places = unwrapList<Row>(result);

    const rows = places
      .filter((place) => !findSimilar({ title: place.name, latitude: place.latitude, longitude: place.longitude }, existing))
      .map((place) => ({
        trip_id: trip.id,
        title: place.name,
        category: catalogCategory(place.type),
        description: place.description ?? `${place.name}, em ${place.city}.`,
        place_name: place.name,
        area: place.address ?? null,
        latitude: place.latitude ?? null,
        longitude: place.longitude ?? null,
        reason: `Está no catálogo do Easy Trip para ${place.city}.`,
        source: 'catalog',
        place_id: place.id,
      }));

    if (rows.length === 0) return 0;

    // `ignoreDuplicates` porque outro membro pode ter aberto a tela ao mesmo
    // tempo: o índice único de título por viagem é quem arbitra, e a segunda
    // inserção não deve virar erro na tela de quem chegou depois.
    const { error } = await db()
      .from('trip_suggestions')
      .upsert(rows, { onConflict: 'trip_id,title', ignoreDuplicates: true });
    if (error) return 0;
    return rows.length;
  }

  /**
   * Só depois do catálogo, e só quando ainda falta.
   *
   * A Edge Function devolve saída estruturada validada por
   * `generatedSuggestionListSchema` — sem URL, sem preço, sem nota, sem
   * horário. O que ela não conseguir preencher fica vazio; nada é completado
   * com valor plausível.
   */
  async function seedFromAi(
    trip: SuggestionTripInfo,
    existing: TripSuggestion[],
  ): Promise<number> {
    if (!config.hasBff) return 0;

    let payload: { suggestions?: unknown };
    try {
      const accessToken = await getAccessToken();
      payload = await postJson<{ suggestions?: unknown }>(
        `${config.bffUrl.replace(/\/$/, '')}/trip-suggestions`,
        {
          tripId: trip.id,
          destinationCity: trip.destinationCity,
          destinationCountry: trip.destinationCountry,
          startDate: trip.startDate,
          endDate: trip.endDate,
          existingTitles: existing.map((s) => s.title),
        },
        { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} },
      );
    } catch {
      // A tela já sabe lidar com "menos que o mínimo": ela mostra o que há e
      // explica. Melhor do que um erro vermelho por cima de sugestões que
      // vieram do catálogo e estão perfeitamente válidas.
      return 0;
    }

    const parsed = generatedSuggestionListSchema.safeParse(payload);
    if (!parsed.success) return 0;

    const rows = parsed.data.suggestions
      .map(normalizeGeneratedSuggestion)
      .filter((suggestion) => !findSimilar(suggestion, existing))
      .map((suggestion) => ({
        trip_id: trip.id,
        title: suggestion.title,
        category: suggestion.category,
        description: suggestion.description,
        place_name: suggestion.placeName ?? null,
        area: suggestion.area ?? null,
        latitude: suggestion.latitude ?? null,
        longitude: suggestion.longitude ?? null,
        estimated_duration_minutes: suggestion.estimatedDurationMinutes ?? null,
        reason: suggestion.reason ?? null,
        source: 'ai',
      }));

    if (rows.length === 0) return 0;

    const { error } = await db()
      .from('trip_suggestions')
      .upsert(rows, { onConflict: 'trip_id,title', ignoreDuplicates: true });
    return error ? 0 : rows.length;
  }

  return {
    listByTrip: readAll,

    async ensure(tripId, options) {
      const existing = await readAll(tripId);
      if (!options?.force && existing.length >= MINIMUM_SUGGESTIONS) return existing;

      const trip = await getTrip(tripId);
      if (!trip) return existing;

      const afterCatalog = (await seedFromCatalog(trip, existing)) > 0 ? await readAll(tripId) : existing;

      if (afterCatalog.length < MINIMUM_SUGGESTIONS || options?.force) {
        await seedFromAi(trip, afterCatalog);
      }

      // A marca d'água é escrita mesmo quando nada novo entrou: ela responde
      // "quando tentamos pela última vez", e é isso que limita o botão
      // "Atualizar sugestões" (§43). Se só fosse escrita em caso de sucesso,
      // uma viagem sem catálogo e sem BFF geraria uma chamada por toque.
      await db()
        .from('trips')
        .update({ suggestions_refreshed_at: nowISO() })
        .eq('id', tripId);

      return readAll(tripId);
    },

    async remove(id) {
      const { error } = await db().from('trip_suggestions').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
  };
}

function catalogCategory(type: string): SuggestionCategory {
  if (type === 'restaurant') return 'gastronomia';
  if (type === 'attraction') return 'atracoes';
  return 'lugares';
}
