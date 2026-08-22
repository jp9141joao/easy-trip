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
  ProfilePatch,
  ReservationRequest,
  Ticket,
  Trip,
  ItineraryItem,
} from '@/domain/types';
import type { ContentImageKind } from '@/domain/upload';

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
  /**
   * Grava os campos editáveis e devolve o perfil completo.
   *
   * `ProfilePatch` é uma allowlist declarada: `role`, `user_id`, `created_at` e
   * `avatar_path` não cabem no tipo, então uma edição de perfil não tem como
   * carregar junto uma troca de papel ou de identidade.
   *
   * `userId` vem sempre da sessão (`useAuth().user.id`), nunca de formulário —
   * e não precisa ser confiável: a RLS restringe o UPDATE a `auth.uid()` e a
   * `0006` tira do papel `authenticated` o privilégio sobre as colunas
   * protegidas. Um id trocado não alcança a linha de outra pessoa.
   */
  update(userId: string, patch: ProfilePatch): Promise<Profile>;
  /**
   * Troca a foto do perfil, nesta ordem: sobe a nova, aponta o perfil para ela
   * e só então remove a anterior.
   *
   * A ordem é o ponto. Apagar antes deixaria o usuário sem foto se o upload
   * falhasse; e se o perfil não puder ser atualizado depois do upload, o
   * arquivo novo é removido — ninguém fica com lixo no bucket por causa de uma
   * falha no meio (§10).
   */
  replaceAvatar(userId: string, file: UploadableFile): Promise<Profile>;
}

export interface ContentRepository {
  /**
   * O que a Home mostra: publicada, dentro da vigência, na ordem editorial.
   *
   * A mesma regra vive na policy `offers_read` (0004). Aqui ela é repetida
   * porque para o administrador a RLS devolve tudo — sem o filtro, o painel
   * abriria a Home com os próprios rascunhos misturados.
   */
  listOffers(): Promise<Offer[]>;
  getOffer(id: string): Promise<Offer | null>;
  /**
   * Rascunho, vencida e agendada incluídas — só a administração usa.
   * Separada de `listOffers` pelo mesmo motivo de `listAllArticles`: se fossem
   * a mesma chamada com um parâmetro, bastaria esquecer o filtro numa tela
   * pública para o rascunho vazar.
   */
  listAllOffers(): Promise<Offer[]>;
  upsertOffer(offer: Offer): Promise<Offer>;
  removeOffer(id: string): Promise<void>;
  /** Somente publicados — é o que as telas públicas consomem. */
  listArticles(): Promise<Article[]>;
  getArticle(id: string): Promise<Article | null>;
  listLikedArticleIds(userId: string): Promise<string[]>;
  setArticleLike(userId: string, articleId: string, liked: boolean): Promise<void>;

  /**
   * Rascunhos incluídos — só o painel usa. Separado de `listArticles` de
   * propósito: se as duas fossem a mesma chamada com um parâmetro, bastaria
   * esquecer o filtro numa tela pública para rascunho vazar (§18).
   */
  listAllArticles(): Promise<Article[]>;
  upsertArticle(article: Article): Promise<Article>;
  removeArticle(id: string): Promise<void>;
  /**
   * Envia uma imagem editorial e devolve a URL que vai para `imageUrl` (P-04).
   *
   * Serve às três famílias — lugar, artigo e oferta —, porque as três guardam
   * a mesma coisa no mesmo bucket e com a mesma autorização: leitura aberta,
   * escrita só da administração. Só quem é admin consegue completá-la; a
   * recusa vem do servidor, não de um `if` na tela.
   *
   * Diferente de `replaceAvatar`, esta **não** grava o campo: quem decide se a
   * imagem entra é o formulário, no "Salvar". O upload sozinho não publica
   * nada.
   */
  uploadEditorialImage(
    kind: ContentImageKind,
    entityId: string,
    file: UploadableFile,
  ): Promise<StoredFile>;
  /**
   * Remove uma imagem editorial **gerenciada** — a contrapartida de
   * `uploadEditorialImage` (F9, §16–§18).
   *
   * Recebe o valor que está gravado no registro, não um caminho, porque é isso
   * que o formulário tem em mãos. Quem decide se aquilo é removível é a
   * implementação: só sai do Storage o que `managedContentPath` reconhecer
   * **e** `managedPathBelongsTo` provar ser deste `kind`/`entityId`. Uma URL do
   * Unsplash, o link de um parceiro ou o arquivo de outro registro passam por
   * aqui sem que nada seja apagado — e sem erro, porque não há nada de errado
   * em pedir a remoção de uma imagem que o Easy Trip nunca hospedou.
   *
   * Arquivo já ausente também não é erro: a operação é idempotente, para o
   * retry de uma exclusão interrompida convergir.
   */
  removeEditorialImage(
    kind: ContentImageKind,
    entityId: string,
    imageUrl: string | null | undefined,
  ): Promise<void>;
}

export interface PlaceRepository {
  list(params?: { city?: string; type?: Place['type']; search?: string }): Promise<Place[]>;
  get(id: string): Promise<Place | null>;
  upsert(place: Place): Promise<Place>;
  remove(id: string): Promise<void>;
  listFavoriteIds(userId: string): Promise<string[]>;
  setFavorite(userId: string, placeId: string, favorite: boolean): Promise<void>;
}

export interface AdvisorRepository {
  /** Somente `active` — quem saiu do time não aparece no diretório. */
  list(): Promise<Advisor[]>;
  get(id: string): Promise<Advisor | null>;
  /** Inativos incluídos — só a administração usa. */
  listAll(): Promise<Advisor[]>;
  upsert(advisor: Advisor): Promise<Advisor>;
  /**
   * Remove o cadastro do especialista. As consultas já registradas continuam
   * onde estão: pedido do usuário e catálogo são coisas separadas, e apagar um
   * apagaria o histórico do outro.
   */
  remove(id: string): Promise<void>;
  listConsultations(userId: string): Promise<Consultation[]>;
  requestConsultation(
    input: Omit<Consultation, 'id' | 'status' | 'createdAt'> & { status?: Consultation['status'] },
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
  files: OfflineFileRepository;
  /** Removes every record owned by the user (§94 — account deletion). */
  purgeUserData(userId: string): Promise<void>;
}

/** Os dois buckets privados em que um registro guarda arquivo do usuário. */
export type PrivateFileKind = 'attachment' | 'journal';

/**
 * Disponibilidade offline dos arquivos privados — a decisão D-04.
 *
 * A regra da decisão: "o Supabase Storage é a *origem oficial* do arquivo,
 * nunca a *única forma de acesso*". Este contrato é o que torna isso
 * verificável pela interface, em vez de uma promessa.
 *
 * `filePath` é sempre a **chave do Storage**, nunca uma URL assinada: aquela
 * expira em uma hora e não identifica coisa nenhuma (§11).
 */
export interface OfflineFileRepository {
  /**
   * O arquivo já está no aparelho? Resposta síncrona, para a tela poder ser
   * honesta sobre o que abre sem rede sem precisar de um `await` por item.
   */
  isAvailableOffline(kind: PrivateFileKind, filePath: string): boolean;
  /**
   * Baixa o arquivo e guarda a cópia local, se ainda não houver uma.
   *
   * Devolve a URI local, ou `undefined` quando não foi possível — sem rede e
   * sem cópia, por exemplo. `undefined` não é erro: é a informação de que a
   * tela precisa para não prometer offline.
   */
  ensureOfflineCopy(kind: PrivateFileKind, filePath: string): Promise<string | undefined>;
  /** Remove tudo o que este aparelho guardou da conta (saída e exclusão). */
  purgeLocalCopies(userId: string): void;
}
