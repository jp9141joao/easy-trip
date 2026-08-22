-- =============================================================================
-- Easy Trip — privilégios de tabela para os papéis do PostgREST (F4)
--
-- POR QUE ESTA MIGRATION EXISTE
--
-- No PostgreSQL, acessar uma tabela exige DUAS autorizações independentes:
-- o privilégio (GRANT) e, quando há RLS, uma policy que deixe a linha passar.
-- As migrations 0001–0004 cuidaram inteiramente da segunda e não escreveram
-- nenhum GRANT — na suposição de que o Supabase concederia os privilégios
-- sozinho.
--
-- Ele concede, mas só para o que é criado pelo papel `supabase_admin`:
--
--   select defaclrole::regrole, defaclnamespace::regnamespace from pg_default_acl;
--   -- supabase_admin | public   ← anon, authenticated, service_role
--
-- As migrations rodam como `postgres`. Não existe linha para `postgres` em
-- `public`, então toda tabela criada por elas nasce sem privilégio nenhum para
-- `authenticated`. O resultado, medido contra um Supabase real:
--
--   GET /rest/v1/profiles  →  42501  permission denied for table profiles
--
-- Com o aplicativo apontado para um projeto de verdade, isso não seria "um
-- detalhe": nada carregaria — nem perfil, nem viagens, nem conteúdo. E o
-- sintoma engana, porque parece problema de RLS ou de sessão, quando as duas
-- estão corretas.
--
-- Não dá para corrigir editando as migrations anteriores (elas já são
-- histórico), e o GRANT tem de vir depois das tabelas existirem. Daí a 0005.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. `anon` fica de fora, e isso é deliberado
--
-- O padrão do Supabase é conceder também ao papel anônimo e confiar na RLS para
-- barrar. Aqui não: o Easy Trip não tem área pública — nenhuma policy das
-- 0002/0003/0004 concede leitura a `anon`, todas exigem `authenticated`.
--
-- Sem o GRANT, uma policy escrita errada no futuro ainda esbarra na falta de
-- privilégio. É a mesma ideia das duas barreiras que já protegem `role`: a
-- segunda existe para o dia em que a primeira falhar.
-- ----------------------------------------------------------------------------
grant usage on schema public to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. Tabelas que já existem
--
-- O privilégio é grosso de propósito: ele responde "esta conta pode falar com
-- esta tabela?", e não "pode ver esta linha?". A segunda pergunta é da RLS, que
-- continua sendo a autorização de verdade — inclusive para administrador, cujo
-- poder de escrever conteúdo editorial vem de `public.is_admin()`, e não daqui.
--
-- `authenticated` é um papel só, compartilhado por quem usa e quem administra.
-- Sem INSERT/UPDATE/DELETE nas tabelas editoriais, as policies de admin da 0003
-- nunca chegariam a ser avaliadas e o painel não gravaria nada.
-- ----------------------------------------------------------------------------
grant select, insert, update, delete on all tables in schema public
  to authenticated;

-- `service_role` já ignora a RLS por definição e só existe no servidor (Edge
-- Functions). Nunca no aplicativo.
grant all on all tables in schema public to service_role;

grant usage, select on all sequences in schema public to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. Tabelas que ainda não existem
--
-- Sem esta parte, o defeito voltaria na próxima migration que criasse uma
-- tabela — e voltaria em silêncio, do mesmo jeito. `ALTER DEFAULT PRIVILEGES`
-- sem `FOR ROLE` vale para o papel corrente, que é o mesmo (`postgres`) que
-- aplica as migrations.
-- ----------------------------------------------------------------------------
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant all on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. Conferência
--
-- Um GRANT que não pegou é invisível: a migration termina sem erro e o problema
-- só aparece na primeira tela que não carrega. Este bloco falha alto.
-- ----------------------------------------------------------------------------
do $$
declare
  sem_privilegio text[];
begin
  -- Pelo oid, e não pelo nome: `has_table_privilege('public.x', …)` levanta
  -- exceção quando o nome não resolve, e o planejador não garante avaliar o
  -- filtro de schema antes da função. Com o oid a pergunta é sempre válida.
  select array_agg(c.relname order by c.relname)
    into sem_privilegio
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and not has_table_privilege('authenticated', c.oid, 'select');

  if sem_privilegio is not null then
    raise exception 'Sem SELECT para `authenticated`: %', array_to_string(sem_privilegio, ', ');
  end if;

  -- E o outro lado: a ausência de privilégio anônimo é parte da regra, não
  -- esquecimento. Se alguém conceder a `anon` sem querer, isto avisa.
  select array_agg(c.relname order by c.relname)
    into sem_privilegio
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and has_table_privilege('anon', c.oid, 'select');

  if sem_privilegio is not null then
    raise exception
      'Papel anônimo tem SELECT em: %. O Easy Trip não tem área pública.',
      array_to_string(sem_privilegio, ', ');
  end if;
end;
$$;
