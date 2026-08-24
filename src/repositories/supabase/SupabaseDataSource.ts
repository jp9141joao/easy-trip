/**
 * Production data source — Postgres + Storage behind Row Level Security.
 *
 * Two rules shape this file:
 *  1. The database stores storage *paths*; the app never sees a public file URL.
 *     Attachments live in private buckets and are handed to the UI as short-lived
 *     signed URLs generated at read time (§93).
 *  2. `userId` is never trusted from the client for authorisation — RLS derives
 *     identity from the JWT. The column is written for ownership, not for access
 *     control.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { TripRole } from '@/domain/collaboration';
import type {
  AIConversation,
  AIMessage,
  Advisor,
  Article,
  ChecklistItem,
  Consultation,
  Expense,
  Goal,
  InsurancePolicy,
  ItineraryItem,
  JournalEntry,
  JournalMedia,
  Offer,
  Place,
  Profile,
  ProfilePatch,
  ReservationRequest,
  Trip,
} from '@/domain/types';
import { avatarStoragePath, validateAvatar } from '@/domain/avatar';
import { DEFAULT_VISIBILITY, parseVisibility } from '@/domain/visibility';
import { parseUserRole } from '@/domain/roles';
import { nowISO, todayISO } from '@/lib/date';
import { createId } from '@/lib/id';
import { isUuid, likeContains } from '@/lib/postgrest';
import {
  ATTACHMENT_POLICY,
  CONTENT_IMAGE_POLICY,
  JOURNAL_POLICY,
  attachmentStoragePath,
  contentImagePath,
  journalStoragePath,
  managedContentPath,
  managedPathBelongsTo,
  validateUpload,
} from '@/domain/upload';
import {
  purgeMirrorForUser,
  readMirror,
  writeMirrorFromBytes,
  writeMirrorFromFile,
} from '@/lib/fileMirror';
import { deleteWithFiles, type FileLifecycleDeps } from './fileLifecycle';
import {
  createMembershipRepository,
  createNotificationRepository,
  createReminderRepository,
  createSuggestionRepository,
  createTravelReservationRepository,
  type CollaborationDeps,
} from './collaboration';
import { getSupabaseClient } from './client';
import type { DataSource, StoredFile, UploadableFile } from '../types';

const SIGNED_URL_TTL = 60 * 60; // 1 hour

const BUCKET = {
  attachments: 'attachments',
  journal: 'journal',
  avatars: 'avatars',
  /** Único bucket público do projeto: imagem editorial. Ver `0007` (P-04). */
  content: 'content',
} as const;

function db(): SupabaseClient {
  return getSupabaseClient();
}

function bucketFor(kind: 'attachment' | 'journal'): string {
  return kind === 'attachment' ? BUCKET.attachments : BUCKET.journal;
}

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  if (result.data === null) throw new Error('Registro não encontrado.');
  return result.data;
}

function unwrapList<T>(result: { data: T[] | null; error: { message: string } | null }): T[] {
  if (result.error) throw new Error(result.error.message);
  return result.data ?? [];
}

/** Turns a private storage path into a temporary, openable URL. */
async function signUrl(bucket: string, path: string | null): Promise<string | undefined> {
  if (!path) return undefined;
  const { data, error } = await db().storage.from(bucket).createSignedUrl(path, SIGNED_URL_TTL);
  if (error || !data) return undefined;
  return data.signedUrl;
}

/**
 * O UID da sessão, lido do cliente — sem ida à rede.
 *
 * Serve para autorizar caminhos de Storage antes de mandar removê-los. Não
 * substitui a RLS: é a checagem que evita usar uma linha adulterada para
 * apagar arquivo alheio, e que dá um erro compreensível em vez do 200 com
 * lista vazia que o Storage devolve quando a policy barra.
 */
async function currentUserId(): Promise<string | null> {
  const { data } = await db().auth.getSession();
  return data.session?.user.id ?? null;
}

async function lifecycleDeps(): Promise<FileLifecycleDeps> {
  return { db, userId: await currentUserId() };
}

/**
 * A forma de abrir o arquivo agora, na ordem que a decisão D-04 manda: cópia
 * local primeiro, URL assinada só quando não houver uma.
 *
 * O que se guarda no banco continua sendo o `storagePath`; isto aqui é derivado
 * e vale por uma hora, ou para sempre se o espelho existir.
 */
async function openableUrl(bucket: string, path: string | null): Promise<string | undefined> {
  if (!path) return undefined;
  return readMirror(bucket, path) ?? (await signUrl(bucket, path));
}

async function uploadFile(
  bucket: string,
  path: string,
  file: UploadableFile,
): Promise<StoredFile> {
  // expo-file-system's File implements Blob, so it streams straight up without
  // buffering the whole attachment into JS memory.
  const { File } = await import('expo-file-system');
  const bytes = await new File(file.uri).arrayBuffer();

  const { error } = await db()
    .storage.from(bucket)
    .upload(path, bytes, { contentType: file.mimeType, upsert: true });
  if (error) throw new Error(error.message);

  return { url: path, mimeType: file.mimeType };
}

/**
 * Acrescenta a URL assinada ao perfil lido.
 *
 * A URL vive só na resposta: `avatarPath` é o que está gravado, `avatarUrl` é
 * derivado e expira em uma hora. Enquanto os dois eram o mesmo campo, o valor
 * derivado voltava para o banco no próximo "Salvar" e a foto sumia.
 */
async function withAvatarUrl(profile: Profile): Promise<Profile> {
  return { ...profile, avatarUrl: await signUrl(BUCKET.avatars, profile.avatarPath ?? null) };
}

/**
 * Traduz a allowlist para colunas, campo a campo.
 *
 * Só entra o que o objeto realmente trouxe: `'phone' in patch` distingue "o
 * usuário apagou o telefone" (grava `null`) de "esta edição não mexeu no
 * telefone" (não aparece no UPDATE). Um spread genérico não faria essa
 * diferença — e apagar um campo pareceria não funcionar.
 */
function toProfileRow(patch: ProfilePatch): Row {
  const row: Row = {};
  if ('name' in patch) row.name = patch.name;
  if ('phone' in patch) row.phone = patch.phone ?? null;
  if ('homeCity' in patch) row.home_city = patch.homeCity ?? null;
  if ('homeCountry' in patch) row.home_country = patch.homeCountry ?? null;
  if ('homeTimezone' in patch) row.home_timezone = patch.homeTimezone ?? null;
  if ('travelStyle' in patch) row.travel_style = patch.travelStyle ?? null;
  if ('defaultCurrency' in patch) row.default_currency = patch.defaultCurrency;
  return row;
}

/* --------------------------------- mappers -------------------------------- */

type Row = Record<string, any>;

const toTrip = (row: Row): Trip => ({
  id: row.id,
  userId: row.user_id,
  destinationCity: row.destination_city,
  destinationCountry: row.destination_country,
  countryCode: row.country_code,
  latitude: row.latitude ?? undefined,
  longitude: row.longitude ?? undefined,
  timezone: row.timezone,
  startDate: row.start_date,
  endDate: row.end_date,
  coverImageUrl: row.cover_image_url ?? undefined,
  budgetTotal: Number(row.budget_total),
  budgetCurrency: row.budget_currency,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  suggestionsRefreshedAt: row.suggestions_refreshed_at ?? undefined,
});

const fromTrip = (trip: Partial<Trip>): Row => prune({
  user_id: trip.userId,
  destination_city: trip.destinationCity,
  destination_country: trip.destinationCountry,
  country_code: trip.countryCode,
  latitude: trip.latitude,
  longitude: trip.longitude,
  timezone: trip.timezone,
  start_date: trip.startDate,
  end_date: trip.endDate,
  cover_image_url: trip.coverImageUrl,
  budget_total: trip.budgetTotal,
  budget_currency: trip.budgetCurrency,
  updated_at: nowISO(),
});

const toItinerary = (row: Row): ItineraryItem => ({
  id: row.id,
  tripId: row.trip_id,
  date: row.date,
  startTime: row.start_time ?? undefined,
  endTime: row.end_time ?? undefined,
  type: row.type,
  title: row.title,
  description: row.description ?? undefined,
  placeName: row.place_name ?? undefined,
  latitude: row.latitude ?? undefined,
  longitude: row.longitude ?? undefined,
  address: row.address ?? undefined,
  placeSource: row.place_source ?? undefined,
  reservationReference: row.reservation_reference ?? undefined,
  completed: row.completed,
  sortOrder: row.sort_order,
  visibility: parseVisibility(row.visibility, DEFAULT_VISIBILITY.itinerary),
  createdBy: row.created_by ?? undefined,
  updatedAt: row.updated_at ?? undefined,
});

const fromItinerary = (item: Partial<ItineraryItem>): Row => prune({
  trip_id: item.tripId,
  date: item.date,
  start_time: item.startTime,
  end_time: item.endTime,
  type: item.type,
  title: item.title,
  description: item.description,
  place_name: item.placeName,
  latitude: item.latitude,
  longitude: item.longitude,
  address: item.address,
  place_source: item.placeSource,
  reservation_reference: item.reservationReference,
  completed: item.completed,
  sort_order: item.sortOrder,
  visibility: item.visibility,
  // `created_by` fica de fora de propósito: quem o escreve é o trigger
  // `set_created_by` (0009), a partir de `auth.uid()`. Mandá-lo daqui seria
  // deixar o cliente declarar a própria autoria.
});

/**
 * A entrada de diário lida do banco.
 *
 * Existia em três cópias inline (listar, criar, atualizar). Com a visibilidade
 * entrando no modelo, três cópias significariam três lugares para esquecer
 * `visibility` — e uma entrada privada lida sem o campo cairia no default
 * `shared` da função de leitura, que é exatamente o erro que não pode
 * acontecer neste tipo de dado.
 */
const toJournal = (row: Row): JournalEntry => ({
  id: row.id,
  tripId: row.trip_id,
  userId: row.user_id,
  entryDate: row.entry_date,
  content: row.content,
  latitude: row.latitude ?? undefined,
  longitude: row.longitude ?? undefined,
  placeName: row.place_name ?? undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  visibility: parseVisibility(row.visibility, DEFAULT_VISIBILITY.journal),
  createdBy: row.created_by ?? undefined,
});

const toChecklist = (row: Row): ChecklistItem => ({
  id: row.id,
  tripId: row.trip_id,
  label: row.label,
  category: row.category,
  completed: row.completed,
  priority: row.priority ?? undefined,
  dueDate: row.due_date ?? undefined,
  createdAt: row.created_at,
  visibility: parseVisibility(row.visibility, DEFAULT_VISIBILITY.checklist),
  createdBy: row.created_by ?? undefined,
});

const fromChecklist = (item: Partial<ChecklistItem>): Row => prune({
  trip_id: item.tripId,
  label: item.label,
  category: item.category,
  completed: item.completed,
  priority: item.priority,
  due_date: item.dueDate,
  visibility: item.visibility,
});

const toExpense = (row: Row): Expense => ({
  id: row.id,
  tripId: row.trip_id,
  userId: row.user_id,
  category: row.category,
  amount: Number(row.amount),
  currency: row.currency,
  amountInBudgetCurrency:
    row.amount_in_budget_currency === null ? undefined : Number(row.amount_in_budget_currency),
  exchangeRate: row.exchange_rate === null ? undefined : Number(row.exchange_rate),
  exchangeRateTimestamp: row.exchange_rate_timestamp ?? undefined,
  transactionDate: row.transaction_date,
  description: row.description,
  createdAt: row.created_at,
  visibility: parseVisibility(row.visibility, DEFAULT_VISIBILITY.expense),
  createdBy: row.created_by ?? undefined,
  paidBy: row.paid_by ?? undefined,
});

const fromExpense = (expense: Partial<Expense>): Row => prune({
  trip_id: expense.tripId,
  user_id: expense.userId,
  category: expense.category,
  amount: expense.amount,
  currency: expense.currency,
  amount_in_budget_currency: expense.amountInBudgetCurrency,
  exchange_rate: expense.exchangeRate,
  exchange_rate_timestamp: expense.exchangeRateTimestamp,
  transaction_date: expense.transactionDate,
  description: expense.description,
});

const toGoal = (row: Row): Goal => ({
  id: row.id,
  userId: row.user_id,
  tripId: row.trip_id ?? undefined,
  type: row.type,
  title: row.title,
  targetValue: Number(row.target_value),
  currentValue: Number(row.current_value),
  unit: row.unit,
  status: row.status,
  deadline: row.deadline ?? undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const fromGoal = (goal: Partial<Goal>): Row => prune({
  user_id: goal.userId,
  trip_id: goal.tripId,
  type: goal.type,
  title: goal.title,
  target_value: goal.targetValue,
  current_value: goal.currentValue,
  unit: goal.unit,
  status: goal.status,
  deadline: goal.deadline,
  updated_at: nowISO(),
});

const toProfile = (row: Row): Profile => ({
  userId: row.user_id,
  name: row.name,
  phone: row.phone ?? undefined,
  avatarPath: row.avatar_path ?? undefined,
  homeCity: row.home_city ?? undefined,
  homeCountry: row.home_country ?? undefined,
  homeTimezone: row.home_timezone ?? undefined,
  travelStyle: row.travel_style ?? undefined,
  defaultCurrency: row.default_currency,
  // A coluna existe a partir da migration 0003. Um banco ainda não migrado
  // devolve `undefined` aqui, e `parseUserRole` transforma isso em `user` —
  // nunca em privilégio (§29).
  role: parseUserRole(row.role),
});

const toPlace = (row: Row): Place => ({
  id: row.id,
  externalProviderId: row.external_provider_id ?? undefined,
  name: row.name,
  type: row.type,
  rating: row.rating ?? undefined,
  priceLevel: row.price_level ?? undefined,
  averagePrice: row.average_price ?? undefined,
  currency: row.currency ?? undefined,
  city: row.city,
  country: row.country,
  address: row.address ?? undefined,
  phone: row.phone ?? undefined,
  openingHours: row.opening_hours ?? undefined,
  description: row.description ?? undefined,
  latitude: row.latitude ?? undefined,
  longitude: row.longitude ?? undefined,
  imageUrl: row.image_url ?? undefined,
  amenities: row.amenities ?? undefined,
  partnerUrl: row.partner_url ?? undefined,
});

const toOffer = (row: Row): Offer => ({
  id: row.id,
  destination: row.destination,
  description: row.description,
  price: row.price === null ? undefined : Number(row.price),
  priceCurrency: row.price_currency ?? undefined,
  discountType: row.discount_type ?? undefined,
  discountValue: row.discount_value ?? undefined,
  costLevel: row.cost_level,
  imageUrl: row.image_url,
  weatherSummary: row.weather_summary ?? undefined,
  bestTime: row.best_time ?? undefined,
  thingsToDo: row.things_to_do ?? [],
  activeFrom: row.active_from ?? undefined,
  activeUntil: row.active_until ?? undefined,
  partnerUrl: row.partner_url ?? undefined,
  status: row.status,
  sortOrder: row.sort_order,
});

const toArticle = (row: Row): Article => ({
  id: row.id,
  slug: row.slug,
  title: row.title,
  category: row.category,
  imageUrl: row.image_url ?? undefined,
  authorName: row.author_name,
  content: row.content,
  publishedAt: row.published_at,
  estimatedReadMinutes: row.estimated_read_minutes,
  status: row.status,
});

const toAdvisor = (row: Row): Advisor => ({
  id: row.id,
  name: row.name,
  specialty: row.specialty,
  avatarUrl: row.avatar_url ?? undefined,
  rating: row.rating ?? undefined,
  status: row.status,
  bio: row.bio ?? undefined,
  active: row.active,
});

const toConsultation = (row: Row): Consultation => ({
  id: row.id,
  userId: row.user_id,
  advisorId: row.advisor_id,
  scheduledAt: row.scheduled_at,
  createdAt: row.created_at,
  status: row.status,
  notes: row.notes ?? undefined,
});

const toReservation = (row: Row): ReservationRequest => ({
  id: row.id,
  userId: row.user_id,
  tripId: row.trip_id ?? undefined,
  placeId: row.place_id,
  placeName: row.place_name,
  requestedFor: row.requested_for,
  partySize: row.party_size,
  notes: row.notes ?? undefined,
  status: row.status,
  createdAt: row.created_at,
});

/** Drops undefined keys so a partial update never nulls untouched columns. */
function prune(row: Row): Row {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
}

/**
 * Acrescenta papel e contagem de viajantes às viagens lidas.
 *
 * Os dois campos são derivados de `trip_members` e nunca gravados na linha da
 * viagem: a mesma viagem tem papéis diferentes para pessoas diferentes, e uma
 * coluna `role` em `trips` guardaria a resposta de uma pergunta que depende de
 * quem pergunta.
 *
 * Uma consulta só para todas as viagens, e não uma por viagem: a Home lista
 * dezenas, e N+1 aqui seria N+1 na abertura do aplicativo.
 *
 * `userId` nulo significa "use a sessão" — o caminho de `get`, onde quem lê é
 * sempre quem está logado.
 */
async function decorateWithMembership(trips: Trip[], userId: string | null): Promise<Trip[]> {
  if (trips.length === 0) return trips;

  const viewer = userId ?? (await currentUserId());
  const result = await db()
    .from('trip_members')
    .select('trip_id, user_id, role')
    .in('trip_id', trips.map((trip) => trip.id));

  if (result.error) return trips;

  const counts = new Map<string, number>();
  const roles = new Map<string, TripRole>();
  for (const row of (result.data ?? []) as Row[]) {
    counts.set(row.trip_id, (counts.get(row.trip_id) ?? 0) + 1);
    if (viewer && row.user_id === viewer) roles.set(row.trip_id, row.role as TripRole);
  }

  return trips.map((trip) => ({
    ...trip,
    memberCount: counts.get(trip.id) ?? 1,
    // Sem linha em `trip_members` mas com `user_id` próprio: viagem cujo
    // backfill não rodou. `owner` é a resposta certa, e é a mesma que os
    // helpers do Postgres dão nesse caso.
    role: roles.get(trip.id) ?? (viewer && trip.userId === viewer ? 'owner' : undefined),
  }));
}

/* --------------------------- colaboração (0008+) -------------------------- */

/**
 * O que os módulos de colaboração precisam deste arquivo.
 *
 * Passado como dependência em vez de importado: `db`, `prune`, `unwrap` e
 * `openableUrl` são detalhes internos daqui, e exportá-los transformaria cada
 * um numa API pública que qualquer arquivo poderia usar para falar com o
 * Postgres por fora dos repositórios.
 */
const collaborationDeps: CollaborationDeps = {
  db,
  unwrap,
  unwrapList,
  prune,
  openableUrl,
  attachmentsBucket: BUCKET.attachments,
  async uploadAttachment(userId, tripId, file) {
    const validation = validateUpload(file, ATTACHMENT_POLICY);
    if (!validation.ok) throw new Error(validation.message);
    const path = attachmentStoragePath(userId, tripId, validation.extension, createId());
    const stored = await uploadFile(BUCKET.attachments, path, {
      ...file,
      mimeType: validation.mimeType,
    });
    // D-04: o arquivo já está no aparelho — espelhá-lo agora custa muito menos
    // do que baixá-lo de volta no aeroporto, que é onde não vai haver rede.
    await writeMirrorFromFile(BUCKET.attachments, path, file.uri);
    return stored;
  },
};

/* ------------------------------- data source ------------------------------ */

export const supabaseDataSource: DataSource = {
  kind: 'supabase',

  trips: {
    /**
     * As viagens da pessoa E as que compartilharam com ela (§56).
     *
     * O `.eq('user_id', userId)` saiu. Ele era a autorização e o filtro ao
     * mesmo tempo — e agora seria só o filtro errado: uma viagem aceita por
     * convite tem `user_id` de outra pessoa e nunca apareceria. Quem decide o
     * que esta consulta enxerga é a policy `trips_select` (0008), que já
     * responde "sou membro?".
     *
     * `userId` continua na assinatura porque é a chave de cache do React Query
     * — e porque um cache reidratado nunca pode servir a viagem de outra conta.
     */
    async list(userId) {
      const result = await db().from('trips').select('*').order('start_date', { ascending: false });
      const trips = unwrapList<Row>(result).map(toTrip);
      return decorateWithMembership(trips, userId);
    },
    async get(tripId) {
      const result = await db().from('trips').select('*').eq('id', tripId).maybeSingle();
      if (result.error) throw new Error(result.error.message);
      if (!result.data) return null;
      const [trip] = await decorateWithMembership([toTrip(result.data)], null);
      return trip;
    },
    async create(input) {
      const result = await db().from('trips').insert(fromTrip(input)).select().single();
      return toTrip(unwrap<Row>(result));
    },
    async update(tripId, patch) {
      const result = await db()
        .from('trips')
        .update(fromTrip(patch))
        .eq('id', tripId)
        .select()
        .single();
      return toTrip(unwrap<Row>(result));
    },
    async remove(tripId) {
      // Child rows go with it via ON DELETE CASCADE in the schema.
      const { error } = await db().from('trips').delete().eq('id', tripId);
      if (error) throw new Error(error.message);
    },
  },

  itinerary: {
    async listByTrip(tripId) {
      const result = await db()
        .from('itinerary_items')
        .select('*')
        .eq('trip_id', tripId)
        .order('date')
        .order('start_time', { nullsFirst: false })
        .order('sort_order');
      return unwrapList<Row>(result).map(toItinerary);
    },
    async create(input) {
      const result = await db()
        .from('itinerary_items')
        .insert(fromItinerary(input))
        .select()
        .single();
      return toItinerary(unwrap<Row>(result));
    },
    async update(id, patch) {
      const result = await db()
        .from('itinerary_items')
        .update(fromItinerary(patch))
        .eq('id', id)
        .select()
        .single();
      return toItinerary(unwrap<Row>(result));
    },
    async remove(id) {
      const { error } = await db().from('itinerary_items').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
  },

  checklist: {
    async listByTrip(tripId) {
      const result = await db()
        .from('checklist_items')
        .select('*')
        .eq('trip_id', tripId)
        .order('created_at');
      return unwrapList<Row>(result).map(toChecklist);
    },
    async create(input) {
      const result = await db()
        .from('checklist_items')
        .insert(fromChecklist(input))
        .select()
        .single();
      return toChecklist(unwrap<Row>(result));
    },
    async update(id, patch) {
      const result = await db()
        .from('checklist_items')
        .update(fromChecklist(patch))
        .eq('id', id)
        .select()
        .single();
      return toChecklist(unwrap<Row>(result));
    },
    async remove(id) {
      const { error } = await db().from('checklist_items').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
  },

  expenses: {
    async listByTrip(tripId) {
      const result = await db()
        .from('expenses')
        .select('*')
        .eq('trip_id', tripId)
        .order('transaction_date', { ascending: false });
      return unwrapList<Row>(result).map(toExpense);
    },
    async create(input) {
      const result = await db().from('expenses').insert(fromExpense(input)).select().single();
      return toExpense(unwrap<Row>(result));
    },
    async update(id, patch) {
      const result = await db()
        .from('expenses')
        .update(fromExpense(patch))
        .eq('id', id)
        .select()
        .single();
      return toExpense(unwrap<Row>(result));
    },
    async remove(id) {
      const { error } = await db().from('expenses').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
  },

  journal: {
    async listByTrip(tripId) {
      const result = await db()
        .from('journal_entries')
        .select('*')
        .eq('trip_id', tripId)
        .order('entry_date', { ascending: false });
      return unwrapList<Row>(result).map(toJournal);
    },
    async create(input) {
      const result = await db()
        .from('journal_entries')
        .insert(
          prune({
            trip_id: input.tripId,
            user_id: input.userId,
            entry_date: input.entryDate,
            content: input.content,
            latitude: input.latitude,
            longitude: input.longitude,
            place_name: input.placeName,
            visibility: input.visibility ?? DEFAULT_VISIBILITY.journal,
          }),
        )
        .select()
        .single();
      return toJournal(unwrap<Row>(result));
    },
    async update(id, patch) {
      const result = await db()
        .from('journal_entries')
        .update(
          prune({
            entry_date: patch.entryDate,
            content: patch.content,
            place_name: patch.placeName,
            visibility: patch.visibility,
            updated_at: nowISO(),
          }),
        )
        .eq('id', id)
        .select()
        .single();
      return toJournal(unwrap<Row>(result));
    },
    async remove(id) {
      // Uma entrada pode ter várias mídias — ou nenhuma. As duas pontas contam:
      // `deleteWithFiles` com lista vazia é só o delete da linha.
      const media = await db().from('journal_media').select('file_path').eq('journal_entry_id', id);
      const paths = (media.data ?? []).map((row: Row) => row.file_path);
      await deleteWithFiles(await lifecycleDeps(), BUCKET.journal, paths, async () => {
        const { error } = await db().from('journal_entries').delete().eq('id', id);
        if (error) throw new Error(error.message);
      });
    },
    async listMedia(entryIds) {
      if (entryIds.length === 0) return [];
      const result = await db()
        .from('journal_media')
        .select('*')
        .in('journal_entry_id', entryIds)
        .order('sort_order');
      const rows = unwrapList<Row>(result);
      return Promise.all(
        rows.map(async (row) => ({
          id: row.id,
          journalEntryId: row.journal_entry_id,
          filePath: row.file_path ?? undefined,
        fileUrl: (await openableUrl(BUCKET.journal, row.file_path)) ?? '',
          mimeType: row.mime_type,
          sortOrder: row.sort_order,
        })) as Promise<JournalMedia>[],
      );
    },
    async addMedia(entryId, userId, file) {
      // Só imagem: a galeria do diário renderiza cada item com `expo-image`, e
      // um PDF viraria quadro quebrado. `0007` diz o mesmo no bucket.
      const validation = validateUpload(file, JOURNAL_POLICY);
      if (!validation.ok) throw new Error(validation.message);

      const path = journalStoragePath(userId, entryId, validation.extension, createId());
      const stored = await uploadFile(BUCKET.journal, path, {
        ...file,
        mimeType: validation.mimeType,
      });
      await writeMirrorFromFile(BUCKET.journal, path, file.uri);
      const existing = await db()
        .from('journal_media')
        .select('id')
        .eq('journal_entry_id', entryId);
      const result = await db()
        .from('journal_media')
        .insert({
          journal_entry_id: entryId,
          file_path: stored.url,
          mime_type: stored.mimeType,
          sort_order: existing.data?.length ?? 0,
        })
        .select()
        .single();
      const row = unwrap<Row>(result);
      return {
        id: row.id,
        journalEntryId: entryId,
        filePath: row.file_path ?? undefined,
        fileUrl: (await openableUrl(BUCKET.journal, row.file_path)) ?? '',
        mimeType: row.mime_type,
        sortOrder: row.sort_order,
      };
    },
    async removeMedia(mediaId) {
      const existing = await db()
        .from('journal_media')
        .select('file_path')
        .eq('id', mediaId)
        .maybeSingle();
      await deleteWithFiles(
        await lifecycleDeps(),
        BUCKET.journal,
        [existing.data?.file_path],
        async () => {
          const { error } = await db().from('journal_media').delete().eq('id', mediaId);
          if (error) throw new Error(error.message);
        },
      );
    },
  },

  goals: {
    async list(userId) {
      const result = await db()
        .from('goals')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      return unwrapList<Row>(result).map(toGoal);
    },
    async create(input) {
      const result = await db().from('goals').insert(fromGoal(input)).select().single();
      return toGoal(unwrap<Row>(result));
    },
    async update(id, patch) {
      const result = await db().from('goals').update(fromGoal(patch)).eq('id', id).select().single();
      return toGoal(unwrap<Row>(result));
    },
    async remove(id) {
      const { error } = await db().from('goals').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
  },

  profile: {
    async get(userId) {
      const result = await db().from('profiles').select('*').eq('user_id', userId).maybeSingle();
      if (result.error) throw new Error(result.error.message);
      if (!result.data) return null;
      return withAvatarUrl(toProfile(result.data));
    },

    async update(userId, patch) {
      // UPDATE, e não upsert: a linha já existe desde o cadastro, criada pelo
      // gatilho `handle_new_user` (0001). Um upsert aqui poderia inserir uma
      // linha nova caso o id não batesse — e "criar perfil" não é o que
      // "salvar perfil" deve fazer.
      const result = await db()
        .from('profiles')
        .update({ ...toProfileRow(patch), updated_at: nowISO() })
        .eq('user_id', userId)
        .select()
        .single();
      return withAvatarUrl(toProfile(unwrap<Row>(result)));
    },

    async replaceAvatar(userId, file) {
      const validation = validateAvatar(file);
      if (!validation.ok) throw new Error(validation.message);

      // O caminho é montado aqui, a partir do UID da sessão. O nome que veio da
      // galeria não participa: ele pode conter `../` ou barras, e é o primeiro
      // segmento do caminho que a policy de Storage compara com `auth.uid()`.
      const path = avatarStoragePath(userId, validation.extension, createId());

      const anterior = (await this.get(userId))?.avatarPath;

      await uploadFile(BUCKET.avatars, path, { ...file, mimeType: validation.mimeType });

      let saved: Profile;
      try {
        const result = await db()
          .from('profiles')
          .update({ avatar_path: path, updated_at: nowISO() })
          .eq('user_id', userId)
          .select()
          .single();
        saved = toProfile(unwrap<Row>(result));
      } catch (error) {
        // O perfil continua apontando para a foto antiga, então o arquivo que
        // acabou de subir não é de ninguém. Removê-lo é o que evita acumular
        // lixo a cada tentativa fracassada.
        await db().storage.from(BUCKET.avatars).remove([path]);
        throw error;
      }

      // A partir daqui o perfil já está correto. Se a remoção da foto anterior
      // falhar, sobra um arquivo órfão — chato, mas não é motivo para desfazer
      // uma troca que deu certo nem para mostrar erro a quem trocou a foto.
      if (anterior && anterior !== path) {
        const { error } = await db().storage.from(BUCKET.avatars).remove([anterior]);
        if (error) console.warn('avatar_anterior_nao_removido', { path: anterior });
      }

      return withAvatarUrl(saved);
    },
  },

  content: {
    async listOffers() {
      // A RLS já esconde rascunho e oferta fora de vigência de quem não
      // administra (0004). O filtro aqui é para o administrador: sem ele, o
      // painel abriria a Home com os próprios rascunhos misturados às ofertas
      // reais — as mesmas duas consultas que `listArticles`/`listAllArticles`
      // separam.
      //
      // A vigência entra junto com o status. Filtrar só por `status` deixava
      // uma promoção vencida reaparecer na Home do administrador — a policy a
      // esconde de todo mundo, menos justamente de quem ela deixa ver tudo.
      const today = todayISO();
      const result = await db()
        .from('offers')
        .select('*')
        .eq('status', 'published')
        .or(`active_from.is.null,active_from.lte.${today}`)
        .or(`active_until.is.null,active_until.gte.${today}`)
        .order('sort_order', { ascending: true })
        .order('id', { ascending: true });
      return unwrapList<Row>(result).map(toOffer);
    },
    async getOffer(id) {
      const result = await db().from('offers').select('*').eq('id', id).maybeSingle();
      if (result.error) throw new Error(result.error.message);
      return result.data ? toOffer(result.data) : null;
    },
    async listAllOffers() {
      const result = await db()
        .from('offers')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('id', { ascending: true });
      return unwrapList<Row>(result).map(toOffer);
    },
    async upsertOffer(offer) {
      // `?? null` e não `prune`: campo ausente aqui significa "o admin apagou".
      const result = await db()
        .from('offers')
        .upsert(
          {
            id: offer.id,
            destination: offer.destination,
            description: offer.description,
            price: offer.price ?? null,
            price_currency: offer.priceCurrency ?? null,
            discount_type: offer.discountType ?? null,
            discount_value: offer.discountValue ?? null,
            cost_level: offer.costLevel,
            image_url: offer.imageUrl,
            weather_summary: offer.weatherSummary ?? null,
            best_time: offer.bestTime ?? null,
            things_to_do: offer.thingsToDo,
            active_from: offer.activeFrom ?? null,
            active_until: offer.activeUntil ?? null,
            partner_url: offer.partnerUrl ?? null,
            status: offer.status,
            sort_order: offer.sortOrder,
          },
          { onConflict: 'id' },
        )
        .select()
        .single();
      return toOffer(unwrap<Row>(result));
    },
    async removeOffer(id) {
      const { error } = await db().from('offers').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    async listArticles() {
      const result = await db()
        .from('articles')
        .select('*')
        .eq('status', 'published')
        .order('published_at', { ascending: false });
      return unwrapList<Row>(result).map(toArticle);
    },
    async getArticle(id) {
      // A rota aceita id ou slug, e as duas colunas têm tipos diferentes: `id`
      // é uuid, `slug` é texto. Um `or=` com o valor emendado entregava a
      // gramática do filtro a quem controla o parâmetro (P-08) e, de quebra,
      // nunca funcionou por slug: o ramo `id.eq.<slug>` estoura o cast de uuid
      // e derruba a consulta inteira com 22P02.
      //
      // A forma do valor já diz qual coluna consultar, então nem é preciso um
      // filtro composto — `.eq()` viaja como parâmetro separado e não passa
      // pelo parser de árvore do PostgREST.
      const column = isUuid(id) ? 'id' : 'slug';
      const result = await db().from('articles').select('*').eq(column, id).maybeSingle();
      if (result.error) throw new Error(result.error.message);
      return result.data ? toArticle(result.data) : null;
    },
    async listAllArticles() {
      const result = await db()
        .from('articles')
        .select('*')
        .order('published_at', { ascending: false });
      return unwrapList<Row>(result).map(toArticle);
    },
    async upsertArticle(article) {
      // `?? null` e não `prune`: aqui um campo ausente significa "o admin
      // apagou", e apagar precisa gravar NULL. Omitir a coluna manteria o valor
      // antigo e a edição pareceria não ter funcionado.
      const result = await db()
        .from('articles')
        .upsert(
          {
            id: article.id,
            slug: article.slug,
            title: article.title,
            category: article.category,
            image_url: article.imageUrl ?? null,
            author_name: article.authorName,
            content: article.content,
            published_at: article.publishedAt,
            estimated_read_minutes: article.estimatedReadMinutes,
            status: article.status,
          },
          { onConflict: 'id' },
        )
        .select()
        .single();
      return toArticle(unwrap<Row>(result));
    },
    async uploadEditorialImage(kind, entityId, file) {
      const validation = validateUpload(file, CONTENT_IMAGE_POLICY);
      if (!validation.ok) throw new Error(validation.message);

      // `content` não é namespaced por usuário — quem escreve é a
      // administração, e a policy `content_write` (0007) confere `is_admin()`
      // em vez de prefixo. O prefixo aqui organiza por família, para uma
      // varredura futura conseguir separar o que é de artigo do que é de
      // oferta.
      const path = contentImagePath(kind, entityId, validation.extension, createId());
      const stored = await uploadFile(BUCKET.content, path, {
        ...file,
        mimeType: validation.mimeType,
      });

      // Este é o único bucket cuja URL é permanente. Nos outros três a leitura
      // passa por `signUrl` e expira em uma hora; aqui a imagem precisa
      // sobreviver ao cache do aparelho e ser a mesma amanhã.
      const { data } = db().storage.from(BUCKET.content).getPublicUrl(stored.url);
      return { url: data.publicUrl, mimeType: stored.mimeType };
    },
    async removeEditorialImage(kind, entityId, imageUrl) {
      const path = managedContentPath(imageUrl);
      // URL do Unsplash, link de parceiro, campo vazio: não há arquivo nosso
      // para remover, e mandar a URL inteira como se fosse caminho é
      // exatamente o erro que o §17 da F9 proíbe.
      if (!path) return;
      // E o caminho precisa ser deste registro. A coluna não autoriza nada —
      // mesmo raciocínio de `ownsPath` no ciclo de vida dos arquivos privados.
      if (!managedPathBelongsTo(path, kind, entityId)) return;

      // O Storage responde 200 com `[]` tanto quando removeu quanto quando o
      // objeto já não estava lá (ver `fileLifecycle`). Para uma imagem pública
      // isso basta: o alvo é a ausência do arquivo, e as duas respostas
      // chegam nela. `error` só aparece em falha de transporte.
      const { error } = await db().storage.from(BUCKET.content).remove([path]);
      if (error) throw new Error(error.message);
    },
    async removeArticle(id) {
      const { error } = await db().from('articles').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    async listLikedArticleIds(userId) {
      const result = await db().from('article_likes').select('article_id').eq('user_id', userId);
      return unwrapList<Row>(result).map((row) => row.article_id);
    },
    async setArticleLike(userId, articleId, liked) {
      if (liked) {
        const { error } = await db()
          .from('article_likes')
          .upsert({ user_id: userId, article_id: articleId }, { onConflict: 'user_id,article_id' });
        if (error) throw new Error(error.message);
        return;
      }
      const { error } = await db()
        .from('article_likes')
        .delete()
        .eq('user_id', userId)
        .eq('article_id', articleId);
      if (error) throw new Error(error.message);
    },
  },

  places: {
    async list(params) {
      let query = db().from('places').select('*');
      if (params?.type) query = query.eq('type', params.type);
      if (params?.city) query = query.ilike('city', params.city);
      // Mesma classe de defeito do P-08, e aqui o valor é digitado pelo
      // usuário, não vem da rota. `or=` é inevitável (duas colunas, um termo),
      // então o valor vai entre aspas — e os curingas do LIKE também são
      // escapados, para `%` digitado significar `%` e não "tudo".
      if (params?.search) {
        const term = likeContains(params.search);
        query = query.or(`name.ilike.${term},city.ilike.${term}`);
      }
      const result = await query;
      return unwrapList<Row>(result).map(toPlace);
    },
    async get(id) {
      const result = await db().from('places').select('*').eq('id', id).maybeSingle();
      if (result.error) throw new Error(result.error.message);
      return result.data ? toPlace(result.data) : null;
    },
    async upsert(place) {
      const result = await db()
        .from('places')
        .upsert(
          {
            id: place.id,
            external_provider_id: place.externalProviderId ?? null,
            name: place.name,
            type: place.type,
            rating: place.rating ?? null,
            price_level: place.priceLevel ?? null,
            average_price: place.averagePrice ?? null,
            currency: place.currency ?? null,
            city: place.city,
            country: place.country,
            address: place.address ?? null,
            phone: place.phone ?? null,
            opening_hours: place.openingHours ?? null,
            description: place.description ?? null,
            latitude: place.latitude ?? null,
            longitude: place.longitude ?? null,
            image_url: place.imageUrl ?? null,
            amenities: place.amenities ?? null,
            partner_url: place.partnerUrl ?? null,
          },
          { onConflict: 'id' },
        )
        .select()
        .single();
      return toPlace(unwrap<Row>(result));
    },
    async remove(id) {
      const { error } = await db().from('places').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    async listFavoriteIds(userId) {
      const result = await db().from('place_favorites').select('place_id').eq('user_id', userId);
      return unwrapList<Row>(result).map((row) => row.place_id);
    },
    async setFavorite(userId, placeId, favorite) {
      if (favorite) {
        const { error } = await db()
          .from('place_favorites')
          .upsert({ user_id: userId, place_id: placeId }, { onConflict: 'user_id,place_id' });
        if (error) throw new Error(error.message);
        return;
      }
      const { error } = await db()
        .from('place_favorites')
        .delete()
        .eq('user_id', userId)
        .eq('place_id', placeId);
      if (error) throw new Error(error.message);
    },
  },

  advisors: {
    async list() {
      // Mesmo motivo do `listOffers`: a RLS protege o viajante, este filtro
      // evita que o administrador veja ex-consultores na tela de Especialistas.
      const result = await db()
        .from('advisors')
        .select('*')
        .eq('active', true)
        .order('name', { ascending: true });
      return unwrapList<Row>(result).map(toAdvisor);
    },
    async get(id) {
      const result = await db().from('advisors').select('*').eq('id', id).maybeSingle();
      if (result.error) throw new Error(result.error.message);
      return result.data ? toAdvisor(result.data) : null;
    },
    async listAll() {
      const result = await db().from('advisors').select('*').order('name', { ascending: true });
      return unwrapList<Row>(result).map(toAdvisor);
    },
    async upsert(advisor) {
      const result = await db()
        .from('advisors')
        .upsert(
          {
            id: advisor.id,
            name: advisor.name,
            specialty: advisor.specialty,
            avatar_url: advisor.avatarUrl ?? null,
            rating: advisor.rating ?? null,
            status: advisor.status,
            bio: advisor.bio ?? null,
            active: advisor.active,
          },
          { onConflict: 'id' },
        )
        .select()
        .single();
      return toAdvisor(unwrap<Row>(result));
    },
    async remove(id) {
      const { error } = await db().from('advisors').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    async listConsultations(userId) {
      const result = await db()
        .from('consultations')
        .select('*')
        .eq('user_id', userId)
        // Por `created_at`, não por `scheduled_at`: aquele é texto que a pessoa
        // escreveu, e ordenar por ele punha "amanhã cedo" depois de "20/09"
        // (P-03). O mais recente primeiro é o que a tela quer mostrar.
        .order('created_at', { ascending: false });
      return unwrapList<Row>(result).map(toConsultation);
    },
    async requestConsultation(input) {
      const result = await db()
        .from('consultations')
        .insert({
          user_id: input.userId,
          advisor_id: input.advisorId,
          scheduled_at: input.scheduledAt,
          notes: input.notes,
          status: 'requested',
        })
        .select()
        .single();
      return toConsultation(unwrap<Row>(result));
    },
    async cancelConsultation(id) {
      const { error } = await db().from('consultations').update({ status: 'cancelled' }).eq('id', id);
      if (error) throw new Error(error.message);
    },
  },

  reservations: {
    async listByUser(userId) {
      const result = await db()
        .from('reservation_requests')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      return unwrapList<Row>(result).map(toReservation);
    },
    async request(input) {
      const result = await db()
        .from('reservation_requests')
        .insert(
          prune({
            user_id: input.userId,
            trip_id: input.tripId,
            place_id: input.placeId,
            place_name: input.placeName,
            requested_for: input.requestedFor,
            party_size: input.partySize,
            notes: input.notes,
            status: 'requested',
          }),
        )
        .select()
        .single();
      return toReservation(unwrap<Row>(result));
    },
    async cancel(id) {
      const { error } = await db()
        .from('reservation_requests')
        .update({ status: 'cancelled' })
        .eq('id', id);
      if (error) throw new Error(error.message);
    },
  },

  members: createMembershipRepository(collaborationDeps),
  notifications: createNotificationRepository(collaborationDeps),
  reminders: createReminderRepository(collaborationDeps),
  travelReservations: createTravelReservationRepository(collaborationDeps),
  suggestions: createSuggestionRepository(
    collaborationDeps,
    async (tripId) => {
      const result = await db()
        .from('trips')
        .select('id, destination_city, destination_country, start_date, end_date, suggestions_refreshed_at')
        .eq('id', tripId)
        .maybeSingle();
      const row = result.data as Row | null;
      if (!row) return null;
      return {
        id: row.id,
        destinationCity: row.destination_city,
        destinationCountry: row.destination_country,
        startDate: row.start_date,
        endDate: row.end_date,
        suggestionsRefreshedAt: row.suggestions_refreshed_at ?? undefined,
      };
    },
    async () => (await db().auth.getSession()).data.session?.access_token,
  ),

  ai: {
    async listConversations(userId, tripId) {
      let query = db().from('ai_conversations').select('*').eq('user_id', userId);
      if (tripId) query = query.eq('trip_id', tripId);
      const result = await query.order('updated_at', { ascending: false });
      return unwrapList<Row>(result).map(
        (row): AIConversation => ({
          id: row.id,
          userId: row.user_id,
          tripId: row.trip_id ?? undefined,
          title: row.title ?? undefined,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }),
      );
    },
    async getOrCreateConversation(userId, tripId) {
      let query = db().from('ai_conversations').select('*').eq('user_id', userId);
      query = tripId ? query.eq('trip_id', tripId) : query.is('trip_id', null);
      // Ordenado, e não apenas `limit(1)`: depois de um "Novo chat" existe
      // mais de uma conversa para a mesma viagem, e sem ordenação o Postgres
      // pode devolver qualquer uma delas — a tela reabriria num chat antigo.
      const existing = await query
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing.data) {
        return {
          id: existing.data.id,
          userId: existing.data.user_id,
          tripId: existing.data.trip_id ?? undefined,
          createdAt: existing.data.created_at,
          updatedAt: existing.data.updated_at,
        };
      }
      return supabaseDataSource.ai.createConversation(userId, tripId);
    },
    async createConversation(userId, tripId) {
      const result = await db()
        .from('ai_conversations')
        .insert(prune({ user_id: userId, trip_id: tripId }))
        .select()
        .single();
      const row = unwrap<Row>(result);
      return {
        id: row.id,
        userId: row.user_id,
        tripId: row.trip_id ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    },
    async listMessages(conversationId) {
      const result = await db()
        .from('ai_messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at');
      return unwrapList<Row>(result).map(
        (row): AIMessage => ({
          id: row.id,
          conversationId: row.conversation_id,
          role: row.role,
          content: row.content,
          createdAt: row.created_at,
        }),
      );
    },
    async addMessage(input) {
      const result = await db()
        .from('ai_messages')
        .insert({
          conversation_id: input.conversationId,
          role: input.role,
          content: input.content,
        })
        .select()
        .single();
      const row = unwrap<Row>(result);
      return {
        id: row.id,
        conversationId: row.conversation_id,
        role: row.role,
        content: row.content,
        createdAt: row.created_at,
      };
    },
    async clearConversation(conversationId) {
      const { error } = await db()
        .from('ai_messages')
        .delete()
        .eq('conversation_id', conversationId);
      if (error) throw new Error(error.message);
    },
    async deleteConversation(conversationId) {
      // Uma chamada só: `ai_messages.conversation_id` é `on delete cascade`
      // (0001), então o banco apaga as mensagens junto, na mesma transação.
      // Apagá-las aqui antes seria trabalho duplicado com uma janela no meio.
      //
      // Não há filtro por usuário na cláusula, e não precisa haver: a política
      // `ai_conversations_all` (0002) já restringe o DELETE às linhas cujo
      // `user_id = auth.uid()`. Um id de conversa de outra conta simplesmente
      // não casa com nenhuma linha visível.
      const { error } = await db()
        .from('ai_conversations')
        .delete()
        .eq('id', conversationId);
      if (error) throw new Error(error.message);
    },
  },

  insurance: {
    async listByUser(userId) {
      const result = await db().from('insurance_policies').select('*').eq('user_id', userId);
      return unwrapList<Row>(result).map(
        (row): InsurancePolicy => ({
          id: row.id,
          userId: row.user_id,
          tripId: row.trip_id ?? undefined,
          provider: row.provider,
          policyNumber: row.policy_number,
          emergencyPhone: row.emergency_phone ?? undefined,
          filePath: row.file_path ?? undefined,
          fileUrl: row.file_path ?? undefined,
          validUntil: row.valid_until ?? undefined,
        }),
      );
    },
    async create(input) {
      const result = await db()
        .from('insurance_policies')
        .insert(
          prune({
            user_id: input.userId,
            trip_id: input.tripId,
            provider: input.provider,
            policy_number: input.policyNumber,
            emergency_phone: input.emergencyPhone,
            file_path: input.fileUrl,
            valid_until: input.validUntil,
          }),
        )
        .select()
        .single();
      const row = unwrap<Row>(result);
      return { ...input, id: row.id };
    },
    async remove(id) {
      // P-07 reproduzido aqui, e **só** aqui: medido contra o Storage local,
      // apagar uma apólice deixava o objeto no bucket `attachments`. Ticket e
      // diário já removiam — a auditoria acertou o diagnóstico e errou o
      // alcance.
      const existing = await db()
        .from('insurance_policies')
        .select('file_path')
        .eq('id', id)
        .maybeSingle();

      // O `file_path` de apólice é o único que pode conter uma URI local
      // (`file://…`) em vez de chave de Storage: `useInsurance.create` grava
      // `file?.uri` direto, porque nunca existiu upload para esta entidade.
      // Uma URI dessas não é objeto de bucket e não deve ir para o Storage.
      const gravado = existing.data?.file_path as string | undefined;
      const chave = gravado && !gravado.startsWith('file:') ? gravado : undefined;

      await deleteWithFiles(await lifecycleDeps(), BUCKET.attachments, [chave], async () => {
        const { error } = await db().from('insurance_policies').delete().eq('id', id);
        if (error) throw new Error(error.message);
      });
    },
  },

  files: {
    isAvailableOffline(kind, filePath) {
      return Boolean(readMirror(bucketFor(kind), filePath));
    },
    async ensureOfflineCopy(kind, filePath) {
      const bucket = bucketFor(kind);
      const existente = readMirror(bucket, filePath);
      if (existente) return existente;

      // "Uma cópia local é gravada ao anexar **e ao baixar**" (D-04). Esta é a
      // segunda metade: o arquivo veio de outro aparelho, e a primeira abertura
      // com rede é a chance de deixá-lo pronto para a próxima sem rede.
      try {
        const { data, error } = await db().storage.from(bucket).download(filePath);
        if (error || !data) return undefined;
        return await writeMirrorFromBytes(bucket, filePath, await data.arrayBuffer());
      } catch {
        // Sem rede, ou sem permissão. Nos dois casos a resposta honesta é "não
        // está disponível offline" — não um erro na cara de quem só abriu a
        // tela de documentos.
        return undefined;
      }
    },
    purgeLocalCopies(userId) {
      purgeMirrorForUser(userId);
    },
  },

  async purgeUserData(userId) {
    // Trips cascade to itinerary/checklist/expenses/tickets/journal.
    await db().from('trips').delete().eq('user_id', userId);
    await db().from('goals').delete().eq('user_id', userId);
    await db().from('consultations').delete().eq('user_id', userId);
    await db().from('reservation_requests').delete().eq('user_id', userId);
    await db().from('article_likes').delete().eq('user_id', userId);
    await db().from('place_favorites').delete().eq('user_id', userId);
    await db().from('insurance_policies').delete().eq('user_id', userId);
    await db().from('ai_conversations').delete().eq('user_id', userId);
    await db().from('profiles').delete().eq('user_id', userId);
  },
};
