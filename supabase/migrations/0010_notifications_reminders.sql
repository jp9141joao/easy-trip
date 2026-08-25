-- =============================================================================
-- Easy Trip — Central de notificações e lembretes
--
-- O SINO ERA DERIVADO; AGORA HÁ DUAS COISAS DIFERENTES
--
-- `useAlerts` calcula avisos a partir do estado da viagem: orçamento estourado,
-- checklist pendente, próxima atividade. Isso continua existindo e continua
-- certo — é um *resumo do agora*, sempre atual porque é recalculado.
--
-- O que não cabe ali é o que **aconteceu**: um convite recebido, uma permissão
-- alterada, um lembrete que venceu, o briefing de hoje. Esses são eventos: têm
-- um instante, precisam de estado de lido, e não podem ser recalculados a
-- partir do banco porque a informação que os originou pode nem existir mais.
--
-- Daí `notifications`. As duas fontes convivem no sino: derivadas em cima,
-- persistidas embaixo, e o badge soma as não lidas das persistidas.
--
-- QUEM ESCREVE
--
-- Nunca o cliente. `notifications` não tem policy de INSERT para
-- `authenticated` — de propósito (§64). Se tivesse, qualquer conta poderia
-- inserir uma linha com `user_id` de outra pessoa e escrever no sino alheio,
-- ou forjar um "convite aceito" que nunca houve. Quem escreve são as funções
-- `security definer` deste arquivo e o `service_role` das Edge Functions.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Notificações
-- ----------------------------------------------------------------------------
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  type       text not null check (type in (
               'trip_invite',
               'trip_invite_accepted',
               'trip_member_removed',
               'trip_role_changed',
               'trip_daily_briefing',
               'reservation_reminder',
               'trip_reminder'
             )),
  title      text not null,
  body       text,
  -- Identificadores para a notificação saber para onde levar e o que oferecer
  -- (aceitar/recusar um convite, abrir uma reserva). Nunca texto de exibição:
  -- o que aparece na tela está em `title`/`body`, congelado no instante do
  -- evento, para a notificação continuar legível depois que a viagem mudar.
  data       jsonb not null default '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx
  on public.notifications (user_id, created_at desc);
-- O badge é `count(*) where read_at is null`. Índice parcial porque a consulta
-- do badge roda a cada abertura e só enxerga as não lidas.
create index if not exists notifications_unread_idx
  on public.notifications (user_id) where read_at is null;

-- Uma por usuário/viagem/dia para o briefing (§35). A unicidade mora no banco
-- e não na função que gera: assim duas execuções simultâneas do cron não
-- produzem dois briefings — a segunda esbarra no índice.
create unique index if not exists notifications_daily_briefing_once
  on public.notifications (user_id, (data ->> 'tripId'), (data ->> 'date'))
  where type = 'trip_daily_briefing';

alter table public.notifications enable row level security;

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select using (user_id = auth.uid());

-- Marcar como lida é a única escrita do cliente. `with check` repete o dono
-- para que um UPDATE não consiga mover a linha para o sino de outra pessoa.
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- RLS decide *qual linha* a pessoa pode tocar; privilégio por coluna decide
-- *o que* ela pode alterar. Sem este recorte, a policy acima deixaria o dono
-- reescrever `title`, `type`, `data` e `created_at` da própria notificação.
-- O cliente só marca como lida. `service_role` conserva o UPDATE de tabela
-- recebido pelos default privileges da 0005 para as rotinas server-side.
revoke update on table public.notifications from authenticated;
grant update (read_at) on table public.notifications to authenticated;

drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications
  for delete using (user_id = auth.uid());

-- Sem policy de INSERT. Ver o cabeçalho.

-- ----------------------------------------------------------------------------
-- 2. Lembretes
--
-- Lembrete é POR PESSOA, e é isso que decide o modelo (§31). Maria ativar
-- "me lembrar" no check-in do hotel não faz João receber nada. Se o lembrete
-- morasse na reserva, seria um campo da viagem e valeria para todo mundo.
--
-- `entity_type`/`entity_id` apontam para o que originou o lembrete sem chave
-- estrangeira polimórfica: a limpeza acontece no trigger de exclusão da
-- entidade, e um lembrete órfão não quebra nada — ele simplesmente não abre
-- nada quando tocado.
-- ----------------------------------------------------------------------------
create table if not exists public.reminders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  trip_id     uuid not null references public.trips (id) on delete cascade,
  entity_type text not null check (entity_type in ('reservation', 'itinerary_item', 'trip')),
  entity_id   uuid not null,
  -- Qual campo da entidade originou este lembrete ('start_at', 'end_at', …).
  -- Sem ele, ativar lembrete no check-in e no check-out do mesmo hotel
  -- produziria dois registros indistinguíveis.
  anchor      text not null default 'start',
  remind_at   timestamptz not null,
  title       text not null,
  body        text,
  sent_at     timestamptz,
  created_at  timestamptz not null default now(),
  constraint reminders_unique unique (user_id, entity_type, entity_id, anchor)
);

create index if not exists reminders_due_idx
  on public.reminders (remind_at) where sent_at is null;
create index if not exists reminders_user_idx on public.reminders (user_id, trip_id);

alter table public.reminders enable row level security;

-- O lembrete é do usuário, mas só faz sentido dentro de uma viagem de que ele
-- participa: as duas condições juntas. Só `user_id = auth.uid()` deixaria
-- alguém criar lembretes apontando para viagens alheias e usar a tabela como
-- canal de escrita não autorizado.
drop policy if exists reminders_all on public.reminders;
create policy reminders_all on public.reminders
  for all
  using (user_id = auth.uid() and public.is_trip_member(trip_id))
  with check (user_id = auth.uid() and public.is_trip_member(trip_id));

-- ----------------------------------------------------------------------------
-- 3. Entrega de lembrete vencido
--
-- Sem push do sistema operacional (ver §33 do plano e o relatório), o lembrete
-- vira notificação na Central quando o aplicativo abre. É honesto: a Central
-- mostra "Check-in amanhã" no primeiro momento em que o aplicativo é aberto
-- depois do horário, e nunca antes.
--
-- A função é `security definer` porque `notifications` não aceita INSERT do
-- cliente — e opera exclusivamente sobre os lembretes de quem chamou. O
-- `sent_at` é o que impede a mesma entrega de acontecer duas vezes.
--
-- O mesmo corpo serve ao cron/Edge Function, que roda por `service_role` e
-- passa o `user_id` explicitamente.
-- ----------------------------------------------------------------------------
create or replace function public.deliver_due_reminders(target_user uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  dono uuid := coalesce(target_user, auth.uid());
  entregues integer := 0;
begin
  if dono is null then
    raise exception 'Sessão obrigatória.' using errcode = '42501';
  end if;

  -- Um usuário só entrega os próprios lembretes. `service_role` roda sem
  -- `auth.uid()`, e é o único caminho pelo qual `target_user` pode divergir
  -- de quem chamou.
  if auth.uid() is not null and dono <> auth.uid() then
    raise exception 'Não é possível entregar lembretes de outra conta.' using errcode = '42501';
  end if;

  with vencidos as (
    update public.reminders r
       set sent_at = now()
     where r.user_id = dono
       and r.sent_at is null
       and r.remind_at <= now()
    returning r.*
  )
  insert into public.notifications (user_id, type, title, body, data)
  select v.user_id,
         case when v.entity_type = 'reservation' then 'reservation_reminder' else 'trip_reminder' end,
         v.title,
         v.body,
         jsonb_build_object(
           'tripId', v.trip_id,
           'entityType', v.entity_type,
           'entityId', v.entity_id,
           'reminderId', v.id
         )
    from vencidos v;

  get diagnostics entregues = row_count;
  return entregues;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Notificações de colaboração
--
-- As funções da 0008 são redefinidas aqui, e não lá, porque `notifications` só
-- existe a partir desta migration. O corpo é o mesmo mais a linha do sino —
-- e continua sendo um `create or replace`, então não há duas versões vivas.
--
-- Só o que muda a relação da pessoa com a viagem gera notificação: convite,
-- resposta ao convite, papel alterado, remoção. Item de checklist marcado não
-- gera nada (§54) — seria ruído a ponto de fazer o sino ser ignorado.
-- ----------------------------------------------------------------------------
create or replace function public.notify(
  target_user uuid,
  notification_type text,
  notification_title text,
  notification_body text default null,
  payload jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notifications (user_id, type, title, body, data)
  values (target_user, notification_type, notification_title, notification_body, payload);
$$;

comment on function public.notify(uuid, text, text, text, jsonb) is
  'Uso interno das funções de colaboração e das Edge Functions. Não é exposta ao papel authenticated.';

create or replace function public.create_trip_invite(
  target_trip uuid,
  target_email text,
  target_role text
)
returns public.trip_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  convidado uuid;
  criado    public.trip_invites;
  viagem    public.trips;
  quem      text;
  email_normalizado text := lower(trim(target_email));
begin
  if auth.uid() is null then
    raise exception 'Sessão obrigatória.' using errcode = '42501';
  end if;
  if not public.is_trip_owner(target_trip) then
    raise exception 'Apenas o proprietário da viagem pode convidar.' using errcode = '42501';
  end if;
  if target_role not in ('editor', 'viewer') then
    raise exception 'Permissão inválida.' using errcode = '22023';
  end if;

  select u.id into convidado
    from auth.users u
   where lower(u.email) = email_normalizado
   limit 1;

  if convidado is null then
    raise exception 'Nenhuma conta Easy Trip com este e-mail.' using errcode = 'P0002';
  end if;
  if convidado = auth.uid() then
    raise exception 'Você já participa desta viagem.' using errcode = '22023';
  end if;
  if exists (select 1 from public.trip_members m
              where m.trip_id = target_trip and m.user_id = convidado) then
    raise exception 'Esta pessoa já é membro da viagem.' using errcode = '23505';
  end if;
  if exists (select 1 from public.trip_invites i
              where i.trip_id = target_trip and i.invited_user_id = convidado and i.status = 'pending') then
    raise exception 'Já existe um convite pendente para esta pessoa.' using errcode = '23505';
  end if;

  insert into public.trip_invites (trip_id, invited_user_id, invited_by, role)
  values (target_trip, convidado, auth.uid(), target_role)
  returning * into criado;

  select * into viagem from public.trips where id = target_trip;
  select coalesce(p.name, 'Alguém') into quem from public.profiles p where p.user_id = auth.uid();

  perform public.notify(
    convidado,
    'trip_invite',
    format('%s convidou você para %s', quem, viagem.destination_city),
    format('%s · %s a %s',
           case when target_role = 'editor' then 'Pode editar' else 'Somente visualizar' end,
           to_char(viagem.start_date, 'DD/MM'),
           to_char(viagem.end_date, 'DD/MM/YYYY')),
    jsonb_build_object(
      'inviteId', criado.id,
      'tripId', target_trip,
      'role', target_role,
      'destination', viagem.destination_city,
      'startDate', viagem.start_date,
      'endDate', viagem.end_date
    )
  );

  return criado;
end;
$$;

create or replace function public.accept_trip_invite(invite uuid)
returns public.trip_members
language plpgsql
security definer
set search_path = public
as $$
declare
  registro public.trip_invites;
  membro   public.trip_members;
  viagem   public.trips;
  quem     text;
begin
  if auth.uid() is null then
    raise exception 'Sessão obrigatória.' using errcode = '42501';
  end if;

  select * into registro from public.trip_invites where id = invite for update;

  if registro.id is null or registro.invited_user_id <> auth.uid() then
    raise exception 'Convite não encontrado.' using errcode = 'P0002';
  end if;
  if registro.status <> 'pending' then
    raise exception 'Este convite não está mais pendente.' using errcode = '22023';
  end if;

  insert into public.trip_members (trip_id, user_id, role)
  values (registro.trip_id, registro.invited_user_id, registro.role)
  on conflict (trip_id, user_id) do update set role = excluded.role, updated_at = now()
  returning * into membro;

  update public.trip_invites set status = 'accepted', responded_at = now() where id = invite;

  select * into viagem from public.trips where id = registro.trip_id;
  select coalesce(p.name, 'Alguém') into quem from public.profiles p where p.user_id = auth.uid();

  perform public.notify(
    registro.invited_by,
    'trip_invite_accepted',
    format('%s entrou em %s', quem, viagem.destination_city),
    null,
    jsonb_build_object('tripId', registro.trip_id, 'memberId', membro.user_id)
  );

  -- A notificação do convite deixa de fazer sentido depois de respondida: se
  -- ficasse, os botões Aceitar/Recusar continuariam ali dando erro.
  delete from public.notifications
   where user_id = auth.uid()
     and type = 'trip_invite'
     and data ->> 'inviteId' = invite::text;

  return membro;
end;
$$;

create or replace function public.decline_trip_invite(invite uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  registro public.trip_invites;
begin
  select * into registro from public.trip_invites where id = invite for update;

  if registro.id is null or registro.invited_user_id <> auth.uid() then
    raise exception 'Convite não encontrado.' using errcode = 'P0002';
  end if;
  if registro.status <> 'pending' then
    raise exception 'Este convite não está mais pendente.' using errcode = '22023';
  end if;

  update public.trip_invites set status = 'declined', responded_at = now() where id = invite;

  delete from public.notifications
   where user_id = auth.uid()
     and type = 'trip_invite'
     and data ->> 'inviteId' = invite::text;
end;
$$;

create or replace function public.cancel_trip_invite(invite uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  registro public.trip_invites;
begin
  select * into registro from public.trip_invites where id = invite for update;

  if registro.id is null or not public.is_trip_owner(registro.trip_id) then
    raise exception 'Convite não encontrado.' using errcode = 'P0002';
  end if;
  if registro.status <> 'pending' then
    raise exception 'Este convite não está mais pendente.' using errcode = '22023';
  end if;

  update public.trip_invites set status = 'cancelled', responded_at = now() where id = invite;

  delete from public.notifications
   where user_id = registro.invited_user_id
     and type = 'trip_invite'
     and data ->> 'inviteId' = invite::text;
end;
$$;

create or replace function public.set_trip_member_role(
  target_trip uuid,
  target_user uuid,
  new_role text
)
returns public.trip_members
language plpgsql
security definer
set search_path = public
as $$
declare
  membro public.trip_members;
  viagem public.trips;
begin
  if not public.is_trip_owner(target_trip) then
    raise exception 'Apenas o proprietário pode alterar permissões.' using errcode = '42501';
  end if;
  if new_role not in ('editor', 'viewer') then
    raise exception 'Permissão inválida.' using errcode = '22023';
  end if;
  if target_user = auth.uid() then
    raise exception 'O proprietário não pode alterar o próprio papel.' using errcode = '22023';
  end if;

  update public.trip_members
     set role = new_role, updated_at = now()
   where trip_id = target_trip and user_id = target_user and role <> 'owner'
  returning * into membro;

  if membro.id is null then
    raise exception 'Membro não encontrado.' using errcode = 'P0002';
  end if;

  select * into viagem from public.trips where id = target_trip;

  perform public.notify(
    target_user,
    'trip_role_changed',
    format('Sua permissão em %s mudou', viagem.destination_city),
    case when new_role = 'editor' then 'Agora você pode editar a viagem.'
         else 'Agora você pode apenas visualizar a viagem.' end,
    jsonb_build_object('tripId', target_trip, 'role', new_role)
  );

  return membro;
end;
$$;

create or replace function public.remove_trip_member(target_trip uuid, target_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  viagem public.trips;
  removidos integer;
begin
  if not public.is_trip_owner(target_trip) then
    raise exception 'Apenas o proprietário pode remover membros.' using errcode = '42501';
  end if;
  if target_user = auth.uid() then
    raise exception 'O proprietário não pode remover a si mesmo.' using errcode = '22023';
  end if;

  delete from public.trip_members
   where trip_id = target_trip and user_id = target_user and role <> 'owner';
  get diagnostics removidos = row_count;

  update public.trip_invites
     set status = 'cancelled', responded_at = now()
   where trip_id = target_trip and invited_user_id = target_user and status = 'pending';

  -- Lembretes daquela pessoa naquela viagem perdem o objeto. O conteúdo dela
  -- fica (§51, §52) — lembrete não é conteúdo, é agenda pessoal do acesso que
  -- acabou.
  delete from public.reminders where trip_id = target_trip and user_id = target_user;

  if removidos > 0 then
    select * into viagem from public.trips where id = target_trip;
    perform public.notify(
      target_user,
      'trip_member_removed',
      format('Você saiu de %s', viagem.destination_city),
      'O proprietário removeu seu acesso a esta viagem.',
      jsonb_build_object('tripId', target_trip)
    );
  end if;
end;
$$;

create or replace function public.leave_trip(target_trip uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  papel text;
begin
  select role into papel
    from public.trip_members
   where trip_id = target_trip and user_id = auth.uid();

  if papel is null then
    raise exception 'Você não participa desta viagem.' using errcode = 'P0002';
  end if;
  if papel = 'owner' then
    raise exception
      'O proprietário não pode sair da viagem. Remova os outros viajantes ou exclua a viagem.'
      using errcode = '22023';
  end if;

  delete from public.reminders where trip_id = target_trip and user_id = auth.uid();
  delete from public.trip_members where trip_id = target_trip and user_id = auth.uid();
end;
$$;

-- ----------------------------------------------------------------------------
-- 4.1. O conteúdo de quem saiu da viagem (§51, §52)
--
-- A POLÍTICA, POR EXTENSO
--
-- Quando Maria é removida (ou sai) de uma viagem:
--
--   COMPARTILHADO  fica. Um item de roteiro marcado "todos da viagem" pertence
--                  à viagem, não a quem o digitou — apagá-lo junto destruiria
--                  o planejamento do grupo por causa de uma mudança de acesso.
--                  A autoria histórica continua em `created_by`, e a tela
--                  mostra o nome por `trip_member_profiles`, que inclui
--                  deliberadamente quem já não é membro.
--
--   PRIVADO        fica onde está e deixa de ser legível por QUALQUER pessoa.
--                  Não é entregue ao proprietário, não é reclassificado como
--                  compartilhado, não aparece em lugar nenhum: a policy da 0009
--                  exige `is_trip_member(trip_id)`, e Maria deixou de sê-lo.
--                  Nem ela, nem o dono da viagem, nem outro membro.
--
-- Por que não apagar o privado na hora da remoção: remoção acidental acontece,
-- e reconvidar a pessoa devolve o acesso ao que era dela. Apagar seria
-- irreversível a partir de um clique reversível.
--
-- Por que existe esta função: dado inacessível para sempre é dado que só ocupa
-- espaço e amplia a superfície de um vazamento futuro. A limpeza é deliberada,
-- server-side, e nunca automática — o operador decide quando rodá-la, e ela só
-- toca no que já é inalcançável.
--
-- `service_role` apenas. Não é exposta ao aplicativo: nenhuma tela deveria
-- poder apagar o conteúdo privado de outra pessoa, nem por engano.
-- ----------------------------------------------------------------------------
create or replace function public.purge_unreachable_private_content(target_trip uuid)
returns table (tabela text, removidos integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  alvo text;
  contagem integer;
begin
  foreach alvo in array array[
    'itinerary_items', 'checklist_items', 'expenses', 'journal_entries', 'tickets'
  ]
  loop
    -- Só linhas privadas cujo autor NÃO é mais membro da viagem. Uma linha
    -- privada de quem continua dentro é conteúdo vivo dessa pessoa.
    execute format(
      'delete from public.%I t
        where t.trip_id = $1
          and t.visibility = ''private''
          and t.created_by is not null
          and not exists (
            select 1 from public.trip_members m
             where m.trip_id = t.trip_id and m.user_id = t.created_by
          )', alvo)
      using target_trip;
    get diagnostics contagem = row_count;

    tabela := alvo;
    removidos := contagem;
    return next;
  end loop;
end;
$$;

comment on function public.purge_unreachable_private_content(uuid) is
  'Limpeza deliberada do conteúdo privado de ex-membros — já inacessível para todos. Só service_role.';

revoke all on function public.purge_unreachable_private_content(uuid) from public, anon, authenticated;
grant execute on function public.purge_unreachable_private_content(uuid) to service_role;

-- ----------------------------------------------------------------------------
-- 5. Quem pode chamar
--
-- `notify` fica de fora da lista de propósito: ela escreve no sino de qualquer
-- pessoa e não valida nada. É a primitiva que as funções acima usam, e só elas
-- — expor ao papel `authenticated` seria devolver exatamente o INSERT que a
-- seção 1 recusou.
-- ----------------------------------------------------------------------------
revoke all on function public.notify(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.notify(uuid, text, text, text, jsonb) to service_role;

revoke all on function public.deliver_due_reminders(uuid) from public, anon;
grant execute on function public.deliver_due_reminders(uuid) to authenticated, service_role;

do $$
declare
  assinatura text;
begin
  foreach assinatura in array array[
    'public.create_trip_invite(uuid, text, text)',
    'public.accept_trip_invite(uuid)',
    'public.decline_trip_invite(uuid)',
    'public.cancel_trip_invite(uuid)',
    'public.set_trip_member_role(uuid, uuid, text)',
    'public.remove_trip_member(uuid, uuid)',
    'public.leave_trip(uuid)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', assinatura);
    execute format('grant execute on function %s to authenticated, service_role', assinatura);
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. Realtime — o sino precisa acender sozinho
-- ----------------------------------------------------------------------------
do $$
declare
  alvo text;
begin
  foreach alvo in array array['notifications', 'reminders']
  loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = alvo
    ) then
      execute format('alter publication supabase_realtime add table public.%I', alvo);
    end if;
  end loop;
exception
  when undefined_object then
    raise notice 'Publicação supabase_realtime ausente; Realtime não configurado.';
end;
$$;
