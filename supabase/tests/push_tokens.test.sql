-- =============================================================================
-- Tokens de notificação push (0016)
--
-- A asserção central é a §3: **ninguém lê o token de outra pessoa**.
--
-- Um token de push é um endereço de entrega. Quem o possui faz o aparelho de
-- outra pessoa tocar, com o texto que quiser, na tela de bloqueio. É o oposto
-- de `trip_members`, onde ler a lista dos outros é o recurso — aqui, ler a
-- lista dos outros é o vazamento.
--
-- Rodar contra um banco descartável, depois de 0001–0016:
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

create or replace function pg_temp.deny(comando text, label text)
returns void language plpgsql as $$
declare atingidas integer;
begin
  execute comando;
  get diagnostics atingidas = row_count;
  if atingidas = 0 then raise notice '  OK   % (0 linhas)', label;
  else raise exception 'FALHOU: % — % linha(s) passaram', label, atingidas; end if;
exception
  when insufficient_privilege or check_violation then
    raise notice '  OK   % (recusado)', label;
end;
$$;

create or replace function pg_temp.deny_call(comando text, label text)
returns void language plpgsql as $$
begin
  execute comando;
  raise exception 'FALHOU: % — a chamada foi aceita', label;
exception
  when insufficient_privilege or invalid_parameter_value then
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
begin reset role; set local request.jwt.claims = ''; end;
$$;

-- ---------------------------------------------------------------- preparação
insert into auth.users (id, email) values
  ('0a000000-0000-4000-8000-00000000ff01', 'push.a@easytrip.app'),
  ('0b000000-0000-4000-8000-00000000ff02', 'push.b@easytrip.app')
on conflict (id) do nothing;

-- =============================================================================
-- 1. Registro
-- =============================================================================
do $$
declare
  linha public.push_tokens;
begin
  raise notice '--- 1. registro ---';

  perform pg_temp.as_user('0a000000-0000-4000-8000-00000000ff01');
  select * into linha from public.register_push_token('ExponentPushToken[AAA]', 'android', 'Pixel da A');

  perform pg_temp.check(linha.user_id = '0a000000-0000-4000-8000-00000000ff01',
    'o token é registrado no dono da sessão');
  perform pg_temp.check(linha.active, 'nasce ativo');
  perform pg_temp.check(linha.platform = 'android', 'a plataforma é gravada');
  perform pg_temp.check(linha.last_used_at is not null, 'o último uso é marcado');

  perform pg_temp.as_postgres();
end;
$$;

do $$
declare n integer;
begin
  raise notice '--- 2. o mesmo aparelho, duas vezes ---';

  perform pg_temp.as_user('0a000000-0000-4000-8000-00000000ff01');
  perform public.register_push_token('ExponentPushToken[AAA]', 'android', 'Pixel da A');
  perform pg_temp.as_postgres();

  select count(*) into n from public.push_tokens where token = 'ExponentPushToken[AAA]';
  -- Reabrir o aplicativo registra de novo. Uma linha, não duas.
  perform pg_temp.check(n = 1, 'registrar o mesmo token duas vezes não duplica');
end;
$$;

do $$
declare n integer;
begin
  raise notice '--- 3. dois aparelhos da mesma pessoa ---';

  perform pg_temp.as_user('0a000000-0000-4000-8000-00000000ff01');
  perform public.register_push_token('ExponentPushToken[AAA2]', 'ios', 'iPad da A');
  perform pg_temp.as_postgres();

  select count(*) into n from public.push_tokens
   where user_id = '0a000000-0000-4000-8000-00000000ff01' and active;
  -- Telefone E tablet. `unique (user_id)` teria desligado o primeiro.
  perform pg_temp.check(n = 2, 'a mesma conta recebe em dois aparelhos');
end;
$$;

-- =============================================================================
-- 4. O aparelho passou de mão
-- =============================================================================
do $$
declare
  dono uuid;
  n    integer;
begin
  raise notice '--- 4. token reemitido para outra conta ---';

  perform pg_temp.as_user('0b000000-0000-4000-8000-00000000ff02');
  perform public.register_push_token('ExponentPushToken[AAA]', 'android', 'Pixel (agora do B)');
  perform pg_temp.as_postgres();

  select user_id into dono from public.push_tokens where token = 'ExponentPushToken[AAA]';
  -- Sem isto, o B receberia as notificações do A. É o caso da reinstalação e
  -- da restauração de backup, e ele acontece.
  perform pg_temp.check(dono = '0b000000-0000-4000-8000-00000000ff02',
    'o token acompanha quem está usando o aparelho agora');

  select count(*) into n from public.push_tokens where token = 'ExponentPushToken[AAA]';
  perform pg_temp.check(n = 1, 'e continua havendo uma linha só');
end;
$$;

-- =============================================================================
-- 5. NINGUÉM LÊ O TOKEN DE NINGUÉM
-- =============================================================================
do $$
declare
  visiveis integer;
begin
  raise notice '--- 5. isolamento ---';

  perform pg_temp.as_user('0a000000-0000-4000-8000-00000000ff01');
  select count(*) into visiveis from public.push_tokens;
  perform pg_temp.check(visiveis = 1, 'A vê apenas o próprio token restante');

  select count(*) into visiveis from public.push_tokens
   where user_id = '0b000000-0000-4000-8000-00000000ff02';
  perform pg_temp.check(visiveis = 0, 'A NÃO vê o token do B');

  perform pg_temp.as_user('0b000000-0000-4000-8000-00000000ff02');
  select count(*) into visiveis from public.push_tokens
   where user_id = '0a000000-0000-4000-8000-00000000ff01';
  perform pg_temp.check(visiveis = 0, 'B NÃO vê os tokens do A');

  perform pg_temp.as_postgres();
end;
$$;

do $$
begin
  raise notice '--- 6. escrita alheia ---';

  perform pg_temp.as_user('0b000000-0000-4000-8000-00000000ff02');

  -- Registrar um token no nome de outra conta: passaria a receber os avisos
  -- dela. É o que a `with check` do insert impede.
  perform pg_temp.deny(
    $q$ insert into public.push_tokens (user_id, token, platform)
        values ('0a000000-0000-4000-8000-00000000ff01', 'ExponentPushToken[FORJADO]', 'android') $q$,
    'não registra token no nome de outra conta');

  -- Mover a própria linha para o user_id alheio: é o que a `with check` do
  -- update impede, e por que ela existe além do `using`.
  perform pg_temp.deny(
    $q$ update public.push_tokens
           set user_id = '0a000000-0000-4000-8000-00000000ff01'
         where user_id = '0b000000-0000-4000-8000-00000000ff02' $q$,
    'não move o próprio token para outra conta');

  perform pg_temp.deny(
    $q$ update public.push_tokens set active = false
         where user_id = '0a000000-0000-4000-8000-00000000ff01' $q$,
    'não desativa o token de outra conta por UPDATE');

  perform pg_temp.deny(
    $q$ delete from public.push_tokens
         where user_id = '0a000000-0000-4000-8000-00000000ff01' $q$,
    'não apaga o token de outra conta');

  perform pg_temp.as_postgres();
end;
$$;

-- =============================================================================
-- 7. Sair da conta
-- =============================================================================
do $$
declare
  saiu boolean;
  n    integer;
begin
  raise notice '--- 7. saída ---';

  -- O B conhece o token do A? Mesmo que conhecesse, não o desliga.
  perform pg_temp.as_user('0b000000-0000-4000-8000-00000000ff02');
  select public.unregister_push_token('ExponentPushToken[AAA2]') into saiu;
  perform pg_temp.check(not saiu, 'não desregistra o token de outra conta');

  perform pg_temp.as_postgres();
  select count(*) into n from public.push_tokens where token = 'ExponentPushToken[AAA2]';
  perform pg_temp.check(n = 1, 'e o token do A continua lá');

  -- O A sai do próprio tablet.
  perform pg_temp.as_user('0a000000-0000-4000-8000-00000000ff01');
  select public.unregister_push_token('ExponentPushToken[AAA2]') into saiu;
  perform pg_temp.check(saiu, 'desregistra o próprio token');
  perform pg_temp.as_postgres();

  select count(*) into n from public.push_tokens where token = 'ExponentPushToken[AAA2]';
  -- Um token vivo depois da saída faria o aparelho mostrar, na tela de
  -- bloqueio, o aviso de quem já não está nele.
  perform pg_temp.check(n = 0, 'sair remove a inscrição daquele aparelho');
end;
$$;

-- =============================================================================
-- 8. Desativação pelo servidor
-- =============================================================================
do $$
begin
  raise notice '--- 8. token recusado pelo serviço ---';

  perform pg_temp.as_user('0a000000-0000-4000-8000-00000000ff01');
  -- Só quem tentou entregar sabe que o token morreu. Um cliente não tem como
  -- saber, e não deveria poder afirmar.
  perform pg_temp.deny_call(
    $q$ select public.deactivate_push_token('ExponentPushToken[AAA]') $q$,
    'cliente não desativa token');
  perform pg_temp.as_postgres();

  perform public.deactivate_push_token('ExponentPushToken[AAA]');
  perform pg_temp.check(
    exists (select 1 from public.push_tokens
             where token = 'ExponentPushToken[AAA]' and active = false),
    'o servidor desativa o token recusado');
  perform pg_temp.check(
    exists (select 1 from public.push_tokens where token = 'ExponentPushToken[AAA]'),
    'e a linha permanece, para diagnóstico');
end;
$$;

-- =============================================================================
-- 9. Validação de entrada
-- =============================================================================
do $$
begin
  raise notice '--- 9. entrada ---';

  perform pg_temp.as_user('0a000000-0000-4000-8000-00000000ff01');
  perform pg_temp.deny_call(
    $q$ select public.register_push_token('', 'android') $q$,
    'token vazio é recusado');
  perform pg_temp.deny_call(
    $q$ select public.register_push_token('t', 'symbian') $q$,
    'plataforma desconhecida é recusada');
  perform pg_temp.as_postgres();
end;
$$;

-- =============================================================================
-- 10. anon
-- =============================================================================
do $$
begin
  raise notice '--- 10. anon ---';
  perform pg_temp.check(
    not has_table_privilege('anon', 'public.push_tokens', 'select'),
    'anon não lê push_tokens');
  perform pg_temp.check(
    not has_table_privilege('anon', 'public.push_tokens', 'insert'),
    'anon não escreve push_tokens');
  perform pg_temp.check(
    not has_function_privilege('anon', 'public.register_push_token(text, text, text)', 'execute'),
    'anon não registra token');
  perform pg_temp.check(
    has_function_privilege('authenticated', 'public.register_push_token(text, text, text)', 'execute'),
    'authenticated registra o próprio token');
end;
$$;

-- =============================================================================
-- 11. A conta some, os tokens somem
-- =============================================================================
do $$
declare n integer;
begin
  raise notice '--- 11. cascata ---';
  delete from auth.users where id = '0b000000-0000-4000-8000-00000000ff02';
  select count(*) into n from public.push_tokens
   where user_id = '0b000000-0000-4000-8000-00000000ff02';
  -- Um endereço de entrega para uma conta que não existe é só um aparelho que
  -- vai tocar sem motivo.
  perform pg_temp.check(n = 0, 'excluir a conta remove os tokens dela');
end;
$$;

do $$ begin raise notice 'push_tokens.test.sql — todas as asserções passaram'; end; $$;
