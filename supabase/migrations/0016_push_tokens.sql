-- =============================================================================
-- Easy Trip — tokens de notificação push (§33)
--
-- A limitação registrada era "avisos apenas dentro do aplicativo": as
-- notificações do Easy Trip existiam em `public.notifications` e só apareciam
-- para quem abrisse a Central. Um aviso de voo amanhã cedo, entregue quando a
-- pessoa lembrar de abrir o aplicativo, é um aviso que chegou tarde.
--
-- Esta migration cria o registro dos aparelhos. O ENVIO é da Edge Function
-- `send-push`: mandar notificação exige uma credencial de servidor, e nada que
-- o cliente possa ler serve para isso.
--
-- A PERGUNTA QUE DEFINE AS POLICIES
--
-- Não é "quem pode ler tokens?" — é "o que um token permite a quem o tem?".
-- Um token de push é um endereço de entrega: quem o possui pode fazer o
-- aparelho de outra pessoa tocar, com o texto que quiser. Então:
--
--   · cada conta gerencia APENAS os próprios tokens;
--   · NENHUM cliente lê o token de outra conta, em nenhuma circunstância;
--   · quem envia é o `service_role`, do lado de lá.
--
-- É o oposto de `trip_members`, onde ler a lista dos outros é o recurso. Aqui,
-- ler a lista dos outros é o vazamento.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tabela
--
-- UM APARELHO É UMA LINHA, E A CHAVE É O TOKEN
--
-- A mesma conta em dois aparelhos tem dois tokens e recebe nos dois — é o
-- comportamento esperado de quem usa telefone e tablet. `unique (token)`, e não
-- `unique (user_id)`: fosse por usuário, entrar no segundo aparelho apagaria a
-- inscrição do primeiro.
--
-- O token é único GLOBALMENTE porque o Expo o reemite: reinstalar o aplicativo
-- ou restaurar um backup pode devolver a outra conta um token que já pertenceu
-- a alguém. O `on conflict (token) do update` do registro resolve isso movendo
-- a linha para o dono atual — sem isso, a pessoa nova receberia as notificações
-- da anterior.
-- ----------------------------------------------------------------------------
create table if not exists public.push_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  token       text not null,
  platform    text not null check (platform in ('ios', 'android', 'web')),
  device_name text,
  -- `false` quando o serviço de push respondeu que o token não vale mais.
  -- Desativar em vez de apagar deixa rastro de diagnóstico: "o aviso não chegou"
  -- tem resposta diferente conforme o token nunca ter existido ou ter expirado.
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  last_used_at timestamptz,
  constraint push_tokens_token_unique unique (token)
);

comment on table public.push_tokens is
  'Endereços de entrega de notificação push, um por aparelho. Legível apenas '
  'pelo próprio dono; o envio é do service_role, pela Edge Function send-push.';

create index if not exists push_tokens_user_idx
  on public.push_tokens (user_id) where active;

-- ----------------------------------------------------------------------------
-- 2. RLS
--
-- Quatro policies, todas com a mesma condição: `user_id = auth.uid()`.
--
-- A repetição é o ponto. Uma policy `for all` seria mais curta e esconderia que
-- as quatro operações foram decididas — e a próxima pessoa a mexer aqui não
-- saberia se `delete` estava liberado de propósito ou por arrasto.
-- ----------------------------------------------------------------------------
alter table public.push_tokens enable row level security;

drop policy if exists push_tokens_select on public.push_tokens;
create policy push_tokens_select on public.push_tokens
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists push_tokens_insert on public.push_tokens;
create policy push_tokens_insert on public.push_tokens
  for insert to authenticated
  -- `with check` e não `using`: o que se valida na inserção é a linha que está
  -- ENTRANDO. Sem isto, alguém registraria um token no nome de outra conta e
  -- passaria a receber os avisos dela.
  with check (user_id = auth.uid());

drop policy if exists push_tokens_update on public.push_tokens;
create policy push_tokens_update on public.push_tokens
  for update to authenticated
  using (user_id = auth.uid())
  -- Os DOIS lados. Só `using` deixaria alguém mover a própria linha para o
  -- `user_id` de outra pessoa: a linha antiga é sua, a nova não seria.
  with check (user_id = auth.uid());

drop policy if exists push_tokens_delete on public.push_tokens;
create policy push_tokens_delete on public.push_tokens
  for delete to authenticated
  using (user_id = auth.uid());

-- `anon` não tem nada aqui. A 0005 documenta por que os grants não são
-- automáticos para tabelas criadas por migration.
grant select, insert, update, delete on public.push_tokens to authenticated;
grant all on public.push_tokens to service_role;

-- ----------------------------------------------------------------------------
-- 3. Registrar um aparelho
--
-- Por RPC, e não por `insert` direto, por causa do caso do token reemitido: a
-- linha pode já existir sob OUTRO dono, e aí o `on conflict do update` precisa
-- rodar sem que a policy de `update` daquela linha (que é de outra pessoa) o
-- barre. É o mesmo padrão de `accept_trip_invite` (0008) — protocolo com
-- pré-condição vira função, não policy.
--
-- `security definer`, e a autorização é a primeira linha do corpo: a identidade
-- vem de `auth.uid()`, nunca de um argumento. Não existe parâmetro `user_id`
-- aqui, e é de propósito — um parâmetro que ninguém pode preencher com o valor
-- errado é melhor do que uma validação que alguém pode esquecer de fazer.
-- ----------------------------------------------------------------------------
create or replace function public.register_push_token(
  device_token text,
  device_platform text,
  device_label text default null
)
returns public.push_tokens
language plpgsql
security definer
set search_path = public
as $$
declare
  quem   uuid := auth.uid();
  linha  public.push_tokens;
begin
  if quem is null then
    raise exception 'Sessão inválida.' using errcode = '42501';
  end if;
  if device_token is null or btrim(device_token) = '' then
    raise exception 'Token de notificação vazio.' using errcode = '22023';
  end if;
  if device_platform not in ('ios', 'android', 'web') then
    raise exception 'Plataforma desconhecida.' using errcode = '22023';
  end if;

  insert into public.push_tokens (user_id, token, platform, device_name, last_used_at)
  values (quem, btrim(device_token), device_platform, device_label, now())
      on conflict (token) do update
      -- O token mudou de dono: reinstalação, restauração de backup, aparelho
      -- passado adiante. A linha acompanha quem está usando AGORA.
      set user_id      = quem,
          platform     = excluded.platform,
          device_name  = excluded.device_name,
          active       = true,
          updated_at   = now(),
          last_used_at = now()
  returning * into linha;

  return linha;
end;
$$;

do $$
begin
  execute 'revoke all on function public.register_push_token(text, text, text) from public, anon';
  execute 'grant execute on function public.register_push_token(text, text, text) to authenticated';
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Sair da conta
--
-- SAIR TEM DE DESREGISTRAR, E ISSO NÃO É DETALHE
--
-- Um token que continua ativo depois da saída faz o aparelho receber as
-- notificações de uma conta que já não está nele. Se outra pessoa entrar no
-- mesmo telefone, ela vê na tela de bloqueio o título de um aviso destinado a
-- quem saiu.
--
-- Recebe o token porque quem sai sabe qual é o seu, e apagar TODOS os tokens da
-- conta desligaria também o outro aparelho da mesma pessoa — que não pediu nada.
-- ----------------------------------------------------------------------------
create or replace function public.unregister_push_token(device_token text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  quem uuid := auth.uid();
  n    integer;
begin
  if quem is null then
    raise exception 'Sessão inválida.' using errcode = '42501';
  end if;

  -- `user_id = quem` mesmo sendo `security definer`: sem esta condição, quem
  -- conhecesse o token de outra pessoa desligaria as notificações dela.
  delete from public.push_tokens
   where token = btrim(device_token) and user_id = quem;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

do $$
begin
  execute 'revoke all on function public.unregister_push_token(text) from public, anon';
  execute 'grant execute on function public.unregister_push_token(text) to authenticated';
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Desativar um token que o serviço recusou
--
-- Só o `service_role` chama: quem descobre que um token morreu é quem tentou
-- entregar. Um cliente não tem como saber, e não deveria poder afirmar.
-- ----------------------------------------------------------------------------
create or replace function public.deactivate_push_token(device_token text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.push_tokens
     set active = false, updated_at = now()
   where token = btrim(device_token);
$$;

do $$
begin
  execute 'revoke all on function public.deactivate_push_token(text) from public, anon, authenticated';
  execute 'grant execute on function public.deactivate_push_token(text) to service_role';
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. `updated_at`
-- ----------------------------------------------------------------------------
create or replace function public.push_tokens_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists push_tokens_touch_updated_at on public.push_tokens;
create trigger push_tokens_touch_updated_at
  before update on public.push_tokens
  for each row execute function public.push_tokens_touch();

-- ----------------------------------------------------------------------------
-- 7. Conferência
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_tables where schemaname = 'public' and tablename = 'push_tokens'
  ) then
    raise exception 'push_tokens não foi criada.';
  end if;

  if not (select rowsecurity from pg_tables
           where schemaname = 'public' and tablename = 'push_tokens') then
    raise exception 'push_tokens sem RLS.';
  end if;

  if (select count(*) from pg_policies
       where schemaname = 'public' and tablename = 'push_tokens') <> 4 then
    raise exception 'As quatro policies de push_tokens não foram criadas.';
  end if;

  if has_table_privilege('anon', 'public.push_tokens', 'select') then
    raise exception 'anon não pode ler push_tokens.';
  end if;
  if has_function_privilege('authenticated', 'public.deactivate_push_token(text)', 'execute') then
    raise exception 'Só o service_role desativa token.';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('register_push_token', 'unregister_push_token', 'deactivate_push_token')
       and p.prosecdef
       and not coalesce(array_to_string(p.proconfig, ',') like '%search_path=%', false)
  ) then
    raise exception 'Função de push security definer sem search_path fixo.';
  end if;
end;
$$;

-- =============================================================================
-- ROLLBACK (manual, se necessário)
--
--   drop function if exists public.deactivate_push_token(text);
--   drop function if exists public.unregister_push_token(text);
--   drop function if exists public.register_push_token(text, text, text);
--   drop trigger  if exists push_tokens_touch_updated_at on public.push_tokens;
--   drop function if exists public.push_tokens_touch();
--   drop table    if exists public.push_tokens;
--
-- Perde os registros de aparelho. Não perde nenhuma notificação: elas moram em
-- `public.notifications` (0010) e continuam aparecendo na Central.
-- =============================================================================
