-- =============================================================================
-- Transferência de propriedade e guarda de exclusão de conta (0014)
--
-- Quatro identidades e uma viagem, como na suíte de colaboração:
--
--   OWNER_A     dono inicial
--   EDITOR_B    membro aceito, editor        → destino legítimo da transferência
--   VIEWER_C    membro aceito, viewer        → também legítimo
--   OUTSIDER_D  não participa                → nunca pode receber
--   INVITEE_E   convite PENDENTE, sem aceitar → nunca pode receber
--
-- As duas asserções que mais importam:
--
--   · depois da transferência o ANTIGO dono deixa de ser dono — e isso só é
--     verdade se `trips.user_id` tiver sido gravado junto com `trip_members`.
--     Um teste que olhasse só `trip_members` passaria com a transferência
--     quebrada, porque `is_trip_owner` tem duas pernas (0008).
--
--   · o novo dono NÃO passa a ver o conteúdo privado de ninguém. Propriedade e
--     privacidade são eixos separados (0009), e transferir uma não move a outra.
--
-- Rodar contra um banco descartável, depois de 0001–0014:
--   ./scripts/sql-test.sh
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

-- A chamada tem de ser recusada. Sucesso silencioso aqui é o pior resultado
-- possível: significa que a viagem mudou de dono sem direito.
create or replace function pg_temp.deny_call(comando text, label text)
returns void language plpgsql as $$
begin
  execute comando;
  raise exception 'FALHOU: % — a chamada foi aceita', label;
exception
  when insufficient_privilege or invalid_parameter_value or no_data_found then
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
  ('0a000000-0000-4000-8000-0000000000aa', 'transfer.a@easytrip.app'),
  ('0b000000-0000-4000-8000-0000000000bb', 'transfer.b@easytrip.app'),
  ('0c000000-0000-4000-8000-0000000000cc', 'transfer.c@easytrip.app'),
  ('0d000000-0000-4000-8000-0000000000dd', 'transfer.d@easytrip.app'),
  ('0e000000-0000-4000-8000-0000000000ee', 'transfer.e@easytrip.app')
on conflict (id) do nothing;

insert into public.profiles (user_id, name) values
  ('0a000000-0000-4000-8000-0000000000aa', 'Alice'),
  ('0b000000-0000-4000-8000-0000000000bb', 'Bento'),
  ('0c000000-0000-4000-8000-0000000000cc', 'Célia'),
  ('0d000000-0000-4000-8000-0000000000dd', 'Dante'),
  ('0e000000-0000-4000-8000-0000000000ee', 'Elis')
on conflict (user_id) do update set name = excluded.name;

-- Viagem principal. O trigger `on_trip_created` (0008) já insere OWNER_A como
-- `owner` em `trip_members`; não repetimos isso aqui de propósito, para que o
-- teste exercite o mesmo caminho que a aplicação.
insert into public.trips
  (id, user_id, destination_city, destination_country, country_code, timezone,
   start_date, end_date, budget_total, budget_currency)
values
  ('11110000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-0000000000aa',
   'Lisboa', 'Portugal', 'PT', 'Europe/Lisbon',
   current_date + 30, current_date + 40, 8000, 'BRL')
on conflict (id) do nothing;

insert into public.trip_members (trip_id, user_id, role) values
  ('11110000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-0000000000bb', 'editor'),
  ('11110000-0000-4000-8000-000000000001', '0c000000-0000-4000-8000-0000000000cc', 'viewer')
on conflict (trip_id, user_id) do update set role = excluded.role;

-- Convite PENDENTE para INVITEE_E: existe, mas não cria membro.
insert into public.trip_invites (trip_id, invited_user_id, invited_by, role, status)
values ('11110000-0000-4000-8000-000000000001',
        '0e000000-0000-4000-8000-0000000000ee',
        '0a000000-0000-4000-8000-0000000000aa', 'editor', 'pending')
on conflict do nothing;

-- Conteúdo privado de cada um, para medir que a transferência não o move.
insert into public.expenses
  (id, trip_id, user_id, amount, currency, category, description, transaction_date,
   visibility, created_by)
values
  ('22220000-0000-4000-8000-000000000001', '11110000-0000-4000-8000-000000000001',
   '0b000000-0000-4000-8000-0000000000bb', 120, 'BRL', 'alimentacao', 'jantar do Bento',
   current_date, 'private', '0b000000-0000-4000-8000-0000000000bb'),
  ('22220000-0000-4000-8000-000000000002', '11110000-0000-4000-8000-000000000001',
   '0a000000-0000-4000-8000-0000000000aa', 90, 'BRL', 'alimentacao', 'almoço da Alice',
   current_date, 'private', '0a000000-0000-4000-8000-0000000000aa')
on conflict (id) do nothing;

-- =============================================================================
-- 1. Quem NÃO pode transferir
-- =============================================================================
do $$
begin
  raise notice '--- 1. recusas ---';

  -- EDITOR_B não é dono.
  perform pg_temp.as_user('0b000000-0000-4000-8000-0000000000bb');
  perform pg_temp.deny_call(
    $q$ select public.transfer_trip_ownership(
          '11110000-0000-4000-8000-000000000001',
          '0c000000-0000-4000-8000-0000000000cc') $q$,
    'editor não transfere a viagem');

  -- VIEWER_C muito menos.
  perform pg_temp.as_user('0c000000-0000-4000-8000-0000000000cc');
  perform pg_temp.deny_call(
    $q$ select public.transfer_trip_ownership(
          '11110000-0000-4000-8000-000000000001',
          '0c000000-0000-4000-8000-0000000000cc') $q$,
    'viewer não transfere a viagem para si');

  -- OUTSIDER_D não enxerga a viagem sequer.
  perform pg_temp.as_user('0d000000-0000-4000-8000-0000000000dd');
  perform pg_temp.deny_call(
    $q$ select public.transfer_trip_ownership(
          '11110000-0000-4000-8000-000000000001',
          '0d000000-0000-4000-8000-0000000000dd') $q$,
    'estranho não transfere a viagem para si');

  perform pg_temp.as_postgres();
end;
$$;

-- =============================================================================
-- 2. Para quem NÃO se pode transferir
-- =============================================================================
do $$
begin
  raise notice '--- 2. destinos inválidos ---';
  perform pg_temp.as_user('0a000000-0000-4000-8000-0000000000aa');

  -- Estranho: não tem linha em `trip_members`.
  perform pg_temp.deny_call(
    $q$ select public.transfer_trip_ownership(
          '11110000-0000-4000-8000-000000000001',
          '0d000000-0000-4000-8000-0000000000dd') $q$,
    'não transfere para quem não participa');

  -- Convite pendente: também não tem linha em `trip_members`. É a asserção que
  -- prova que "convidado" e "membro" são coisas diferentes para esta função.
  perform pg_temp.deny_call(
    $q$ select public.transfer_trip_ownership(
          '11110000-0000-4000-8000-000000000001',
          '0e000000-0000-4000-8000-0000000000ee') $q$,
    'não transfere para convite ainda não aceito');

  -- Para si mesmo.
  perform pg_temp.deny_call(
    $q$ select public.transfer_trip_ownership(
          '11110000-0000-4000-8000-000000000001',
          '0a000000-0000-4000-8000-0000000000aa') $q$,
    'não transfere para si mesmo');

  -- Usuário inexistente.
  perform pg_temp.deny_call(
    $q$ select public.transfer_trip_ownership(
          '11110000-0000-4000-8000-000000000001',
          '00000000-0000-4000-8000-000000000999') $q$,
    'não transfere para uuid inexistente');

  perform pg_temp.as_postgres();
end;
$$;

-- =============================================================================
-- 3. A guarda de exclusão de conta, ANTES da transferência
-- =============================================================================
do $$
declare
  n integer;
  outros integer;
begin
  raise notice '--- 3. bloqueios de exclusão (antes) ---';

  perform pg_temp.as_user('0a000000-0000-4000-8000-0000000000aa');
  select count(*) into n from public.account_deletion_blockers();
  perform pg_temp.check(n = 1, 'dono de viagem compartilhada é bloqueado');
  select other_members into outros from public.account_deletion_blockers() limit 1;
  perform pg_temp.check(outros = 2, 'a viagem bloqueadora conta 2 outros membros');

  -- Membro não-dono não é bloqueado: a conta dele pode ir embora sem levar a
  -- viagem junto, porque a cascata segue `trips.user_id`, não `trip_members`.
  perform pg_temp.as_user('0b000000-0000-4000-8000-0000000000bb');
  select count(*) into n from public.account_deletion_blockers();
  perform pg_temp.check(n = 0, 'editor não é bloqueado');

  perform pg_temp.as_user('0d000000-0000-4000-8000-0000000000dd');
  select count(*) into n from public.account_deletion_blockers();
  perform pg_temp.check(n = 0, 'quem não participa de nada não é bloqueado');

  perform pg_temp.as_postgres();
end;
$$;

-- Viagem solo: pertence só a OWNER_A, sem outros membros. NÃO deve bloquear.
insert into public.trips
  (id, user_id, destination_city, destination_country, country_code, timezone,
   start_date, end_date, budget_total, budget_currency)
values
  ('11110000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-0000000000aa',
   'Sozinha', 'Brasil', 'BR', 'America/Sao_Paulo',
   current_date + 5, current_date + 6, 100, 'BRL')
on conflict (id) do nothing;

do $$
declare n integer;
begin
  perform pg_temp.as_user('0a000000-0000-4000-8000-0000000000aa');
  select count(*) into n from public.account_deletion_blockers();
  perform pg_temp.check(n = 1, 'viagem sem outros membros não entra na lista de bloqueio');
  perform pg_temp.as_postgres();
end;
$$;

-- =============================================================================
-- 4. A transferência em si
-- =============================================================================
do $$
declare
  devolvido public.trip_members;
begin
  raise notice '--- 4. transferência ---';

  perform pg_temp.as_user('0a000000-0000-4000-8000-0000000000aa');
  select * into devolvido from public.transfer_trip_ownership(
    '11110000-0000-4000-8000-000000000001',
    '0b000000-0000-4000-8000-0000000000bb');

  perform pg_temp.check(devolvido.user_id = '0b000000-0000-4000-8000-0000000000bb',
    'a função devolve a linha do novo proprietário');
  perform pg_temp.check(devolvido.role = 'owner',
    'a linha devolvida tem papel owner');

  perform pg_temp.as_postgres();
end;
$$;

do $$
declare
  dono_trips uuid;
  papel_a    text;
  papel_b    text;
  donos      integer;
  convite    text;
begin
  raise notice '--- 5. estado depois da transferência ---';

  select user_id into dono_trips from public.trips
   where id = '11110000-0000-4000-8000-000000000001';
  -- ESTA é a asserção que pega uma transferência pela metade.
  perform pg_temp.check(dono_trips = '0b000000-0000-4000-8000-0000000000bb',
    'trips.user_id passou para o novo proprietário');

  select role into papel_b from public.trip_members
   where trip_id = '11110000-0000-4000-8000-000000000001'
     and user_id = '0b000000-0000-4000-8000-0000000000bb';
  perform pg_temp.check(papel_b = 'owner', 'novo proprietário é owner em trip_members');

  select role into papel_a from public.trip_members
   where trip_id = '11110000-0000-4000-8000-000000000001'
     and user_id = '0a000000-0000-4000-8000-0000000000aa';
  perform pg_temp.check(papel_a = 'editor', 'antigo proprietário foi rebaixado a editor');
  perform pg_temp.check(papel_a is not null, 'antigo proprietário continua na viagem');

  select count(*) into donos from public.trip_members
   where trip_id = '11110000-0000-4000-8000-000000000001' and role = 'owner';
  perform pg_temp.check(donos = 1, 'a viagem tem exatamente um proprietário');

  select status into convite from public.trip_invites
   where trip_id = '11110000-0000-4000-8000-000000000001'
     and invited_user_id = '0e000000-0000-4000-8000-0000000000ee';
  perform pg_temp.check(convite = 'pending',
    'convite pendente de terceiro não é afetado pela transferência');
end;
$$;

-- =============================================================================
-- 6. Os privilégios efetivamente mudaram de lado
-- =============================================================================
do $$
declare
  b_owner boolean;
  a_owner boolean;
  a_edita  boolean;
begin
  raise notice '--- 6. privilégios ---';

  perform pg_temp.as_user('0b000000-0000-4000-8000-0000000000bb');
  select public.is_trip_owner('11110000-0000-4000-8000-000000000001') into b_owner;
  perform pg_temp.check(b_owner, 'novo proprietário passa em is_trip_owner');

  perform pg_temp.as_user('0a000000-0000-4000-8000-0000000000aa');
  select public.is_trip_owner('11110000-0000-4000-8000-000000000001') into a_owner;
  -- Sem o UPDATE em `trips.user_id`, esta asserção falha: a segunda perna de
  -- `is_trip_owner` continuaria respondendo sim para a Alice.
  perform pg_temp.check(not a_owner, 'antigo proprietário NÃO passa mais em is_trip_owner');

  select public.can_edit_trip('11110000-0000-4000-8000-000000000001') into a_edita;
  perform pg_temp.check(a_edita, 'antigo proprietário continua podendo editar conteúdo');

  perform pg_temp.as_postgres();
end;
$$;

do $$
begin
  raise notice '--- 7. o antigo dono perdeu a gerência ---';

  perform pg_temp.as_user('0a000000-0000-4000-8000-0000000000aa');
  perform pg_temp.deny_call(
    $q$ select public.set_trip_member_role(
          '11110000-0000-4000-8000-000000000001',
          '0c000000-0000-4000-8000-0000000000cc', 'editor') $q$,
    'antigo proprietário não muda mais o papel de ninguém');
  perform pg_temp.deny_call(
    $q$ select public.remove_trip_member(
          '11110000-0000-4000-8000-000000000001',
          '0c000000-0000-4000-8000-0000000000cc') $q$,
    'antigo proprietário não remove mais viajantes');
  perform pg_temp.deny_call(
    $q$ select public.transfer_trip_ownership(
          '11110000-0000-4000-8000-000000000001',
          '0c000000-0000-4000-8000-0000000000cc') $q$,
    'antigo proprietário não transfere de novo');

  perform pg_temp.as_postgres();
end;
$$;

-- =============================================================================
-- 8. Privacidade: a transferência NÃO move conteúdo privado
-- =============================================================================
do $$
declare
  visiveis integer;
begin
  raise notice '--- 8. privacidade ---';

  -- O novo dono continua sem ver a despesa privada da Alice.
  perform pg_temp.as_user('0b000000-0000-4000-8000-0000000000bb');
  select count(*) into visiveis from public.expenses
   where id = '22220000-0000-4000-8000-000000000002';
  perform pg_temp.check(visiveis = 0,
    'novo proprietário NÃO vê a despesa privada do antigo');

  select count(*) into visiveis from public.expenses
   where id = '22220000-0000-4000-8000-000000000001';
  perform pg_temp.check(visiveis = 1, 'novo proprietário vê a própria despesa privada');

  -- E o antigo dono continua vendo a sua, e não a do outro.
  perform pg_temp.as_user('0a000000-0000-4000-8000-0000000000aa');
  select count(*) into visiveis from public.expenses
   where id = '22220000-0000-4000-8000-000000000002';
  perform pg_temp.check(visiveis = 1, 'antigo proprietário continua vendo a própria despesa privada');

  select count(*) into visiveis from public.expenses
   where id = '22220000-0000-4000-8000-000000000001';
  perform pg_temp.check(visiveis = 0,
    'antigo proprietário nunca viu a despesa privada do outro, e continua sem ver');

  -- `created_by` não foi reescrito por ninguém.
  perform pg_temp.as_postgres();
  select count(*) into visiveis from public.expenses
   where id = '22220000-0000-4000-8000-000000000001'
     and created_by = '0b000000-0000-4000-8000-0000000000bb';
  perform pg_temp.check(visiveis = 1, 'created_by das despesas não foi alterado');
end;
$$;

-- =============================================================================
-- 9. A guarda de exclusão DEPOIS da transferência
-- =============================================================================
do $$
declare
  n integer;
begin
  raise notice '--- 9. bloqueios de exclusão (depois) ---';

  -- Alice deixou de ser dona da viagem compartilhada: nada mais a bloqueia.
  -- A viagem solo dela nunca bloqueou.
  perform pg_temp.as_user('0a000000-0000-4000-8000-0000000000aa');
  select count(*) into n from public.account_deletion_blockers();
  perform pg_temp.check(n = 0,
    'quem transferiu deixa de ser bloqueado para excluir a conta');

  -- E o bloqueio passou para o Bento, que agora é o dono.
  perform pg_temp.as_user('0b000000-0000-4000-8000-0000000000bb');
  select count(*) into n from public.account_deletion_blockers();
  perform pg_temp.check(n = 1, 'o novo proprietário passa a ser bloqueado');

  perform pg_temp.as_postgres();
end;
$$;

-- =============================================================================
-- 10. `leave_trip` depois da transferência
-- =============================================================================
do $$
declare
  ainda integer;
begin
  raise notice '--- 10. saída ---';

  -- Alice agora é editora, então pode sair — o que antes da transferência era
  -- proibido para ela.
  perform pg_temp.as_user('0a000000-0000-4000-8000-0000000000aa');
  perform public.leave_trip('11110000-0000-4000-8000-000000000001');
  perform pg_temp.as_postgres();

  select count(*) into ainda from public.trip_members
   where trip_id = '11110000-0000-4000-8000-000000000001'
     and user_id = '0a000000-0000-4000-8000-0000000000aa';
  perform pg_temp.check(ainda = 0, 'ex-proprietário consegue sair depois de transferir');

  -- O novo dono continua sem poder sair.
  perform pg_temp.as_user('0b000000-0000-4000-8000-0000000000bb');
  perform pg_temp.deny_call(
    $q$ select public.leave_trip('11110000-0000-4000-8000-000000000001') $q$,
    'novo proprietário não pode sair da viagem');
  perform pg_temp.as_postgres();
end;
$$;

-- =============================================================================
-- 11. `anon` não alcança nenhuma das duas funções
-- =============================================================================
do $$
begin
  raise notice '--- 11. anon ---';
  perform pg_temp.check(
    not has_function_privilege('anon', 'public.transfer_trip_ownership(uuid, uuid)', 'execute'),
    'anon não pode executar transfer_trip_ownership');
  perform pg_temp.check(
    not has_function_privilege('anon', 'public.account_deletion_blockers()', 'execute'),
    'anon não pode executar account_deletion_blockers');
  perform pg_temp.check(
    has_function_privilege('authenticated', 'public.transfer_trip_ownership(uuid, uuid)', 'execute'),
    'authenticated pode executar transfer_trip_ownership');
end;
$$;

do $$ begin raise notice 'ownership_transfer.test.sql — todas as asserções passaram'; end; $$;
