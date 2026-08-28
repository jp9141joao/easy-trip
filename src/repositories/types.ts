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
  AppNotification,
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
  Reminder,
  Reservation,
  ReservationRequest,
  Trip,
  TripInvite,
  TripMember,
  TripSuggestion,
  ItineraryItem,
} from '@/domain/types';
import type { InvitableRole, TripRole } from '@/domain/collaboration';
import type { Visibility } from '@/domain/visibility';
import type { ContentImageKind } from '@/domain/upload';

/**
 * Entrada de criação em que a visibilidade é opcional.
 *
 * A tela informa quando o usuário escolheu; quando não informa, o adaptador
 * aplica `DEFAULT_VISIBILITY` do domínio. O default mora numa constante única
 * de propósito: espalhado por chamada, "despesa nasce privada" viraria uma
 * regra que vale em algumas telas e não em outras — que é o mesmo que não
 * valer (§11).
 */
export type WithOptionalVisibility<T extends { visibility: Visibility }> =
  Omit<T, 'visibility'> & { visibility?: Visibility };

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
  /**
   * Troca a capa da viagem, nesta ordem: sobe a nova, aponta a viagem para ela
   * e só então remove a anterior.
   *
   * A ORDEM É O PONTO (§5). Apagar antes deixaria a viagem sem capa se o upload
   * falhasse; e se a linha não puder ser atualizada depois do upload, o arquivo
   * novo é removido — ninguém fica com lixo no bucket por causa de uma falha no
   * meio. É a mesma sequência de `replaceAvatar`, pelo mesmo motivo.
   */
  replaceCover(tripId: string, file: UploadableFile): Promise<Trip>;
  /**
   * Remove a capa enviada e devolve a viagem à imagem sugerida na criação.
   *
   * `cover_image_url` não é tocada: ela nunca deixou de existir, só estava
   * embaixo. Por isso "remover" devolve o padrão em vez de deixar a viagem sem
   * imagem nenhuma (§3).
   */
  removeCover(tripId: string): Promise<Trip>;
}

export interface ItineraryRepository {
  listByTrip(tripId: string): Promise<ItineraryItem[]>;
  create(input: WithOptionalVisibility<Omit<ItineraryItem, 'id'>>): Promise<ItineraryItem>;
  update(id: string, patch: Partial<ItineraryItem>): Promise<ItineraryItem>;
  remove(id: string): Promise<void>;
}

export interface ChecklistRepository {
  listByTrip(tripId: string): Promise<ChecklistItem[]>;
  create(input: WithOptionalVisibility<Omit<ChecklistItem, 'id' | 'createdAt'>>): Promise<ChecklistItem>;
  update(id: string, patch: Partial<ChecklistItem>): Promise<ChecklistItem>;
  remove(id: string): Promise<void>;
}

export interface ExpenseRepository {
  listByTrip(tripId: string): Promise<Expense[]>;
  create(input: WithOptionalVisibility<Omit<Expense, 'id' | 'createdAt'>>): Promise<Expense>;
  update(id: string, patch: Partial<Expense>): Promise<Expense>;
  remove(id: string): Promise<void>;
}

export interface JournalRepository {
  listByTrip(tripId: string): Promise<JournalEntry[]>;
  create(input: WithOptionalVisibility<Omit<JournalEntry, 'id' | 'createdAt' | 'updatedAt'>>): Promise<JournalEntry>;
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
  /** A conversa mais recente da viagem, ou uma nova se ainda não houver. */
  getOrCreateConversation(userId: string, tripId?: string): Promise<AIConversation>;
  /** Abre uma conversa nova. Não toca nas anteriores. */
  createConversation(userId: string, tripId?: string): Promise<AIConversation>;
  listMessages(conversationId: string): Promise<AIMessage[]>;
  addMessage(input: Omit<AIMessage, 'id' | 'createdAt'>): Promise<AIMessage>;
  /** Apaga as mensagens, mantendo a conversa. */
  clearConversation(conversationId: string): Promise<void>;
  /**
   * Apaga a conversa **e** as mensagens dela.
   *
   * É o que "Novo chat" faz desde a decisão de produto de não manter histórico
   * de conversas da IA: começar de novo apaga a anterior, e não a esconde numa
   * lista que ninguém abre. Fechar e reabrir o aplicativo não a traz de volta,
   * porque ela não existe mais.
   *
   * No Supabase o `on delete cascade` de `ai_messages.conversation_id` (0001)
   * remove as mensagens junto — não há migration nova para isto, e a RLS
   * continua sendo quem decide: `ai_conversations_all` só deixa apagar linha
   * cujo `user_id` é o da sessão.
   */
  deleteConversation(conversationId: string): Promise<void>;
}

export interface InsuranceRepository {
  listByUser(userId: string): Promise<InsurancePolicy[]>;
  create(input: Omit<InsurancePolicy, 'id'>): Promise<InsurancePolicy>;
  remove(id: string): Promise<void>;
}

/* ------------------------------- colaboração ------------------------------ */

/**
 * Membros e convites.
 *
 * Nenhum método aqui recebe o `userId` de quem age. Isso é deliberado: no
 * adaptador remoto quem age é a sessão, e todas as regras (só o proprietário
 * convida, só o convidado aceita, o proprietário não sai) são decididas por
 * funções `security definer` no Postgres — ver a 0008. Passar um `userId` daria
 * a impressão de que o cliente escolhe em nome de quem está falando.
 */
export interface MembershipRepository {
  /**
   * Mapa mínimo id → nome usado em autoria/atribuição.
   *
   * Pode incluir ex-membros que deixaram conteúdo compartilhado; isso não é a
   * lista ativa de viajantes, que continua sendo exclusivamente `listMembers`.
   */
  memberNames(tripId: string): Promise<Record<string, string>>;
  listMembers(tripId: string): Promise<TripMember[]>;
  /** Só o proprietário enxerga convites pendentes da viagem. */
  listInvites(tripId: string): Promise<TripInvite[]>;
  /** Convites que a pessoa recebeu e ainda não respondeu. */
  listPendingInvitesForUser(userId: string): Promise<TripInvite[]>;
  /**
   * Resolve o e-mail para uma conta e cria o convite.
   *
   * A resolução acontece inteiramente no servidor: o cliente nunca consulta
   * `auth.users`, nunca recebe uma lista, e um e-mail sem conta volta como erro
   * com mensagem própria — não como "usuário encontrado, id oculto" (§5).
   */
  invite(tripId: string, email: string, role: InvitableRole): Promise<TripInvite>;
  acceptInvite(inviteId: string): Promise<TripMember>;
  declineInvite(inviteId: string): Promise<void>;
  cancelInvite(inviteId: string): Promise<void>;
  setRole(tripId: string, userId: string, role: InvitableRole): Promise<TripMember>;
  removeMember(tripId: string, userId: string): Promise<void>;
  /**
   * Passa a viagem a outro membro (§50, migration 0014).
   *
   * O destinatário precisa já ter aceitado o convite — quem só foi convidado
   * não tem linha em `trip_members` e a função do banco recusa. A troca é
   * atômica e move as DUAS pernas de `is_trip_owner`: `trips.user_id` e o papel
   * em `trip_members`. Devolve a linha do novo proprietário.
   */
  transferOwnership(tripId: string, userId: string): Promise<TripMember>;
  leave(tripId: string): Promise<void>;
  /** O papel da sessão nesta viagem. `null` quando não participa. */
  myRole(tripId: string, userId: string): Promise<TripRole | null>;
}

export interface NotificationRepository {
  list(userId: string): Promise<AppNotification[]>;
  markRead(id: string): Promise<void>;
  markAllRead(userId: string): Promise<void>;
  remove(id: string): Promise<void>;
  /**
   * Converte em notificação os lembretes do usuário que já venceram.
   *
   * Existe porque não há push do sistema operacional nesta fase (§33): o
   * lembrete vira aviso no primeiro momento em que o aplicativo abre depois do
   * horário. Devolve quantos foram entregues, para a tela poder recarregar a
   * lista só quando algo mudou.
   */
  deliverDueReminders(userId: string): Promise<number>;
}

export interface ReminderRepository {
  listByTrip(tripId: string, userId: string): Promise<Reminder[]>;
  /**
   * Cria ou substitui o lembrete daquele usuário para aquela âncora.
   *
   * Upsert e não insert: reabrir a reserva e escolher "1 hora antes" no lugar
   * de "1 dia antes" é trocar o lembrete, não somar um segundo.
   */
  upsert(input: Omit<Reminder, 'id' | 'createdAt' | 'sentAt'>): Promise<Reminder>;
  remove(id: string): Promise<void>;
  removeForEntity(userId: string, entityId: string, anchor: Reminder['anchor']): Promise<void>;
}

export interface TravelReservationRepository {
  listByTrip(tripId: string): Promise<Reservation[]>;
  create(input: WithOptionalVisibility<Omit<Reservation, 'id' | 'createdAt' | 'updatedAt'>>): Promise<Reservation>;
  update(id: string, patch: Partial<Reservation>): Promise<Reservation>;
  remove(id: string): Promise<void>;
  uploadDocument(userId: string, tripId: string, file: UploadableFile): Promise<StoredFile>;
}

export interface SuggestionRepository {
  listByTrip(tripId: string): Promise<TripSuggestion[]>;
  /**
   * Garante o mínimo de sugestões da viagem (§41).
   *
   * `force` é o botão "Atualizar sugestões". Sem ele, a operação só faz alguma
   * coisa quando a viagem tem menos que o mínimo — abrir a tela não gasta
   * geração nenhuma (§43).
   */
  ensure(tripId: string, options?: { force?: boolean }): Promise<TripSuggestion[]>;
  remove(id: string): Promise<void>;
}

/** Aggregate handed to the app through `DataProvider`. */
export interface DataSource {
  readonly kind: 'supabase' | 'local';
  trips: TripRepository;
  itinerary: ItineraryRepository;
  checklist: ChecklistRepository;
  expenses: ExpenseRepository;
  journal: JournalRepository;
  goals: GoalRepository;
  profile: ProfileRepository;
  content: ContentRepository;
  places: PlaceRepository;
  advisors: AdvisorRepository;
  reservations: ReservationRepository;
  ai: AIRepository;
  insurance: InsuranceRepository;
  members: MembershipRepository;
  notifications: NotificationRepository;
  reminders: ReminderRepository;
  travelReservations: TravelReservationRepository;
  suggestions: SuggestionRepository;
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
