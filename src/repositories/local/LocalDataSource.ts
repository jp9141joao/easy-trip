/**
 * Device-local implementation of every repository (§119).
 *
 * This is NOT a mock: records go through AsyncStorage and attachments through
 * the document directory, so everything survives an app restart (CA-02, CA-04).
 * What it does not do is talk to a server — which is exactly why the UI labels
 * this mode "Modo demonstração" instead of implying a sync happened.
 */

import { ADVISORS, ARTICLES, OFFERS, PLACES } from '@/data/catalog';
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
  CurrencyCode,
  ReservationRequest,
  Ticket,
  Trip,
} from '@/domain/types';
import { validateAvatar } from '@/domain/avatar';
import { byEditorialOrder, isOfferLive } from '@/domain/offerWindow';
import { parseUserRole } from '@/domain/roles';
import { nowISO, todayISO } from '@/lib/date';
import { deleteStoredFile, persistFile, purgeAllFiles, storedFileExists } from '@/lib/files';
import {
  ATTACHMENT_POLICY,
  CONTENT_IMAGE_POLICY,
  JOURNAL_POLICY,
  managedContentPath,
  managedPathBelongsTo,
  validateUpload,
} from '@/domain/upload';
import { createId } from '@/lib/id';
import { normalizeKey } from '@/data/images';
import type {
  AIRepository,
  AdvisorRepository,
  ChecklistRepository,
  ContentRepository,
  DataSource,
  ExpenseRepository,
  GoalRepository,
  InsuranceRepository,
  ItineraryRepository,
  JournalRepository,
  PlaceRepository,
  ProfileRepository,
  ReservationRepository,
  TicketRepository,
  TripRepository,
} from '../types';
import { LocalCollection } from './collection';

/* --------------------------- persistent collections ----------------------- */

const trips = new LocalCollection<Trip>('trips');
const itinerary = new LocalCollection<ItineraryItem>('itinerary');
const checklist = new LocalCollection<ChecklistItem>('checklist');
const expenses = new LocalCollection<Expense>('expenses');
const tickets = new LocalCollection<Ticket>('tickets');
const journal = new LocalCollection<JournalEntry>('journal');
const journalMedia = new LocalCollection<JournalMedia>('journalMedia');
const goals = new LocalCollection<Goal>('goals');
const profiles = new LocalCollection<Profile & { id: string }>('profiles');
const consultations = new LocalCollection<Consultation>('consultations');
const reservations = new LocalCollection<ReservationRequest>('reservations');
const conversations = new LocalCollection<AIConversation>('aiConversations');
const messages = new LocalCollection<AIMessage>('aiMessages');
const insurance = new LocalCollection<InsurancePolicy>('insurance');
/**
 * Conteúdo editorial agora é persistido, e não mais lido direto de
 * `catalog.ts`. A semente é o próprio catálogo: quem já usa o aplicativo
 * continua vendo exatamente o mesmo conteúdo, e o que o administrador editar
 * passa a valer por cima — sem que a Comunidade ou o diretório fiquem vazios
 * enquanto o cadastro não existe.
 */
const articles = new LocalCollection<Article>('articles', () => ARTICLES);
const places = new LocalCollection<Place>('places', () => PLACES);
// P-05: até aqui estas duas eram lidas direto da constante importada, e por
// isso nenhuma escrita tinha onde acontecer. Agora seguem o mesmo padrão das
// outras — semeadas do catálogo, persistidas a partir daí.
const offers = new LocalCollection<Offer>('offers', () => OFFERS);
const advisors = new LocalCollection<Advisor>('advisors', () => ADVISORS);

const articleLikes = new LocalCollection<{ id: string; userId: string; articleId: string }>(
  'articleLikes',
);
const placeFavorites = new LocalCollection<{ id: string; userId: string; placeId: string }>(
  'placeFavorites',
);

/* --------------------------------- trips ---------------------------------- */

const tripRepository: TripRepository = {
  async list(userId) {
    const rows = await trips.find((t) => t.userId === userId);
    return rows.sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
  },
  get: (tripId) => trips.byId(tripId),
  async create(input) {
    const timestamp = nowISO();
    return trips.insert({ ...input, id: createId(), createdAt: timestamp, updatedAt: timestamp });
  },
  update: (tripId, patch) => trips.update(tripId, { ...patch, updatedAt: nowISO() }),
  async remove(tripId) {
    // Cascade: nothing may outlive its trip (§12).
    const entries = await journal.find((j) => j.tripId === tripId);
    const entryIds = new Set(entries.map((e) => e.id));
    const media = await journalMedia.find((m) => entryIds.has(m.journalEntryId));
    media.forEach((m) => deleteStoredFile(m.fileUrl));
    const tripTickets = await tickets.find((t) => t.tripId === tripId);
    tripTickets.forEach((t) => t.fileUrl && deleteStoredFile(t.fileUrl));

    await journalMedia.removeWhere((m) => entryIds.has(m.journalEntryId));
    await journal.removeWhere((j) => j.tripId === tripId);
    await itinerary.removeWhere((i) => i.tripId === tripId);
    await checklist.removeWhere((c) => c.tripId === tripId);
    await expenses.removeWhere((e) => e.tripId === tripId);
    await tickets.removeWhere((t) => t.tripId === tripId);
    const tripConversations = await conversations.find((c) => c.tripId === tripId);
    const convIds = new Set(tripConversations.map((c) => c.id));
    await messages.removeWhere((m) => convIds.has(m.conversationId));
    await conversations.removeWhere((c) => c.tripId === tripId);
    await trips.remove(tripId);
  },
};

/* ------------------------------- itinerary -------------------------------- */

const itineraryRepository: ItineraryRepository = {
  listByTrip: (tripId) => itinerary.find((i) => i.tripId === tripId),
  create: (input) => itinerary.insert({ ...input, id: createId() }),
  update: (id, patch) => itinerary.update(id, patch),
  remove: (id) => itinerary.remove(id),
};

/* ------------------------------- checklist -------------------------------- */

const checklistRepository: ChecklistRepository = {
  listByTrip: (tripId) => checklist.find((c) => c.tripId === tripId),
  create: (input) => checklist.insert({ ...input, id: createId(), createdAt: nowISO() }),
  update: (id, patch) => checklist.update(id, patch),
  remove: (id) => checklist.remove(id),
};

/* -------------------------------- expenses -------------------------------- */

const expenseRepository: ExpenseRepository = {
  async listByTrip(tripId) {
    const rows = await expenses.find((e) => e.tripId === tripId);
    return rows.sort((a, b) => (a.transactionDate < b.transactionDate ? 1 : -1));
  },
  create: (input) => expenses.insert({ ...input, id: createId(), createdAt: nowISO() }),
  update: (id, patch) => expenses.update(id, patch),
  remove: (id) => expenses.remove(id),
};

/* -------------------------------- tickets --------------------------------- */

const ticketRepository: TicketRepository = {
  listByTrip: (tripId) => tickets.find((t) => t.tripId === tripId),
  create: (input) => tickets.insert({ ...input, id: createId() }),
  update: (id, patch) => tickets.update(id, patch),
  async remove(id) {
    const ticket = await tickets.byId(id);
    if (ticket?.fileUrl) deleteStoredFile(ticket.fileUrl);
    await tickets.remove(id);
  },
  async uploadAttachment(userId, tripId, file) {
    // A mesma política do adaptador remoto. Ela mora nas duas fontes de
    // propósito: sem isso, o que a tela aceita passaria a depender de o
    // aplicativo estar em modo local ou conectado.
    const validation = validateUpload(file, ATTACHMENT_POLICY);
    if (!validation.ok) throw new Error(validation.message);
    return persistFile(['tickets', tripId], file);
  },
};

/* -------------------------------- journal --------------------------------- */

const journalRepository: JournalRepository = {
  async listByTrip(tripId) {
    const rows = await journal.find((j) => j.tripId === tripId);
    return rows.sort((a, b) => (a.entryDate < b.entryDate ? 1 : -1));
  },
  async create(input) {
    const timestamp = nowISO();
    return journal.insert({ ...input, id: createId(), createdAt: timestamp, updatedAt: timestamp });
  },
  update: (id, patch) => journal.update(id, { ...patch, updatedAt: nowISO() }),
  async remove(id) {
    const media = await journalMedia.find((m) => m.journalEntryId === id);
    media.forEach((m) => deleteStoredFile(m.fileUrl));
    await journalMedia.removeWhere((m) => m.journalEntryId === id);
    await journal.remove(id);
  },
  listMedia: (entryIds) => journalMedia.find((m) => entryIds.includes(m.journalEntryId)),
  async addMedia(entryId, userId, file) {
    const validation = validateUpload(file, JOURNAL_POLICY);
    if (!validation.ok) throw new Error(validation.message);
    const stored = await persistFile(['journal', entryId], file);
    const existing = await journalMedia.find((m) => m.journalEntryId === entryId);
    return journalMedia.insert({
      id: createId(),
      journalEntryId: entryId,
      fileUrl: stored.url,
      mimeType: stored.mimeType,
      sortOrder: existing.length,
    });
  },
  async removeMedia(mediaId) {
    const media = await journalMedia.byId(mediaId);
    if (media) deleteStoredFile(media.fileUrl);
    await journalMedia.remove(mediaId);
  },
};

/* ---------------------------------- goals --------------------------------- */

const goalRepository: GoalRepository = {
  list: (userId) => goals.find((g) => g.userId === userId),
  async create(input) {
    const timestamp = nowISO();
    return goals.insert({ ...input, id: createId(), createdAt: timestamp, updatedAt: timestamp });
  },
  update: (id, patch) => goals.update(id, { ...patch, updatedAt: nowISO() }),
  remove: (id) => goals.remove(id),
};

/* --------------------------------- profile -------------------------------- */

const profileRepository: ProfileRepository = {
  async get(userId) {
    const row = await profiles.byId(userId);
    if (!row) return null;
    const { id: _id, ...profile } = row;
    // Perfis gravados antes desta versão não têm a coluna; `parseUserRole` os
    // lê como `user` em vez de deixar `role` chegar `undefined` na interface.
    return { ...profile, role: parseUserRole(profile.role) } as Profile;
  },
  async update(userId, patch) {
    const existing = await profiles.byId(userId);
    // Espelho local do gatilho do Postgres (§7, §31): o papel vem do que já
    // estava gravado e nunca da entrada. Perfil novo nasce `user`.
    const role = parseUserRole(existing?.role);
    // Só as chaves presentes: apagar o telefone grava `undefined`, não mexer
    // nele mantém o que estava — a mesma distinção que o `toProfileRow` faz do
    // lado do Supabase.
    const merged = {
      userId,
      name: '',
      defaultCurrency: 'BRL' as CurrencyCode,
      ...(existing ?? {}),
      ...patch,
      role,
      id: userId,
    };
    if (existing) await profiles.update(userId, merged);
    else await profiles.insert(merged);
    const { id: _id, ...profile } = merged;
    return profile as Profile;
  },

  async replaceAvatar(userId, file) {
    const validation = validateAvatar(file);
    if (!validation.ok) throw new Error(validation.message);

    const existing = await profiles.byId(userId);
    const anterior = existing?.avatarPath;

    // Mesma ordem do adaptador remoto: sobe, aponta, e só então apaga a
    // anterior. Aqui não há rede, mas a ordem continua importando — uma cópia
    // que falhe não pode deixar o usuário sem foto.
    const stored = await persistFile(['avatars', userId], file);
    const saved = await this.update(userId, {});
    const next = { ...saved, avatarPath: stored.url, avatarUrl: stored.url, id: userId };
    await profiles.update(userId, next);

    if (anterior && anterior !== stored.url) deleteStoredFile(anterior);

    const { id: _id, ...profile } = next;
    return profile as Profile;
  },
};

/* --------------------------------- content -------------------------------- */

const contentRepository: ContentRepository = {
  async listOffers(): Promise<Offer[]> {
    // Mesma regra da policy `offers_read` (0004), pela mesma função que o
    // adaptador Supabase usa — publicada E dentro da vigência.
    const today = todayISO();
    const rows = await offers.find((o) => isOfferLive(o, today));
    return rows.sort(byEditorialOrder);
  },
  async getOffer(id) {
    return offers.byId(id);
  },
  async listAllOffers(): Promise<Offer[]> {
    const rows = await offers.all();
    return rows.sort(byEditorialOrder);
  },
  async upsertOffer(offer) {
    const existing = await offers.byId(offer.id);
    if (existing) return offers.update(offer.id, offer);
    return offers.insert(offer);
  },
  async removeOffer(id) {
    await offers.remove(id);
  },
  async listArticles(): Promise<Article[]> {
    const rows = await articles.find((a) => a.status === 'published');
    return rows.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
  },
  async getArticle(id) {
    const rows = await articles.all();
    return rows.find((a) => a.id === id || a.slug === id) ?? null;
  },
  async listAllArticles(): Promise<Article[]> {
    const rows = await articles.all();
    return rows.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
  },
  async upsertArticle(article) {
    const existing = await articles.byId(article.id);
    if (existing) await articles.update(article.id, article);
    else await articles.insert(article);
    return article;
  },
  async uploadEditorialImage(kind, entityId, file) {
    // Mesma validação do adaptador remoto, para as duas fontes recusarem o
    // mesmo arquivo. O modo local não tem `is_admin()` — não há camada de
    // autorização nenhuma aqui, como já acontece em `getArticle` e nos demais
    // métodos administrativos.
    const validation = validateUpload(file, CONTENT_IMAGE_POLICY);
    if (!validation.ok) throw new Error(validation.message);
    return persistFile(['content', kind, entityId], file);
  },
  async removeEditorialImage(kind, entityId, imageUrl) {
    // A mesma regra do adaptador remoto, com o mesmo reconhecedor: só sai o
    // arquivo que este aplicativo gravou para este registro. A URL do Unsplash
    // que veio do catálogo não é apagável — e nem deveria ser tentada.
    const path = managedContentPath(imageUrl);
    if (!path || !managedPathBelongsTo(path, kind, entityId)) return;
    // `deleteStoredFile` já ignora arquivo ausente: repetir a exclusão
    // converge, como no lado remoto.
    deleteStoredFile(imageUrl!);
  },
  async removeArticle(id) {
    await articles.remove(id);
    // Curtidas de um artigo que deixou de existir só ocupariam espaço.
    await articleLikes.removeWhere((l) => l.articleId === id);
  },
  async listLikedArticleIds(userId) {
    const rows = await articleLikes.find((l) => l.userId === userId);
    return rows.map((l) => l.articleId);
  },
  async setArticleLike(userId, articleId, liked) {
    if (liked) {
      const existing = await articleLikes.find(
        (l) => l.userId === userId && l.articleId === articleId,
      );
      if (existing.length === 0) {
        await articleLikes.insert({ id: createId(), userId, articleId });
      }
      return;
    }
    await articleLikes.removeWhere((l) => l.userId === userId && l.articleId === articleId);
  },
};

/* --------------------------------- places --------------------------------- */

const placeRepository: PlaceRepository = {
  async list(params): Promise<Place[]> {
    let rows = await places.all();
    if (params?.type) rows = rows.filter((p) => p.type === params.type);
    if (params?.city) {
      const city = normalizeKey(params.city);
      rows = rows.filter((p) => normalizeKey(p.city) === city);
    }
    if (params?.search) {
      const term = normalizeKey(params.search);
      rows = rows.filter(
        (p) =>
          normalizeKey(p.name).includes(term) ||
          normalizeKey(p.city).includes(term) ||
          normalizeKey(p.country).includes(term) ||
          normalizeKey(p.type).includes(term),
      );
    }
    return rows;
  },
  async get(id) {
    return places.byId(id);
  },
  async upsert(place) {
    const existing = await places.byId(place.id);
    if (existing) await places.update(place.id, place);
    else await places.insert(place);
    return place;
  },
  async remove(id) {
    await places.remove(id);
    await placeFavorites.removeWhere((f) => f.placeId === id);
  },
  async listFavoriteIds(userId) {
    const rows = await placeFavorites.find((f) => f.userId === userId);
    return rows.map((f) => f.placeId);
  },
  async setFavorite(userId, placeId, favorite) {
    if (favorite) {
      const existing = await placeFavorites.find(
        (f) => f.userId === userId && f.placeId === placeId,
      );
      if (existing.length === 0) await placeFavorites.insert({ id: createId(), userId, placeId });
      return;
    }
    await placeFavorites.removeWhere((f) => f.userId === userId && f.placeId === placeId);
  },
};

/* -------------------------------- advisors -------------------------------- */

const advisorRepository: AdvisorRepository = {
  async list(): Promise<Advisor[]> {
    const rows = await advisors.find((a) => a.active);
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  },
  async get(id) {
    return advisors.byId(id);
  },
  async listAll(): Promise<Advisor[]> {
    const rows = await advisors.all();
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  },
  async upsert(advisor) {
    const existing = await advisors.byId(advisor.id);
    if (existing) return advisors.update(advisor.id, advisor);
    return advisors.insert(advisor);
  },
  async remove(id) {
    // Só o cadastro. As consultas continuam de pé — ver o contrato.
    await advisors.remove(id);
  },
  async listConsultations(userId) {
    const rows = await consultations.find((c) => c.userId === userId);
    // Por `createdAt`. `scheduledAt` é o texto que a pessoa escreveu — ordenar
    // por ele comparava "amanhã cedo" com "20/09 às 15h" como string (P-03).
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },
  async requestConsultation(input) {
    // Always lands as `requested` — an advisor still has to accept it (§46).
    return consultations.insert({
      ...input,
      id: createId(),
      status: input.status ?? 'requested',
      createdAt: nowISO(),
    });
  },
  async cancelConsultation(id) {
    await consultations.update(id, { status: 'cancelled' });
  },
};

/* ------------------------------ reservations ------------------------------ */

const reservationRepository: ReservationRepository = {
  async listByUser(userId) {
    const rows = await reservations.find((r) => r.userId === userId);
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },
  async request(input) {
    // `requested`, never `confirmed` — no provider has replied (§54).
    return reservations.insert({
      ...input,
      id: createId(),
      status: 'requested',
      createdAt: nowISO(),
    });
  },
  async cancel(id) {
    await reservations.update(id, { status: 'cancelled' });
  },
};

/* ----------------------------------- AI ----------------------------------- */

const aiRepository: AIRepository = {
  listConversations: (userId, tripId) =>
    conversations.find((c) => c.userId === userId && (tripId ? c.tripId === tripId : true)),
  async getOrCreateConversation(userId, tripId) {
    const existing = await conversations.find(
      (c) => c.userId === userId && c.tripId === tripId,
    );
    // A mais recente, e não "a primeira que aparecer": depois de um "Novo
    // chat" existe mais de uma conversa para a mesma viagem, e reabrir a tela
    // tem de cair na que o usuário estava usando.
    const [latest] = existing.sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1));
    if (latest) return latest;
    return aiRepository.createConversation(userId, tripId);
  },
  createConversation(userId, tripId) {
    const timestamp = nowISO();
    return conversations.insert({
      id: createId(),
      userId,
      tripId,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  },
  async listMessages(conversationId) {
    const rows = await messages.find((m) => m.conversationId === conversationId);
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  },
  async addMessage(input) {
    const message = await messages.insert({ ...input, id: createId(), createdAt: nowISO() });
    await conversations.update(input.conversationId, { updatedAt: nowISO() }).catch(() => undefined);
    return message;
  },
  async clearConversation(conversationId) {
    await messages.removeWhere((m) => m.conversationId === conversationId);
  },
};

/* -------------------------------- insurance ------------------------------- */

const insuranceRepository: InsuranceRepository = {
  listByUser: (userId) => insurance.find((p) => p.userId === userId),
  create: (input) => insurance.insert({ ...input, id: createId() }),
  remove: (id) => insurance.remove(id),
};

/* ------------------------------- data source ------------------------------ */

export const localDataSource: DataSource = {
  kind: 'local',
  trips: tripRepository,
  itinerary: itineraryRepository,
  checklist: checklistRepository,
  expenses: expenseRepository,
  tickets: ticketRepository,
  journal: journalRepository,
  goals: goalRepository,
  profile: profileRepository,
  content: contentRepository,
  places: placeRepository,
  advisors: advisorRepository,
  reservations: reservationRepository,
  ai: aiRepository,
  insurance: insuranceRepository,
  /**
   * No modo local o arquivo **já é** local: `persistFile` copia o que o usuário
   * escolheu para o diretório do aplicativo, e é essa URI que fica gravada.
   * Não há o que baixar nem espelhar — a disponibilidade offline aqui é a
   * situação original que a D-04 existe para não perder ao ligar o Storage.
   */
  files: {
    isAvailableOffline: (_kind, filePath) => storedFileExists(filePath),
    ensureOfflineCopy: async (_kind, filePath) =>
      storedFileExists(filePath) ? filePath : undefined,
    purgeLocalCopies: () => purgeAllFiles(),
  },

  async purgeUserData(userId) {
    const userTrips = await trips.find((t) => t.userId === userId);
    for (const trip of userTrips) await tripRepository.remove(trip.id);
    await goals.removeWhere((g) => g.userId === userId);
    await profiles.removeWhere((p) => p.userId === userId);
    await consultations.removeWhere((c) => c.userId === userId);
    await reservations.removeWhere((r) => r.userId === userId);
    await articleLikes.removeWhere((l) => l.userId === userId);
    await placeFavorites.removeWhere((f) => f.userId === userId);
    await insurance.removeWhere((p) => p.userId === userId);
    const userConversations = await conversations.find((c) => c.userId === userId);
    const ids = new Set(userConversations.map((c) => c.id));
    await messages.removeWhere((m) => ids.has(m.conversationId));
    await conversations.removeWhere((c) => c.userId === userId);
    purgeAllFiles();
  },
};

/** Exposed for the seeding routine and for tests. */
export const localCollections = {
  trips,
  offers,
  advisors,
  itinerary,
  checklist,
  expenses,
  tickets,
  journal,
  journalMedia,
  goals,
  profiles,
};
