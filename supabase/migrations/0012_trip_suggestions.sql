-- =============================================================================
-- Easy Trip — Sugestões da viagem
--
-- Sugestão é da VIAGEM, não da pessoa (§48). Todos os membros veem a mesma
-- lista; quem pode editar a viagem pode gerar/atualizar e adicionar ao roteiro;
-- `viewer` só olha. Por isso a tabela não tem `visibility`: não existe sugestão
-- "somente para mim" — o que pode ser privado é o item de roteiro criado a
-- partir dela, e esse já tem a coluna (0009).
--
-- POR QUE ISTO É PERSISTIDO E NÃO CALCULADO NA HORA
--
-- Duas razões, e as duas são de honestidade:
--
--  1. Custo. Gerar com o Gemini a cada abertura da tela seria uma chamada por
--     abertura, por pessoa, para um conteúdo que não muda de um minuto para o
--     outro (§43).
--  2. Estabilidade. Sugestão que se reescreve sozinha a cada visita não é
--     sugestão, é ruído: a pessoa não consegue voltar naquele restaurante que
--     viu ontem.
--
-- `source` distingue o que veio do catálogo real de lugares do que a IA
-- escreveu. A tela mostra "✨ Sugestão da IA" no segundo caso, e é por este
-- campo que ela sabe — não por heurística de texto.
-- =============================================================================

create table if not exists public.trip_suggestions (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips (id) on delete cascade,
  title       text not null,
  category    text not null check (category in (
                'lugares', 'atracoes', 'gastronomia', 'noite', 'ar_livre', 'para_voce'
              )),
  description text not null,
  place_name  text,
  area        text,
  latitude    double precision,
  longitude   double precision,
  estimated_duration_minutes integer check (estimated_duration_minutes is null
                                            or estimated_duration_minutes between 15 and 1440),
  -- Por que esta sugestão, para esta viagem, para esta pessoa. É o que a torna
  -- uma sugestão e não uma lista genérica de pontos turísticos.
  reason      text,
  source      text not null check (source in ('catalog', 'ai')),
  -- Preenchido só quando `source = 'catalog'`: aponta para o lugar real de que
  -- a sugestão saiu, para a tela conseguir abrir a ficha dele.
  place_id    uuid references public.places (id) on delete set null,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- Uma sugestão da IA nunca traz preço, horário de funcionamento, avaliação
  -- ou disponibilidade (§41): o modelo não tem como saber, e escrever isso
  -- seria inventar. O CHECK impede que uma versão futura do prompt volte a
  -- introduzir esses campos por aqui — não há coluna para eles.
  constraint trip_suggestions_coords_pair check ((latitude is null) = (longitude is null)),
  constraint trip_suggestions_catalog_link check (source = 'catalog' or place_id is null)
);

comment on table public.trip_suggestions is
  'Sugestões de uma viagem. Compartilhadas com todos os membros; sem visibilidade por item.';
comment on column public.trip_suggestions.source is
  'catalog: veio de public.places. ai: escrita pelo modelo — a tela rotula como "Sugestão da IA".';

create index if not exists trip_suggestions_trip_idx
  on public.trip_suggestions (trip_id, category, created_at desc);

-- Sem duplicata dentro da mesma viagem. `lower(...)` porque "Museu do Louvre" e
-- "museu do louvre" são a mesma sugestão, e um refresh que devolvesse as duas
-- encheria a tela de repetição.
create unique index if not exists trip_suggestions_unique_title
  on public.trip_suggestions (trip_id, lower(title));

alter table public.trip_suggestions enable row level security;

drop policy if exists trip_suggestions_select on public.trip_suggestions;
create policy trip_suggestions_select on public.trip_suggestions
  for select using (public.is_trip_member(trip_id));

drop policy if exists trip_suggestions_write on public.trip_suggestions;
create policy trip_suggestions_write on public.trip_suggestions
  for all
  using (public.can_edit_trip(trip_id))
  with check (public.can_edit_trip(trip_id));

drop trigger if exists trip_suggestions_touch_updated_at on public.trip_suggestions;
create trigger trip_suggestions_touch_updated_at
  before update on public.trip_suggestions
  for each row execute function public.touch_updated_at();

drop trigger if exists set_created_by on public.trip_suggestions;
create trigger set_created_by
  before insert on public.trip_suggestions
  for each row execute function public.set_created_by();

-- ----------------------------------------------------------------------------
-- Marca d'água do último refresh
--
-- Guardada na viagem, e não em cada sugestão, porque a pergunta que a tela faz
-- é "quando esta viagem foi atualizada pela última vez?" — e a resposta precisa
-- existir mesmo quando a geração não produziu nenhuma linha nova.
--
-- É também o que limita o botão "Atualizar sugestões" (§43): o cliente não
-- precisa ser confiável, porque a Edge Function relê esta coluna antes de
-- gastar uma chamada do Gemini.
-- ----------------------------------------------------------------------------
alter table public.trips
  add column if not exists suggestions_refreshed_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'trip_suggestions'
  ) then
    alter publication supabase_realtime add table public.trip_suggestions;
  end if;
exception
  when undefined_object then
    raise notice 'Publicação supabase_realtime ausente; Realtime não configurado.';
end;
$$;
