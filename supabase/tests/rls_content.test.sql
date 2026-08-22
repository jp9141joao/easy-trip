-- =============================================================================
-- F3 / D-06 — Ofertas e Especialistas: leitura filtrada, escrita só de admin
--
-- Vale o mesmo princípio do teste de P-01: cada cenário assume a identidade de
-- um usuário do jeito que o PostgREST monta (papel `authenticated` + claim
-- `sub`) e fala com a tabela direto. Nenhuma linha de aplicativo participa —
-- o que passa ou não passa aqui é a policy, não a consulta.
--
-- Não basta conferir que a condição SQL da policy é verdadeira: os cenários de
-- escrita executam INSERT/UPDATE/DELETE de verdade e medem o efeito real
-- (exceção levantada, ou zero linhas atingidas).
--
-- Rodar contra um banco descartável:
--   psql -f supabase/tests/_local_bootstrap.sql
--   psql -f supabase/migrations/0001_schema.sql
--   psql -f supabase/migrations/0002_rls.sql
--   psql -f supabase/migrations/0003_admin_roles.sql
--   psql -f supabase/migrations/0004_content_publishing.sql
--   psql -f supabase/migrations/0005_grants.sql
--   psql -f supabase/tests/rls_content.test.sql
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

-- ---------------------------------------------------------------- preparação
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'comum@easytrip.app'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'admin@easytrip.app')
on conflict (id) do nothing;

update public.profiles set role = 'admin'
 where user_id = 'bbbbbbbb-0000-4000-8000-000000000002';

-- Quatro ofertas cobrindo as quatro razões possíveis de aparecer ou não:
-- publicada e vigente, rascunho, vencida, e ainda não começada.
insert into public.offers
  (id, destination, description, cost_level, image_url, status, sort_order, active_from, active_until)
values
  ('11111111-0000-4000-8000-000000000001', 'Lisboa',  'vigente',   'economy',  'https://x/1', 'published', 10, null, null),
  ('11111111-0000-4000-8000-000000000002', 'Roma',    'rascunho',  'moderate', 'https://x/2', 'draft',     20, null, null),
  ('11111111-0000-4000-8000-000000000003', 'Oslo',    'vencida',   'luxury',   'https://x/3', 'published', 30, null, current_date - 1),
  ('11111111-0000-4000-8000-000000000004', 'Hanói',   'futura',    'economy',  'https://x/4', 'published', 40, current_date + 1, null)
on conflict (id) do nothing;

insert into public.advisors (id, name, specialty, status, active) values
  ('22222222-0000-4000-8000-000000000001', 'Ativa Silva',   'Europa',      'offline', true),
  ('22222222-0000-4000-8000-000000000002', 'Inativo Souza', 'Corporativo', 'online',  false)
on conflict (id) do nothing;

-- Confere o ponto que mais importa do bloco de preparação: as colunas nasceram
-- com o valor que preserva o conteúdo já existente.
select pg_temp.check(
  (select count(*) from public.offers where status = 'published') = 3
  and (select count(*) from public.advisors where active) = 1,
  'preparação: defaults preservam o conteúdo atual (published / active)'
);

-- =============================================================================
-- CONTA COMUM
-- =============================================================================
set role authenticated;
set request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

do $$ begin raise notice 'Ofertas — conta comum'; end $$;

-- A — lê a oferta válida
select pg_temp.check(
  (select count(*) from public.offers where destination = 'Lisboa') = 1,
  'A/ofertas: conta comum lê oferta publicada e vigente'
);

-- B — não enxerga o que não deveria estar público.
-- Sem `where` nenhum: é o que uma chamada crua a /rest/v1/offers faz.
select pg_temp.check(
  (select count(*) from public.offers) = 1,
  'B/ofertas: `select * from offers` devolve só a publicada e vigente'
);
select pg_temp.check(
  (select count(*) from public.offers where status = 'draft') = 0,
  'B/ofertas: rascunho invisível'
);
select pg_temp.check(
  (select count(*) from public.offers where destination = 'Oslo') = 0,
  'B/ofertas: oferta vencida invisível'
);
select pg_temp.check(
  (select count(*) from public.offers where destination = 'Hanói') = 0,
  'B/ofertas: oferta agendada para o futuro invisível'
);

-- C — não insere
do $$
declare
  aconteceu boolean := false;
begin
  begin
    insert into public.offers (destination, description, cost_level, image_url)
    values ('Pirata', 'inserida por conta comum', 'economy', 'https://x/9');
    aconteceu := true;
  exception when insufficient_privilege then
    null; -- 42501: a policy recusou, que é o esperado
  end;
  perform pg_temp.check(not aconteceu, 'C/ofertas: conta comum NÃO insere');
end;
$$;

-- D — não edita. A oferta é visível para ela, então o que barra o UPDATE é a
-- ausência de policy de escrita, e não o filtro de leitura.
do $$
declare
  atingidas integer;
begin
  update public.offers set description = 'sequestrada' where destination = 'Lisboa';
  get diagnostics atingidas = row_count;
  perform pg_temp.check(atingidas = 0, 'D/ofertas: conta comum NÃO edita (0 linhas)');
  perform pg_temp.check(
    (select description from public.offers where destination = 'Lisboa') = 'vigente',
    'D/ofertas: conteúdo permanece intacto'
  );
end;
$$;

-- E — não exclui
do $$
declare
  atingidas integer;
begin
  delete from public.offers where destination = 'Lisboa';
  get diagnostics atingidas = row_count;
  perform pg_temp.check(atingidas = 0, 'E/ofertas: conta comum NÃO exclui (0 linhas)');
  perform pg_temp.check(
    (select count(*) from public.offers where destination = 'Lisboa') = 1,
    'E/ofertas: a linha continua lá'
  );
end;
$$;

do $$ begin raise notice 'Especialistas — conta comum'; end $$;

select pg_temp.check(
  (select count(*) from public.advisors) = 1
  and (select count(*) from public.advisors where name = 'Ativa Silva') = 1,
  'A+B/especialistas: lê o ativo e não enxerga o inativo'
);

-- O especialista ativo está `offline`. Se `active` e `status` tivessem sido
-- confundidos numa coluna só, esta linha teria sumido da lista.
select pg_temp.check(
  (select status from public.advisors where name = 'Ativa Silva') = 'offline',
  'A/especialistas: ativo porém offline continua visível (presença ≠ cadastro)'
);

do $$
declare
  aconteceu boolean := false;
  atingidas integer;
begin
  begin
    insert into public.advisors (name, specialty) values ('Pirata', 'Tudo');
    aconteceu := true;
  exception when insufficient_privilege then
    null;
  end;
  perform pg_temp.check(not aconteceu, 'C/especialistas: conta comum NÃO insere');

  update public.advisors set specialty = 'sequestrada' where name = 'Ativa Silva';
  get diagnostics atingidas = row_count;
  perform pg_temp.check(atingidas = 0, 'D/especialistas: conta comum NÃO edita');

  delete from public.advisors where name = 'Ativa Silva';
  get diagnostics atingidas = row_count;
  perform pg_temp.check(atingidas = 0, 'E/especialistas: conta comum NÃO exclui');

  perform pg_temp.check(
    (select specialty from public.advisors where name = 'Ativa Silva') = 'Europa',
    'D+E/especialistas: cadastro permanece intacto'
  );
end;
$$;

reset role;
reset request.jwt.claims;

-- =============================================================================
-- ADMINISTRADOR — cenário F
-- =============================================================================
set role authenticated;
set request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';

do $$ begin raise notice 'Administrador'; end $$;

select pg_temp.check(
  (select count(*) from public.offers) = 4,
  'F/ofertas: administrador enxerga rascunho, vencida e futura (a lista do painel funciona)'
);
select pg_temp.check(
  (select count(*) from public.advisors) = 2,
  'F/especialistas: administrador enxerga o inativo'
);

do $$
declare
  atingidas integer;
  nova      uuid;
  antes     timestamptz;
  depois    timestamptz;
begin
  insert into public.offers (destination, description, cost_level, image_url, status)
  values ('Cairo', 'criada pelo painel', 'moderate', 'https://x/10', 'draft')
  returning id, updated_at into nova, antes;
  perform pg_temp.check(nova is not null, 'F/ofertas: administrador insere');

  -- O gatilho de `updated_at` precisa vencer o valor que o cliente mandar.
  -- Sem ele, um painel que esqueça a coluna gravaria um registro dizendo ter
  -- sido editado antes da própria edição.
  update public.offers
     set description = 'editada pelo painel',
         updated_at = timestamptz '1999-01-01'
   where id = nova;
  get diagnostics atingidas = row_count;
  perform pg_temp.check(atingidas = 1, 'F/ofertas: administrador edita');

  select updated_at into depois from public.offers where id = nova;
  perform pg_temp.check(
    depois >= antes,
    'F/ofertas: gatilho sobrescreve `updated_at` mandado pelo cliente'
  );

  delete from public.offers where id = nova;
  get diagnostics atingidas = row_count;
  perform pg_temp.check(atingidas = 1, 'F/ofertas: administrador exclui');

  insert into public.advisors (name, specialty) values ('Nova Consultora', 'Ásia')
  returning id into nova;
  perform pg_temp.check(nova is not null, 'F/especialistas: administrador insere');

  update public.advisors set active = false where id = nova;
  get diagnostics atingidas = row_count;
  perform pg_temp.check(atingidas = 1, 'F/especialistas: administrador desativa');

  delete from public.advisors where id = nova;
  get diagnostics atingidas = row_count;
  perform pg_temp.check(atingidas = 1, 'F/especialistas: administrador exclui');
end;
$$;

reset role;
reset request.jwt.claims;

-- =============================================================================
-- SEM AUTENTICAÇÃO
-- =============================================================================
set role anon;
set request.jwt.claims = '';

do $$ begin raise notice 'Sem autenticação'; end $$;

-- Desde a 0005 o papel anônimo não tem GRANT em `public`: a recusa vem antes da
-- RLS. Mais forte que "0 linhas", e o teste mede a recusa real.
do $$
declare
  leu boolean := false;
begin
  begin
    perform count(*) from public.offers;
    perform count(*) from public.advisors;
    leu := true;
  exception when insufficient_privilege then
    null;
  end;
  perform pg_temp.check(not leu, 'anônimo: não lê oferta nem especialista, nem os publicados');
end;
$$;

do $$
declare
  aconteceu boolean := false;
begin
  begin
    insert into public.offers (destination, description, cost_level, image_url)
    values ('Anônima', 'x', 'economy', 'https://x/11');
    aconteceu := true;
  exception when insufficient_privilege then
    null;
  end;
  perform pg_temp.check(not aconteceu, 'anônimo: NÃO insere oferta');
end;
$$;

reset role;
reset request.jwt.claims;

do $$ begin raise notice '=== F3: todos os cenários passaram ==='; end $$;
