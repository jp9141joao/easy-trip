-- =============================================================================
-- Agendamento do briefing diário (0015)
--
-- A asserção que dá nome a este arquivo é a §6: **o segredo não aparece em
-- `cron.job`**. Todo o desenho da 0015 existe por causa dela — o comando
-- agendado chama uma função que lê o Vault na execução, em vez de carregar a
-- service role no próprio texto do comando.
--
-- As demais asserções protegem o que costuma quebrar em volta: recusar agendar
-- com o Vault incompleto (um job criado assim falharia de hora em hora sem
-- ninguém entender por quê), e manter as funções privilegiadas fora do alcance
-- de `anon` e `authenticated`.
--
-- Rodar contra um banco descartável, depois de 0001–0015:
--   ./scripts/sql-test.sh
-- =============================================================================

\set ON_ERROR_STOP on
\set QUIET on

create or replace function pg_temp.check(condition boolean, label text)
returns void language plpgsql as $$
begin
  if condition then raise notice '  OK   %', label;
  else raise exception 'FALHOU: %', label; end if;
end;
$$;

create or replace function pg_temp.deny_call(comando text, label text)
returns void language plpgsql as $$
begin
  execute comando;
  raise exception 'FALHOU: % — a chamada foi aceita', label;
exception
  when insufficient_privilege or undefined_object or object_not_in_prerequisite_state
    or undefined_table or invalid_parameter_value then
    raise notice '  OK   % (recusado)', label;
end;
$$;

-- =============================================================================
-- 1. Sem segredo no Vault, não se agenda
-- =============================================================================
do $$
begin
  raise notice '--- 1. Vault vazio ---';

  -- Estado inicial: o Vault está vazio, e é assim que um banco recém-migrado
  -- chega. Agendar aqui criaria um job condenado a falhar.
  perform pg_temp.deny_call(
    'select public.schedule_trip_daily_briefing()',
    'não agenda com o Vault vazio');

  perform pg_temp.check(
    not public.briefing_secret_present('project_url'),
    'o status reporta project_url ausente');
  perform pg_temp.check(
    not public.briefing_secret_present('service_role_key'),
    'o status reporta service_role_key ausente');
  perform pg_temp.check(
    not public.briefing_secret_present('trip_daily_briefing_cron_secret'),
    'o status reporta o segredo do cron ausente');
end;
$$;

do $$
declare
  st record;
begin
  select * into st from public.trip_daily_briefing_schedule_status();
  perform pg_temp.check(st.agendado = false, 'o status diz que não há agendamento');
end;
$$;

-- =============================================================================
-- 2. Com o Vault incompleto, também não
-- =============================================================================
select vault.create_secret('https://exemplo.supabase.co', 'project_url');

do $$
begin
  raise notice '--- 2. Vault incompleto ---';

  perform pg_temp.check(
    public.briefing_secret_present('project_url'),
    'project_url agora está presente');

  -- Falta a service role e o segredo do cron. Um de três não basta.
  perform pg_temp.deny_call(
    'select public.schedule_trip_daily_briefing()',
    'não agenda faltando a service role');
end;
$$;

select vault.create_secret('chave-de-servico-de-teste', 'service_role_key');

do $$
begin
  perform pg_temp.deny_call(
    'select public.schedule_trip_daily_briefing()',
    'não agenda faltando o segredo do cron');
end;
$$;

-- =============================================================================
-- 3. Com o Vault completo, agenda
-- =============================================================================
select vault.create_secret('segredo-do-cron-de-teste', 'trip_daily_briefing_cron_secret');

do $$
declare
  job_id bigint;
begin
  raise notice '--- 3. agendamento ---';

  select public.schedule_trip_daily_briefing() into job_id;
  perform pg_temp.check(job_id is not null and job_id > 0, 'o agendamento devolve um id de job');
end;
$$;

do $$
declare
  st record;
begin
  select * into st from public.trip_daily_briefing_schedule_status();
  perform pg_temp.check(st.agendado, 'o status confirma o agendamento');
  perform pg_temp.check(st.ativo, 'o job está ativo');
  perform pg_temp.check(st.schedule = '0 * * * *', 'roda de hora em hora');
  perform pg_temp.check(st.tem_url and st.tem_service_role and st.tem_segredo_cron,
    'o status confirma as três credenciais presentes');
end;
$$;

do $$
declare
  n integer;
begin
  select count(*) into n from cron.job where jobname = 'trip-daily-briefing';
  perform pg_temp.check(n = 1, 'existe exatamente um job com este nome');
end;
$$;

-- =============================================================================
-- 4. Idempotência do agendamento
-- =============================================================================
do $$
declare
  n integer;
begin
  raise notice '--- 4. reagendar ---';

  perform public.schedule_trip_daily_briefing();
  perform public.schedule_trip_daily_briefing();

  select count(*) into n from cron.job where jobname = 'trip-daily-briefing';
  -- `cron.schedule` com o mesmo nome SUBSTITUI. Se algum dia isso mudar, três
  -- jobs iguais passariam a disparar três vezes por hora.
  perform pg_temp.check(n = 1, 'reagendar não duplica o job');
end;
$$;

-- =============================================================================
-- 5. Horário customizado
-- =============================================================================
do $$
declare
  s text;
begin
  perform public.schedule_trip_daily_briefing('30 * * * *');
  select schedule into s from cron.job where jobname = 'trip-daily-briefing';
  perform pg_temp.check(s = '30 * * * *', 'o horário pode ser alterado sem recriar nada');
  perform public.schedule_trip_daily_briefing();
end;
$$;

-- =============================================================================
-- 6. O SEGREDO NÃO ESTÁ EM `cron.job`
--
-- A asserção central. Se alguém "simplificar" a 0015 interpolando a service
-- role no comando agendado — que é como a documentação do Supabase costuma
-- mostrar —, é aqui que quebra.
-- =============================================================================
do $$
declare
  comando text;
begin
  raise notice '--- 6. o segredo não vaza para cron.job ---';

  select command into comando from cron.job where jobname = 'trip-daily-briefing';

  perform pg_temp.check(
    comando = 'select public.dispatch_trip_daily_briefing();',
    'o comando agendado é só a chamada da função');

  perform pg_temp.check(
    comando not like '%chave-de-servico-de-teste%',
    'a service role NÃO aparece em cron.job.command');
  perform pg_temp.check(
    comando not like '%segredo-do-cron-de-teste%',
    'o segredo do cron NÃO aparece em cron.job.command');
  perform pg_temp.check(
    comando not like '%Bearer%',
    'nenhum cabeçalho Authorization aparece em cron.job.command');
  perform pg_temp.check(
    comando not like '%exemplo.supabase.co%',
    'nem mesmo a URL do projeto aparece em cron.job.command');

  -- A tabela inteira, não só a linha: um job antigo com segredo no comando
  -- também seria um vazamento.
  perform pg_temp.check(
    not exists (
      select 1 from cron.job
       where command like '%chave-de-servico-de-teste%'
          or command like '%segredo-do-cron-de-teste%'
    ),
    'nenhum job de cron neste banco carrega credencial no comando');
end;
$$;

-- =============================================================================
-- 7. As funções privilegiadas estão fora do alcance do cliente
-- =============================================================================
do $$
declare
  f text;
begin
  raise notice '--- 7. alcance ---';

  foreach f in array array[
    'public.briefing_secret(text)',
    'public.dispatch_trip_daily_briefing()',
    'public.schedule_trip_daily_briefing(text)',
    'public.unschedule_trip_daily_briefing()',
    'public.trip_daily_briefing_schedule_status()',
    'public.briefing_secret_present(text)'
  ] loop
    perform pg_temp.check(
      not has_function_privilege('anon', f, 'execute'),
      format('anon não executa %s', f));
    perform pg_temp.check(
      not has_function_privilege('authenticated', f, 'execute'),
      format('authenticated não executa %s', f));
  end loop;
end;
$$;

-- O Vault continua fechado para o cliente: é a segunda metade da mesma
-- proteção. De nada adiantaria fechar as funções se a view fosse legível.
do $$
begin
  perform pg_temp.check(
    not has_table_privilege('anon', 'vault.decrypted_secrets', 'select'),
    'anon não lê vault.decrypted_secrets');
  perform pg_temp.check(
    not has_table_privilege('authenticated', 'vault.decrypted_secrets', 'select'),
    'authenticated não lê vault.decrypted_secrets');
end;
$$;

-- =============================================================================
-- 8. Desagendar
-- =============================================================================
do $$
declare
  n integer;
  st record;
begin
  raise notice '--- 8. desagendar ---';

  perform public.unschedule_trip_daily_briefing();
  select count(*) into n from cron.job where jobname = 'trip-daily-briefing';
  perform pg_temp.check(n = 0, 'o job foi removido');

  select * into st from public.trip_daily_briefing_schedule_status();
  perform pg_temp.check(st.agendado = false, 'o status volta a dizer que não há agendamento');

  -- Chamar de novo não pode explodir: a função responde "garanta que não está
  -- agendado", e já não está.
  perform public.unschedule_trip_daily_briefing();
  perform pg_temp.check(true, 'desagendar duas vezes não levanta exceção');
end;
$$;

do $$ begin raise notice 'briefing_schedule.test.sql — todas as asserções passaram'; end; $$;
