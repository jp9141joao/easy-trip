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
  normalizeGeneratedSuggestion,
  partialSuggestionListSchema,
  suggestionRefreshWindow,
  type GeneratedSuggestion,
  SuggestionGenerationError,
  type SuggestionAttemptDiagnostics,
  type SuggestionCategory,
} from '@/domain/suggestions';
import { DEFAULT_VISIBILITY, parseVisibility } from '@/domain/visibility';
import { config } from '@/lib/config';
import { nowISO } from '@/lib/date';
import { postJson, ServiceError } from '@/services/http';
import { deleteMirror } from '@/lib/fileMirror';
import { OrphanFileError, removeObjects } from './fileLifecycle';
import {
  throwBackendError,
  toBackendCapabilityError,
} from '../backendCapabilities';
import type {
  MembershipRepository,
  NotificationRepository,
  PushTokenRepository,
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
  const { db } = deps;

  /**
   * Id → nome, e nada mais. Vem da função `trip_member_profiles`, que devolve
   * duas colunas para os viajantes desta viagem. `profiles` continua fechado
   * (§52): telefone, cidade e estilo de viagem não pertencem a quem divide um
   * roteiro.
   */
  async function memberNames(tripId: string): Promise<Record<string, string>> {
    const { data, error } = await db().rpc('trip_member_profiles', { target_trip: tripId });
    if (error) {
      throwBackendError(
        error,
        'MISSING_TRIP_MEMBERS',
        'Não foi possível carregar os nomes dos viajantes.',
      );
    }
    return Object.fromEntries(
      ((data ?? []) as Row[]).map((row) => [row.user_id, row.name as string]),
    );
  }

  async function callRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await db().rpc(fn, args);
    if (error) {
      const capabilityError = toBackendCapabilityError(error, 'MISSING_TRIP_MEMBERS');
      if (capabilityError) throwBackendError(error, 'MISSING_TRIP_MEMBERS');
      throw rpcError(error);
    }
    return data as T;
  }

  return {
    memberNames,

    async listMembers(tripId) {
      const [names, result] = await Promise.all([
        memberNames(tripId),
        db().from('trip_members').select('*').eq('trip_id', tripId),
      ]);
      if (result.error) {
        throwBackendError(
          result.error,
          'MISSING_TRIP_MEMBERS',
          'Não foi possível carregar os viajantes.',
        );
      }
      const rows = (result.data ?? []) as Row[];
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
      if (result.error) {
        throwBackendError(
          result.error,
          'MISSING_TRIP_MEMBERS',
          'Não foi possível carregar os convites.',
        );
      }
      return ((result.data ?? []) as Row[]).map((row) => toInvite(row, names));
    },

    async listPendingInvitesForUser(userId) {
      const result = await db()
        .from('trip_invites')
        .select('*')
        .eq('invited_user_id', userId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      if (result.error) {
        throwBackendError(
          result.error,
          'MISSING_TRIP_MEMBERS',
          'Não foi possível carregar os convites recebidos.',
        );
      }
      return ((result.data ?? []) as Row[]).map((row) => toInvite(row, {}));
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

    async transferOwnership(tripId, userId) {
      // RPC, e não dois UPDATE. A propriedade mora em `trips.user_id` E em
      // `trip_members.role` (as duas pernas de `is_trip_owner`, 0008), e
      // gravá-las daqui seriam duas requisições: uma falha entre elas deixaria
      // a viagem com dois donos ou nenhum. `transfer_trip_ownership` (0014)
      // grava as duas numa transação só.
      const row = await callRpc<Row>('transfer_trip_ownership', {
        target_trip: tripId,
        new_owner: userId,
      });
      return toMember(row, {});
    },

    leave: (tripId) => callRpc<void>('leave_trip', { target_trip: tripId }),

    async myRole(tripId, userId) {
      const result = await db()
        .from('trip_members')
        .select('role')
        .eq('trip_id', tripId)
        .eq('user_id', userId)
        .maybeSingle();
      if (result.error) {
        throwBackendError(
          result.error,
          'MISSING_TRIP_MEMBERS',
          'Não foi possível confirmar a permissão nesta viagem.',
        );
      }
      return (result.data?.role as TripRole | undefined) ?? null;
    },
  };
}

/* ------------------------------- push tokens ------------------------------ */

/**
 * O endereço de entrega deste aparelho (§33, migration 0016).
 *
 * Por RPC nos dois casos, e não `insert`/`delete` diretos, porque as duas
 * operações têm pré-condição que uma `with check` não expressa:
 *
 *   registrar   o token pode já existir sob OUTRO dono — reinstalação,
 *               restauração de backup, aparelho passado adiante. O
 *               `on conflict do update` da 0016 move a linha para quem está
 *               usando agora; um `insert` daqui esbarraria na unicidade e o
 *               aparelho continuaria recebendo os avisos de quem saiu.
 *   desregistrar apagar por token, e não por conta: a mesma pessoa pode ter
 *               telefone e tablet, e sair de um não desliga o outro.
 */
export function createPushTokenRepository(deps: CollaborationDeps): PushTokenRepository {
  const { db } = deps;

  return {
    async register(token, platform, deviceName) {
      const { error } = await db().rpc('register_push_token', {
        device_token: token,
        device_platform: platform,
        device_label: deviceName ?? null,
      });
      if (error) {
        throwBackendError(
          error,
          'MISSING_PUSH_TOKENS',
          'Não foi possível ativar os avisos neste aparelho.',
        );
      }
    },

    async unregister(token) {
      const { error } = await db().rpc('unregister_push_token', { device_token: token });
      if (error) {
        throwBackendError(
          error,
          'MISSING_PUSH_TOKENS',
          'Não foi possível desativar os avisos neste aparelho.',
        );
      }
    },
  };
}

/* ------------------------------ notifications ----------------------------- */

export function createNotificationRepository(deps: CollaborationDeps): NotificationRepository {
  const { db } = deps;

  return {
    async list(userId) {
      const result = await db()
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (result.error) {
        throwBackendError(
          result.error,
          'MISSING_NOTIFICATIONS',
          'Não foi possível carregar as notificações.',
        );
      }
      return ((result.data ?? []) as Row[]).map(toNotification);
    },

    async markRead(id) {
      const { error } = await db()
        .from('notifications')
        .update({ read_at: nowISO() })
        .eq('id', id)
        .is('read_at', null);
      if (error) {
        throwBackendError(error, 'MISSING_NOTIFICATIONS', 'Não foi possível marcar a notificação.');
      }
    },

    async markAllRead(userId) {
      const { error } = await db()
        .from('notifications')
        .update({ read_at: nowISO() })
        .eq('user_id', userId)
        .is('read_at', null);
      if (error) {
        throwBackendError(
          error,
          'MISSING_NOTIFICATIONS',
          'Não foi possível marcar as notificações.',
        );
      }
    },

    async remove(id) {
      const { error } = await db().from('notifications').delete().eq('id', id);
      if (error) {
        throwBackendError(error, 'MISSING_NOTIFICATIONS', 'Não foi possível excluir a notificação.');
      }
    },

    /**
     * Sem push do sistema, quem entrega o lembrete é a abertura do aplicativo
     * (§33). A função no Postgres é a mesma que o cron chamaria, e o `sent_at`
     * é o que impede a entrega dupla quando os dois rodam.
     */
    async deliverDueReminders() {
      const { data, error } = await db().rpc('deliver_due_reminders');
      if (error) {
        throwBackendError(
          error,
          'MISSING_NOTIFICATIONS',
          'Não foi possível entregar os lembretes pendentes.',
        );
      }
      return typeof data === 'number' ? data : 0;
    },
  };
}

/* -------------------------------- reminders ------------------------------- */

export function createReminderRepository(deps: CollaborationDeps): ReminderRepository {
  const { db, prune } = deps;

  return {
    async listByTrip(tripId, userId) {
      const result = await db()
        .from('reminders')
        .select('*')
        .eq('trip_id', tripId)
        .eq('user_id', userId);
      if (result.error) {
        throwBackendError(
          result.error,
          'MISSING_NOTIFICATIONS',
          'Não foi possível carregar os lembretes.',
        );
      }
      return ((result.data ?? []) as Row[]).map(toReminder);
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
      if (result.error) {
        throwBackendError(
          result.error,
          'MISSING_NOTIFICATIONS',
          'Não foi possível salvar o lembrete.',
        );
      }
      return toReminder(result.data as Row);
    },

    async remove(id) {
      const { error } = await db().from('reminders').delete().eq('id', id);
      if (error) {
        throwBackendError(error, 'MISSING_NOTIFICATIONS', 'Não foi possível excluir o lembrete.');
      }
    },

    async removeForEntity(userId, entityId, anchor) {
      const { error } = await db()
        .from('reminders')
        .delete()
        .eq('user_id', userId)
        .eq('entity_id', entityId)
        .eq('anchor', anchor);
      if (error) {
        throwBackendError(error, 'MISSING_NOTIFICATIONS', 'Não foi possível excluir o lembrete.');
      }
    },
  };
}

/* ------------------------------- reservations ----------------------------- */

export function createTravelReservationRepository(
  deps: CollaborationDeps,
): TravelReservationRepository {
  const { db, prune, openableUrl, uploadAttachment, attachmentsBucket } = deps;

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
        // `tickets` já existia na 0001. Um `select('*')` contra o backend
        // legado portanto dava 200 e deixava tipos antigos (`voo`,
        // `hospedagem`) chegarem ao domínio novo como se 0011 estivesse
        // aplicada. Pedir explicitamente o contrato 0009/0011 transforma essa
        // meia-compatibilidade em um erro de capability verificável.
        .select(
          'id,trip_id,user_id,type,title,provider,reference,start_date_time,end_date_time,origin,destination,file_path,mime_type,notes,created_at,visibility,created_by,details,status,address,updated_at,legacy_type',
        )
        .eq('trip_id', tripId)
        .order('start_date_time', { ascending: true, nullsFirst: false });
      if (result.error) {
        throwBackendError(
          result.error,
          'MISSING_RESERVATIONS_SCHEMA',
          'Não foi possível carregar as reservas.',
        );
      }
      return Promise.all(((result.data ?? []) as Row[]).map(toReservation));
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
      if (result.error) {
        throwBackendError(
          result.error,
          'MISSING_RESERVATIONS_SCHEMA',
          'Não foi possível criar a reserva.',
        );
      }
      return toReservation(result.data as Row);
    },

    async update(id, patch) {
      const result = await db().from('tickets').update(toRow(patch)).eq('id', id).select().single();
      if (result.error) {
        throwBackendError(
          result.error,
          'MISSING_RESERVATIONS_SCHEMA',
          'Não foi possível atualizar a reserva.',
        );
      }
      return toReservation(result.data as Row);
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

      if (existing.error) {
        throwBackendError(
          existing.error,
          'MISSING_RESERVATIONS_SCHEMA',
          'Não foi possível carregar a reserva para exclusão.',
        );
      }

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
      if (error) {
        throwBackendError(
          error,
          'MISSING_RESERVATIONS_SCHEMA',
          'Não foi possível excluir a reserva.',
        );
      }
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
  /** Cooldown curto da última tentativa que não entregou nada (0017). */
  suggestionsRetryAfter?: string;
  /** Início da tentativa em curso, se houver uma dentro da lease (0017). */
  suggestionsAttemptAt?: string;
}

export function createSuggestionRepository(
  deps: CollaborationDeps,
  getTrip: (tripId: string) => Promise<SuggestionTripInfo | null>,
  getAccessToken: () => Promise<string | undefined>,
): SuggestionRepository {
  const { db } = deps;

  async function readAll(tripId: string): Promise<TripSuggestion[]> {
    const result = await db()
      .from('trip_suggestions')
      .select('*')
      .eq('trip_id', tripId)
      .order('created_at', { ascending: true });
    if (result.error) {
      throwBackendError(
        result.error,
        'MISSING_SUGGESTIONS_SCHEMA',
        'Não foi possível carregar as sugestões.',
      );
    }
    return ((result.data ?? []) as Row[]).map(toSuggestion);
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
    /*
     * `trim()` porque o destino é texto digitado.
     *
     * `ilike` já ignora a caixa, mas não ignora espaço: um " Paris" gravado com
     * espaço à frente não casa com nenhuma linha de `public.places`, e o
     * destino cai no caminho da IA como se o catálogo não o cobrisse. Não há
     * curinga aqui de propósito — `%Roma%` casaria com qualquer cidade que
     * contivesse "roma" e sugeriria a trattoria errada.
     */
    const result = await db()
      .from('places')
      .select('*')
      .ilike('city', trip.destinationCity.trim())
      .limit(12);
    if (result.error) {
      throw new SuggestionGenerationError(
        'CATALOG_UNAVAILABLE',
        'Não foi possível consultar o catálogo de lugares.',
        existing,
        result.error,
        { catalogCount: 0 },
      );
    }
    const places = (result.data ?? []) as Row[];

    const rows = places
      .filter((place) => !findSimilar({ title: place.name, latitude: place.latitude, longitude: place.longitude }, existing))
      .map((place) => ({
        trip_id: trip.id,
        title: place.name,
        category: catalogCategory(place.type),
        description: place.description ?? `${place.name}, em ${place.city}.`,
        place_name: place.name,
        area: place.address ?? null,
        // Coordenada é par ou não é nada — a mesma regra do CHECK
        // `trip_suggestions_coords_pair` da 0012. Uma linha de catálogo com
        // metade do par faria o upsert inteiro voltar 23514, e a viagem
        // perderia TODAS as sugestões do catálogo por causa de uma só.
        ...coordinatePair(place.latitude, place.longitude),
        reason: `Está no catálogo do Easy Trip para ${place.city}.`,
        source: 'catalog',
        place_id: place.id,
      }));

    if (rows.length === 0) return 0;

    // `ignoreDuplicates` porque outro membro pode ter aberto a tela ao mesmo
    // tempo. `title_key` é a coluna gerada por `lower(title)` na 0012: além de
    // manter a comparação case-insensitive, ela fornece ao PostgREST um alvo
    // de conflito endereçável. Sem `onConflict`, o upsert HTTP usa a PK e uma
    // colisão no índice de título volta como 23505.
    const { error } = await db()
      .from('trip_suggestions')
      .upsert(rows, { onConflict: 'trip_id,title_key', ignoreDuplicates: true });
    if (error) {
      if (toBackendCapabilityError(error, 'MISSING_SUGGESTIONS_SCHEMA')) {
        throwBackendError(error, 'MISSING_SUGGESTIONS_SCHEMA');
      }
      throw new SuggestionGenerationError(
        'PERSISTENCE_FAILED',
        'Não foi possível salvar as sugestões do catálogo.',
        existing,
        error,
      );
    }
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
    minimumNeeded: number,
    base: SuggestionAttemptDiagnostics,
  ): Promise<number> {
    /**
     * O diagnóstico desta tentativa, montado a cada saída.
     *
     * Existe porque, no aparelho, todos estes caminhos chegavam ao mesmo texto
     * de tela — e não havia como saber, do Android, se o que aconteceu foi 401,
     * 403, 422, 429, rede ou catálogo vazio (§12 do handoff). São só números e
     * rótulos fechados: nenhum token, nenhum corpo de resposta.
     */
    const diag = (extra: SuggestionAttemptDiagnostics = {}): SuggestionAttemptDiagnostics => ({
      ...base,
      minimumNeeded,
      ...extra,
    });

    if (!config.hasBff) {
      throw new SuggestionGenerationError(
        'AI_UNAVAILABLE',
        'O serviço de sugestões não está configurado.',
        existing,
        undefined,
        diag({ transport: 'unconfigured' }),
      );
    }

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
          // Quantas ainda faltam para o total mínimo da viagem. O servidor não
          // tem como saber — o catálogo é lido daqui (§22 do handoff).
          minimumNeeded,
        },
        { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} },
      );
    } catch (error) {
      const transporte = error instanceof ServiceError ? error.kind : undefined;
      const status = error instanceof ServiceError ? error.status : undefined;
      const codigo =
        error instanceof ServiceError && error.payload && typeof error.payload === 'object'
          ? String((error.payload as Record<string, unknown>).code ?? '') || undefined
          : undefined;
      const rede = diag({ transport: transporte, httpStatus: status, responseCode: codigo });

      if (error instanceof ServiceError && error.kind === 'http') {
        if (error.status === 401 || error.status === 403) {
          throw new SuggestionGenerationError(
            'PERMISSION_DENIED',
            'Sua permissão atual não permite gerar sugestões para esta viagem.',
            existing,
            error,
            rede,
          );
        }
        /*
         * 429: o servidor recusou o claim.
         *
         * Duas coisas muito diferentes chegam aqui, e a 0017 finalmente as
         * separa. Com `retryAfter` no corpo, a espera é o cooldown de uma
         * tentativa que FALHOU — minutos, e o texto de tela não pode ser
         * "Atualizado recentemente", porque nada foi atualizado. Sem ele, é a
         * janela de seis horas de uma geração que deu certo.
         */
        if (error.status === 429) {
          const espera = retryAfterOf(error.payload);
          throw new SuggestionGenerationError(
            espera ? 'GENERATION_COOLDOWN' : 'REFRESH_LIMITED',
            espera
              ? 'A última tentativa de gerar sugestões não trouxe nada. Tente de novo em alguns minutos.'
              : 'As sugestões desta viagem já foram atualizadas nas últimas 6 horas.',
            existing,
            error,
            { ...rede, retryAfter: espera ?? rede.retryAfter },
          );
        }
        /*
         * 422: gerou, mas não o bastante.
         *
         * O que veio é válido e é aproveitado — gravar é melhor do que
         * descartar, porque a próxima janela só abre em seis horas. Depois de
         * gravar, o erro sobe assim mesmo: a lista continua abaixo do mínimo e
         * dizer "pronto" seria mentir (§21 do handoff).
         */
        if (error.status === 422) {
          const salvas = await persistGenerated(trip, existing, error.payload);
          /*
           * O PARCIAL QUE SOBE PRECISA SER O QUE FICOU GRAVADO.
           *
           * Aqui subia `existing` — a lista de ANTES da gravação. Numa viagem
           * cujo catálogo não cobre o destino, `existing` é a lista vazia: a
           * tela recebia `partialSuggestions: []`, concluía que não havia nada
           * a mostrar e pintava o cartão de falha por cima das sugestões que
           * esta mesma chamada acabara de salvar.
           *
           * Foi assim que Moscovo ficou sem tela: a janela de seis horas já
           * tinha sido consumida (o claim é gasto ANTES do Gemini, de
           * propósito), então as duas ou três sugestões válidas que vieram no
           * corpo do 422 eram tudo o que a viagem teria até a janela reabrir —
           * e eram exatamente as que a tela jogava fora.
           *
           * A releitura só acontece quando algo foi de fato gravado; sem isso
           * `existing` continua sendo a resposta certa, e não há ida à rede.
           */
          const comOParcial = salvas > 0 ? await readAll(trip.id) : existing;
          throw new SuggestionGenerationError(
            'INCOMPLETE_GENERATION',
            salvas > 0
              ? 'Conseguimos apenas algumas sugestões para este destino. Tente de novo mais tarde.'
              : 'Não encontramos sugestões suficientes para este destino agora.',
            comOParcial,
            error,
            diag({ ...rede, aiCount: salvas, totalCount: comOParcial.length }),
          );
        }
        if (error.status === 404) {
          throw new SuggestionGenerationError(
            'EDGE_FUNCTION_UNAVAILABLE',
            'O serviço de sugestões não está publicado ou não reconheceu esta viagem.',
            existing,
            error,
            rede,
          );
        }
        /*
         * 502: a tentativa aconteceu e não entregou nada.
         *
         * A Function já encerrou a tentativa no banco com o cooldown curto e
         * devolveu quando ele acaba (0017). Quando esse instante vem no corpo,
         * a tela pode dizer o prazo em vez de "tente novamente" sem prazo — e
         * `GENERATION_COOLDOWN` é o que impede o botão morto, porque tocar
         * agora esbarraria no cooldown do próprio banco.
         */
        if (error.status === 502) {
          const espera = retryAfterOf(error.payload);
          throw new SuggestionGenerationError(
            espera ? 'GENERATION_COOLDOWN' : 'AI_PROVIDER_FAILED',
            espera
              ? 'A geração não trouxe nenhuma sugestão desta vez.'
              : 'O Gemini não conseguiu gerar sugestões agora.',
            existing,
            error,
            { ...rede, retryAfter: espera ?? rede.retryAfter },
          );
        }
        if (error.status === 503) {
          throw new SuggestionGenerationError(
            'AI_UNAVAILABLE',
            'A geração por IA não está configurada neste servidor.',
            existing,
            error,
            rede,
          );
        }
      }
      throw new SuggestionGenerationError(
        'AI_UNAVAILABLE',
        'Não foi possível alcançar o serviço de sugestões.',
        existing,
        error,
        rede,
      );
    }

    /*
     * A lista vazia é aceita aqui, e a distinção importa.
     *
     * "Nenhuma sugestão nova" é um resultado possível e honesto de um refresh
     * numa viagem que já está completa — o modelo não repete o que já existe. O
     * que NÃO é aceitável é um corpo que não é a resposta acordada, e esse
     * continua virando `INVALID_AI_RESPONSE`.
     *
     * Quem decide se o total ficou abaixo do mínimo é `ensure`, depois de
     * gravar: é lá que catálogo e IA são somados (§22 do handoff).
     */
    const parsed = partialSuggestionListSchema.safeParse(payload);
    if (!parsed.success) {
      throw new SuggestionGenerationError(
        'INVALID_AI_RESPONSE',
        'O serviço respondeu sem sugestões válidas.',
        existing,
        parsed.error,
        diag({ httpStatus: 200, transport: 'parse' }),
      );
    }

    return writeGenerated(trip, existing, parsed.data.suggestions);
  }

  /**
   * Grava o que a IA produziu, sem repetir o que já existe.
   *
   * Separado de `seedFromAi` porque a recusa parcial (422) também traz
   * sugestões legítimas, e elas precisam do mesmo caminho de deduplicação e
   * gravação — não de uma segunda implementação que possa divergir dele.
   */
  async function writeGenerated(
    trip: SuggestionTripInfo,
    existing: TripSuggestion[],
    generated: readonly GeneratedSuggestion[],
  ): Promise<number> {
    const rows = generated
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
      .upsert(rows, { onConflict: 'trip_id,title_key', ignoreDuplicates: true });
    if (error) {
      if (toBackendCapabilityError(error, 'MISSING_SUGGESTIONS_SCHEMA')) {
        throwBackendError(error, 'MISSING_SUGGESTIONS_SCHEMA');
      }
      throw new SuggestionGenerationError(
        'PERSISTENCE_FAILED',
        'Não foi possível salvar as sugestões geradas.',
        existing,
        error,
      );
    }
    return rows.length;
  }

  /**
   * O parcial que acompanha a recusa 422.
   *
   * Tolerante de propósito: um corpo de erro sem sugestões utilizáveis não vira
   * um segundo erro. O que importa dizer a quem chamou já é "não completou", e
   * isso quem diz é `seedFromAi` logo depois desta gravação.
   */
  async function persistGenerated(
    trip: SuggestionTripInfo,
    existing: TripSuggestion[],
    payload: unknown,
  ): Promise<number> {
    const parsed = partialSuggestionListSchema.safeParse(payload);
    if (!parsed.success || parsed.data.suggestions.length === 0) return 0;
    try {
      return await writeGenerated(trip, existing, parsed.data.suggestions);
    } catch {
      // Falhar ao gravar o parcial não pode mascarar o motivo real, que é a
      // geração incompleta. O erro certo sobe logo em seguida.
      return 0;
    }
  }

  return {
    listByTrip: readAll,

    async ensure(tripId, options) {
      const existing = await readAll(tripId);
      if (!options?.force && existing.length >= MINIMUM_SUGGESTIONS) return existing;

      const trip = await getTrip(tripId);
      if (!trip) {
        throw new SuggestionGenerationError(
          'PERSISTENCE_FAILED',
          'Não foi possível carregar a viagem para montar sugestões.',
          existing,
        );
      }

      /*
       * A janela de seis horas está aberta AGORA?
       *
       * Lido uma vez, no começo, e carregado no diagnóstico até o fim: é a
       * informação que faltava para explicar a tela de Moscovo, onde a mesma
       * frase servia para "nunca gerou" e para "gerou, falhou, e a janela foi
       * consumida mesmo assim".
       */
      const janela = suggestionRefreshWindow(trip);
      const janelaAberta = janela.open;
      const base: SuggestionAttemptDiagnostics = {
        refreshWindowOpen: janelaAberta,
        refreshBlockedBy: janela.blockedBy,
        retryAfter: janela.nextAttemptAt,
        forced: Boolean(options?.force),
      };

      /*
       * A recusa local tem o mesmo vocabulário da recusa do servidor (0017).
       *
       * `window` é a janela de seis horas de uma geração que ENTREGOU — isso é
       * o limite de custo funcionando, e a tela mostra como informação.
       * `cooldown` e `in_progress` são outra coisa: nada foi entregue, e dizer
       * "Atualizado recentemente" ali descreveria como sucesso o momento exato
       * em que a pessoa não recebeu nada.
       */
      const recusaLocal = (final: TripSuggestion[], diagnostico: SuggestionAttemptDiagnostics) =>
        janela.blockedBy === 'window'
          ? new SuggestionGenerationError(
              'REFRESH_LIMITED',
              'As sugestões desta viagem já foram atualizadas nas últimas 6 horas.',
              final,
              undefined,
              diagnostico,
            )
          : new SuggestionGenerationError(
              'GENERATION_COOLDOWN',
              janela.blockedBy === 'in_progress'
                ? 'Já existe uma geração em andamento para esta viagem.'
                : 'A última tentativa de gerar sugestões não trouxe nada. Tente de novo em alguns minutos.',
              final,
              undefined,
              diagnostico,
            );

      /*
       * "Atualizar sugestões" dentro da janela de seis horas é uma recusa, não
       * um sucesso silencioso.
       *
       * Antes, o pedido caía fora do `if` de geração e a função devolvia a
       * lista inalterada: a tela não tinha como distinguir "atualizei e nada
       * mudou" de "nem tentei". Agora o motivo é o retorno — o mesmo
       * `REFRESH_LIMITED` que a Function devolve quando o compare-and-set
       * recusa o claim (§23 do handoff).
       *
       * Vem antes do catálogo de propósito: `force` é pedido de atualização, e
       * dentro da janela não há atualização nenhuma a fazer.
       */
      if (options?.force && !janelaAberta) {
        throw recusaLocal(existing, { ...base, totalCount: existing.length });
      }

      const doCatalogo = await seedFromCatalog(trip, existing);
      const afterCatalog = doCatalogo > 0 ? await readAll(tripId) : existing;

      /*
       * O mínimo é do TOTAL, e o catálogo conta (§22 do handoff).
       *
       * Catálogo com 2 → a IA precisa de 1, e uma única sugestão válida fecha
       * a viagem em 3, com sucesso. Catálogo com 0 → precisa de 3, e duas não
       * bastam. É esta conta que viaja para a Function em `minimumNeeded`.
       */
      const faltam = Math.max(0, MINIMUM_SUGGESTIONS - afterCatalog.length);

      /*
       * `staleTime` só dura enquanto o cache vive. A marca d'água vem do
       * Postgres e continua valendo depois de cold start, troca de aparelho e
       * chamada direta ao repositório. Sem esta condição, uma viagem com menos
       * de três resultados chamaria o Gemini a cada abertura do aplicativo.
       *
       * A Edge Function repete a barreira com um compare-and-set atômico antes
       * do provedor. Esta checagem economiza a ida à Function; não é a defesa
       * de segurança/custo contra um cliente modificado.
       */
      let daIa = 0;
      if ((faltam > 0 || options?.force) && janelaAberta) {
        daIa = await seedFromAi(trip, afterCatalog, faltam, {
          ...base,
          catalogCount: doCatalogo,
        });
      }

      // Não escrevemos `suggestions_refreshed_at` daqui. Owner/editor podem
      // gerar, mas só owner pode editar a viagem; uma escrita cliente-side
      // tornaria o editor inconsistente e deixaria uma corrida entre aparelhos.
      // `claim_trip_suggestion_refresh` é chamado pela Function com o JWT do
      // usuário e registra a janela atomicamente antes do Gemini.

      const final = await readAll(tripId);

      /*
       * Última conferência, do lado do cliente.
       *
       * A Function já recusa a geração insuficiente com 422, mas ela só
       * enxerga o que ela mesma gerou. Aqui se vê o total real depois de
       * gravar — inclusive quando a deduplicação descartou uma sugestão que o
       * servidor considerou válida. Devolver esta lista como sucesso faria a
       * tela dizer "pronto" abaixo do mínimo.
       */
      const diagnostico: SuggestionAttemptDiagnostics = {
        ...base,
        minimumNeeded: faltam,
        catalogCount: doCatalogo,
        aiCount: daIa,
        totalCount: final.length,
      };

      if (faltam > 0 && final.length < MINIMUM_SUGGESTIONS) {
        /*
         * A JANELA FECHADA NÃO É UMA GERAÇÃO INCOMPLETA — E ERA AQUI QUE A
         * TELA DE MOSCOVO TRAVAVA.
         *
         * Com `suggestions_refreshed_at` recente, o bloco acima nem chamou a
         * Function: não houve geração para ser incompleta. Ainda assim o erro
         * que subia daqui era `INCOMPLETE_GENERATION`, que a tela pinta como
         * "Sugestões indisponíveis" com um botão "Tentar novamente" — um botão
         * que, por definição, não tinha como funcionar antes das seis horas.
         * A pessoa via uma falha permanente onde o sistema só estava dentro do
         * próprio limite de custo.
         *
         * Quem responde por que a janela está fechada é `recusaLocal`, que fala
         * o mesmo vocabulário do servidor (0017): `REFRESH_LIMITED` quando a
         * espera é a janela de uma geração que entregou, `GENERATION_COOLDOWN`
         * quando é o cooldown curto de uma que falhou. Em nenhum dos dois há
         * botão morto (§13, §15 do handoff).
         */
        if (!janelaAberta) throw recusaLocal(final, diagnostico);

        throw new SuggestionGenerationError(
          'INCOMPLETE_GENERATION',
          final.length > afterCatalog.length
            ? 'Conseguimos apenas algumas sugestões para este destino. Tente de novo mais tarde.'
            : 'Ainda não encontramos sugestões suficientes para este destino.',
          final,
          undefined,
          diagnostico,
        );
      }

      return final;
    },

    async remove(id) {
      const { error } = await db().from('trip_suggestions').delete().eq('id', id);
      if (error) {
        throwBackendError(
          error,
          'MISSING_SUGGESTIONS_SCHEMA',
          'Não foi possível remover a sugestão.',
        );
      }
    },
  };
}

/**
 * O instante em que uma nova tentativa será aceita, quando o corpo da recusa
 * traz um.
 *
 * É a diferença entre "tente em alguns minutos" e "atualizado recentemente":
 * só uma tentativa que NÃO entregou nada deixa um `retryAfter` para trás
 * (0017). Nada é inventado quando o campo não vem — a tela volta ao texto sem
 * prazo, que é honesto, em vez de estimar um horário.
 */
function retryAfterOf(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const value = (payload as Record<string, unknown>).retryAfter;
  if (typeof value !== 'string') return undefined;
  return Number.isNaN(new Date(value).getTime()) ? undefined : value;
}

/** Coordenada é par ou não é nada (CHECK `trip_suggestions_coords_pair`, 0012). */
function coordinatePair(
  latitude: unknown,
  longitude: unknown,
): { latitude: number | null; longitude: number | null } {
  return typeof latitude === 'number' && typeof longitude === 'number'
    ? { latitude, longitude }
    : { latitude: null, longitude: null };
}

function catalogCategory(type: string): SuggestionCategory {
  if (type === 'restaurant') return 'gastronomia';
  if (type === 'attraction') return 'atracoes';
  return 'lugares';
}
