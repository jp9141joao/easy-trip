-- =============================================================================
-- Easy Trip — Colaboração: membros, papéis e convites
--
-- O QUE MUDA NO MODELO
--
-- Até aqui uma viagem tinha um dono e mais ninguém: `trips.user_id` era, ao
-- mesmo tempo, a identidade do criador e a única autorização existente. A RLS
-- inteira das tabelas operacionais passava por `public.owns_trip(trip_id)`.
--
-- A partir daqui uma viagem é um objeto compartilhável, no mesmo espírito de um
-- arquivo compartilhado: existe uma lista de membros, cada membro tem um papel
-- (`owner`/`editor`/`viewer`), e a autorização deixa de perguntar "você é o
-- dono?" para perguntar "você é membro?" e "você pode escrever?".
--
-- `trips.user_id` NÃO é removido. Ele continua sendo o proprietário original —
-- é ele que faz o backfill abaixo ter uma resposta, é ele que sustenta o
-- `on delete cascade` da conta, e é a rede de segurança caso uma linha de
-- `trip_members` seja perdida. Quem manda na autorização, porém, passa a ser
-- `trip_members`.
--
-- POR QUE AS MUTAÇÕES DE MEMBRO E CONVITE NÃO TÊM POLICY DE ESCRITA
--
-- As regras de colaboração não são "quem pode tocar nesta linha", e sim um
-- pequeno protocolo: não convidar a si mesmo, não convidar quem já é membro,
-- não haver dois convites pendentes para a mesma pessoa, só o proprietário
-- gerenciar, o convidado só poder responder ao convite que é dele, o
-- proprietário não poder sair deixando a viagem sem dono. Uma `with check` não
-- expressa isso sem virar um emaranhado que ninguém consegue reler.
--
-- Por isso `trip_members` e `trip_invites` têm policy de SELECT e mais nada:
-- toda escrita passa por funções `security definer` declaradas aqui, que
-- validam o protocolo inteiro no servidor. O cliente não tem como escrever
-- direto — não porque a tela não oferece, mas porque não existe policy que
-- deixe.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Membros
-- ----------------------------------------------------------------------------
create table if not exists public.trip_members (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references public.trips (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       text not null check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trip_members_unique unique (trip_id, user_id)
);

comment on table public.trip_members is
  'Quem participa de uma viagem e com qual papel. Fonte da autorização de todo o conteúdo da viagem.';

create index if not exists trip_members_trip_idx on public.trip_members (trip_id);
create index if not exists trip_members_user_idx on public.trip_members (user_id);

-- ----------------------------------------------------------------------------
-- 2. Convites
--
-- `invited_user_id` é um usuário existente, e não um e-mail solto: o Easy Trip
-- não convida quem não tem conta. A resolução e-mail → id acontece dentro de
-- `create_trip_invite`, que é a única porta que enxerga `auth.users` — o
-- cliente nunca consulta o diretório de usuários.
-- ----------------------------------------------------------------------------
create table if not exists public.trip_invites (
  id              uuid primary key default gen_random_uuid(),
  trip_id         uuid not null references public.trips (id) on delete cascade,
  invited_user_id uuid not null references auth.users (id) on delete cascade,
  invited_by      uuid not null references auth.users (id) on delete cascade,
  role            text not null check (role in ('editor', 'viewer')),
  status          text not null default 'pending'
                  check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at      timestamptz not null default now(),
  responded_at    timestamptz,
  constraint trip_invites_not_self check (invited_user_id <> invited_by)
);

comment on table public.trip_invites is
  'Convites para participar de uma viagem. Só o proprietário cria; só o convidado responde.';

-- Um convite pendente por pessoa e por viagem. O índice é parcial de propósito:
-- recusar e ser convidado de novo é legítimo, o que não pode existir são dois
-- pendentes ao mesmo tempo — que é exatamente o que permitiria um replay.
create unique index if not exists trip_invites_one_pending
  on public.trip_invites (trip_id, invited_user_id)
  where status = 'pending';

create index if not exists trip_invites_invited_idx
  on public.trip_invites (invited_user_id, status);
create index if not exists trip_invites_trip_idx on public.trip_invites (trip_id, status);

-- ----------------------------------------------------------------------------
-- 3. Helpers de autorização
--
-- `security definer` + `search_path = public`: as três rodam como dono da
-- tabela, então enxergam `trip_members` inteira sem esbarrar na RLS da própria
-- `trip_members`. Sem isso, uma policy de `trip_members` que consultasse
-- `trip_members` entraria em recursão infinita.
--
-- Todas caem de volta em `trips.user_id`. Não é redundância decorativa: é o que
-- garante que uma viagem cujo backfill não tenha rodado (ou cuja linha de
-- membro tenha sumido) continue acessível para quem a criou.
-- ----------------------------------------------------------------------------
create or replace function public.is_trip_member(target_trip uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.trip_members m
     where m.trip_id = target_trip and m.user_id = auth.uid()
  ) or exists (
    select 1 from public.trips t
     where t.id = target_trip and t.user_id = auth.uid()
  );
$$;

create or replace function public.can_edit_trip(target_trip uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.trip_members m
     where m.trip_id = target_trip
       and m.user_id = auth.uid()
       and m.role in ('owner', 'editor')
  ) or exists (
    select 1 from public.trips t
     where t.id = target_trip and t.user_id = auth.uid()
  );
$$;

create or replace function public.is_trip_owner(target_trip uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.trip_members m
     where m.trip_id = target_trip and m.user_id = auth.uid() and m.role = 'owner'
  ) or exists (
    select 1 from public.trips t
     where t.id = target_trip and t.user_id = auth.uid()
  );
$$;

comment on function public.is_trip_member(uuid) is
  'A sessão atual participa desta viagem, em qualquer papel?';
comment on function public.can_edit_trip(uuid) is
  'A sessão atual pode escrever conteúdo compartilhado desta viagem? (owner ou editor)';
comment on function public.is_trip_owner(uuid) is
  'A sessão atual é proprietária desta viagem? Só ela gerencia membros e convites.';

-- ----------------------------------------------------------------------------
-- 4. Backfill — nenhuma viagem existente pode deixar de funcionar
--
-- Idempotente: `on conflict do nothing` deixa a migration ser reaplicada sobre
-- uma base já migrada sem levantar erro e sem rebaixar ninguém.
-- ----------------------------------------------------------------------------
insert into public.trip_members (trip_id, user_id, role)
select t.id, t.user_id, 'owner'
  from public.trips t
on conflict (trip_id, user_id) do nothing;

-- Viagem nova já nasce com o criador na lista. O trigger existe porque a
-- inserção do membro não pode depender de o aplicativo lembrar de fazê-la: se
-- ela ficasse do lado do cliente, uma viagem criada por um caminho novo
-- nasceria sem dono na tabela que decide autorização.
create or replace function public.handle_new_trip()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.trip_members (trip_id, user_id, role)
  values (new.id, new.user_id, 'owner')
  on conflict (trip_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_trip_created on public.trips;
create trigger on_trip_created
  after insert on public.trips
  for each row execute function public.handle_new_trip();

-- ----------------------------------------------------------------------------
-- 5. RLS
-- ----------------------------------------------------------------------------
alter table public.trip_members enable row level security;
alter table public.trip_invites enable row level security;

-- Membro enxerga a lista de membros da viagem — é o que a tela "Viajantes"
-- mostra. Ninguém de fora enxerga nada.
drop policy if exists trip_members_select on public.trip_members;
create policy trip_members_select on public.trip_members
  for select using (public.is_trip_member(trip_id));

-- Sem policy de INSERT/UPDATE/DELETE. Ver o cabeçalho: escrita só pelas
-- funções `security definer` da seção 6.

-- O convidado vê o convite que é dele; o proprietário vê os que enviou.
drop policy if exists trip_invites_select on public.trip_invites;
create policy trip_invites_select on public.trip_invites
  for select using (
    invited_user_id = auth.uid() or public.is_trip_owner(trip_id)
  );

-- ----------------------------------------------------------------------------
-- 6. Trips: a autorização passa a ser por participação
--
-- SELECT vira "sou membro". UPDATE continua exigindo poder de escrita — e aqui
-- é `is_trip_owner`, não `can_edit_trip`: editar destino, datas e orçamento é
-- decisão do dono da viagem, não de quem foi convidado para colaborar no
-- conteúdo. DELETE idem, e com mais razão.
-- ----------------------------------------------------------------------------
drop policy if exists trips_select on public.trips;
create policy trips_select on public.trips
  for select using (user_id = auth.uid() or public.is_trip_member(id));

drop policy if exists trips_insert on public.trips;
create policy trips_insert on public.trips
  for insert with check (user_id = auth.uid());

drop policy if exists trips_update on public.trips;
create policy trips_update on public.trips
  for update using (public.is_trip_owner(id)) with check (public.is_trip_owner(id));

drop policy if exists trips_delete on public.trips;
create policy trips_delete on public.trips
  for delete using (public.is_trip_owner(id));

-- ----------------------------------------------------------------------------
-- 7. Tabelas operacionais: leitura para membro, escrita para editor
--
-- A 0002 criava uma policy `FOR ALL` por tabela. Ela é substituída por quatro
-- policies separadas, porque leitura e escrita deixaram de ter a mesma
-- resposta: `viewer` lê e não escreve. Uma policy `FOR ALL` não sabe expressar
-- essa diferença.
--
-- A visibilidade por item (`shared`/`private`) entra na 0009 e refina o SELECT
-- e o UPDATE/DELETE. Aqui o recorte ainda é só por participação.
-- ----------------------------------------------------------------------------
do $$
declare
  alvo text;
begin
  foreach alvo in array array[
    'itinerary_items', 'checklist_items', 'expenses', 'tickets', 'journal_entries'
  ]
  loop
    execute format('drop policy if exists %I_all on public.%I', alvo, alvo);

    execute format('drop policy if exists %I_select on public.%I', alvo, alvo);
    execute format(
      'create policy %I_select on public.%I for select using (public.is_trip_member(trip_id))',
      alvo, alvo);

    execute format('drop policy if exists %I_insert on public.%I', alvo, alvo);
    execute format(
      'create policy %I_insert on public.%I for insert with check (public.can_edit_trip(trip_id))',
      alvo, alvo);

    execute format('drop policy if exists %I_update on public.%I', alvo, alvo);
    execute format(
      'create policy %I_update on public.%I for update
         using (public.can_edit_trip(trip_id)) with check (public.can_edit_trip(trip_id))',
      alvo, alvo);

    execute format('drop policy if exists %I_delete on public.%I', alvo, alvo);
    execute format(
      'create policy %I_delete on public.%I for delete using (public.can_edit_trip(trip_id))',
      alvo, alvo);
  end loop;
end;
$$;

-- Mídia do diário segue a entrada a que pertence.
drop policy if exists journal_media_all on public.journal_media;

drop policy if exists journal_media_select on public.journal_media;
create policy journal_media_select on public.journal_media
  for select using (
    exists (
      select 1 from public.journal_entries e
       where e.id = journal_entry_id and public.is_trip_member(e.trip_id)
    )
  );

drop policy if exists journal_media_write on public.journal_media;
create policy journal_media_write on public.journal_media
  for all
  using (
    exists (
      select 1 from public.journal_entries e
       where e.id = journal_entry_id and public.can_edit_trip(e.trip_id)
    )
  )
  with check (
    exists (
      select 1 from public.journal_entries e
       where e.id = journal_entry_id and public.can_edit_trip(e.trip_id)
    )
  );

-- ----------------------------------------------------------------------------
-- 8. O protocolo de colaboração, em funções
--
-- Todas são `security definer`, e todas começam validando a autorização de
-- novo. Isso não é desconfiança do cliente — é que `security definer` desliga a
-- RLS, então a autorização precisa ser reescrita por extenso aqui dentro. Uma
-- função dessas que esquecesse a checagem seria um bypass completo.
--
-- `revoke ... from public` + `grant ... to authenticated` fecha o outro lado:
-- sem sessão, nenhuma delas é chamável.
-- ----------------------------------------------------------------------------

-- Resolve o e-mail para um id de usuário. NÃO é uma busca no diretório: recebe
-- um e-mail exato, devolve no máximo um id, e nunca uma lista. Quem não é
-- proprietário da viagem sequer chega a este ponto.
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
    -- Mensagem própria, e não "erro ao convidar": esta é a única situação em
    -- que a pessoa consegue resolver sozinha o que deu errado.
    raise exception 'Nenhuma conta Easy Trip com este e-mail.' using errcode = 'P0002';
  end if;

  if convidado = auth.uid() then
    raise exception 'Você já participa desta viagem.' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.trip_members m
     where m.trip_id = target_trip and m.user_id = convidado
  ) then
    raise exception 'Esta pessoa já é membro da viagem.' using errcode = '23505';
  end if;

  if exists (
    select 1 from public.trip_invites i
     where i.trip_id = target_trip
       and i.invited_user_id = convidado
       and i.status = 'pending'
  ) then
    raise exception 'Já existe um convite pendente para esta pessoa.' using errcode = '23505';
  end if;

  insert into public.trip_invites (trip_id, invited_user_id, invited_by, role)
  values (target_trip, convidado, auth.uid(), target_role)
  returning * into criado;

  return criado;
end;
$$;

-- Aceitar é do convidado, e de mais ninguém. `for update` trava a linha: sem
-- ele, dois toques rápidos no botão passariam os dois pelo `if` de status antes
-- de qualquer um gravar, e o convite seria aceito duas vezes.
create or replace function public.accept_trip_invite(invite uuid)
returns public.trip_members
language plpgsql
security definer
set search_path = public
as $$
declare
  registro public.trip_invites;
  membro   public.trip_members;
begin
  if auth.uid() is null then
    raise exception 'Sessão obrigatória.' using errcode = '42501';
  end if;

  select * into registro from public.trip_invites where id = invite for update;

  if registro.id is null or registro.invited_user_id <> auth.uid() then
    -- Mesma mensagem para "não existe" e "não é seu": responder coisas
    -- diferentes transformaria esta função num oráculo de ids de convite.
    raise exception 'Convite não encontrado.' using errcode = 'P0002';
  end if;

  if registro.status <> 'pending' then
    raise exception 'Este convite não está mais pendente.' using errcode = '22023';
  end if;

  insert into public.trip_members (trip_id, user_id, role)
  values (registro.trip_id, registro.invited_user_id, registro.role)
  on conflict (trip_id, user_id) do update set role = excluded.role, updated_at = now()
  returning * into membro;

  update public.trip_invites
     set status = 'accepted', responded_at = now()
   where id = invite;

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

  update public.trip_invites
     set status = 'declined', responded_at = now()
   where id = invite;
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

  update public.trip_invites
     set status = 'cancelled', responded_at = now()
   where id = invite;
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
begin
  if not public.is_trip_owner(target_trip) then
    raise exception 'Apenas o proprietário pode alterar permissões.' using errcode = '42501';
  end if;
  if new_role not in ('editor', 'viewer') then
    -- Promover a `owner` seria transferência de propriedade, que esta fase não
    -- implementa. Fazê-la por aqui, sem confirmação e sem rebaixar o anterior,
    -- criaria duas pessoas donas da mesma viagem — ver §50.
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

  return membro;
end;
$$;

create or replace function public.remove_trip_member(target_trip uuid, target_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_trip_owner(target_trip) then
    raise exception 'Apenas o proprietário pode remover membros.' using errcode = '42501';
  end if;
  if target_user = auth.uid() then
    raise exception 'O proprietário não pode remover a si mesmo.' using errcode = '22023';
  end if;

  delete from public.trip_members
   where trip_id = target_trip and user_id = target_user and role <> 'owner';

  -- Convite pendente da mesma pessoa perde o sentido junto.
  update public.trip_invites
     set status = 'cancelled', responded_at = now()
   where trip_id = target_trip and invited_user_id = target_user and status = 'pending';
end;
$$;

-- Sair é do colaborador. O proprietário não sai: sairia deixando a viagem sem
-- ninguém que possa gerenciá-la, e o conteúdo compartilhado dos outros membros
-- órfão. Enquanto não houver transferência de propriedade (§50), a saída dele
-- é bloqueada e a mensagem diz o caminho.
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

  delete from public.trip_members
   where trip_id = target_trip and user_id = auth.uid();
end;
$$;

-- ----------------------------------------------------------------------------
-- 8.1. Os nomes dos viajantes — e só os nomes
--
-- A tela "Viajantes" precisa escrever "Maria", e `profiles` é legível apenas
-- pelo próprio dono (`profiles_select`, 0002). Afrouxar aquela policy para
-- "membros da mesma viagem" resolveria o problema errado: `profiles` guarda
-- telefone, cidade, fuso e estilo de viagem, e nada disso pertence a quem
-- divide um roteiro.
--
-- Esta função devolve duas colunas — id e nome — para os membros de uma viagem
-- de que quem chama participa. É a minimização de PII do §52: o mínimo que faz
-- a interface funcionar, e nada além.
--
-- Neste ponto da sequência só existem membros, convites e o proprietário. A
-- 0009 redefine a função depois de criar `created_by`/`paid_by` e acrescenta
-- os autores históricos de conteúdo compartilhado. A lista ativa continua
-- vindo de `trip_members`; este RPC é apenas um mapa id → nome.
-- ----------------------------------------------------------------------------
create or replace function public.trip_member_profiles(target_trip uuid)
returns table (user_id uuid, name text)
language sql
stable
security definer
set search_path = public
as $$
  select p.user_id, p.name
    from public.profiles p
   where public.is_trip_member(target_trip)
     and (
       p.user_id in (select m.user_id from public.trip_members m where m.trip_id = target_trip)
       or p.user_id in (select i.invited_user_id from public.trip_invites i
                         where i.trip_id = target_trip and i.status = 'pending')
       or p.user_id in (select t.user_id from public.trips t where t.id = target_trip)
     );
$$;

comment on function public.trip_member_profiles(uuid) is
  'Mapa mínimo id → nome para membros e convites. A 0009 acrescenta autores históricos compartilhados.';

-- ----------------------------------------------------------------------------
-- 9. Quem pode chamar
--
-- `security definer` sem esta seção é uma função que roda como dono e está
-- disponível para `public` — inclusive para o papel anônimo, que o Easy Trip
-- não usa em lugar nenhum (0005).
-- ----------------------------------------------------------------------------
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
    'public.leave_trip(uuid)',
    'public.trip_member_profiles(uuid)',
    'public.is_trip_member(uuid)',
    'public.can_edit_trip(uuid)',
    'public.is_trip_owner(uuid)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', assinatura);
    execute format('grant execute on function %s to authenticated, service_role', assinatura);
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- 10. Realtime
--
-- A colaboração precisa parecer um arquivo compartilhado (§8): o que o outro
-- membro muda tem de aparecer sem reabrir a tela. A publicação é adicionada
-- aqui; quem restringe o que cada sessão recebe é a RLS, porque o Realtime do
-- Supabase avalia as policies antes de entregar a linha.
--
-- `add table` levanta erro se a tabela já estiver na publicação, e migration
-- que não pode ser reaplicada é migration que trava um `db reset`. Daí o bloco.
-- ----------------------------------------------------------------------------
do $$
declare
  alvo text;
begin
  foreach alvo in array array[
    'trip_members', 'trip_invites', 'itinerary_items', 'checklist_items',
    'expenses', 'tickets', 'journal_entries'
  ]
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
    -- Projeto sem a publicação `supabase_realtime` (base local crua). O resto
    -- da migration não depende dela.
    raise notice 'Publicação supabase_realtime ausente; Realtime não configurado.';
end;
$$;

-- ----------------------------------------------------------------------------
-- 11. Conferência
-- ----------------------------------------------------------------------------
do $$
declare
  orfas integer;
begin
  select count(*) into orfas
    from public.trips t
   where not exists (
     select 1 from public.trip_members m
      where m.trip_id = t.id and m.user_id = t.user_id and m.role = 'owner'
   );

  if orfas > 0 then
    raise exception 'Backfill incompleto: % viagem(ns) sem proprietário em trip_members.', orfas;
  end if;
end;
$$;
