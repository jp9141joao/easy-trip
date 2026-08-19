/**
 * Repository contracts (§97, §119).
 *
 * The UI depends only on these interfaces. Two implementations satisfy them:
 *
 *   DataSource
 *   ├── SupabaseDataSource  (production — Postgres + RLS + Storage)
 *   └── LocalDataSource     (device-only — AsyncStorage, still real persistence)
 *
 * Swapping implementations must never require a screen change.
 */

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
  JournalEntry,
  JournalMedia,
  Offer,
  Place,
  Profile,
  ReservationRequest,
  Ticket,
  Trip,
  ItineraryItem,
} from '@/domain/types';

/** A local file selected by the user, ready to be uploaded. */
export interface UploadableFile {
  uri: string;
  name: string;
  mimeType: string;
  size?: number;
}

/** Result of persisting a file — `url` is directly openable/renderable. */
export interface StoredFile {
  url: string;
  mimeType: string;
}

export interface TripRepository {
  list(userId: string): Promise<Trip[]>;
  get(tripId: string): Promise<Trip | null>;
  create(input: Omit<Trip, 'id' | 'createdAt' | 'updatedAt'>): Promise<Trip>;
  update(tripId: string, patch: Partial<Trip>): Promise<Trip>;
  /** Removes the trip and every record that hangs off its `tripId`. */
  remove(tripId: string): Promise<void>;
}

export interface ItineraryRepository {
  listByTrip(tripId: string): Promise<ItineraryItem[]>;
  create(input: Omit<ItineraryItem, 'id'>): Promise<ItineraryItem>;
  update(id: string, patch: Partial<ItineraryItem>): Promise<ItineraryItem>;
  remove(id: string): Promise<void>;
}

export interface ChecklistRepository {
  listByTrip(tripId: string): Promise<ChecklistItem[]>;
  create(input: Omit<ChecklistItem, 'id' | 'createdAt'>): Promise<ChecklistItem>;
  update(id: string, patch: Partial<ChecklistItem>): Promise<ChecklistItem>;
  remove(id: string): Promise<void>;
}

export interface ExpenseRepository {
  listByTrip(tripId: string): Promise<Expense[]>;
  create(input: Omit<Expense, 'id' | 'createdAt'>): Promise<Expense>;
  update(id: string, patch: Partial<Expense>): Promise<Expense>;
  remove(id: string): Promise<void>;
}

export interface TicketRepository {
  listByTrip(tripId: string): Promise<Ticket[]>;
  create(input: Omit<Ticket, 'id'>): Promise<Ticket>;
  update(id: string, patch: Partial<Ticket>): Promise<Ticket>;
  remove(id: string): Promise<void>;
  /** Persists the attachment and returns a URL the app can actually open. */
  uploadAttachment(userId: string, tripId: string, file: UploadableFile): Promise<StoredFile>;
}

export interface JournalRepository {
  listByTrip(tripId: string): Promise<JournalEntry[]>;
  create(input: Omit<JournalEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<JournalEntry>;
  update(id: string, patch: Partial<JournalEntry>): Promise<JournalEntry>;
  remove(id: string): Promise<void>;
  listMedia(entryIds: string[]): Promise<JournalMedia[]>;
  addMedia(entryId: string, userId: string, file: UploadableFile): Promise<JournalMedia>;
  removeMedia(mediaId: string): Promise<void>;
}

export interface GoalRepository {
  list(userId: string): Promise<Goal[]>;
  create(input: Omit<Goal, 'id' | 'createdAt' | 'updatedAt'>): Promise<Goal>;
  update(id: string, patch: Partial<Goal>): Promise<Goal>;
  remove(id: string): Promise<void>;
}

export interface ProfileRepository {
  get(userId: string): Promise<Profile | null>;
  upsert(profile: Profile): Promise<Profile>;
  uploadAvatar(userId: string, file: UploadableFile): Promise<StoredFile>;
}

export interface ContentRepository {
  listOffers(): Promise<Offer[]>;
  getOffer(id: string): Promise<Offer | null>;
  listArticles(): Promise<Article[]>;
  getArticle(id: string): Promise<Article | null>;
  listLikedArticleIds(userId: string): Promise<string[]>;
  setArticleLike(userId: string, articleId: string, liked: boolean): Promise<void>;
}

export interface PlaceRepository {
  list(params?: { city?: string; type?: Place['type']; search?: string }): Promise<Place[]>;
  get(id: string): Promise<Place | null>;
  listFavoriteIds(userId: string): Promise<string[]>;
  setFavorite(userId: string, placeId: string, favorite: boolean): Promise<void>;
}

export interface AdvisorRepository {
  list(): Promise<Advisor[]>;
  get(id: string): Promise<Advisor | null>;
  listConsultations(userId: string): Promise<Consultation[]>;
  requestConsultation(
    input: Omit<Consultation, 'id' | 'status'> & { status?: Consultation['status'] },
  ): Promise<Consultation>;
  cancelConsultation(id: string): Promise<void>;
}

export interface ReservationRepository {
  listByUser(userId: string): Promise<ReservationRequest[]>;
  request(input: Omit<ReservationRequest, 'id' | 'createdAt' | 'status'>): Promise<ReservationRequest>;
  cancel(id: string): Promise<void>;
}

export interface AIRepository {
  listConversations(userId: string, tripId?: string): Promise<AIConversation[]>;
  getOrCreateConversation(userId: string, tripId?: string): Promise<AIConversation>;
  listMessages(conversationId: string): Promise<AIMessage[]>;
  addMessage(input: Omit<AIMessage, 'id' | 'createdAt'>): Promise<AIMessage>;
  clearConversation(conversationId: string): Promise<void>;
}

export interface InsuranceRepository {
  listByUser(userId: string): Promise<InsurancePolicy[]>;
  create(input: Omit<InsurancePolicy, 'id'>): Promise<InsurancePolicy>;
  remove(id: string): Promise<void>;
}

/** Aggregate handed to the app through `DataProvider`. */
export interface DataSource {
  readonly kind: 'supabase' | 'local';
  trips: TripRepository;
  itinerary: ItineraryRepository;
  checklist: ChecklistRepository;
  expenses: ExpenseRepository;
  tickets: TicketRepository;
  journal: JournalRepository;
  goals: GoalRepository;
  profile: ProfileRepository;
  content: ContentRepository;
  places: PlaceRepository;
  advisors: AdvisorRepository;
  reservations: ReservationRepository;
  ai: AIRepository;
  insurance: InsuranceRepository;
  /** Removes every record owned by the user (§94 — account deletion). */
  purgeUserData(userId: string): Promise<void>;
}
