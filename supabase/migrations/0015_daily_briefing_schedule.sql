-- =============================================================================
-- Easy Trip — agendamento do briefing diário (§34–§38)
--
-- A Function `trip-daily-briefing` existe desde a F-Melhorias e nunca foi
-- agendada: o cabeçalho dela traz um `cron.schedule` comentado, com a service
-- role e o segredo escritos no meio do comando. Esta migration substitui aquele
-- rascunho por um mecanismo que pode ir a produção.
--
-- O PROBLEMA DO RASCUNHO, QUE É O MOTIVO DESTE ARQUIVO
--
-- `cron.schedule` guarda o comando como TEXTO em `cron.job.command`. Um comando
-- que carrega a service role deixa a service role legível em `cron.job` — uma
-- tabela que não foi feita para guardar segredo e que aparece em qualquer dump,
-- backup ou consulta de diagnóstico. Trocar o segredo passaria a exigir
-- reescrever o agendamento.
--
-- Então o comando agendado NÃO carrega segredo nenhum:
--
--     select public.dispatch_trip_daily_briefing();
--
-- É essa função que lê as credenciais do Vault NO MOMENTO DA EXECUÇÃO e monta a
-- requisição. `cron.job.command` fica com uma linha pública; o segredo fica
-- cifrado onde deve estar; e trocá-lo passa a ser um `update` no Vault, sem
-- tocar no agendamento.
--
-- O QUE ESTA MIGRATION NÃO FAZ, E DE PROPÓSITO
--
-- Ela NÃO agenda nada e NÃO guarda segredo nenhum. Uma migration que agendasse
-- sozinha teria de conhecer a URL do projeto e as credenciais — e aí estaríamos
-- de volta ao problema, só que versionado no Git. O agendamento é um ato
-- operacional explícito, com os segredos já instalados:
--
--   -- uma vez, fora do controle de versão:
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--   select vault.create_secret('<SERVICE_ROLE_KEY>',        'service_role_key');
--   select vault.create_secret('<SEGREDO ALEATÓRIO>',       'trip_daily_briefing_cron_secret');
--
--   -- e então, uma vez:
--   select public.schedule_trip_daily_briefing();
--
--   -- para conferir depois:
--   select * from public.trip_daily_briefing_schedule_status();
--
-- Nenhuma migration anterior é alterada.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Extensões
--
-- No PostgreSQL do Supabase as três estão em `shared_preload_libraries` e são
-- criadas sem cerimônia. Num ambiente onde a criação exija privilégio que a
-- migration não tem, o bloco AVISA em vez de abortar: as funções abaixo são SQL
-- comum e continuam válidas, e `schedule_trip_daily_briefing` recusa com
-- mensagem clara enquanto o mecanismo não estiver disponível. Derrubar a
-- migration inteira por causa disso deixaria o schema pela metade por um
-- detalhe de ambiente.
-- ----------------------------------------------------------------------------
do $$
begin
  create extension if not exists pg_cron;
exception when others then
  raise notice 'pg_cron indisponível (%). Habilite a extensão antes de agendar.', sqlerrm;
end;
$$;

-- Mesma razão da separação do Vault, logo abaixo: o `create schema` fica FORA
-- do bloco com `exception`, que desfaria a subtransação inteira se a criação da
-- extensão falhasse.
create schema if not exists extensions;

do $$
begin
  create extension if not exists pg_net with schema extensions;
exception when others then
  raise notice 'pg_net indisponível (%). Habilite a extensão antes de agendar.', sqlerrm;
end;
$$;

-- O schema vem antes da extensão, e num bloco SEPARADO. Num Supabase hospedado
-- ele já existe e o `if not exists` é inócuo; num PostgreSQL recém-criado — o
-- das suítes SQL — a extensão não teria onde ser instalada.
--
-- Separado porque `exception when others` abre uma subtransação: se a criação
-- da extensão falhasse no MESMO bloco, o `create schema` seria desfeito junto, e
-- o sintoma seria "schema vault does not exist" numa migration que acabou de
-- criá-lo.
create schema if not exists vault;

do $$
begin
  create extension if not exists supabase_vault with schema vault;
exception when others then
  raise notice 'supabase_vault indisponível (%).', sqlerrm;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Leitura de um segredo do Vault
--
-- Isolada numa função para que exista UM lugar que sabe o nome da view e o
-- formato do erro. `vault.decrypted_secrets` decifra na leitura; por isso esta
-- função é `security definer` e fica fora do alcance de `anon`, `authenticated`
-- e `public` — quem pode executá-la lê o segredo em claro.
--
-- Erro explícito, e não `null`: um segredo ausente que virasse `null` produziria
-- uma requisição sem `Authorization`, que a Function recusaria com 401 uma vez
-- por hora, para sempre, sem ninguém entender por quê.
-- ----------------------------------------------------------------------------
create or replace function public.briefing_secret(secret_name text)
returns text
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  valor text;
begin
  begin
    select decrypted_secret into valor
      from vault.decrypted_secrets
     where name = secret_name
     limit 1;
  exception when undefined_table then
    raise exception 'O Vault não está disponível neste banco.' using errcode = '42P01';
  end;

  if valor is null or btrim(valor) = '' then
    raise exception
      'Segredo % ausente no Vault. Instale-o com vault.create_secret(...) antes de agendar.',
      secret_name using errcode = '42704';
  end if;

  return valor;
end;
$$;

do $$
begin
  execute 'revoke all on function public.briefing_secret(text) from public, anon, authenticated';
end;
$$;

comment on function public.briefing_secret(text) is
  'Lê um segredo do Vault. SECURITY DEFINER e fora do alcance do cliente: quem '
  'executa esta função lê o valor em claro.';

-- ----------------------------------------------------------------------------
-- 3. O disparo
--
-- É isto que o cron chama. A assinatura não recebe nada e não devolve segredo:
-- devolve o id da requisição do `pg_net`, que é o que permite auditar a resposta
-- depois em `net._http_response`.
--
-- `execute` dinâmico nas chamadas de `net`: assim a função pode ser CRIADA num
-- banco onde a extensão ainda não existe (o corpo só é resolvido na execução), o
-- que mantém esta migration aplicável antes de o `pg_net` estar habilitado.
--
-- A idempotência NÃO mora aqui. Ela mora no índice único
-- `notifications_daily_briefing_once` (0010), sobre (user_id, tripId, date):
-- duas execuções simultâneas do cron esbarram nele, e a segunda recebe 23505 e
-- não entrega nada. Tentar decidir isso aqui — "já mandei nesta hora?" — seria
-- exatamente a checagem que duas transações concorrentes atravessam juntas.
--
-- A janela de horário e o recorte de viagens em andamento também não moram
-- aqui: são da Function, que conhece o fuso do destino de cada viagem. O cron só
-- precisa acordá-la de hora em hora.
-- ----------------------------------------------------------------------------
create or replace function public.dispatch_trip_daily_briefing()
returns bigint
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  url        text;
  chave      text;
  segredo    text;
  request_id bigint;
begin
  url     := public.briefing_secret('project_url');
  chave   := public.briefing_secret('service_role_key');
  segredo := public.briefing_secret('trip_daily_briefing_cron_secret');

  execute
    'select net.http_post('
    || 'url := $1, headers := $2::jsonb, body := $3::jsonb, timeout_milliseconds := 60000)'
  into request_id
  using
    rtrim(url, '/') || '/functions/v1/trip-daily-briefing',
    jsonb_build_object(
      'Authorization', 'Bearer ' || chave,
      'x-easy-trip-cron-secret', segredo,
      'Content-Type', 'application/json'
    ),
    '{}'::jsonb;

  return request_id;
end;
$$;

do $$
begin
  execute 'revoke all on function public.dispatch_trip_daily_briefing() from public, anon, authenticated';
end;
$$;

comment on function public.dispatch_trip_daily_briefing() is
  'Chama a Edge Function trip-daily-briefing com as credenciais do Vault. É o '
  'comando que o cron executa — por isso cron.job.command não contém segredo.';

-- ----------------------------------------------------------------------------
-- 4. Agendar
--
-- De hora em hora, no minuto zero. A Function decide, viagem por viagem, se já
-- são entre 7h e 9h NO FUSO DO DESTINO — e é por isso que o cron precisa rodar
-- de hora em hora e não uma vez por dia: não existe um horário UTC que seja de
-- manhã em Tóquio e em São Paulo ao mesmo tempo.
--
-- Confere as credenciais ANTES de agendar. Um job criado com o Vault vazio
-- falharia silenciosamente uma vez por hora; melhor recusar agora, com a
-- mensagem dizendo qual segredo falta.
--
-- Idempotente: `cron.schedule` com um nome que já existe substitui o job.
-- ----------------------------------------------------------------------------
create or replace function public.schedule_trip_daily_briefing(
  schedule text default '0 * * * *'
)
returns bigint
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  job_id bigint;
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    raise exception 'pg_cron não está habilitado neste banco.' using errcode = '55000';
  end if;
  if not exists (select 1 from pg_namespace where nspname = 'net') then
    raise exception 'pg_net não está habilitado neste banco.' using errcode = '55000';
  end if;

  -- Levanta com o nome do segredo que falta. Descartamos o valor.
  perform public.briefing_secret('project_url');
  perform public.briefing_secret('service_role_key');
  perform public.briefing_secret('trip_daily_briefing_cron_secret');

  execute 'select cron.schedule($1, $2, $3)'
     into job_id
    using 'trip-daily-briefing', schedule, 'select public.dispatch_trip_daily_briefing();';

  return job_id;
end;
$$;

create or replace function public.unschedule_trip_daily_briefing()
returns boolean
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  ok boolean;
begin
  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    return false;
  end if;
  execute 'select cron.unschedule($1)' into ok using 'trip-daily-briefing';
  return coalesce(ok, false);
exception when others then
  -- `cron.unschedule` levanta quando o job não existe. Para uma função cujo
  -- propósito é "garanta que não está agendado", isso é sucesso.
  return false;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Auditar
--
-- Existe para responder "o agendamento está de pé?" sem que ninguém precise
-- consultar `cron.job` na mão — e sem devolver segredo: as três colunas de
-- credencial dizem se o segredo ESTÁ instalado, nunca qual é.
-- ----------------------------------------------------------------------------
create or replace function public.trip_daily_briefing_schedule_status()
returns table (
  agendado          boolean,
  schedule          text,
  comando           text,
  ativo             boolean,
  tem_url           boolean,
  tem_service_role  boolean,
  tem_segredo_cron  boolean
)
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  tem_cron boolean := exists (select 1 from pg_namespace where nspname = 'cron');
begin
  if not tem_cron then
    return query select false, null::text, null::text, false,
                        public.briefing_secret_present('project_url'),
                        public.briefing_secret_present('service_role_key'),
                        public.briefing_secret_present('trip_daily_briefing_cron_secret');
    return;
  end if;

  return query execute
    'select true, j.schedule, j.command, j.active,
            public.briefing_secret_present($1),
            public.briefing_secret_present($2),
            public.briefing_secret_present($3)
       from cron.job j where j.jobname = $4'
    using 'project_url', 'service_role_key', 'trip_daily_briefing_cron_secret',
          'trip-daily-briefing';

  if not found then
    return query select false, null::text, null::text, false,
                        public.briefing_secret_present('project_url'),
                        public.briefing_secret_present('service_role_key'),
                        public.briefing_secret_present('trip_daily_briefing_cron_secret');
  end if;
end;
$$;

-- Presença, e não valor. Separada de `briefing_secret` porque esta pode ser
-- concedida a quem audita sem conceder leitura do segredo.
create or replace function public.briefing_secret_present(secret_name text)
returns boolean
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  presente boolean;
begin
  select exists (
    select 1 from vault.decrypted_secrets
     where name = secret_name and btrim(coalesce(decrypted_secret, '')) <> ''
  ) into presente;
  return coalesce(presente, false);
exception when undefined_table then
  return false;
end;
$$;

do $$
begin
  execute 'revoke all on function public.schedule_trip_daily_briefing(text) from public, anon, authenticated';
  execute 'revoke all on function public.unschedule_trip_daily_briefing() from public, anon, authenticated';
  execute 'revoke all on function public.trip_daily_briefing_schedule_status() from public, anon, authenticated';
  execute 'revoke all on function public.briefing_secret_present(text) from public, anon, authenticated';
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. Conferência
-- ----------------------------------------------------------------------------
do $$
declare
  faltando text;
begin
  select string_agg(f, ', ') into faltando
    from unnest(array[
      'briefing_secret', 'briefing_secret_present', 'dispatch_trip_daily_briefing',
      'schedule_trip_daily_briefing', 'unschedule_trip_daily_briefing',
      'trip_daily_briefing_schedule_status'
    ]) as f
   where not exists (
     select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = f
   );
  if faltando is not null then
    raise exception 'Funções de agendamento ausentes: %', faltando;
  end if;

  -- Nenhuma delas pode estar ao alcance do cliente: todas leem ou usam
  -- credencial privilegiada.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('briefing_secret', 'dispatch_trip_daily_briefing',
                         'schedule_trip_daily_briefing')
       and (has_function_privilege('anon', p.oid, 'execute')
         or has_function_privilege('authenticated', p.oid, 'execute'))
  ) then
    raise exception 'Função de agendamento alcançável por anon ou authenticated.';
  end if;

  -- `security definer` sem `search_path` fixo é escalada de privilégio.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname like '%briefing%'
       and p.prosecdef
       and not coalesce(array_to_string(p.proconfig, ',') like '%search_path=%', false)
  ) then
    raise exception 'Função security definer de briefing sem search_path fixo.';
  end if;
end;
$$;

-- =============================================================================
-- ROLLBACK (manual, se necessário)
--
--   select public.unschedule_trip_daily_briefing();
--   drop function if exists public.trip_daily_briefing_schedule_status();
--   drop function if exists public.schedule_trip_daily_briefing(text);
--   drop function if exists public.unschedule_trip_daily_briefing();
--   drop function if exists public.dispatch_trip_daily_briefing();
--   drop function if exists public.briefing_secret_present(text);
--   drop function if exists public.briefing_secret(text);
--
-- As extensões NÃO são removidas: outras coisas podem depender delas. Os
-- segredos do Vault também não — quem os instalou os remove.
-- =============================================================================
