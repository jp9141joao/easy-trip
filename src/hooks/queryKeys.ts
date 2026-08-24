/**
 * Centralised query keys.
 *
 * Every trip-scoped key embeds the `tripId`, so switching the active trip
 * cannot serve another trip's cached rows (§12, CA-01).
 */
export const queryKeys = {
  trips: (userId: string) => ['trips', userId] as const,
  trip: (tripId: string) => ['trip', tripId] as const,

  itinerary: (tripId: string) => ['itinerary', tripId] as const,
  checklist: (tripId: string) => ['checklist', tripId] as const,
  expenses: (tripId: string) => ['expenses', tripId] as const,
  journal: (tripId: string) => ['journal', tripId] as const,
  journalMedia: (tripId: string) => ['journalMedia', tripId] as const,

  goals: (userId: string) => ['goals', userId] as const,
  profile: (userId: string) => ['profile', userId] as const,

  offers: () => ['offers'] as const,
  offer: (id: string) => ['offer', id] as const,
  articles: () => ['articles'] as const,
  article: (id: string) => ['article', id] as const,
  articleLikes: (userId: string) => ['articleLikes', userId] as const,

  places: (params: string) => ['places', params] as const,
  place: (id: string) => ['place', id] as const,
  placeFavorites: (userId: string) => ['placeFavorites', userId] as const,

  /** Painel: inclui rascunhos, por isso chave própria — nunca compartilhada
   *  com a listagem pública, que não pode servir rascunho do cache. */
  adminArticles: () => ['admin', 'articles'] as const,
  adminPlaces: () => ['admin', 'places'] as const,
  adminOffers: () => ['admin', 'offers'] as const,
  adminAdvisors: () => ['admin', 'advisors'] as const,

  advisors: () => ['advisors'] as const,
  consultations: (userId: string) => ['consultations', userId] as const,
  reservations: (userId: string) => ['reservations', userId] as const,
  insurance: (userId: string) => ['insurance', userId] as const,

  weather: (latitude?: number, longitude?: number) => ['weather', latitude, longitude] as const,
  fxRate: (from: string, to: string) => ['fx', from, to] as const,

  aiConversation: (userId: string, tripId?: string) => ['aiConversation', userId, tripId] as const,
  aiMessages: (conversationId: string) => ['aiMessages', conversationId] as const,

  /* ----------------------------- colaboração ------------------------------ */

  /**
   * As chaves de colaboração levam `tripId` **e**, quando o resultado depende
   * de quem pergunta, `userId` (§58).
   *
   * `tripMembers` não leva `userId` porque a lista de viajantes é a mesma para
   * todos os membros. `myRole` leva, porque é literalmente a resposta para uma
   * pessoa. `reminders` leva, porque lembrete é por pessoa (§31) — sem o
   * `userId` na chave, trocar de conta no mesmo aparelho mostraria os
   * lembretes de quem saiu.
   */
  tripMembers: (tripId: string) => ['tripMembers', tripId] as const,
  tripInvites: (tripId: string) => ['tripInvites', tripId] as const,
  myInvites: (userId: string) => ['myInvites', userId] as const,
  myRole: (tripId: string, userId: string) => ['myRole', tripId, userId] as const,

  notifications: (userId: string) => ['notifications', userId] as const,
  reminders: (tripId: string, userId: string) => ['reminders', tripId, userId] as const,

  /**
   * As reservas de viagem — voo, hotel, carro, ingresso, trem, ônibus.
   *
   * Nome diferente de `reservations`, logo acima, porque são coisas distintas:
   * aquela é o pedido de reserva feito a um lugar do catálogo (§54 do plano
   * original), esta é o documento da reserva que a pessoa já tem. Reusar a
   * chave misturaria as duas no cache.
   */
  tripReservations: (tripId: string) => ['tripReservations', tripId] as const,
  suggestions: (tripId: string) => ['suggestions', tripId] as const,

  /** Previsão por atividade: a chave inclui o dia, porque a resposta muda com ele. */
  activityWeather: (latitude: number, longitude: number, date: string) =>
    ['activityWeather', latitude.toFixed(2), longitude.toFixed(2), date] as const,
} as const;
