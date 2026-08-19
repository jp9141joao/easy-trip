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
  tickets: (tripId: string) => ['tickets', tripId] as const,
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

  advisors: () => ['advisors'] as const,
  consultations: (userId: string) => ['consultations', userId] as const,
  reservations: (userId: string) => ['reservations', userId] as const,
  insurance: (userId: string) => ['insurance', userId] as const,

  weather: (latitude?: number, longitude?: number) => ['weather', latitude, longitude] as const,
  fxRate: (from: string, to: string) => ['fx', from, to] as const,

  aiConversation: (userId: string, tripId?: string) => ['aiConversation', userId, tripId] as const,
  aiMessages: (conversationId: string) => ['aiMessages', conversationId] as const,
} as const;
