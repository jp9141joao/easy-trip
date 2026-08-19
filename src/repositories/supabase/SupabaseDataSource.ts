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
  ReservationRequest,
  Ticket,
  Trip,
} from '@/domain/types';
import { nowISO } from '@/lib/date';
import { getSupabaseClient } from './client';
import type { DataSource, StoredFile, UploadableFile } from '../types';

const SIGNED_URL_TTL = 60 * 60; // 1 hour

const BUCKET = {
  attachments: 'attachments',
  journal: 'journal',
  avatars: 'avatars',
} as const;

function db(): SupabaseClient {
  return getSupabaseClient();
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
  reservationReference: row.reservation_reference ?? undefined,
  completed: row.completed,
  sortOrder: row.sort_order,
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
  reservation_reference: item.reservationReference,
  completed: item.completed,
  sort_order: item.sortOrder,
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
});

const fromChecklist = (item: Partial<ChecklistItem>): Row => prune({
  trip_id: item.tripId,
  label: item.label,
  category: item.category,
  completed: item.completed,
  priority: item.priority,
  due_date: item.dueDate,
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
  avatarUrl: row.avatar_path ?? undefined,
  homeCity: row.home_city ?? undefined,
  homeCountry: row.home_country ?? undefined,
  homeTimezone: row.home_timezone ?? undefined,
  travelStyle: row.travel_style ?? undefined,
  defaultCurrency: row.default_currency,
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
});

const toConsultation = (row: Row): Consultation => ({
  id: row.id,
  userId: row.user_id,
  advisorId: row.advisor_id,
  scheduledAt: row.scheduled_at,
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

/* ------------------------------- data source ------------------------------ */

export const supabaseDataSource: DataSource = {
  kind: 'supabase',

  trips: {
    async list(userId) {
      const result = await db()
        .from('trips')
        .select('*')
        .eq('user_id', userId)
        .order('start_date', { ascending: false });
      return unwrapList<Row>(result).map(toTrip);
    },
    async get(tripId) {
      const result = await db().from('trips').select('*').eq('id', tripId).maybeSingle();
      if (result.error) throw new Error(result.error.message);
      return result.data ? toTrip(result.data) : null;
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

  tickets: {
    async listByTrip(tripId) {
      const result = await db().from('tickets').select('*').eq('trip_id', tripId);
      const rows = unwrapList<Row>(result);
      return Promise.all(
        rows.map(async (row) => ({
          id: row.id,
          tripId: row.trip_id,
          userId: row.user_id,
          type: row.type,
          title: row.title,
          provider: row.provider ?? undefined,
          reference: row.reference ?? undefined,
          startDateTime: row.start_date_time ?? undefined,
          endDateTime: row.end_date_time ?? undefined,
          origin: row.origin ?? undefined,
          destination: row.destination ?? undefined,
          fileUrl: await signUrl(BUCKET.attachments, row.file_path),
          mimeType: row.mime_type ?? undefined,
          notes: row.notes ?? undefined,
        })) as Promise<Ticket>[],
      );
    },
    async create(input) {
      const result = await db()
        .from('tickets')
        .insert(
          prune({
            trip_id: input.tripId,
            user_id: input.userId,
            type: input.type,
            title: input.title,
            provider: input.provider,
            reference: input.reference,
            start_date_time: input.startDateTime,
            end_date_time: input.endDateTime,
            origin: input.origin,
            destination: input.destination,
            file_path: input.fileUrl,
            mime_type: input.mimeType,
            notes: input.notes,
          }),
        )
        .select()
        .single();
      const row = unwrap<Row>(result);
      return {
        ...input,
        id: row.id,
        fileUrl: await signUrl(BUCKET.attachments, row.file_path),
      } as Ticket;
    },
    async update(id, patch) {
      const result = await db()
        .from('tickets')
        .update(
          prune({
            type: patch.type,
            title: patch.title,
            provider: patch.provider,
            reference: patch.reference,
            start_date_time: patch.startDateTime,
            end_date_time: patch.endDateTime,
            origin: patch.origin,
            destination: patch.destination,
            file_path: patch.fileUrl,
            mime_type: patch.mimeType,
            notes: patch.notes,
          }),
        )
        .eq('id', id)
        .select()
        .single();
      const row = unwrap<Row>(result);
      return {
        id: row.id,
        tripId: row.trip_id,
        userId: row.user_id,
        type: row.type,
        title: row.title,
        provider: row.provider ?? undefined,
        reference: row.reference ?? undefined,
        startDateTime: row.start_date_time ?? undefined,
        endDateTime: row.end_date_time ?? undefined,
        origin: row.origin ?? undefined,
        destination: row.destination ?? undefined,
        fileUrl: await signUrl(BUCKET.attachments, row.file_path),
        mimeType: row.mime_type ?? undefined,
        notes: row.notes ?? undefined,
      };
    },
    async remove(id) {
      const existing = await db().from('tickets').select('file_path').eq('id', id).maybeSingle();
      const path = existing.data?.file_path;
      if (path) await db().storage.from(BUCKET.attachments).remove([path]);
      const { error } = await db().from('tickets').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    uploadAttachment: (userId, tripId, file) =>
      uploadFile(BUCKET.attachments, `${userId}/${tripId}/${Date.now()}-${file.name}`, file),
  },

  journal: {
    async listByTrip(tripId) {
      const result = await db()
        .from('journal_entries')
        .select('*')
        .eq('trip_id', tripId)
        .order('entry_date', { ascending: false });
      return unwrapList<Row>(result).map(
        (row): JournalEntry => ({
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
        }),
      );
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
          }),
        )
        .select()
        .single();
      const row = unwrap<Row>(result);
      return { ...input, id: row.id, createdAt: row.created_at, updatedAt: row.updated_at };
    },
    async update(id, patch) {
      const result = await db()
        .from('journal_entries')
        .update(
          prune({
            entry_date: patch.entryDate,
            content: patch.content,
            place_name: patch.placeName,
            updated_at: nowISO(),
          }),
        )
        .eq('id', id)
        .select()
        .single();
      const row = unwrap<Row>(result);
      return {
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
      };
    },
    async remove(id) {
      const media = await db().from('journal_media').select('file_path').eq('journal_entry_id', id);
      const paths = (media.data ?? []).map((row: Row) => row.file_path).filter(Boolean);
      if (paths.length) await db().storage.from(BUCKET.journal).remove(paths);
      const { error } = await db().from('journal_entries').delete().eq('id', id);
      if (error) throw new Error(error.message);
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
          fileUrl: (await signUrl(BUCKET.journal, row.file_path)) ?? '',
          mimeType: row.mime_type,
          sortOrder: row.sort_order,
        })) as Promise<JournalMedia>[],
      );
    },
    async addMedia(entryId, userId, file) {
      const stored = await uploadFile(
        BUCKET.journal,
        `${userId}/${entryId}/${Date.now()}-${file.name}`,
        file,
      );
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
        fileUrl: (await signUrl(BUCKET.journal, row.file_path)) ?? '',
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
      if (existing.data?.file_path) {
        await db().storage.from(BUCKET.journal).remove([existing.data.file_path]);
      }
      const { error } = await db().from('journal_media').delete().eq('id', mediaId);
      if (error) throw new Error(error.message);
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
      const profile = toProfile(result.data);
      return { ...profile, avatarUrl: await signUrl(BUCKET.avatars, result.data.avatar_path) };
    },
    async upsert(profile) {
      const result = await db()
        .from('profiles')
        .upsert(
          prune({
            user_id: profile.userId,
            name: profile.name,
            phone: profile.phone,
            avatar_path: profile.avatarUrl,
            home_city: profile.homeCity,
            home_country: profile.homeCountry,
            home_timezone: profile.homeTimezone,
            travel_style: profile.travelStyle,
            default_currency: profile.defaultCurrency,
          }),
          { onConflict: 'user_id' },
        )
        .select()
        .single();
      const row = unwrap<Row>(result);
      // Return a usable URL, not the raw storage path, so the caller can render
      // the new avatar immediately without a refetch.
      return { ...toProfile(row), avatarUrl: await signUrl(BUCKET.avatars, row.avatar_path) };
    },
    uploadAvatar: (userId, file) =>
      uploadFile(BUCKET.avatars, `${userId}/avatar-${Date.now()}-${file.name}`, file),
  },

  content: {
    async listOffers() {
      const result = await db().from('offers').select('*');
      return unwrapList<Row>(result).map(toOffer);
    },
    async getOffer(id) {
      const result = await db().from('offers').select('*').eq('id', id).maybeSingle();
      if (result.error) throw new Error(result.error.message);
      return result.data ? toOffer(result.data) : null;
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
      const result = await db().from('articles').select('*').or(`id.eq.${id},slug.eq.${id}`).maybeSingle();
      if (result.error) throw new Error(result.error.message);
      return result.data ? toArticle(result.data) : null;
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
      if (params?.search) query = query.or(`name.ilike.%${params.search}%,city.ilike.%${params.search}%`);
      const result = await query;
      return unwrapList<Row>(result).map(toPlace);
    },
    async get(id) {
      const result = await db().from('places').select('*').eq('id', id).maybeSingle();
      if (result.error) throw new Error(result.error.message);
      return result.data ? toPlace(result.data) : null;
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
      const result = await db().from('advisors').select('*');
      return unwrapList<Row>(result).map(toAdvisor);
    },
    async get(id) {
      const result = await db().from('advisors').select('*').eq('id', id).maybeSingle();
      if (result.error) throw new Error(result.error.message);
      return result.data ? toAdvisor(result.data) : null;
    },
    async listConsultations(userId) {
      const result = await db()
        .from('consultations')
        .select('*')
        .eq('user_id', userId)
        .order('scheduled_at', { ascending: false });
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
      const existing = await query.limit(1).maybeSingle();
      if (existing.data) {
        return {
          id: existing.data.id,
          userId: existing.data.user_id,
          tripId: existing.data.trip_id ?? undefined,
          createdAt: existing.data.created_at,
          updatedAt: existing.data.updated_at,
        };
      }
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
      const { error } = await db().from('insurance_policies').delete().eq('id', id);
      if (error) throw new Error(error.message);
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
