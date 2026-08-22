-- =============================================================================
-- P-01 — rascunho de artigo não é conteúdo público
--
-- O que este teste prova é que a regra vive no PostgreSQL, e não na tela: cada
-- cenário assume a identidade de um usuário como o PostgREST faria (papel
-- `authenticated` + claim `sub` no JWT) e consulta a tabela diretamente, sem
-- passar por nada do aplicativo.
--
-- Rodar contra um banco descartável:
--   psql -f supabase/tests/_local_bootstrap.sql
--   psql -f supabase/migrations/0001_schema.sql
--   psql -f supabase/migrations/0002_rls.sql
--   psql -f supabase/migrations/0003_admin_roles.sql
--   psql -f supabase/migrations/0004_content_publishing.sql
--   psql -f supabase/migrations/0005_grants.sql
--   psql -f supabase/tests/rls_articles.test.sql
--
-- Falha ruidosamente: qualquer cenário que não bata aborta com exceção.
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

-- O trigger `handle_new_user` já criou os perfis; promovemos um deles pela
-- mesma operação administrativa documentada em 0003 (sem sessão de usuário).
update public.profiles set role = 'admin'
 where user_id = 'bbbbbbbb-0000-4000-8000-000000000002';

insert into public.articles (id, slug, title, category, author_name, content, status) values
  ('cccccccc-0000-4000-8000-000000000003', 'publicado', 'Artigo publicado', 'Dicas',
   'Equipe Easy Trip', 'conteudo publicado', 'published'),
  ('dddddddd-0000-4000-8000-000000000004', 'rascunho', 'Rascunho confidencial', 'Dicas',
   'Equipe Easy Trip', 'conteudo ainda nao revisado', 'draft')
on conflict (id) do nothing;

-- =========================================================== CENÁRIOS A, B, E
-- Sessão de conta comum, exatamente como o PostgREST monta.
set role authenticated;
set request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

do $$ begin
  raise notice 'Conta comum';
end $$;

-- Cenário A — enxerga o publicado
select pg_temp.check(
  (select count(*) from public.articles where slug = 'publicado') = 1,
  'A: conta comum lê artigo publicado'
);

-- Cenário B — NÃO enxerga o rascunho
select pg_temp.check(
  (select count(*) from public.articles where slug = 'rascunho') = 0,
  'B: conta comum NÃO lê rascunho'
);

-- Cenário E — consulta sem filtro nenhum não pode devolver rascunho.
-- É o cenário que importa: é o que uma chamada crua a /rest/v1/articles faz.
select pg_temp.check(
  (select count(*) from public.articles) = 1
  and not exists (select 1 from public.articles where status <> 'published'),
  'E: `select * from articles` sem filtro devolve só publicados'
);

-- Regressão: as outras três tabelas editoriais continuam legíveis.
select pg_temp.check(
  (select count(*) from public.offers) >= 0
  and (select count(*) from public.places) >= 0
  and (select count(*) from public.advisors) >= 0,
  'regressão: offers/places/advisors continuam legíveis para conta comum'
);

reset role;
reset request.jwt.claims;

-- ==================================================================== CENÁRIO C
set role authenticated;
set request.jwt.claims = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';

do $$ begin
  raise notice 'Administrador';
end $$;

select pg_temp.check(public.is_admin(), 'C: is_admin() reconhece o administrador');

select pg_temp.check(
  (select count(*) from public.articles where slug = 'rascunho') = 1,
  'C: administrador lê o rascunho'
);

select pg_temp.check(
  (select count(*) from public.articles) = 2,
  'C: administrador enxerga rascunho e publicado (a lista do painel funciona)'
);

reset role;
reset request.jwt.claims;

-- ==================================================================== CENÁRIO D
-- O produto não tem área pública: sem sessão, nada é legível. O teste registra
-- a regra atual em vez de inventar acesso anônimo.
set role anon;
set request.jwt.claims = '';

do $$ begin
  raise notice 'Sem autenticação';
end $$;

-- A barreira aqui deixou de ser a policy e passou a ser o privilégio: desde a
-- 0005 o papel anônimo não recebe GRANT nenhum em `public`. É uma negativa mais
-- forte que "0 linhas" — a consulta nem chega a ser avaliada pela RLS.
do $$
declare
  leu boolean := false;
begin
  begin
    perform count(*) from public.articles;
    leu := true;
  exception when insufficient_privilege then
    null;
  end;
  perform pg_temp.check(not leu, 'D: sem autenticação não lê artigo nenhum, nem publicado');
end;
$$;

reset role;
reset request.jwt.claims;

do $$ begin
  raise notice '=== P-01: todos os cenários passaram ===';
end $$;
