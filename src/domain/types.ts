/**
 * Easy Trip 2.0 — domain model.
 *
 * Golden rule (§12): a Trip exists exactly once, and every operational record
 * carries the `tripId` it belongs to. Values that can be derived
 * (status, daysLeft, totalSpent, remainingBudget, progress) are NEVER stored —
 * they live in `src/domain/selectors.ts`.
 */

export type ISODate = string; // YYYY-MM-DD
export type ISODateTime = string; // ISO 8601 UTC

/**
 * Texto de agenda escrito pela pessoa — **não** é data (P-03).
 *
 * Onde este tipo aparece, a tela pede a preferência em palavras: "quinta à
 * tarde", "20/09 às 20h", "qualquer dia da semana que vem". A coluna
 * correspondente é `text`, e é isso mesmo: quem recebe a solicitação é uma
 * pessoa do outro lado, que responde propondo um horário. Forçar um seletor de
 * data aqui empobreceria o pedido sem ganhar nada — não há agenda para
 * consultar.
 *
 * Existe como tipo próprio porque antes estes campos eram `ISODateTime`, e a
 * mentira tinha consequência: `listConsultations` ordenava por eles como se
 * fossem ISO, então "amanhã cedo" vinha depois de "20/09" por comparação de
 * string. Quem lesse a assinatura confiaria num `new Date(...)` que devolve
 * `Invalid Date`.
 *
 * Se um dia houver agenda de verdade, o caminho é acrescentar uma coluna
 * `timestamptz` ao lado — não reinterpretar esta.
 */
export type ScheduleText = string;

export type CurrencyCode = 'BRL' | 'USD' | 'EUR' | 'GBP' | 'JPY' | 'CHF' | 'CAD' | 'AUD' | 'ARS';

export const CURRENCIES: readonly CurrencyCode[] = [
  'BRL',
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'CHF',
  'CAD',
  'AUD',
  'ARS',
] as const;

export type TravelStyle =
  | 'aventura'
  | 'cultural'
  | 'gastronomico'
  | 'relaxamento'
  | 'economico'
  | 'luxo'
  | 'corporativo'
  | 'familia';

export const TRAVEL_STYLES: readonly TravelStyle[] = [
  'aventura',
  'cultural',
  'gastronomico',
  'relaxamento',
  'economico',
  'luxo',
  'corporativo',
  'familia',
] as const;

export interface User {
  id: string;
  email: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/**
 * Papel da conta. Duas posições, e só: quem usa o Easy Trip e quem edita o
 * conteúdo editorial que o Easy Trip exibe.
 */
export const USER_ROLES = ['user', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface Profile {
  userId: string;
  name: string;
  phone?: string;
  /**
   * Caminho do arquivo dentro do bucket `avatars` (`{uid}/…`). É isto que fica
   * gravado em `profiles.avatar_path`.
   */
  avatarPath?: string;
  /**
   * URL assinada, derivada de `avatarPath` a cada leitura e válida por uma
   * hora. **Nunca é gravada.**
   *
   * Os dois campos existiam como um só, e o resultado foi corrupção silenciosa:
   * a leitura devolvia a URL assinada em `avatarUrl`, a tela devolvia o mesmo
   * objeto ao salvar, e a URL — com token e prazo de validade — acabava gravada
   * na coluna do caminho. Na leitura seguinte não havia arquivo naquele
   * "caminho" e a foto sumia. Separar não é preciosismo de nomenclatura: é o
   * que impede o valor derivado de voltar para o banco.
   */
  avatarUrl?: string;
  homeCity?: string;
  homeCountry?: string;
  /** IANA timezone, e.g. `America/Sao_Paulo`. */
  homeTimezone?: string;
  travelStyle?: TravelStyle;
  defaultCurrency: CurrencyCode;
  /**
   * Fonte única de verdade da autorizacão (§4). O aplicativo apenas lê este
   * campo; quem o escreve é o banco — ver `ProfilePatch`.
   */
  role: UserRole;
}

/**
 * O que o aplicativo pode gravar num perfil.
 *
 * `role` está deliberadamente de fora. Não é uma omissão de conveniência: é a
 * primeira das duas barreiras contra auto-promoção (§7). Como o tipo de entrada
 * do repositório não tem o campo, nenhuma tela — nem uma futura — consegue
 * *expressar* uma troca de papel. A segunda barreira, a que realmente importa,
 * é o gatilho no Postgres, porque um cliente modificado não obedece a tipos.
 */
/**
 * Tudo que o dono da conta pode editar — e nada além disso.
 *
 * É uma allowlist declarada, não um `Omit` do que por acaso não deveria entrar.
 * A diferença aparece quando `Profile` ganha uma coluna nova: com `Omit`, o
 * campo novo entraria no que é editável por padrão e ninguém perceberia; aqui,
 * ele fica de fora até que alguém o adicione de propósito.
 *
 * Ficam de fora, cada um por um motivo diferente:
 *   `role`       — autorização; quem escreve é o banco (0003);
 *   `userId`     — identidade; vem da sessão, nunca de formulário;
 *   `avatarPath` — muda pelo fluxo de avatar, que também mexe no Storage;
 *   `avatarUrl`  — é derivado; gravá-lo foi exatamente o defeito acima.
 */
export interface ProfilePatch {
  name?: string;
  phone?: string;
  homeCity?: string;
  homeCountry?: string;
  homeTimezone?: string;
  travelStyle?: TravelStyle;
  defaultCurrency?: CurrencyCode;
}

/** A mesma allowlist em tempo de execução, para o teste poder conferi-la. */
export const PROFILE_PATCH_FIELDS = [
  'name',
  'phone',
  'homeCity',
  'homeCountry',
  'homeTimezone',
  'travelStyle',
  'defaultCurrency',
] as const satisfies readonly (keyof ProfilePatch)[];

export interface Trip {
  id: string;
  userId: string;
  destinationCity: string;
  destinationCountry: string;
  /** ISO 3166-1 alpha-2, uppercase. Drives SOS and locale lookups. */
  countryCode: string;
  latitude?: number;
  longitude?: number;
  /** IANA timezone of the destination. */
  timezone: string;
  startDate: ISODate;
  endDate: ISODate;
  coverImageUrl?: string;
  budgetTotal: number;
  budgetCurrency: CurrencyCode;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/** Derived, never persisted (§31). */
export type TripStatus = 'upcoming' | 'active' | 'completed';

export type ItineraryType =
  | 'voo'
  | 'hospedagem'
  | 'refeicao'
  | 'atracao'
  | 'transporte'
  | 'atividade'
  | 'outro';

export const ITINERARY_TYPES: readonly ItineraryType[] = [
  'voo',
  'hospedagem',
  'refeicao',
  'atracao',
  'transporte',
  'atividade',
  'outro',
] as const;

export interface ItineraryItem {
  id: string;
  tripId: string;
  date: ISODate;
  /** HH:mm */
  startTime?: string;
  endTime?: string;
  type: ItineraryType;
  title: string;
  description?: string;
  placeName?: string;
  latitude?: number;
  longitude?: number;
  reservationReference?: string;
  completed: boolean;
  sortOrder: number;
}

export type ChecklistCategory =
  | 'documentos'
  | 'saude'
  | 'mala'
  | 'reservas'
  | 'financeiro'
  | 'outros';

export const CHECKLIST_CATEGORIES: readonly ChecklistCategory[] = [
  'documentos',
  'saude',
  'mala',
  'reservas',
  'financeiro',
  'outros',
] as const;

export type Priority = 'low' | 'medium' | 'high';

export interface ChecklistItem {
  id: string;
  tripId: string;
  label: string;
  category: ChecklistCategory;
  completed: boolean;
  priority?: Priority;
  dueDate?: ISODate;
  createdAt: ISODateTime;
}

export type ExpenseCategory =
  | 'hospedagem'
  | 'alimentacao'
  | 'transporte'
  | 'lazer'
  | 'compras'
  | 'outros';

export const EXPENSE_CATEGORIES: readonly ExpenseCategory[] = [
  'hospedagem',
  'alimentacao',
  'transporte',
  'lazer',
  'compras',
  'outros',
] as const;

export interface Expense {
  id: string;
  tripId: string;
  userId: string;
  category: ExpenseCategory;
  /** Amount in `currency`, the currency actually paid. */
  amount: number;
  currency: CurrencyCode;
  /**
   * Amount converted into the trip's budget currency. Stored together with the
   * rate + timestamp so a historical expense never silently changes value when
   * the FX market moves (§41).
   */
  amountInBudgetCurrency?: number;
  exchangeRate?: number;
  exchangeRateTimestamp?: ISODateTime;
  transactionDate: ISODate;
  description: string;
  createdAt: ISODateTime;
}

export interface JournalEntry {
  id: string;
  tripId: string;
  userId: string;
  entryDate: ISODate;
  content: string;
  latitude?: number;
  longitude?: number;
  placeName?: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface JournalMedia {
  id: string;
  journalEntryId: string;
  /**
   * A chave do objeto no Storage — a identidade durável do arquivo (§11).
   *
   * É o que fica gravado. `fileUrl` é derivado dele a cada leitura e não deve
   * voltar para o banco: era esse exato embaralhamento que fazia a foto de
   * perfil sumir na F5, quando uma URL assinada expirada era regravada por
   * cima do caminho.
   */
  filePath?: string;
  /**
   * Como abrir o arquivo **agora**. Derivado, nunca gravado.
   *
   * Aponta para a cópia local quando ela existe — e é isso que faz o documento
   * abrir em modo avião (D-04) — e para uma URL assinada de uma hora quando
   * não existe.
   */
  fileUrl: string;
  mimeType: string;
  sortOrder: number;
}

export type TicketType = 'voo' | 'hospedagem' | 'atracao' | 'transporte' | 'outro';

export const TICKET_TYPES: readonly TicketType[] = [
  'voo',
  'hospedagem',
  'atracao',
  'transporte',
  'outro',
] as const;

export interface Ticket {
  id: string;
  tripId: string;
  userId: string;
  type: TicketType;
  title: string;
  provider?: string;
  reference?: string;
  startDateTime?: ISODateTime;
  endDateTime?: ISODateTime;
  origin?: string;
  destination?: string;
  /**
   * A chave do objeto no Storage — a identidade durável do arquivo (§11).
   *
   * É o que fica gravado. `fileUrl` é derivado dele a cada leitura e não deve
   * voltar para o banco: era esse exato embaralhamento que fazia a foto de
   * perfil sumir na F5, quando uma URL assinada expirada era regravada por
   * cima do caminho.
   */
  filePath?: string;
  /**
   * Como abrir o arquivo **agora**. Derivado, nunca gravado.
   *
   * Aponta para a cópia local quando ela existe — e é isso que faz o documento
   * abrir em modo avião (D-04) — e para uma URL assinada de uma hora quando
   * não existe.
   */
  fileUrl?: string;
  mimeType?: string;
  notes?: string;
}

export type GoalType = 'economia' | 'destino' | 'preparacao' | 'frequencia';

export const GOAL_TYPES: readonly GoalType[] = [
  'economia',
  'destino',
  'preparacao',
  'frequencia',
] as const;

export type GoalStatus = 'active' | 'completed' | 'cancelled';

export interface Goal {
  id: string;
  userId: string;
  tripId?: string;
  type: GoalType;
  title: string;
  targetValue: number;
  currentValue: number;
  unit: string;
  status: GoalStatus;
  deadline?: ISODate;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export type CostLevel = 'economy' | 'moderate' | 'luxury';

/**
 * Rascunho ou publicado. Um único tipo para `Article` e `Offer` porque no banco
 * é literalmente o mesmo CHECK — se algum dia divergirem, que seja por decisão
 * e não por duas listas que ninguém percebeu terem se afastado.
 */
export type ContentStatus = 'draft' | 'published';

export interface Offer {
  id: string;
  destination: string;
  description: string;
  price?: number;
  /** Currency the `price` is expressed in — never the destination's currency. */
  priceCurrency?: CurrencyCode;
  discountType?: 'percentage' | 'fixed' | 'label';
  discountValue?: number | string;
  costLevel: CostLevel;
  imageUrl: string;
  weatherSummary?: string;
  bestTime?: string;
  thingsToDo: string[];
  /**
   * Vigência comercial. Fora dela a oferta não aparece para o viajante — a
   * regra é aplicada pela RLS (`0004`), não pela tela.
   */
  activeFrom?: ISODate;
  activeUntil?: ISODate;
  partnerUrl?: string;
  /** Decisão editorial: rascunho não chega ao viajante. */
  status: ContentStatus;
  /** Ordem na faixa da Home. Menor primeiro; empate resolvido pelo `id`. */
  sortOrder: number;
}

export interface Article {
  id: string;
  slug: string;
  title: string;
  category: string;
  imageUrl?: string;
  authorName: string;
  content: string;
  publishedAt: ISODateTime;
  estimatedReadMinutes: number;
  status: ContentStatus;
}

export interface ArticleLike {
  articleId: string;
  userId: string;
  createdAt: ISODateTime;
}

export type PlaceType = 'hotel' | 'restaurant' | 'attraction';

export interface Place {
  id: string;
  externalProviderId?: string;
  name: string;
  type: PlaceType;
  rating?: number;
  /** 1–4, comparable to the common $-$$$$ scale. */
  priceLevel?: number;
  averagePrice?: number;
  currency?: CurrencyCode;
  city: string;
  country: string;
  address?: string;
  phone?: string;
  openingHours?: string[];
  description?: string;
  latitude?: number;
  longitude?: number;
  imageUrl?: string;
  amenities?: string[];
  partnerUrl?: string;
}

export interface PlaceFavorite {
  placeId: string;
  userId: string;
  createdAt: ISODateTime;
}

export type AdvisorStatus = 'online' | 'offline' | 'busy';

export interface Advisor {
  id: string;
  name: string;
  specialty: string;
  avatarUrl?: string;
  rating?: number;
  /** Presença: pode atender agora? Muda várias vezes por dia. */
  status: AdvisorStatus;
  bio?: string;
  /**
   * Cadastro: faz parte do time? Independente de `status` — um especialista
   * `offline` continua no diretório; um inativo sai dele sem que as consultas
   * já registradas percam a referência.
   */
  active: boolean;
}

export type ConsultationStatus = 'requested' | 'scheduled' | 'cancelled' | 'completed';

export interface Consultation {
  id: string;
  userId: string;
  advisorId: string;
  /** Quando a pessoa gostaria de conversar, em palavras. Ver `ScheduleText`. */
  scheduledAt: ScheduleText;
  status: ConsultationStatus;
  notes?: string;
  /**
   * Quando o pedido foi feito. Este sim é ISO de verdade — a coluna é
   * `timestamptz`. É por ele que a lista se ordena, já que `scheduledAt` não
   * tem ordem nenhuma.
   */
  createdAt: ISODateTime;
}

export type ReservationStatus = 'requested' | 'confirmed' | 'cancelled';

/**
 * A reservation *request* (§54). Never rendered as "Reserva confirmada" unless
 * a provider actually confirmed it.
 */
export interface ReservationRequest {
  id: string;
  userId: string;
  tripId?: string;
  placeId: string;
  placeName: string;
  /** Data e horário desejados, em palavras. Ver `ScheduleText`. */
  requestedFor: ScheduleText;
  partySize: number;
  notes?: string;
  status: ReservationStatus;
  createdAt: ISODateTime;
}

export interface AIConversation {
  id: string;
  userId: string;
  tripId?: string;
  title?: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export type AIRole = 'user' | 'assistant' | 'system';

export interface AIMessage {
  id: string;
  conversationId: string;
  role: AIRole;
  content: string;
  createdAt: ISODateTime;
}

/** Travel insurance policy, surfaced by the SOS screen (§66). */
export interface InsurancePolicy {
  id: string;
  userId: string;
  tripId?: string;
  provider: string;
  policyNumber: string;
  emergencyPhone?: string;
  /**
   * A chave do objeto no Storage — a identidade durável do arquivo (§11).
   *
   * É o que fica gravado. `fileUrl` é derivado dele a cada leitura e não deve
   * voltar para o banco: era esse exato embaralhamento que fazia a foto de
   * perfil sumir na F5, quando uma URL assinada expirada era regravada por
   * cima do caminho.
   */
  filePath?: string;
  /**
   * Como abrir o arquivo **agora**. Derivado, nunca gravado.
   *
   * Aponta para a cópia local quando ela existe — e é isso que faz o documento
   * abrir em modo avião (D-04) — e para uma URL assinada de uma hora quando
   * não existe.
   */
  fileUrl?: string;
  validUntil?: ISODate;
}
