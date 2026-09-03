-- =============================================================================
-- Ambiente mínimo para validar as migrations num PostgreSQL descartável.
--
-- NÃO faz parte do schema do produto e nunca é aplicado ao projeto remoto: o
-- Supabase já fornece `auth`, `storage` e os papéis. Isto apenas recria o
-- suficiente para que 0001/0002/0003 rodem numa imagem `postgres:17` limpa,
-- permitindo testar a RLS sem tocar em nada hospedado.
-- =============================================================================

create extension if not exists "pgcrypto";

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  created_at timestamptz not null default now(),
  raw_user_meta_data jsonb default '{}'::jsonb
);

-- Mesmas definições que o Supabase usa: leem o JWT do GUC da requisição.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub', '')::uuid;
$$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;

create schema if not exists storage;
-- Mesmas colunas que o Supabase expõe e que as migrations tocam. `0006` grava
-- limite de tamanho e lista de tipos no bucket de avatares; sem elas aqui, a
-- migration falharia no banco de teste por um motivo que não existe no real.
create table if not exists storage.buckets (
  id text primary key,
  name text,
  public boolean,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text,
  name text
);
alter table storage.objects enable row level security;
-- Cópia FIEL da definição que o Supabase instala (conferida contra
-- `storage-api` v1.71.0 num stack local). Ela devolve todos os segmentos
-- EXCETO o último, porque o último é o nome do arquivo — e não uma pasta.
--
-- A versão anterior deste arquivo devolvia `string_to_array(name, '/')` inteiro.
-- Para `{uuid}/cover-x.jpg` os dois concordam em `[1]`, e por isso a diferença
-- passou despercebida. Ela deixa de ser inofensiva num objeto SEM barra: para o
-- nome `{uuid}`, a versão antiga devolvia o próprio uuid em `[1]` e
-- `trip_cover_trip_id` (0013) concederia acesso a um objeto na raiz do bucket.
-- Contra o Supabase real, `[1]` é null e o acesso é negado. Testar a policy
-- contra a versão antiga mediria uma permissividade que o produto não tem.
create or replace function storage.foldername(name text) returns text[]
  language sql immutable as $$
    select (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1];
  $$;

grant usage on schema public, auth, storage to anon, authenticated, service_role;

-- NÃO conceder privilégio de tabela aqui.
--
-- Até a F3 este arquivo concedia, para que os testes de RLS medissem a policy e
-- não um "permission denied". A suposição embutida — "o Supabase concede
-- sozinho" — foi medida na F4 contra um Supabase real e é falsa para tabelas
-- criadas por migration (ver o cabeçalho de `0005_grants.sql`).
--
-- Quem concede agora é a própria 0005. Repetir os grants aqui esconderia
-- exatamente o defeito que ela corrige: os testes passariam mesmo que a
-- migration fosse removida.

-- `storage.objects` é a EXCEÇÃO, e por um motivo que não vale para as tabelas
-- do produto: ela não é criada por migration nenhuma. Quem a cria é a
-- plataforma, que também concede DML a `anon` e `authenticated` — conferido no
-- stack local:
--
--   anon|DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
--   authenticated|DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
--
-- No Supabase quem restringe o acesso ao objeto é a RLS, não o grant. Sem estas
-- linhas, um teste de policy de Storage mediria "permission denied for table
-- objects" e passaria mesmo com TODAS as policies da 0013 removidas.
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;
