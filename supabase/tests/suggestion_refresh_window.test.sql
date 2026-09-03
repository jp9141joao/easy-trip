-- =============================================================================
-- A janela de geração de sugestões (0012 + 0017)
--
-- O QUE ESTA SUÍTE EXISTE PARA PROVAR
--
-- A 0012 protegia o custo consumindo a janela de seis horas ANTES da chamada ao
-- Gemini. Isso impede duas chamadas simultâneas — e cobrava seis horas de quem
-- não tinha recebido nada, porque a mesma coluna dizia "há uma tentativa em
-- curso" e "esta viagem foi atualizada".
--
-- A 0017 separa as duas afirmações. O que precisa ser provado, então, é que a
-- separação não afrouxou a proteção:
--
--   · uma tentativa em curso continua excluindo a próxima (concorrência);
--   · uma tentativa que FALHOU custa minutos, e não seis horas;
--   · uma tentativa que ENTREGOU continua custando seis horas;
--   · quem não é dono da tentativa não consegue encerrá-la;
--   · o aplicativo não consegue zerar nenhuma dessas colunas por conta própria.
--
-- A afirmação mais fácil de provar mal é a de concorrência: duas chamadas em
-- sequência, na mesma sessão, não provam exclusão nenhuma. Por isso a §12 abre
-- uma SEGUNDA conexão com `dblink` e mede o que acontece com ela enquanto a
-- primeira ainda não terminou.
--
-- Quatro identidades e uma viagem:
--
--   OWNER_A     dono da viagem       → gera
--   EDITOR_B    editor aceito        → gera
--   VIEWER_C    viewer aceito        → NÃO gera
--   OUTSIDER_D  não participa        → NÃO gera
--
-- Rodar contra um banco descartável, depois de 0001–0017:
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

-- Chamada que a função tem de recusar levantando o errcode esperado. Um teste
-- que aceitasse qualquer exceção contaria como sucesso um erro de digitação.
create or replace function pg_temp.deny_call(comando text, errcode_esperado text, label text)
returns void language plpgsql as $$
begin
  execute comando;
  raise exception 'FALHOU: % — a chamada foi aceita', label;
exception
  when others then
    if SQLSTATE = errcode_esperado then
      raise notice '  OK   % (%)', label, SQLSTATE;
    else
      raise exception 'FALHOU: % — esperava %, veio %', label, errcode_esperado, SQLSTATE;
    end if;
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

-- Envelhecer o relógio da linha em vez de esperar. Roda como superusuário, que
-- é justamente o privilégio que o aplicativo NÃO tem (§11).
create or replace function pg_temp.age(campo text, quanto interval)
returns void language plpgsql as $$
begin
  execute format(
    'update public.trips set %I = %I - %L::interval where id = %L',
    campo, campo, quanto, 'c1770000-0000-4000-8000-00000000000a'
  );
end;
$$;

-- ---------------------------------------------------------------- preparação
insert into auth.users (id, email) values
  ('c1a00000-0000-4000-8000-0000000000aa', 'window.a@easytrip.app'),
  ('c1b00000-0000-4000-8000-0000000000bb', 'window.b@easytrip.app'),
  ('c1c00000-0000-4000-8000-0000000000cc', 'window.c@easytrip.app'),
  ('c1d00000-0000-4000-8000-0000000000dd', 'window.d@easytrip.app')
on conflict (id) do nothing;

insert into public.profiles (user_id, name) values
  ('c1a00000-0000-4000-8000-0000000000aa', 'Ana'),
  ('c1b00000-0000-4000-8000-0000000000bb', 'Bruno'),
  ('c1c00000-0000-4000-8000-0000000000cc', 'Clara'),
  ('c1d00000-0000-4000-8000-0000000000dd', 'Davi')
on conflict (user_id) do update set name = excluded.name;

insert into public.trips
  (id, user_id, destination_city, destination_country, country_code, timezone,
   start_date, end_date, budget_total, budget_currency)
values
  ('c1770000-0000-4000-8000-00000000000a', 'c1a00000-0000-4000-8000-0000000000aa',
   'Moscovo', 'Rússia', 'RU', 'Europe/Moscow',
   current_date + 30, current_date + 40, 15000, 'BRL')
on conflict (id) do nothing;

insert into public.trip_members (trip_id, user_id, role) values
  ('c1770000-0000-4000-8000-00000000000a', 'c1b00000-0000-4000-8000-0000000000bb', 'editor'),
  ('c1770000-0000-4000-8000-00000000000a', 'c1c00000-0000-4000-8000-0000000000cc', 'viewer')
on conflict (trip_id, user_id) do update set role = excluded.role;

-- =============================================================================
-- 1. As colunas e as constantes
--
-- Os números moram em três funções, e não espalhados pelo corpo do claim e do
-- settle: a distância entre "janela de sucesso" e "cooldown de falha" é o que a
-- 0017 existe para manter, e duas cópias do mesmo intervalo divergem um dia.
-- =============================================================================
do $$
begin
  raise notice '--- 1. colunas e constantes ---';

  perform pg_temp.check(
    (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'trips'
        and column_name in ('suggestions_attempt_key', 'suggestions_attempt_at',
                            'suggestions_retry_after', 'suggestions_failed_attempts')) = 4,
    'as quatro colunas de estado da geração existem');

  perform pg_temp.check(public.suggestion_refresh_interval() = interval '6 hours',
    'a janela de sucesso continua sendo de 6 horas');
  perform pg_temp.check(public.suggestion_attempt_lease() = interval '5 minutes',
    'a lease de uma tentativa em curso é de 5 minutos');

  -- Curto na primeira falha, dobrando, com teto na janela normal: não é retry
  -- imediato e ilimitado, e também nunca fica PIOR do que o comportamento
  -- antigo de seis horas.
  perform pg_temp.check(public.suggestion_failure_cooldown(1) = interval '10 minutes',
    'primeira falha: 10 minutos');
  perform pg_temp.check(public.suggestion_failure_cooldown(2) = interval '20 minutes',
    'segunda falha: 20 minutos');
  perform pg_temp.check(public.suggestion_failure_cooldown(3) = interval '40 minutes',
    'terceira falha: 40 minutos');
  perform pg_temp.check(public.suggestion_failure_cooldown(99) = interval '6 hours',
    'o cooldown nunca passa da janela de 6 horas');
end;
$$;

-- =============================================================================
-- 2. Papel: gerar é escrita, e viewer não escreve
-- =============================================================================
do $$
declare trip constant uuid := 'c1770000-0000-4000-8000-00000000000a';
begin
  raise notice '--- 2. papel ---';

  perform pg_temp.as_user('c1c00000-0000-4000-8000-0000000000cc');
  perform pg_temp.deny_call(
    format('select public.claim_trip_suggestion_refresh(%L)', trip),
    '42501', 'viewer não reserva a geração');
  perform pg_temp.deny_call(
    format('select public.settle_trip_suggestion_refresh(%L, gen_random_uuid(), ''retry'')', trip),
    '42501', 'viewer não encerra a geração');

  perform pg_temp.as_user('c1d00000-0000-4000-8000-0000000000dd');
  perform pg_temp.deny_call(
    format('select public.claim_trip_suggestion_refresh(%L)', trip),
    '42501', 'quem não participa não reserva a geração');

  perform pg_temp.as_postgres();
end;
$$;

-- =============================================================================
-- 3. O claim NÃO grava mais a marca d'água
--
-- É a diferença central em relação à 0012, e a que faz todo o resto funcionar:
-- enquanto a tentativa está em curso, a viagem ainda não foi "atualizada".
-- =============================================================================
do $$
declare
  trip constant uuid := 'c1770000-0000-4000-8000-00000000000a';
  linha record;
  estado record;
begin
  raise notice '--- 3. o claim reserva, não atualiza ---';
  perform pg_temp.as_user('c1a00000-0000-4000-8000-0000000000aa');

  select * into linha from public.claim_trip_suggestion_refresh(trip);
  perform pg_temp.check(linha.claimed, 'a primeira tentativa vence o claim');
  perform pg_temp.check(linha.attempt is not null, 'o vencedor recebe um token');

  select suggestions_refreshed_at, suggestions_attempt_key, suggestions_attempt_at,
         suggestions_retry_after
    into estado from public.trips where id = trip;

  perform pg_temp.check(estado.suggestions_refreshed_at is null,
    'a marca d''água continua vazia durante a tentativa');
  perform pg_temp.check(estado.suggestions_attempt_at is not null,
    'a tentativa em curso ficou registrada');
  perform pg_temp.check(estado.suggestions_attempt_key <> linha.attempt::text,
    'a linha guarda o md5, e não o token em claro');
  perform pg_temp.check(estado.suggestions_attempt_key = md5(linha.attempt::text),
    'o que está gravado é exatamente md5(token)');

  perform pg_temp.as_postgres();
end;
$$;

-- =============================================================================
-- 4. Enquanto A tenta, B fica de fora — e uma tentativa abandonada expira
-- =============================================================================
do $$
declare
  trip constant uuid := 'c1770000-0000-4000-8000-00000000000a';
  linha record;
begin
  raise notice '--- 4. tentativa em curso ---';

  -- B é o EDITOR: tem todo o direito de gerar, e mesmo assim não passa. O que
  -- o bloqueia é a tentativa de A, não a permissão dele.
  perform pg_temp.as_user('c1b00000-0000-4000-8000-0000000000bb');
  select * into linha from public.claim_trip_suggestion_refresh(trip);
  perform pg_temp.check(not linha.claimed, 'B é recusado enquanto a tentativa de A está viva');
  perform pg_temp.check(linha.attempt is null, 'B não recebe token nenhum');
  perform pg_temp.as_postgres();

  -- CONTRAPROVA DA LEASE: envelhecida a tentativa além dos cinco minutos, o
  -- mesmo claim de B passa. Ou seja: o que segurava a viagem era a lease, e ela
  -- expira sozinha quando a Function morre sem encerrar.
  perform pg_temp.age('suggestions_attempt_at', interval '6 minutes');
  perform pg_temp.as_user('c1b00000-0000-4000-8000-0000000000bb');
  select * into linha from public.claim_trip_suggestion_refresh(trip);
  perform pg_temp.check(linha.claimed, 'passada a lease, a tentativa abandonada é retomada');
  perform pg_temp.as_postgres();
end;
$$;

-- =============================================================================
-- 5. Só quem tem o token encerra a tentativa
--
-- É o que separa este desenho do "release" que a 0012 recusou a criar. Sem a
-- exigência do token, qualquer membro poderia desfazer a janela de uma geração
-- bem-sucedida e repetir a chamada ao provedor sem teto.
-- =============================================================================
do $$
declare
  trip constant uuid := 'c1770000-0000-4000-8000-00000000000a';
  resultado record;
  chave_antes text;
begin
  raise notice '--- 5. token errado não encerra nada ---';

  select suggestions_attempt_key into chave_antes from public.trips where id = trip;

  perform pg_temp.as_user('c1a00000-0000-4000-8000-0000000000aa');
  select * into resultado
    from public.settle_trip_suggestion_refresh(trip, gen_random_uuid(), 'delivered');
  perform pg_temp.check(not resultado.settled, 'um token qualquer não encerra a tentativa');

  select * into resultado
    from public.settle_trip_suggestion_refresh(trip, null, 'retry');
  perform pg_temp.check(not resultado.settled, 'token nulo não encerra a tentativa');
  perform pg_temp.as_postgres();

  perform pg_temp.check(
    (select suggestions_attempt_key from public.trips where id = trip) = chave_antes,
    'a tentativa em curso segue intacta depois das duas recusas');
  perform pg_temp.check(
    (select suggestions_refreshed_at from public.trips where id = trip) is null,
    'nenhuma marca d''água foi gravada por um encerramento recusado');

  perform pg_temp.as_user('c1a00000-0000-4000-8000-0000000000aa');
  perform pg_temp.deny_call(
    format('select public.settle_trip_suggestion_refresh(%L, gen_random_uuid(), ''liberado'')', trip),
    '22023', 'um resultado inventado é recusado');
  perform pg_temp.as_postgres();
end;
$$;

-- =============================================================================
-- 6. Falha sem entrega: minutos, não seis horas
--
-- O coração da correção. A tentativa termina em `retry`, e o que se grava é o
-- cooldown — a marca d'água não é tocada.
-- =============================================================================
do $$
declare
  trip constant uuid := 'c1770000-0000-4000-8000-00000000000a';
  linha record;
  resultado record;
  estado record;
begin
  raise notice '--- 6. falha sem entrega ---';

  -- A tentativa viva agora é a que B retomou na §4. Ela é descartada aqui pelo
  -- superusuário — o aplicativo não conseguiria fazer isto, e a §11 mede
  -- exatamente essa impossibilidade — para o cooldown medido abaixo ser o da
  -- PRIMEIRA falha e não o de uma contagem herdada.
  update public.trips
     set suggestions_attempt_key = null, suggestions_attempt_at = null,
         suggestions_failed_attempts = 0
   where id = trip;

  perform pg_temp.as_user('c1a00000-0000-4000-8000-0000000000aa');
  select * into linha from public.claim_trip_suggestion_refresh(trip);
  perform pg_temp.check(linha.claimed, 'a tentativa começa');

  select * into resultado
    from public.settle_trip_suggestion_refresh(trip, linha.attempt, 'retry');
  perform pg_temp.check(resultado.settled, 'quem tem o token encerra');
  perform pg_temp.as_postgres();

  select * into estado from public.trips where id = trip;

  -- A AFIRMAÇÃO QUE ESTA SUÍTE EXISTE PARA FAZER.
  perform pg_temp.check(estado.suggestions_refreshed_at is null,
    'uma geração que não entregou nada NÃO grava a marca d''água de 6 horas');
  perform pg_temp.check(estado.suggestions_retry_after <= now() + interval '10 minutes'
                    and estado.suggestions_retry_after > now() + interval '9 minutes',
    'o que se grava é o cooldown curto de 10 minutos');
  perform pg_temp.check(estado.suggestions_failed_attempts = 1,
    'a falha foi contada');
  perform pg_temp.check(estado.suggestions_attempt_key is null
                    and estado.suggestions_attempt_at is null,
    'a tentativa foi liberada — a próxima não espera a lease');
end;
$$;

-- =============================================================================
-- 7. O cooldown segura, vence, e a falha seguinte dobra
-- =============================================================================
do $$
declare
  trip constant uuid := 'c1770000-0000-4000-8000-00000000000a';
  linha record;
  estado record;
begin
  raise notice '--- 7. cooldown ---';

  perform pg_temp.as_user('c1a00000-0000-4000-8000-0000000000aa');
  select * into linha from public.claim_trip_suggestion_refresh(trip);
  perform pg_temp.check(not linha.claimed, 'dentro do cooldown, uma nova tentativa é recusada');
  perform pg_temp.check(linha.retry_after is not null,
    'a recusa diz QUANDO — é o que a tela mostra em vez de "mais tarde"');
  perform pg_temp.check(linha.refreshed_at is null,
    'e não inventa uma atualização que não houve');
  perform pg_temp.as_postgres();

  -- Vencido o cooldown, a viagem volta a poder gerar — sem esperar seis horas.
  perform pg_temp.age('suggestions_retry_after', interval '11 minutes');

  perform pg_temp.as_user('c1a00000-0000-4000-8000-0000000000aa');
  select * into linha from public.claim_trip_suggestion_refresh(trip);
  perform pg_temp.check(linha.claimed, 'vencido o cooldown, a tentativa é permitida');
  perform public.settle_trip_suggestion_refresh(trip, linha.attempt, 'retry');
  perform pg_temp.as_postgres();

  select * into estado from public.trips where id = trip;
  perform pg_temp.check(estado.suggestions_failed_attempts = 2, 'a segunda falha foi contada');
  perform pg_temp.check(estado.suggestions_retry_after > now() + interval '19 minutes',
    'a segunda falha seguida espera o dobro — não é retry ilimitado');
end;
$$;

-- =============================================================================
-- 8. Entrega: aí sim, seis horas
-- =============================================================================
do $$
declare
  trip constant uuid := 'c1770000-0000-4000-8000-00000000000a';
  linha record;
  estado record;
begin
  raise notice '--- 8. entrega ---';

  perform pg_temp.age('suggestions_retry_after', interval '21 minutes');

  perform pg_temp.as_user('c1a00000-0000-4000-8000-0000000000aa');
  select * into linha from public.claim_trip_suggestion_refresh(trip);
  perform pg_temp.check(linha.claimed, 'a tentativa começa');
  perform public.settle_trip_suggestion_refresh(trip, linha.attempt, 'delivered');

  select * into estado from public.trips where id = trip;
  perform pg_temp.check(estado.suggestions_refreshed_at is not null,
    'a entrega grava a marca d''água');
  perform pg_temp.check(estado.suggestions_retry_after is null,
    'e limpa o cooldown: não há falha pendente');
  perform pg_temp.check(estado.suggestions_failed_attempts = 0,
    'a contagem de falhas volta a zero');

  -- A abertura seguinte não chama o provedor de novo dentro das seis horas.
  select * into linha from public.claim_trip_suggestion_refresh(trip);
  perform pg_temp.check(not linha.claimed, 'dentro das 6 horas, nova geração é recusada');
  perform pg_temp.check(linha.refreshed_at is not null,
    'e a recusa é a da janela de sucesso — com marca d''água, não com cooldown');
  perform pg_temp.check(linha.retry_after is null, 'sem cooldown curto pendurado');
  perform pg_temp.as_postgres();

  -- Contraprova: passadas as seis horas, a mesma chamada passa.
  perform pg_temp.age('suggestions_refreshed_at', interval '6 hours 1 minute');
  perform pg_temp.as_user('c1a00000-0000-4000-8000-0000000000aa');
  select * into linha from public.claim_trip_suggestion_refresh(trip);
  perform pg_temp.check(linha.claimed, 'passadas as 6 horas, a geração é permitida');

  -- 9. Falha determinística: consome a janela como uma entrega, e é assim que
  -- ela deixa de ser um laço de custo. Repetir em dez minutos gastaria de novo
  -- com a mesma certeza de falhar.
  perform public.settle_trip_suggestion_refresh(trip, linha.attempt, 'exhausted');
  select * into estado from public.trips where id = trip;
  perform pg_temp.check(estado.suggestions_refreshed_at > now() - interval '1 minute',
    'erro determinístico consome a janela de 6 horas');
  perform pg_temp.check(estado.suggestions_retry_after is null,
    'erro determinístico NÃO ganha o retry curto');

  select * into linha from public.claim_trip_suggestion_refresh(trip);
  perform pg_temp.check(not linha.claimed, 'e a tentativa seguinte é recusada');
  perform pg_temp.as_postgres();
end;
$$;

-- =============================================================================
-- 11. O aplicativo não escreve nenhuma destas colunas
--
-- Se `authenticated` pudesse gravá-las, todo o desenho seria decorativo: um
-- cliente modificado zeraria `suggestions_retry_after` e geraria em laço. A
-- 0012 revoga o UPDATE amplo e reconcede uma lista de colunas; as quatro
-- colunas novas não estão nela, e é isto que se mede aqui.
-- =============================================================================
do $$
declare trip constant uuid := 'c1770000-0000-4000-8000-00000000000a';
begin
  raise notice '--- 11. privilégio de coluna ---';

  perform pg_temp.as_user('c1a00000-0000-4000-8000-0000000000aa');
  perform pg_temp.deny_call(
    format('update public.trips set suggestions_retry_after = null where id = %L', trip),
    '42501', 'o dono não limpa o cooldown por conta própria');
  perform pg_temp.deny_call(
    format('update public.trips set suggestions_refreshed_at = null where id = %L', trip),
    '42501', 'o dono não apaga a marca d''água');
  perform pg_temp.deny_call(
    format('update public.trips set suggestions_attempt_key = null where id = %L', trip),
    '42501', 'o dono não rouba a tentativa de outro aparelho');
  perform pg_temp.deny_call(
    format('update public.trips set suggestions_failed_attempts = 0 where id = %L', trip),
    '42501', 'o dono não zera a contagem de falhas');

  -- E o que ele PODE continua podendo: a edição legítima da viagem não foi
  -- estreitada por acidente.
  update public.trips set destination_city = 'Moscovo' where id = trip;
  raise notice '  OK   a edição normal da viagem continua permitida';
  perform pg_temp.as_postgres();
end;
$$;

-- =============================================================================
-- 12. CONCORRÊNCIA DE VERDADE — duas conexões, não duas chamadas
--
-- Tudo acima roda numa sessão só, e numa sessão só nada prova exclusão mútua:
-- a segunda chamada vê o efeito da primeira porque ela já terminou. A pergunta
-- que interessa é outra — o que acontece com uma requisição que chega enquanto
-- a outra AINDA está no meio do caminho.
--
-- Aqui a sessão A abre uma transação e reserva a tentativa sem confirmar. Uma
-- segunda conexão (`dblink`) tenta reservar também:
--
--   · enquanto A não confirma, B trava no lock da linha e estoura o
--     `lock_timeout` — não passa e não chama provedor nenhum;
--   · depois do commit de A, B roda de novo, o PostgreSQL reavalia o predicado
--     depois do lock, e B recebe `claimed = false`.
--
-- É o `update ... where` único do claim que faz isso. Um "ler e depois gravar"
-- deixaria as duas passarem.
-- =============================================================================
create extension if not exists dblink;

do $$
declare
  trip constant uuid := 'c1770000-0000-4000-8000-00000000000a';
begin
  raise notice '--- 12. duas conexões ---';
  -- Estado limpo: sem tentativa, sem janela, sem cooldown.
  update public.trips
     set suggestions_attempt_key = null, suggestions_attempt_at = null,
         suggestions_refreshed_at = null, suggestions_retry_after = null,
         suggestions_failed_attempts = 0
   where id = trip;
end;
$$;

select dblink_connect('outra', 'dbname=' || current_database());
-- A segunda conexão é um usuário de verdade da viagem: o editor. Ela não é
-- recusada por permissão — o que se está medindo é a exclusão, não o papel.
select dblink_exec('outra',
  $$set request.jwt.claims = '{"sub":"c1b00000-0000-4000-8000-0000000000bb"}'$$);
-- Sem isto, B esperaria indefinidamente pelo lock e a suíte travaria em vez de
-- falhar. Dois segundos é muito mais do que o claim leva e muito menos do que
-- uma espera acidental.
select dblink_exec('outra', 'set lock_timeout to ''2s''');

begin;

set local role authenticated;
set local request.jwt.claims = '{"sub":"c1a00000-0000-4000-8000-0000000000aa"}';

do $outer$
declare
  trip constant uuid := 'c1770000-0000-4000-8000-00000000000a';
  venceu boolean;
begin
  -- A reserva de A, ainda NÃO confirmada: a linha fica travada até o commit.
  select claimed into venceu from public.claim_trip_suggestion_refresh(trip);
  perform pg_temp.check(venceu, 'A venceu o claim (transação aberta)');

  begin
    perform *
       from dblink('outra',
         $sql$select claimed from public.claim_trip_suggestion_refresh(
                'c1770000-0000-4000-8000-00000000000a')$sql$) as t(claimed boolean);
    raise exception 'FALHOU: B atravessou a tentativa de A';
  exception
    when lock_not_available then
      -- É o `lock_timeout` de B que dispara: sem ele as duas conexões ficariam
      -- esperando uma pela outra e a suíte travaria em vez de falhar.
      raise notice '  OK   B trava no lock da linha enquanto A não termina (55P03)';
  end;
end;
$outer$;

commit;

-- Confirmada a transação de A, B roda de novo: agora não há lock, e o predicado
-- é reavaliado contra a tentativa que A registrou.
do $outer$
declare venceu boolean;
begin
  select claimed into venceu
    from dblink('outra',
      $sql$select claimed from public.claim_trip_suggestion_refresh(
             'c1770000-0000-4000-8000-00000000000a')$sql$) as t(claimed boolean);

  perform pg_temp.check(not venceu,
    'depois do commit de A, B recebe claimed=false — uma única chamada ao provedor');

  perform pg_temp.check(
    (select suggestions_refreshed_at from public.trips
      where id = 'c1770000-0000-4000-8000-00000000000a') is null,
    'e nada disso gravou marca d''água: a tentativa de A ainda não terminou');
end;
$outer$;

select dblink_disconnect('outra');

do $$ begin raise notice '--- suíte concluída ---'; end $$;
