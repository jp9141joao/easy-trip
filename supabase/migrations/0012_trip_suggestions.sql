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
  -- Chave normalizada separada do texto exibido. O PostgREST só consegue
  -- receber `on_conflict` com nomes de colunas; um índice direto em
  -- `lower(title)` não é endereçável pela API de upsert.
  title_key   text generated always as (lower(title)) stored,
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

-- Sem duplicata dentro da mesma viagem. `title_key` preserva o título original
-- para exibição e permite que o PostgREST use
-- `on_conflict=trip_id,title_key`. Um índice de expressão em `lower(title)`
-- funcionaria em SQL direto, mas o upsert HTTP cairia no conflito da PK e
-- devolveria 23505 para títulos com diferença apenas de caixa.
create unique index if not exists trip_suggestions_unique_title
  on public.trip_suggestions (trip_id, title_key);

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
  before insert or update on public.trip_suggestions
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

-- A marca d'água não é editável diretamente pelo aplicativo. Revogar apenas
-- a coluna não anularia o UPDATE de tabela concedido pela 0005; por isso o
-- privilégio amplo é retirado e os campos legítimos da edição de viagem são
-- concedidos explicitamente. `service_role` conserva o privilégio de tabela.
revoke update on table public.trips from authenticated;
grant update (
  destination_city,
  destination_country,
  country_code,
  latitude,
  longitude,
  timezone,
  start_date,
  end_date,
  cover_image_url,
  budget_total,
  budget_currency,
  updated_at
) on table public.trips to authenticated;

-- ----------------------------------------------------------------------------
-- Reivindicação atômica da janela de geração
--
-- Ler a marca d'água e atualizá-la em duas chamadas deixa uma corrida: dois
-- aparelhos podem ler "livre" e ambos chamar o Gemini. Este UPDATE faz o
-- compare-and-set no banco antes do provedor. Sob concorrência, o PostgreSQL
-- reavalia o predicado depois do lock da linha; portanto só uma chamada muda
-- NULL/mais de 6h para `now()` e recebe `claimed = true`.
--
-- A reivindicação simples consome a janela mesmo se o provedor falhar. É uma
-- decisão de proteção de custo: não há complete/release que um cliente pudesse
-- usar para liberar a janela e repetir chamadas. A UI preserva sugestões já
-- persistidas e informa a falha sem apagar conteúdo.
-- ----------------------------------------------------------------------------
create or replace function public.claim_trip_suggestion_refresh(target_trip uuid)
returns table (claimed boolean, refreshed_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  instante timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Sessão obrigatória.' using errcode = '42501';
  end if;

  if not public.can_edit_trip(target_trip) then
    raise exception 'Sem permissão para atualizar sugestões desta viagem.' using errcode = '42501';
  end if;

  update public.trips t
     set suggestions_refreshed_at = now()
   where t.id = target_trip
     and (
       t.suggestions_refreshed_at is null
       or t.suggestions_refreshed_at <= now() - interval '6 hours'
     )
  returning t.suggestions_refreshed_at into instante;

  if found then
    return query select true, instante;
    return;
  end if;

  select t.suggestions_refreshed_at
    into instante
    from public.trips t
   where t.id = target_trip;

  return query select false, instante;
end;
$$;

comment on function public.claim_trip_suggestion_refresh(uuid) is
  'CAS de 6h antes da geração: owner/editor recebe claimed=true uma vez; não altera sugestões.';

revoke all on function public.claim_trip_suggestion_refresh(uuid) from public, anon;
grant execute on function public.claim_trip_suggestion_refresh(uuid) to authenticated, service_role;

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
