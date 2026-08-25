-- =============================================================================
-- Colaboração — matriz de segurança (§60–§64)
--
-- Quatro identidades e uma viagem:
--
--            leitura     escrita     gerência    privado alheio
--   OWNER_A     sim         sim         sim           NÃO
--   EDITOR_B    sim         sim         NÃO           NÃO
--   VIEWER_C    sim         NÃO         NÃO           NÃO
--   OUTSIDER_D  NÃO         NÃO         NÃO           NÃO
--
-- A linha que mais importa é a última coluna da primeira linha: **o
-- proprietário não lê o conteúdo privado dos outros membros**. Se algum dia
-- alguém "consertar" a policy dando bypass ao dono, é aqui que quebra.
--
-- Cada cenário assume a identidade do jeito que o PostgREST monta (papel
-- `authenticated` + claim `sub`) e fala com a tabela direto. Nenhuma linha de
-- aplicativo participa: o que passa ou não passa aqui é a policy.
--
-- Rodar contra um banco descartável, depois de 0001–0012:
--   psql -f supabase/tests/rls_collaboration.test.sql
-- =============================================================================

\set ON_ERROR_STOP on
\set QUIET on

create or replace function pg_temp.check(condition boolean, label text)
returns void language plpgsql as $$
begin
  if condition then
    raise notice '  OK   %', label;
  else
    raise exception 'FALHOU: %', label;
  end if;
end;
$$;

-- Recusa esperada: a operação tem de levantar exceção OU não atingir linha
-- nenhuma. As duas contam como negada — a RLS usa uma forma para escrita
-- barrada por `with check` e a outra para linha invisível ao `using`.
create or replace function pg_temp.deny(comando text, label text)
returns void language plpgsql as $$
declare
  atingidas integer;
begin
  execute comando;
  get diagnostics atingidas = row_count;
  if atingidas = 0 then
    raise notice '  OK   % (0 linhas)', label;
  else
    raise exception 'FALHOU: % — % linha(s) passaram', label, atingidas;
  end if;
exception
  when insufficient_privilege or check_violation then
    raise notice '  OK   % (recusado)', label;
end;
$$;

create or replace function pg_temp.as_user(uid text)
returns void language plpgsql as $$
begin
  execute format('set local role authenticated');
  execute format('set local request.jwt.claims = %L', json_build_object('sub', uid)::text);
end;
$$;

create or replace function pg_temp.as_postgres() returns void language plpgsql as $$
begin
  reset role;
  set local request.jwt.claims = '';
end;
$$;

-- ---------------------------------------------------------------- preparação
insert into auth.users (id, email) values
  ('0a000000-0000-4000-8000-00000000000a', 'owner.a@easytrip.app'),
  ('0b000000-0000-4000-8000-00000000000b', 'editor.b@easytrip.app'),
  ('0c000000-0000-4000-8000-00000000000c', 'viewer.c@easytrip.app'),
  ('0d000000-0000-4000-8000-00000000000d', 'outsider.d@easytrip.app')
on conflict (id) do nothing;

insert into public.profiles (user_id, name) values
  ('0a000000-0000-4000-8000-00000000000a', 'Ana'),
  ('0b000000-0000-4000-8000-00000000000b', 'Bruno'),
  ('0c000000-0000-4000-8000-00000000000c', 'Carla'),
  ('0d000000-0000-4000-8000-00000000000d', 'Davi')
on conflict (user_id) do update set name = excluded.name;

insert into public.trips
  (id, user_id, destination_city, destination_country, country_code, timezone,
   start_date, end_date, budget_total, budget_currency)
values
  ('a1000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-00000000000a',
   'Paris', 'França', 'FR', 'Europe/Paris', '2026-08-22', '2026-08-31', 12000, 'BRL'),
  -- Viagem de D, para provar que "membro de alguma viagem" não é "membro desta".
  ('a1000000-0000-4000-8000-000000000002', '0d000000-0000-4000-8000-00000000000d',
   'Lisboa', 'Portugal', 'PT', 'Europe/Lisbon', '2026-09-01', '2026-09-10', 8000, 'BRL')
on conflict (id) do nothing;

insert into public.trip_members (trip_id, user_id, role) values
  ('a1000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-00000000000b', 'editor'),
  ('a1000000-0000-4000-8000-000000000001', '0c000000-0000-4000-8000-00000000000c', 'viewer')
on conflict do nothing;

insert into public.itinerary_items (id, trip_id, date, type, title, visibility, created_by) values
  ('c1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001',
   '2026-08-24', 'atracao', 'Louvre (compartilhado)', 'shared',
   '0a000000-0000-4000-8000-00000000000a')
on conflict (id) do nothing;

insert into public.journal_entries (id, trip_id, user_id, entry_date, content, visibility, created_by) values
  ('c2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001',
   '0a000000-0000-4000-8000-00000000000a', '2026-08-24', 'Diário privado de Ana', 'private',
   '0a000000-0000-4000-8000-00000000000a'),
  ('c2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001',
   '0b000000-0000-4000-8000-00000000000b', '2026-08-25', 'Diário privado de Bruno', 'private',
   '0b000000-0000-4000-8000-00000000000b')
on conflict (id) do nothing;

insert into public.expenses
  (id, trip_id, user_id, category, amount, currency, transaction_date, description,
   visibility, created_by, paid_by)
values
  ('c3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001',
   '0b000000-0000-4000-8000-00000000000b', 'alimentacao', 320, 'EUR', '2026-08-24',
   'Jantar compartilhado', 'shared', '0b000000-0000-4000-8000-00000000000b',
   '0b000000-0000-4000-8000-00000000000b'),
  ('c3000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001',
   '0b000000-0000-4000-8000-00000000000b', 'outros', 75, 'EUR', '2026-08-24',
   'Farmácia privada de Bruno', 'private', '0b000000-0000-4000-8000-00000000000b',
   '0b000000-0000-4000-8000-00000000000b')
on conflict (id) do nothing;

-- Evento persistido pelo servidor para testar a única mutação permitida ao
-- cliente: `read_at`. Os demais campos precisam continuar imutáveis mesmo
-- para a pessoa dona da notificação.
insert into public.notifications
  (id, user_id, type, title, body, data, created_at)
values
  ('d1000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-00000000000b',
   'trip_role_changed', 'Permissão alterada', 'Agora você pode editar.',
   '{"tripId":"a1000000-0000-4000-8000-000000000001"}'::jsonb,
   '2026-08-24T12:00:00Z')
on conflict (id) do nothing;

-- ============================================================ §60 — leitura
do $$
begin
  raise notice '§60 leitura';

  perform pg_temp.as_user('0a000000-0000-4000-8000-00000000000a');
  perform pg_temp.check(
    (select count(*) from public.trips where id = 'a1000000-0000-4000-8000-000000000001') = 1,
    'OWNER_A lê a viagem');
  perform pg_temp.check(
    (select count(*) from public.itinerary_items
      where trip_id = 'a1000000-0000-4000-8000-000000000001') = 1,
    'OWNER_A lê roteiro compartilhado');

  perform pg_temp.as_user('0b000000-0000-4000-8000-00000000000b');
  perform pg_temp.check(
    (select count(*) from public.trips where id = 'a1000000-0000-4000-8000-000000000001') = 1,
    'EDITOR_B lê a viagem');

  perform pg_temp.as_user('0c000000-0000-4000-8000-00000000000c');
  perform pg_temp.check(
    (select count(*) from public.itinerary_items
      where trip_id = 'a1000000-0000-4000-8000-000000000001') = 1,
    'VIEWER_C lê roteiro compartilhado');

  perform pg_temp.as_user('0d000000-0000-4000-8000-00000000000d');
  perform pg_temp.check(
    (select count(*) from public.trips where id = 'a1000000-0000-4000-8000-000000000001') = 0,
    'OUTSIDER_D não enxerga a viagem');
  perform pg_temp.check(
    (select count(*) from public.itinerary_items
      where trip_id = 'a1000000-0000-4000-8000-000000000001') = 0,
    'OUTSIDER_D não enxerga o roteiro');
  perform pg_temp.check(
    (select count(*) from public.trip_members
      where trip_id = 'a1000000-0000-4000-8000-000000000001') = 0,
    'OUTSIDER_D não enxerga a lista de membros');

  perform pg_temp.as_postgres();
end;
$$;

-- ============================================================ §60 — escrita
do $$
begin
  raise notice '§60 escrita';

  perform pg_temp.as_user('0b000000-0000-4000-8000-00000000000b');
  insert into public.itinerary_items (trip_id, date, type, title, visibility)
  values ('a1000000-0000-4000-8000-000000000001', '2026-08-26', 'atracao', 'Editor criou', 'shared');
  perform pg_temp.check(true, 'EDITOR_B cria conteúdo compartilhado');

  -- O cliente tenta atribuir a criação a A. O trigger precisa sobrescrever o
  -- payload em TODAS as cinco tabelas, inclusive quando o valor não é nulo.
  insert into public.itinerary_items
    (id, trip_id, date, type, title, visibility, created_by)
  values
    ('c1100000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001',
     '2026-08-26', 'atracao', 'Roteiro com autor forjado', 'shared',
     '0a000000-0000-4000-8000-00000000000a')
  on conflict (id) do nothing;
  perform pg_temp.check(
    (select created_by from public.itinerary_items
      where id = 'c1100000-0000-4000-8000-000000000001')
      = '0b000000-0000-4000-8000-00000000000b',
    'INSERT de roteiro força autoria da sessão');

  insert into public.checklist_items
    (id, trip_id, label, category, visibility, created_by)
  values
    ('c4100000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001',
     'Checklist com autor forjado', 'mala', 'shared',
     '0a000000-0000-4000-8000-00000000000a')
  on conflict (id) do nothing;
  perform pg_temp.check(
    (select created_by from public.checklist_items
      where id = 'c4100000-0000-4000-8000-000000000001')
      = '0b000000-0000-4000-8000-00000000000b',
    'INSERT de checklist força autoria da sessão');

  insert into public.expenses
    (id, trip_id, user_id, category, amount, currency, transaction_date, description,
     visibility, created_by, paid_by)
  values
    ('c3100000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001',
     '0b000000-0000-4000-8000-00000000000b', 'outros', 10, 'EUR', '2026-08-26',
     'Despesa com autor forjado', 'shared', '0a000000-0000-4000-8000-00000000000a',
     '0b000000-0000-4000-8000-00000000000b')
  on conflict (id) do nothing;
  perform pg_temp.check(
    (select created_by from public.expenses
      where id = 'c3100000-0000-4000-8000-000000000001')
      = '0b000000-0000-4000-8000-00000000000b',
    'INSERT de despesa força autoria da sessão');

  insert into public.journal_entries
    (id, trip_id, user_id, entry_date, content, visibility, created_by)
  values
    ('c2100000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001',
     '0b000000-0000-4000-8000-00000000000b', '2026-08-26',
     'Diário compartilhado com autor forjado', 'shared',
     '0a000000-0000-4000-8000-00000000000a')
  on conflict (id) do nothing;
  perform pg_temp.check(
    (select created_by from public.journal_entries
      where id = 'c2100000-0000-4000-8000-000000000001')
      = '0b000000-0000-4000-8000-00000000000b',
    'INSERT de diário força autoria da sessão');

  insert into public.tickets
    (id, trip_id, user_id, type, title, visibility, created_by)
  values
    ('c5100000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001',
     '0b000000-0000-4000-8000-00000000000b', 'other', 'Reserva com autor forjado',
     'shared', '0a000000-0000-4000-8000-00000000000a')
  on conflict (id) do nothing;
  perform pg_temp.check(
    (select created_by from public.tickets
      where id = 'c5100000-0000-4000-8000-000000000001')
      = '0b000000-0000-4000-8000-00000000000b',
    'INSERT de reserva força autoria da sessão');

  -- Editar conteúdo compartilhado de A continua válido, mas `created_by` é
  -- imutável. Tentar combinar troca de autor + private é recusado pelo WITH
  -- CHECK depois que o trigger restaura A como autor real.
  update public.itinerary_items
     set title = 'Louvre editado legitimamente por B'
   where id = 'c1000000-0000-4000-8000-000000000001';
  perform pg_temp.check(
    (select title = 'Louvre editado legitimamente por B'
            and created_by = '0a000000-0000-4000-8000-00000000000a'
       from public.itinerary_items
      where id = 'c1000000-0000-4000-8000-000000000001'),
    'EDITOR_B edita shared de A sem alterar autoria');

  update public.itinerary_items
     set created_by = '0b000000-0000-4000-8000-00000000000b'
   where id = 'c1000000-0000-4000-8000-000000000001';
  perform pg_temp.check(
    (select created_by from public.itinerary_items
      where id = 'c1000000-0000-4000-8000-000000000001')
      = '0a000000-0000-4000-8000-00000000000a',
    'EDITOR_B não rouba autoria de shared de A');

  perform pg_temp.deny(
    $q$update public.itinerary_items
          set visibility = 'private',
              created_by = '0b000000-0000-4000-8000-00000000000b'
        where id = 'c1000000-0000-4000-8000-000000000001'$q$,
    'EDITOR_B não privatiza shared de A forjando autoria');

  perform pg_temp.as_user('0c000000-0000-4000-8000-00000000000c');
  perform pg_temp.deny(
    $q$insert into public.itinerary_items (trip_id, date, type, title, visibility)
       values ('a1000000-0000-4000-8000-000000000001','2026-08-27','atracao','Viewer tentou','shared')$q$,
    'VIEWER_C não cria roteiro');
  perform pg_temp.deny(
    $q$update public.itinerary_items set title = 'Viewer editou'
        where id = 'c1000000-0000-4000-8000-000000000001'$q$,
    'VIEWER_C não edita roteiro');
  perform pg_temp.deny(
    $q$delete from public.itinerary_items where id = 'c1000000-0000-4000-8000-000000000001'$q$,
    'VIEWER_C não apaga roteiro');
  perform pg_temp.deny(
    $q$update public.trips set budget_total = 1 where id = 'a1000000-0000-4000-8000-000000000001'$q$,
    'VIEWER_C não edita a viagem');

  perform pg_temp.as_user('0d000000-0000-4000-8000-00000000000d');
  perform pg_temp.deny(
    $q$insert into public.itinerary_items (trip_id, date, type, title, visibility)
       values ('a1000000-0000-4000-8000-000000000001','2026-08-28','atracao','Outsider','shared')$q$,
    'OUTSIDER_D não escreve na viagem');

  perform pg_temp.as_postgres();
end;
$$;

-- ==================================================== §60/§63 — privacidade
do $$
begin
  raise notice '§60/§63 privado';

  perform pg_temp.as_user('0a000000-0000-4000-8000-00000000000a');
  perform pg_temp.check(
    (select count(*) from public.journal_entries
      where id = 'c2000000-0000-4000-8000-000000000001') = 1,
    'A lê o próprio diário privado');
  -- A LINHA QUE MAIS IMPORTA DESTE ARQUIVO.
  perform pg_temp.check(
    (select count(*) from public.journal_entries
      where id = 'c2000000-0000-4000-8000-000000000002') = 0,
    'PROPRIETÁRIO A **não** lê o diário privado de B');
  perform pg_temp.deny(
    $q$delete from public.journal_entries where id = 'c2000000-0000-4000-8000-000000000002'$q$,
    'PROPRIETÁRIO A não apaga o diário privado de B');

  perform pg_temp.as_user('0b000000-0000-4000-8000-00000000000b');
  perform pg_temp.check(
    (select count(*) from public.journal_entries
      where id = 'c2000000-0000-4000-8000-000000000001') = 0,
    'EDITOR_B não lê o diário privado de A');
  perform pg_temp.check(
    (select count(*) from public.journal_entries
      where id = 'c2000000-0000-4000-8000-000000000002') = 1,
    'EDITOR_B lê o próprio diário privado');

  perform pg_temp.as_user('0c000000-0000-4000-8000-00000000000c');
  perform pg_temp.check(
    (select count(*) from public.journal_entries
      where trip_id = 'a1000000-0000-4000-8000-000000000001'
        and visibility = 'private') = 0,
    'VIEWER_C não lê diário privado de ninguém');

  perform pg_temp.as_postgres();
end;
$$;

-- ================================================== §62 — despesas
do $$
begin
  raise notice '§62 despesas';

  perform pg_temp.as_user('0a000000-0000-4000-8000-00000000000a');
  perform pg_temp.check(
    (select count(*) from public.expenses
      where id = 'c3000000-0000-4000-8000-000000000001') = 1,
    'A lê a despesa compartilhada de B');
  perform pg_temp.check(
    (select count(*) from public.expenses
      where id = 'c3000000-0000-4000-8000-000000000002') = 0,
    'A **não** lê a despesa privada de B');

  perform pg_temp.as_user('0c000000-0000-4000-8000-00000000000c');
  perform pg_temp.check(
    (select count(*) from public.expenses
      where trip_id = 'a1000000-0000-4000-8000-000000000001'
        and visibility = 'shared') >= 1
    and
    (select count(*) from public.expenses
      where trip_id = 'a1000000-0000-4000-8000-000000000001'
        and visibility = 'private') = 0,
    'VIEWER_C vê só a despesa compartilhada');
  perform pg_temp.deny(
    $q$update public.expenses set amount = 1 where id = 'c3000000-0000-4000-8000-000000000001'$q$,
    'VIEWER_C não altera despesa compartilhada');

  perform pg_temp.as_postgres();
end;
$$;

-- ============================================ §60/§61 — gerência e convites
do $$
declare
  convite uuid;
begin
  raise notice '§61 convites';

  -- Escrita direta em trip_members não existe para ninguém: não há policy.
  perform pg_temp.as_user('0b000000-0000-4000-8000-00000000000b');
  perform pg_temp.deny(
    $q$update public.trip_members set role = 'owner'
        where trip_id = 'a1000000-0000-4000-8000-000000000001'
          and user_id = '0b000000-0000-4000-8000-00000000000b'$q$,
    'EDITOR_B não se promove a owner');
  perform pg_temp.deny(
    $q$insert into public.trip_members (trip_id, user_id, role)
       values ('a1000000-0000-4000-8000-000000000001','0d000000-0000-4000-8000-00000000000d','editor')$q$,
    'EDITOR_B não insere membro direto');

  -- Convites: só o proprietário cria.
  begin
    perform public.create_trip_invite(
      'a1000000-0000-4000-8000-000000000001', 'outsider.d@easytrip.app', 'editor');
    raise exception 'FALHOU: EDITOR_B conseguiu convidar';
  exception
    when insufficient_privilege then raise notice '  OK   EDITOR_B não convida (recusado)';
  end;

  perform pg_temp.as_user('0c000000-0000-4000-8000-00000000000c');
  begin
    perform public.create_trip_invite(
      'a1000000-0000-4000-8000-000000000001', 'outsider.d@easytrip.app', 'viewer');
    raise exception 'FALHOU: VIEWER_C conseguiu convidar';
  exception
    when insufficient_privilege then raise notice '  OK   VIEWER_C não convida (recusado)';
  end;

  -- O proprietário convida.
  perform pg_temp.as_user('0a000000-0000-4000-8000-00000000000a');
  select id into convite from public.create_trip_invite(
    'a1000000-0000-4000-8000-000000000001', 'OUTSIDER.D@easytrip.app', 'viewer');
  perform pg_temp.check(convite is not null, 'OWNER_A convida (e-mail case-insensitive)');

  -- Duplicata pendente.
  begin
    perform public.create_trip_invite(
      'a1000000-0000-4000-8000-000000000001', 'outsider.d@easytrip.app', 'editor');
    raise exception 'FALHOU: convite duplicado pendente foi aceito';
  exception
    when unique_violation then raise notice '  OK   convite duplicado pendente recusado';
  end;

  -- Convidar quem já é membro.
  begin
    perform public.create_trip_invite(
      'a1000000-0000-4000-8000-000000000001', 'editor.b@easytrip.app', 'viewer');
    raise exception 'FALHOU: convidou quem já é membro';
  exception
    when unique_violation then raise notice '  OK   membro existente não é convidável';
  end;

  -- Convidar a si mesmo.
  begin
    perform public.create_trip_invite(
      'a1000000-0000-4000-8000-000000000001', 'owner.a@easytrip.app', 'editor');
    raise exception 'FALHOU: convidou a si mesmo';
  exception
    when others then raise notice '  OK   auto-convite recusado';
  end;

  -- Aceitar convite alheio.
  perform pg_temp.as_user('0b000000-0000-4000-8000-00000000000b');
  begin
    perform public.accept_trip_invite(convite);
    raise exception 'FALHOU: B aceitou convite de D';
  exception
    when no_data_found then raise notice '  OK   convite alheio não é aceitável';
  end;

  -- O convidado vê e aceita.
  perform pg_temp.as_user('0d000000-0000-4000-8000-00000000000d');
  perform pg_temp.check(
    (select count(*) from public.trip_invites where id = convite) = 1,
    'OUTSIDER_D enxerga o próprio convite');
  perform public.accept_trip_invite(convite);
  perform pg_temp.check(
    (select role from public.trip_members
      where trip_id = 'a1000000-0000-4000-8000-000000000001'
        and user_id = '0d000000-0000-4000-8000-00000000000d') = 'viewer',
    'D entra como viewer — com o papel do convite, não o que ele pediria');

  -- Replay: aceitar de novo.
  begin
    perform public.accept_trip_invite(convite);
    raise exception 'FALHOU: convite aceito duas vezes';
  exception
    when invalid_parameter_value then raise notice '  OK   replay de convite recusado';
  end;

  -- Sair da viagem.
  perform public.leave_trip('a1000000-0000-4000-8000-000000000001');
  perform pg_temp.check(
    (select count(*) from public.trip_members
      where trip_id = 'a1000000-0000-4000-8000-000000000001'
        and user_id = '0d000000-0000-4000-8000-00000000000d') = 0,
    'D sai da viagem');

  -- O proprietário não sai.
  perform pg_temp.as_user('0a000000-0000-4000-8000-00000000000a');
  begin
    perform public.leave_trip('a1000000-0000-4000-8000-000000000001');
    raise exception 'FALHOU: proprietário saiu da viagem';
  exception
    when invalid_parameter_value then raise notice '  OK   proprietário não pode sair';
  end;

  -- Promover a owner por RPC.
  begin
    perform public.set_trip_member_role(
      'a1000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-00000000000b', 'owner');
    raise exception 'FALHOU: transferência de propriedade por set_trip_member_role';
  exception
    when invalid_parameter_value then raise notice '  OK   não há transferência de propriedade';
  end;

  perform pg_temp.as_postgres();
end;
$$;

-- ================================================ §64 — notificações
do $$
begin
  raise notice '§64 notificações';

  perform pg_temp.as_user('0b000000-0000-4000-8000-00000000000b');
  -- B foi notificado? Não — a notificação do convite foi para D.
  perform pg_temp.check(
    (select count(*) from public.notifications
      where user_id = '0d000000-0000-4000-8000-00000000000d') = 0,
    'B não enxerga o sino de D');

  perform pg_temp.deny(
    $q$insert into public.notifications (user_id, type, title)
       values ('0a000000-0000-4000-8000-00000000000a','trip_invite','forjada')$q$,
    'ninguém insere notificação para outra pessoa');
  perform pg_temp.deny(
    $q$insert into public.notifications (user_id, type, title)
       values ('0b000000-0000-4000-8000-00000000000b','trip_invite','forjada para mim')$q$,
    'ninguém insere notificação nem para si');

  begin
    perform public.notify('0a000000-0000-4000-8000-00000000000a', 'trip_invite', 'forjada');
    raise exception 'FALHOU: notify() é chamável pelo cliente';
  exception
    when insufficient_privilege then raise notice '  OK   notify() não é chamável pelo cliente';
  end;

  update public.notifications
     set read_at = coalesce(read_at, now())
   where id = 'd1000000-0000-4000-8000-000000000001';
  perform pg_temp.check(
    (select read_at is not null from public.notifications
      where id = 'd1000000-0000-4000-8000-000000000001'),
    'dono marca read_at da própria notificação');

  perform pg_temp.deny(
    $q$update public.notifications set title = 'Título forjado'
        where id = 'd1000000-0000-4000-8000-000000000001'$q$,
    'dono não reescreve title da própria notificação');
  perform pg_temp.deny(
    $q$update public.notifications set data = '{"forged":true}'::jsonb
        where id = 'd1000000-0000-4000-8000-000000000001'$q$,
    'dono não reescreve data da própria notificação');
  perform pg_temp.deny(
    $q$update public.notifications set type = 'trip_member_removed'
        where id = 'd1000000-0000-4000-8000-000000000001'$q$,
    'dono não reescreve type da própria notificação');
  perform pg_temp.deny(
    $q$update public.notifications set created_at = now()
        where id = 'd1000000-0000-4000-8000-000000000001'$q$,
    'dono não reescreve created_at da própria notificação');

  perform pg_temp.as_postgres();
  perform pg_temp.check(
    not has_table_privilege('authenticated', 'public.notifications', 'update')
      and has_column_privilege('authenticated', 'public.notifications', 'read_at', 'update'),
    'authenticated tem UPDATE somente em notifications.read_at');
  perform pg_temp.check(
    has_table_privilege('service_role', 'public.notifications', 'update'),
    'service_role conserva UPDATE completo em notifications');
end;
$$;

-- ============================================= §31 — lembretes são por pessoa
do $$
declare
  entregues integer;
begin
  raise notice '§31 lembretes';

  perform pg_temp.as_user('0b000000-0000-4000-8000-00000000000b');
  insert into public.reminders (user_id, trip_id, entity_type, entity_id, anchor, remind_at, title)
  values ('0b000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-000000000001',
          'trip', 'a1000000-0000-4000-8000-000000000001', 'start', now() - interval '1 minute',
          'Check-in amanhã');
  perform pg_temp.check(true, 'EDITOR_B cria o próprio lembrete');

  perform pg_temp.deny(
    $q$insert into public.reminders (user_id, trip_id, entity_type, entity_id, anchor, remind_at, title)
       values ('0a000000-0000-4000-8000-00000000000a','a1000000-0000-4000-8000-000000000001',
               'trip','a1000000-0000-4000-8000-000000000001','start', now(), 'Lembrete alheio')$q$,
    'B não cria lembrete no nome de A');

  select public.deliver_due_reminders() into entregues;
  perform pg_temp.check(entregues = 1, 'lembrete vencido vira notificação');
  select public.deliver_due_reminders() into entregues;
  perform pg_temp.check(entregues = 0, 'o mesmo lembrete não é entregue duas vezes');

  perform pg_temp.as_user('0a000000-0000-4000-8000-00000000000a');
  perform pg_temp.check(
    (select count(*) from public.notifications where type = 'trip_reminder') = 0,
    'A não recebe o lembrete que B ativou');

  begin
    perform public.deliver_due_reminders('0b000000-0000-4000-8000-00000000000b');
    raise exception 'FALHOU: A entregou lembretes de B';
  exception
    when insufficient_privilege then raise notice '  OK   ninguém entrega lembrete de outra conta';
  end;

  perform pg_temp.as_postgres();
end;
$$;

-- ============================================= §48 — sugestões
do $$
declare
  primeira record;
  segunda record;
  do_owner record;
  conteudo_antes jsonb;
  conteudo_depois jsonb;
begin
  raise notice '§48 sugestões';

  perform pg_temp.as_user('0b000000-0000-4000-8000-00000000000b');
  insert into public.trip_suggestions (trip_id, title, category, description, source)
  values ('a1000000-0000-4000-8000-000000000001', 'Museu do Louvre', 'atracoes',
          'Um dos principais museus de Paris.', 'ai');
  perform pg_temp.check(true, 'EDITOR_B cria sugestão');

  -- É o alvo enviado pelo PostgREST no upsert. Um índice direto em
  -- lower(title) não pode ser nomeado por `on_conflict` e devolvia 23505.
  insert into public.trip_suggestions (trip_id, title, category, description, source)
  values ('a1000000-0000-4000-8000-000000000001', 'museu do louvre', 'atracoes',
          'Duplicata apenas para validar o conflito.', 'ai')
  on conflict (trip_id, title_key) do nothing;
  perform pg_temp.check(
    (select count(*) from public.trip_suggestions
      where trip_id = 'a1000000-0000-4000-8000-000000000001'
        and title_key = 'museu do louvre') = 1,
    'upsert ignora título duplicado sem diferenciar maiúsculas');

  select coalesce(jsonb_agg(to_jsonb(s) order by s.id), '[]'::jsonb)
    into conteudo_antes
    from public.trip_suggestions s
   where s.trip_id = 'a1000000-0000-4000-8000-000000000001';

  perform pg_temp.as_user('0c000000-0000-4000-8000-00000000000c');
  perform pg_temp.check(
    (select count(*) from public.trip_suggestions
      where trip_id = 'a1000000-0000-4000-8000-000000000001') = 1,
    'VIEWER_C vê as sugestões');
  perform pg_temp.deny(
    $q$delete from public.trip_suggestions
        where trip_id = 'a1000000-0000-4000-8000-000000000001'$q$,
    'VIEWER_C não apaga sugestão');
  begin
    perform public.claim_trip_suggestion_refresh(
      'a1000000-0000-4000-8000-000000000001');
    raise exception 'FALHOU: VIEWER_C reivindicou refresh';
  exception
    when insufficient_privilege then
      raise notice '  OK   VIEWER_C não reivindica refresh';
  end;

  perform pg_temp.as_user('0b000000-0000-4000-8000-00000000000b');
  select * into primeira from public.claim_trip_suggestion_refresh(
    'a1000000-0000-4000-8000-000000000001');
  perform pg_temp.check(
    primeira.claimed and primeira.refreshed_at is not null,
    'EDITOR_B reivindica a janela de refresh');

  select * into segunda from public.claim_trip_suggestion_refresh(
    'a1000000-0000-4000-8000-000000000001');
  perform pg_temp.check(
    not segunda.claimed and segunda.refreshed_at = primeira.refreshed_at,
    'segunda claim imediata é recusada sem mover timestamp');

  perform pg_temp.as_user('0d000000-0000-4000-8000-00000000000d');
  perform pg_temp.check(
    (select count(*) from public.trip_suggestions
      where trip_id = 'a1000000-0000-4000-8000-000000000001') = 0,
    'ex-membro D não vê mais as sugestões');
  begin
    perform public.claim_trip_suggestion_refresh(
      'a1000000-0000-4000-8000-000000000001');
    raise exception 'FALHOU: ex-membro D reivindicou refresh';
  exception
    when insufficient_privilege then
      raise notice '  OK   ex-membro D não reivindica refresh';
  end;

  -- Reabre a janela como operação de teste server-side, para provar que owner
  -- e editor são ambos autorizados sem esperar seis horas reais.
  perform pg_temp.as_postgres();
  update public.trips
     set suggestions_refreshed_at = now() - interval '7 hours'
   where id = 'a1000000-0000-4000-8000-000000000001';

  perform pg_temp.as_user('0a000000-0000-4000-8000-00000000000a');
  select * into do_owner from public.claim_trip_suggestion_refresh(
    'a1000000-0000-4000-8000-000000000001');
  perform pg_temp.check(
    do_owner.claimed and do_owner.refreshed_at > now() - interval '1 minute',
    'OWNER_A reivindica a janela quando ela reabre');

  -- Nem owner pode adulterar/backdatear a marca d'água pelo REST; a única
  -- porta autenticada é o CAS acima. Os demais campos editáveis da viagem
  -- continuam funcionando com o grant por coluna.
  perform pg_temp.deny(
    $q$update public.trips
          set suggestions_refreshed_at = now() - interval '7 hours'
        where id = 'a1000000-0000-4000-8000-000000000001'$q$,
    'OWNER_A não adultera a marca d''água diretamente');
  update public.trips
     set budget_total = 12001,
         updated_at = now()
   where id = 'a1000000-0000-4000-8000-000000000001';
  perform pg_temp.check(
    (select budget_total from public.trips
      where id = 'a1000000-0000-4000-8000-000000000001') = 12001,
    'grant por coluna preserva edição legítima da viagem');

  select coalesce(jsonb_agg(to_jsonb(s) order by s.id), '[]'::jsonb)
    into conteudo_depois
    from public.trip_suggestions s
   where s.trip_id = 'a1000000-0000-4000-8000-000000000001';
  perform pg_temp.check(
    conteudo_depois = conteudo_antes,
    'claims alteram somente a marca d''água, nunca o conteúdo das sugestões');

  perform pg_temp.as_postgres();
  perform pg_temp.check(
    not has_column_privilege(
      'authenticated', 'public.trips', 'suggestions_refreshed_at', 'update'),
    'authenticated não atualiza suggestions_refreshed_at diretamente');
  perform pg_temp.check(
    has_table_privilege('service_role', 'public.trips', 'update'),
    'service_role conserva UPDATE completo em trips');
end;
$$;

do $$ begin raise notice 'Matriz de colaboração: tudo verde.'; end $$;

-- ==================================== §51/§52 — quem saiu da viagem
do $$
declare
  removidos integer;
begin
  raise notice '§51 conteúdo de ex-membro';

  perform pg_temp.as_postgres();

  -- B cria conteúdo compartilhado e conteúdo privado, e depois é removido.
  insert into public.checklist_items (id, trip_id, label, category, visibility, created_by)
  values ('c4000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001',
          'Adaptador de tomada', 'mala', 'shared', '0b000000-0000-4000-8000-00000000000b'),
         ('c4000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001',
          'Remédio do Bruno', 'saude', 'private', '0b000000-0000-4000-8000-00000000000b')
  on conflict (id) do nothing;

  -- D já saiu e nunca criou esta linha. Seu nome só deve entrar no mapa por
  -- ser `paid_by` de uma despesa compartilhada; a autoria continua sendo A.
  insert into public.expenses
    (id, trip_id, user_id, category, amount, currency, transaction_date, description,
     visibility, created_by, paid_by)
  values
    ('c3000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001',
     '0a000000-0000-4000-8000-00000000000a', 'outros', 12, 'EUR', '2026-08-26',
     'Despesa paga por ex-membro', 'shared', '0a000000-0000-4000-8000-00000000000a',
     '0d000000-0000-4000-8000-00000000000d')
  on conflict (id) do nothing;

  perform pg_temp.as_user('0a000000-0000-4000-8000-00000000000a');
  perform public.remove_trip_member(
    'a1000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-00000000000b');

  -- O compartilhado FICA e continua legível pelo grupo.
  perform pg_temp.check(
    (select count(*) from public.checklist_items
      where id = 'c4000000-0000-4000-8000-000000000001') = 1,
    'item compartilhado do ex-membro permanece na viagem');

  -- O privado dele NÃO vira visível para o proprietário.
  perform pg_temp.check(
    (select count(*) from public.checklist_items
      where id = 'c4000000-0000-4000-8000-000000000002') = 0,
    'privado do ex-membro NÃO é entregue ao proprietário');

  -- E ele próprio perdeu o acesso à viagem inteira.
  perform pg_temp.as_user('0b000000-0000-4000-8000-00000000000b');
  perform pg_temp.check(
    (select count(*) from public.trips where id = 'a1000000-0000-4000-8000-000000000001') = 0,
    'ex-membro perde acesso à viagem imediatamente');
  perform pg_temp.check(
    (select count(*) from public.checklist_items
      where id = 'c4000000-0000-4000-8000-000000000002') = 0,
    'ex-membro também não alcança mais o próprio privado daquela viagem');

  -- A autoria histórica sobrevive, para "Adicionado por Bruno" continuar certo.
  perform pg_temp.as_postgres();
  perform pg_temp.check(
    (select created_by from public.checklist_items
      where id = 'c4000000-0000-4000-8000-000000000001')
      = '0b000000-0000-4000-8000-00000000000b',
    'autoria histórica preservada depois da saída');

  perform pg_temp.as_user('0a000000-0000-4000-8000-00000000000a');
  perform pg_temp.check(
    (select count(*) from public.trip_member_profiles(
       'a1000000-0000-4000-8000-000000000001')
      where user_id = '0b000000-0000-4000-8000-00000000000b' and name = 'Bruno') = 1,
    'mapa de nomes mantém autor de shared após remoção');
  perform pg_temp.check(
    (select count(*) from public.trip_member_profiles(
       'a1000000-0000-4000-8000-000000000001')
      where user_id = '0d000000-0000-4000-8000-00000000000d' and name = 'Davi') = 1,
    'mapa de nomes inclui paid_by histórico de shared');
  perform pg_temp.check(
    (select count(*) from public.trip_members
      where trip_id = 'a1000000-0000-4000-8000-000000000001'
        and user_id in ('0b000000-0000-4000-8000-00000000000b',
                        '0d000000-0000-4000-8000-00000000000d')) = 0,
    'ex-autores no mapa não reaparecem na lista ativa');

  perform pg_temp.as_user('0b000000-0000-4000-8000-00000000000b');
  perform pg_temp.check(
    (select count(*) from public.trip_member_profiles(
       'a1000000-0000-4000-8000-000000000001')) = 0,
    'ex-membro não recebe o mapa de nomes da viagem');

  -- A limpeza deliberada remove o que ficou inalcançável — e só isso.
  --
  -- B deixou para trás três registros privados nesta viagem: o diário, a
  -- despesa da farmácia e o item de checklist criado acima. Os três são
  -- inalcançáveis desde a remoção; a limpeza os apaga de uma vez.
  perform pg_temp.as_postgres();
  select sum(t.removidos) into removidos
    from public.purge_unreachable_private_content('a1000000-0000-4000-8000-000000000001') t;
  perform pg_temp.check(removidos = 3, 'limpeza remove os três privados órfãos de B');

  perform pg_temp.check(
    (select count(*) from public.checklist_items
      where id = 'c4000000-0000-4000-8000-000000000002') = 0,
    'o privado órfão saiu do banco');

  perform pg_temp.check(
    (select count(*) from public.checklist_items
      where id = 'c4000000-0000-4000-8000-000000000001') = 1,
    'a limpeza NÃO toca no conteúdo compartilhado');

  -- E o privado de quem CONTINUA na viagem fica intocado.
  perform pg_temp.check(
    (select count(*) from public.journal_entries
      where id = 'c2000000-0000-4000-8000-000000000001') = 1,
    'a limpeza NÃO toca no privado de quem continua membro');

  -- A despesa COMPARTILHADA que B criou também fica: ela é da viagem (§52).
  perform pg_temp.check(
    (select count(*) from public.expenses
      where id = 'c3000000-0000-4000-8000-000000000001') = 1,
    'despesa compartilhada do ex-membro permanece');

  perform pg_temp.as_postgres();
end;
$$;

do $$ begin raise notice 'Matriz de colaboração (com ex-membros): tudo verde.'; end $$;
