-- =============================================================================
-- Easy Trip 2.0 — Row Level Security (§93, §104)
--
-- Authorisation is enforced here, from the JWT identity (`auth.uid()`), never
-- from a `user_id` the client sends. That is why shipping the anon key in the
-- bundle is safe (§17): without a valid session it grants nothing.
--
-- Trip-scoped tables authorise through their parent trip, so a record can only
-- be reached by the owner of the trip it belongs to.
-- =============================================================================

alter table public.profiles            enable row level security;
alter table public.trips               enable row level security;
alter table public.itinerary_items     enable row level security;
alter table public.checklist_items     enable row level security;
alter table public.expenses            enable row level security;
alter table public.tickets             enable row level security;
alter table public.journal_entries     enable row level security;
alter table public.journal_media       enable row level security;
alter table public.goals               enable row level security;
alter table public.article_likes       enable row level security;
alter table public.place_favorites     enable row level security;
alter table public.consultations       enable row level security;
alter table public.reservation_requests enable row level security;
alter table public.ai_conversations    enable row level security;
alter table public.ai_messages         enable row level security;
alter table public.insurance_policies  enable row level security;

-- Editorial content is world-readable but never client-writable.
alter table public.offers   enable row level security;
alter table public.articles enable row level security;
alter table public.places   enable row level security;
alter table public.advisors enable row level security;

-- ----------------------------------------------------------------------------
-- Helper: does the current user own this trip?
-- ----------------------------------------------------------------------------
create or replace function public.owns_trip(target_trip uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.trips t
    where t.id = target_trip and t.user_id = auth.uid()
  );
$$;

-- ----------------------------------------------------------------------------
-- Profiles
-- ----------------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (user_id = auth.uid());

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert with check (user_id = auth.uid());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles
  for delete using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- Trips
-- ----------------------------------------------------------------------------
drop policy if exists trips_select on public.trips;
create policy trips_select on public.trips
  for select using (user_id = auth.uid());

drop policy if exists trips_insert on public.trips;
create policy trips_insert on public.trips
  for insert with check (user_id = auth.uid());

drop policy if exists trips_update on public.trips;
create policy trips_update on public.trips
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists trips_delete on public.trips;
create policy trips_delete on public.trips
  for delete using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- Trip-scoped tables: authorised through the parent trip
-- ----------------------------------------------------------------------------
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'itinerary_items', 'checklist_items', 'expenses', 'tickets', 'journal_entries'
  ]
  loop
    execute format('drop policy if exists %I_all on public.%I', table_name, table_name);
    execute format(
      'create policy %I_all on public.%I for all
         using (public.owns_trip(trip_id))
         with check (public.owns_trip(trip_id))',
      table_name, table_name
    );
  end loop;
end;
$$;

-- Journal media hangs off a journal entry, which hangs off a trip.
drop policy if exists journal_media_all on public.journal_media;
create policy journal_media_all on public.journal_media
  for all
  using (
    exists (
      select 1 from public.journal_entries e
      where e.id = journal_entry_id and public.owns_trip(e.trip_id)
    )
  )
  with check (
    exists (
      select 1 from public.journal_entries e
      where e.id = journal_entry_id and public.owns_trip(e.trip_id)
    )
  );

-- ----------------------------------------------------------------------------
-- User-owned tables
-- ----------------------------------------------------------------------------
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'goals', 'article_likes', 'place_favorites', 'consultations',
    'reservation_requests', 'ai_conversations', 'insurance_policies'
  ]
  loop
    execute format('drop policy if exists %I_all on public.%I', table_name, table_name);
    execute format(
      'create policy %I_all on public.%I for all
         using (user_id = auth.uid())
         with check (user_id = auth.uid())',
      table_name, table_name
    );
  end loop;
end;
$$;

-- AI messages are reached through their conversation.
drop policy if exists ai_messages_all on public.ai_messages;
create policy ai_messages_all on public.ai_messages
  for all
  using (
    exists (
      select 1 from public.ai_conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.ai_conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- Editorial content: read-only for authenticated users
-- ----------------------------------------------------------------------------
do $$
declare
  table_name text;
begin
  foreach table_name in array array['offers', 'articles', 'places', 'advisors']
  loop
    execute format('drop policy if exists %I_read on public.%I', table_name, table_name);
    execute format(
      'create policy %I_read on public.%I for select to authenticated using (true)',
      table_name, table_name
    );
  end loop;
end;
$$;

-- =============================================================================
-- Storage: private buckets only. The client never gets a public URL — it
-- receives a short-lived signed URL generated at read time.
-- =============================================================================
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false),
       ('journal', 'journal', false),
       ('avatars', 'avatars', false)
on conflict (id) do nothing;

-- Objects are namespaced by user id: `<uid>/<trip>/<file>`. The policy checks
-- that the first path segment is the caller's own id.
do $$
declare
  bucket text;
begin
  foreach bucket in array array['attachments', 'journal', 'avatars']
  loop
    execute format('drop policy if exists %I_owner on storage.objects', bucket);
    execute format(
      'create policy %I_owner on storage.objects for all to authenticated
         using (bucket_id = %L and (storage.foldername(name))[1] = auth.uid()::text)
         with check (bucket_id = %L and (storage.foldername(name))[1] = auth.uid()::text)',
      bucket, bucket, bucket
    );
  end loop;
end;
$$;
