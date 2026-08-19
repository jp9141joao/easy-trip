-- =============================================================================
-- Easy Trip 2.0 — schema (§13, §14, §15)
--
-- Design rules encoded here:
--   * Derived values (status, daysLeft, totalSpent, remainingBudget) are NOT
--     columns. They are computed in the app from the stored records (§96), so
--     they can never drift out of sync.
--   * Every operational record carries `trip_id` and cascades with its trip,
--     which is what makes the Paris/Kyoto mix-up structurally impossible (§12).
--   * Attachments store a storage PATH, never a public URL — the client gets a
--     short-lived signed URL at read time (§93).
-- =============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- Profile
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  name             text not null,
  phone            text,
  avatar_path      text,
  home_city        text,
  home_country     text,
  home_timezone    text,
  travel_style     text,
  default_currency text not null default 'BRL',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Trip — the single source of truth for a journey
-- ----------------------------------------------------------------------------
create table if not exists public.trips (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users (id) on delete cascade,
  destination_city     text not null,
  destination_country  text not null,
  country_code         char(2) not null,
  latitude             double precision,
  longitude            double precision,
  timezone             text not null,
  start_date           date not null,
  end_date             date not null,
  cover_image_url      text,
  budget_total         numeric(12, 2) not null default 0 check (budget_total >= 0),
  budget_currency      text not null default 'BRL',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint trips_date_order check (end_date >= start_date)
);
create index if not exists trips_user_idx on public.trips (user_id, start_date desc);

-- ----------------------------------------------------------------------------
-- Itinerary
-- ----------------------------------------------------------------------------
create table if not exists public.itinerary_items (
  id                    uuid primary key default gen_random_uuid(),
  trip_id               uuid not null references public.trips (id) on delete cascade,
  date                  date not null,
  start_time            time,
  end_time              time,
  type                  text not null check (type in ('voo','hospedagem','refeicao','atracao','transporte','atividade','outro')),
  title                 text not null,
  description           text,
  place_name            text,
  latitude              double precision,
  longitude             double precision,
  reservation_reference text,
  completed             boolean not null default false,
  sort_order            integer not null default 0,
  created_at            timestamptz not null default now()
);
create index if not exists itinerary_trip_idx on public.itinerary_items (trip_id, date, start_time, sort_order);

-- ----------------------------------------------------------------------------
-- Checklist
-- ----------------------------------------------------------------------------
create table if not exists public.checklist_items (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references public.trips (id) on delete cascade,
  label      text not null,
  category   text not null check (category in ('documentos','saude','mala','reservas','financeiro','outros')),
  completed  boolean not null default false,
  priority   text check (priority in ('low','medium','high')),
  due_date   date,
  created_at timestamptz not null default now()
);
create index if not exists checklist_trip_idx on public.checklist_items (trip_id);

-- ----------------------------------------------------------------------------
-- Expenses — the exchange rate used is stored with the row (§41)
-- ----------------------------------------------------------------------------
create table if not exists public.expenses (
  id                        uuid primary key default gen_random_uuid(),
  trip_id                   uuid not null references public.trips (id) on delete cascade,
  user_id                   uuid not null references auth.users (id) on delete cascade,
  category                  text not null check (category in ('hospedagem','alimentacao','transporte','lazer','compras','outros')),
  amount                    numeric(12, 2) not null check (amount > 0),
  currency                  text not null,
  amount_in_budget_currency numeric(12, 2),
  exchange_rate             numeric(18, 8),
  exchange_rate_timestamp   timestamptz,
  transaction_date          date not null,
  description               text not null,
  created_at                timestamptz not null default now()
);
create index if not exists expenses_trip_idx on public.expenses (trip_id, transaction_date desc);

-- ----------------------------------------------------------------------------
-- Tickets / documents
-- ----------------------------------------------------------------------------
create table if not exists public.tickets (
  id              uuid primary key default gen_random_uuid(),
  trip_id         uuid not null references public.trips (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  type            text not null check (type in ('voo','hospedagem','atracao','transporte','outro')),
  title           text not null,
  provider        text,
  reference       text,
  start_date_time timestamptz,
  end_date_time   timestamptz,
  origin          text,
  destination     text,
  file_path       text,   -- storage path, resolved to a signed URL on read
  mime_type       text,
  notes           text,
  created_at      timestamptz not null default now()
);
create index if not exists tickets_trip_idx on public.tickets (trip_id);

-- ----------------------------------------------------------------------------
-- Journal
-- ----------------------------------------------------------------------------
create table if not exists public.journal_entries (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references public.trips (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  entry_date date not null,
  content    text not null,
  latitude   double precision,
  longitude  double precision,
  place_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists journal_trip_idx on public.journal_entries (trip_id, entry_date desc);

create table if not exists public.journal_media (
  id               uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null references public.journal_entries (id) on delete cascade,
  file_path        text not null,
  mime_type        text not null,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now()
);
create index if not exists journal_media_entry_idx on public.journal_media (journal_entry_id, sort_order);

-- ----------------------------------------------------------------------------
-- Goals
-- ----------------------------------------------------------------------------
create table if not exists public.goals (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  trip_id       uuid references public.trips (id) on delete set null,
  type          text not null check (type in ('economia','destino','preparacao','frequencia')),
  title         text not null,
  target_value  numeric(12, 2) not null check (target_value > 0),
  current_value numeric(12, 2) not null default 0 check (current_value >= 0),
  unit          text not null default 'R$',
  status        text not null default 'active' check (status in ('active','completed','cancelled')),
  deadline      date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists goals_user_idx on public.goals (user_id);

-- ----------------------------------------------------------------------------
-- Editorial content (publicly readable, written by the team)
-- ----------------------------------------------------------------------------
create table if not exists public.offers (
  id              uuid primary key default gen_random_uuid(),
  destination     text not null,
  description     text not null,
  price           numeric(12, 2),
  price_currency  text,
  discount_type   text check (discount_type in ('percentage','fixed','label')),
  discount_value  text,
  cost_level      text not null check (cost_level in ('economy','moderate','luxury')),
  image_url       text not null,
  weather_summary text,
  best_time       text,
  things_to_do    text[] not null default '{}',
  active_from     date,
  active_until    date,
  partner_url     text
);

create table if not exists public.articles (
  id                     uuid primary key default gen_random_uuid(),
  slug                   text not null unique,
  title                  text not null,
  category               text not null,
  image_url              text,
  author_name            text not null,
  content                text not null,
  published_at           timestamptz not null default now(),
  estimated_read_minutes integer not null default 5,
  status                 text not null default 'published' check (status in ('draft','published'))
);

create table if not exists public.article_likes (
  article_id uuid not null references public.articles (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, article_id)   -- UNIQUE(articleId, userId) per §13
);

create table if not exists public.places (
  id                   uuid primary key default gen_random_uuid(),
  external_provider_id text,
  name                 text not null,
  type                 text not null check (type in ('hotel','restaurant','attraction')),
  rating               numeric(2, 1),
  price_level          integer check (price_level between 1 and 4),
  average_price        numeric(12, 2),
  currency             text,
  city                 text not null,
  country              text not null,
  address              text,
  phone                text,
  opening_hours        text[],
  description          text,
  latitude             double precision,
  longitude            double precision,
  image_url            text,
  amenities            text[],
  partner_url          text
);
create index if not exists places_city_idx on public.places (city, type);

create table if not exists public.place_favorites (
  place_id   uuid not null references public.places (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, place_id)
);

create table if not exists public.advisors (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  specialty  text not null,
  avatar_url text,
  rating     numeric(2, 1),
  status     text not null default 'offline' check (status in ('online','offline','busy')),
  bio        text
);

-- ----------------------------------------------------------------------------
-- Requests — always start as `requested`, never as confirmed (§46, §54)
-- ----------------------------------------------------------------------------
create table if not exists public.consultations (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  advisor_id   uuid not null references public.advisors (id) on delete cascade,
  scheduled_at text not null,
  status       text not null default 'requested' check (status in ('requested','scheduled','cancelled','completed')),
  notes        text,
  created_at   timestamptz not null default now()
);

create table if not exists public.reservation_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  trip_id       uuid references public.trips (id) on delete set null,
  place_id      uuid not null references public.places (id) on delete cascade,
  place_name    text not null,
  requested_for text not null,
  party_size    integer not null check (party_size between 1 and 50),
  notes         text,
  status        text not null default 'requested' check (status in ('requested','confirmed','cancelled')),
  created_at    timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- AI conversations
-- ----------------------------------------------------------------------------
create table if not exists public.ai_conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  trip_id    uuid references public.trips (id) on delete cascade,
  title      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations (id) on delete cascade,
  role            text not null check (role in ('user','assistant','system')),
  content         text not null,
  created_at      timestamptz not null default now()
);
create index if not exists ai_messages_conversation_idx on public.ai_messages (conversation_id, created_at);

-- ----------------------------------------------------------------------------
-- Insurance policies
-- ----------------------------------------------------------------------------
create table if not exists public.insurance_policies (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  trip_id         uuid references public.trips (id) on delete set null,
  provider        text not null,
  policy_number   text not null,
  emergency_phone text,
  file_path       text,
  valid_until     date,
  created_at      timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Auto-create a profile whenever a user signs up, so the app never has to deal
-- with a half-created account.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, name, default_currency)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    'BRL'
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
