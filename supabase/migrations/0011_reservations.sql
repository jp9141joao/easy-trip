-- =============================================================================
-- Easy Trip — Reservas (antigos "Tickets")
--
-- POR QUE A TABELA CONTINUA SE CHAMANDO `tickets`
--
-- "Tickets" vira "Reservas" na interface inteira. No banco, a tabela fica onde
-- está. Renomeá-la não acrescentaria nada que o usuário perceba e custaria uma
-- migration destrutiva sobre dados que já estão em produção: caminhos de
-- Storage referenciados por linha, policies, o `trip_id` de que a 0008 depende.
-- O nome da tabela não é o nome do produto — e esta é exatamente a situação em
-- que confundir os dois se paga em risco.
--
-- O que muda de verdade é a forma do registro. `tickets` guardava um documento
-- com título e anexo; `Reserva` guarda uma reserva de verdade, com tipo, código
-- localizador, horários e os campos específicos de cada modalidade.
--
-- POR QUE `details jsonb` E NÃO TRINTA COLUNAS
--
-- Voo tem número de voo, terminal, assento e bagagem. Hospedagem tem quarto e
-- telefone. Carro tem locadora e dois locais. Ingresso tem quantidade. Como
-- colunas, seriam ~25 campos anuláveis, dos quais cada linha usaria cinco — e
-- a tabela deixaria de dizer qualquer coisa sobre o que é obrigatório.
--
-- O que é comum a todas as modalidades continua em coluna (tipo, título,
-- fornecedor, localizador, início, fim, origem, destino, endereço, situação,
-- anexo): é por esses campos que a lista ordena, filtra e agrupa, e é neles que
-- o lembrete se ancora. O que é específico vai para `details`, validado por um
-- schema Zod por tipo em `src/domain/reservations.ts`. O banco garante forma;
-- o domínio garante conteúdo.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Colunas novas
-- ----------------------------------------------------------------------------
alter table public.tickets
  add column if not exists details     jsonb not null default '{}'::jsonb,
  add column if not exists status      text  not null default 'confirmed',
  add column if not exists address     text,
  add column if not exists updated_at  timestamptz not null default now(),
  -- O valor original de `type`, preservado antes da normalização da seção 2.
  -- Existe para que a tradução seja auditável e reversível: sem ele, uma
  -- reserva que era `transporte` e virou `other` perderia a informação de que
  -- um dia foi transporte, e nenhuma consulta traria isso de volta.
  add column if not exists legacy_type text;

alter table public.tickets drop constraint if exists tickets_status_check;
alter table public.tickets add constraint tickets_status_check
  check (status in ('confirmed', 'pending', 'cancelled'));

-- ----------------------------------------------------------------------------
-- 2. Normalização de `type`
--
-- O vocabulário antigo era misto (português, e do ponto de vista de "documento
-- guardado"): voo, hospedagem, atracao, transporte, outro. O novo é o das
-- modalidades de reserva que a tela agora oferece.
--
--   voo         → flight
--   hospedagem  → hotel
--   atracao     → park_ticket
--   transporte  → other       ← a única tradução com perda
--   outro       → other
--
-- `transporte` não tem para onde ir: podia ser trem, ônibus ou carro alugado, e
-- o registro não diz qual. Inventar `train` faria a tela mentir sobre o que a
-- pessoa guardou. `other` mantém o registro inteiro — título, fornecedor,
-- horários, anexo —, muda só o ícone e a categoria em que ele aparece, e
-- `legacy_type` guarda de onde veio.
-- ----------------------------------------------------------------------------
update public.tickets set legacy_type = type where legacy_type is null;

alter table public.tickets drop constraint if exists tickets_type_check;

update public.tickets set type = case type
    when 'voo'        then 'flight'
    when 'hospedagem' then 'hotel'
    when 'atracao'    then 'park_ticket'
    when 'transporte' then 'other'
    when 'outro'      then 'other'
    else type
  end
 where type in ('voo', 'hospedagem', 'atracao', 'transporte', 'outro');

alter table public.tickets add constraint tickets_type_check
  check (type in ('flight', 'hotel', 'car', 'park_ticket', 'train', 'bus', 'other'));

-- `reference` já existia e sempre significou "código da reserva". Continua
-- sendo ele — uma coluna `confirmation_code` nova deixaria dois lugares para o
-- mesmo dado e a certeza de que metade das telas leria o errado.
comment on column public.tickets.reference is
  'Código localizador/confirmação da reserva. É o `confirmationCode` do domínio.';
comment on column public.tickets.details is
  'Campos específicos da modalidade, validados por schema Zod em src/domain/reservations.ts.';
comment on table public.tickets is
  'Reservas de viagem. O nome da tabela é histórico; o produto chama isto de "Reservas".';

create index if not exists tickets_trip_type_idx on public.tickets (trip_id, type, start_date_time);

-- ----------------------------------------------------------------------------
-- 3. `updated_at` de verdade
--
-- A concorrência desta fase é last-write-wins (§53), e last-write-wins sem
-- `updated_at` confiável é só "a última que chegou" sem ninguém conseguir dizer
-- qual foi. O trigger tira isso do cliente: o instante é o do banco.
-- ----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tickets_touch_updated_at on public.tickets;
create trigger tickets_touch_updated_at
  before update on public.tickets
  for each row execute function public.touch_updated_at();

-- As mesmas duas colunas nos itens de roteiro, pelo mesmo motivo: dois editores
-- podem mexer no mesmo item, e a tela precisa poder dizer "atualizado agora".
alter table public.itinerary_items
  add column if not exists updated_at timestamptz not null default now(),
  -- §17: localização do item. `place_name`, `latitude` e `longitude` já existiam
  -- desde a 0001 — só faltava o endereço legível e a origem da coordenada.
  add column if not exists address text,
  -- De onde veio a coordenada: catálogo de lugares, geocodificação, escolha no
  -- mapa, ou uma sugestão. Sem isso não há como saber se `latitude` é confiável
  -- o bastante para desenhar uma rota.
  add column if not exists place_source text;

alter table public.itinerary_items drop constraint if exists itinerary_place_source_check;
alter table public.itinerary_items add constraint itinerary_place_source_check
  check (place_source is null or place_source in ('catalog', 'geocoding', 'manual', 'suggestion'));

-- Coordenada é par ou não é nada. Meia coordenada entraria no cálculo de rota
-- como se fosse (0, lng) — o Golfo da Guiné, a 6.000 km de Paris.
alter table public.itinerary_items drop constraint if exists itinerary_coords_pair;
alter table public.itinerary_items add constraint itinerary_coords_pair
  check ((latitude is null) = (longitude is null));

drop trigger if exists itinerary_touch_updated_at on public.itinerary_items;
create trigger itinerary_touch_updated_at
  before update on public.itinerary_items
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 4. Limpeza de lembretes órfãos
--
-- Apagar a reserva apaga os lembretes que apontavam para ela — de todos os
-- membros, não só de quem apagou. Sem isto, a Central mostraria "Check-in
-- amanhã" de um hotel que não está mais na viagem.
-- ----------------------------------------------------------------------------
create or replace function public.purge_entity_reminders()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.reminders
   where entity_id = old.id
     and entity_type = case tg_table_name
                         when 'tickets' then 'reservation'
                         else 'itinerary_item'
                       end;
  return old;
end;
$$;

drop trigger if exists tickets_purge_reminders on public.tickets;
create trigger tickets_purge_reminders
  after delete on public.tickets
  for each row execute function public.purge_entity_reminders();

drop trigger if exists itinerary_purge_reminders on public.itinerary_items;
create trigger itinerary_purge_reminders
  after delete on public.itinerary_items
  for each row execute function public.purge_entity_reminders();

-- ----------------------------------------------------------------------------
-- 5. Conferência
-- ----------------------------------------------------------------------------
do $$
declare
  invalidas integer;
begin
  select count(*) into invalidas
    from public.tickets
   where type not in ('flight', 'hotel', 'car', 'park_ticket', 'train', 'bus', 'other');
  if invalidas > 0 then
    raise exception 'Normalização de tipo incompleta: % reserva(s).', invalidas;
  end if;

  select count(*) into invalidas
    from public.itinerary_items
   where (latitude is null) <> (longitude is null);
  if invalidas > 0 then
    raise exception 'Itens de roteiro com meia coordenada: %.', invalidas;
  end if;
end;
$$;
