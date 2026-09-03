-- =============================================================================
-- Capa própria da viagem e meta de gasto diário (0013)
--
-- A 0013 conclui com um bloco `do $$ ... raise exception ...` que confere se as
-- colunas, o bucket e as quatro policies EXISTEM. Isso é inspeção: prova que os
-- objetos foram criados, e não prova nada sobre o que eles decidem. Esta suíte
-- cobre a outra metade — o comportamento — EXECUTANDO cada regra:
--
--   · o CHECK recusa mesmo zero e negativo, e não só o formulário;
--   · a policy de leitura deixa o editor e o viewer verem a capa (é o motivo de
--     o prefixo ser a VIAGEM e não o usuário — ver §4 da migration);
--   · a policy de escrita recusa o editor, que PODE editar o conteúdo da viagem
--     mas não a capa dela. Essa assimetria é intencional e é a que mais se
--     perderia numa refatoração distraída;
--   · `trip_cover_trip_id` não concede interpretação a caminho malformado.
--
-- Cinco identidades e duas viagens:
--
--   OWNER_A     dono da viagem A
--   EDITOR_B    editor aceito na viagem A   → lê a capa, NÃO escreve
--   VIEWER_C    viewer aceito na viagem A   → lê a capa, NÃO escreve
--   OUTSIDER_D  não participa de nada       → não lê, não escreve
--   OWNER_E     dono da viagem B            → mede o isolamento entre viagens
--
-- Rodar contra um banco descartável, depois de 0001–0016:
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

-- Escrita que a RLS tem de recusar. As duas formas de recusa contam como
-- sucesso, e a diferença entre elas não é acidental:
--
--   · INSERT contra `with check` LEVANTA erro (42501);
--   · UPDATE/DELETE contra `using` NÃO levanta — a linha simplesmente fica
--     invisível e o comando afeta 0 linhas.
--
-- Um teste que só procurasse exceção daria por recusado um DELETE que apagou
-- tudo, então aqui a contagem de linhas é conferida explicitamente.
create or replace function pg_temp.deny_dml(comando text, label text)
returns void language plpgsql as $$
declare afetadas integer;
begin
  execute comando;
  get diagnostics afetadas = row_count;
  if afetadas = 0 then
    raise notice '  OK   % (0 linhas)', label;
  else
    raise exception 'FALHOU: % — % linha(s) afetada(s)', label, afetadas;
  end if;
exception
  when insufficient_privilege then
    raise notice '  OK   % (recusado pela policy)', label;
end;
$$;

-- Escrita que TEM de passar, afetando exatamente o número esperado de linhas.
-- Sem a contagem, um UPDATE silenciosamente barrado pelo `using` passaria por
-- sucesso — que é exatamente o defeito que a contraprova do editor procura.
create or replace function pg_temp.allow_dml(comando text, esperado integer, label text)
returns void language plpgsql as $$
declare afetadas integer;
begin
  execute comando;
  get diagnostics afetadas = row_count;
  if afetadas = esperado then
    raise notice '  OK   % (% linha(s))', label, afetadas;
  else
    raise exception 'FALHOU: % — esperava % linha(s), afetou %', label, esperado, afetadas;
  end if;
end;
$$;

-- Comando que deve ser recusado pelo BANCO por violar restrição de dados
-- (CHECK), não por RLS. Separado de `deny_dml` de propósito: se um dia o CHECK
-- sumir e a linha entrar, este helper falha em vez de contar 0 linhas.
create or replace function pg_temp.deny_check(comando text, label text)
returns void language plpgsql as $$
begin
  execute comando;
  raise exception 'FALHOU: % — o valor foi aceito', label;
exception
  when check_violation then
    raise notice '  OK   % (check_violation)', label;
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
  ('c0a00000-0000-4000-8000-0000000000aa', 'cover.a@easytrip.app'),
  ('c0b00000-0000-4000-8000-0000000000bb', 'cover.b@easytrip.app'),
  ('c0c00000-0000-4000-8000-0000000000cc', 'cover.c@easytrip.app'),
  ('c0d00000-0000-4000-8000-0000000000dd', 'cover.d@easytrip.app'),
  ('c0e00000-0000-4000-8000-0000000000ee', 'cover.e@easytrip.app')
on conflict (id) do nothing;

insert into public.profiles (user_id, name) values
  ('c0a00000-0000-4000-8000-0000000000aa', 'Ana'),
  ('c0b00000-0000-4000-8000-0000000000bb', 'Bruno'),
  ('c0c00000-0000-4000-8000-0000000000cc', 'Clara'),
  ('c0d00000-0000-4000-8000-0000000000dd', 'Davi'),
  ('c0e00000-0000-4000-8000-0000000000ee', 'Elena')
on conflict (user_id) do update set name = excluded.name;

-- Viagem A (Ana) e viagem B (Elena). O trigger `on_trip_created` (0008) põe o
-- criador em `trip_members` como owner; não repetimos aqui, para exercitar o
-- mesmo caminho que a aplicação.
insert into public.trips
  (id, user_id, destination_city, destination_country, country_code, timezone,
   start_date, end_date, budget_total, budget_currency)
values
  ('c0770000-0000-4000-8000-00000000000a', 'c0a00000-0000-4000-8000-0000000000aa',
   'Tóquio', 'Japão', 'JP', 'Asia/Tokyo',
   current_date + 30, current_date + 40, 15000, 'BRL'),
  ('c0770000-0000-4000-8000-00000000000b', 'c0e00000-0000-4000-8000-0000000000ee',
   'Paris', 'França', 'FR', 'Europe/Paris',
   current_date + 60, current_date + 70, 12000, 'BRL')
on conflict (id) do nothing;

insert into public.trip_members (trip_id, user_id, role) values
  ('c0770000-0000-4000-8000-00000000000a', 'c0b00000-0000-4000-8000-0000000000bb', 'editor'),
  ('c0770000-0000-4000-8000-00000000000a', 'c0c00000-0000-4000-8000-0000000000cc', 'viewer')
on conflict (trip_id, user_id) do update set role = excluded.role;

-- =============================================================================
-- 1. As colunas existem, com o tipo e a nulidade que a migration promete
-- =============================================================================
do $$
declare
  tipo_capa  text;
  tipo_meta  text;
  nulavel_capa text;
  nulavel_meta text;
  padrao_meta  text;
begin
  raise notice '--- 1. colunas ---';

  select data_type, is_nullable, column_default
    into tipo_capa, nulavel_capa, padrao_meta
    from information_schema.columns
   where table_schema = 'public' and table_name = 'trips'
     and column_name = 'cover_image_path';
  perform pg_temp.check(tipo_capa = 'text', 'trips.cover_image_path existe e é text');
  perform pg_temp.check(nulavel_capa = 'YES', 'trips.cover_image_path aceita null');

  select data_type, is_nullable, column_default
    into tipo_meta, nulavel_meta, padrao_meta
    from information_schema.columns
   where table_schema = 'public' and table_name = 'trips'
     and column_name = 'daily_spending_goal';
  perform pg_temp.check(tipo_meta = 'numeric', 'trips.daily_spending_goal existe e é numeric');
  perform pg_temp.check(nulavel_meta = 'YES', 'trips.daily_spending_goal aceita null');
  -- `default 0` faria toda viagem existente amanhecer com a meta estourada.
  perform pg_temp.check(padrao_meta is null,
    'trips.daily_spending_goal NÃO tem default (null = sem meta)');

  -- `cover_image_url` (a URL sugerida do destino) continua existindo intacta:
  -- a coluna nova é outra, e confundir as duas já custou a foto de perfil.
  perform pg_temp.check(exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'trips'
       and column_name = 'cover_image_url'),
    'cover_image_url antiga não foi substituída pela nova');

  perform pg_temp.check(exists (
    select 1 from pg_constraint where conname = 'trips_daily_spending_goal_positive'),
    'a constraint trips_daily_spending_goal_positive existe');
end;
$$;

-- =============================================================================
-- 2. As duas viagens nascem com as colunas nulas, e null é um estado legítimo
-- =============================================================================
do $$
declare
  capa text;
  meta numeric;
begin
  raise notice '--- 2. estado inicial (null) ---';

  select cover_image_path, daily_spending_goal into capa, meta
    from public.trips where id = 'c0770000-0000-4000-8000-00000000000a';
  perform pg_temp.check(capa is null, 'viagem nova nasce sem cover_image_path');
  perform pg_temp.check(meta is null, 'viagem nova nasce sem daily_spending_goal');
end;
$$;

-- =============================================================================
-- 3. `daily_spending_goal` — o CHECK medido por execução
--
-- O aplicativo já recusa valor não positivo. Isto mede a segunda linha de
-- defesa: o `anon key` está no pacote e um PATCH direto no PostgREST não passa
-- por tela nenhuma.
-- =============================================================================
do $$
declare meta numeric;
begin
  raise notice '--- 3. meta diária: CHECK ---';

  perform pg_temp.allow_dml(
    $q$ update public.trips set daily_spending_goal = 300
         where id = 'c0770000-0000-4000-8000-00000000000a' $q$,
    1, 'aceita meta positiva (300)');
  select daily_spending_goal into meta from public.trips
   where id = 'c0770000-0000-4000-8000-00000000000a';
  perform pg_temp.check(meta = 300, 'a meta gravada é exatamente 300');

  -- Duas casas decimais, como `numeric(12,2)` promete.
  perform pg_temp.allow_dml(
    $q$ update public.trips set daily_spending_goal = 149.99
         where id = 'c0770000-0000-4000-8000-00000000000a' $q$,
    1, 'aceita meta com centavos (149.99)');
  select daily_spending_goal into meta from public.trips
   where id = 'c0770000-0000-4000-8000-00000000000a';
  perform pg_temp.check(meta = 149.99, 'os centavos não são truncados');

  -- Zero é "não gastar nada", e não "sem meta". O CHECK separa os dois.
  perform pg_temp.deny_check(
    $q$ update public.trips set daily_spending_goal = 0
         where id = 'c0770000-0000-4000-8000-00000000000a' $q$,
    'recusa meta zero');

  perform pg_temp.deny_check(
    $q$ update public.trips set daily_spending_goal = -1
         where id = 'c0770000-0000-4000-8000-00000000000a' $q$,
    'recusa meta negativa');

  perform pg_temp.deny_check(
    $q$ update public.trips set daily_spending_goal = -0.01
         where id = 'c0770000-0000-4000-8000-00000000000a' $q$,
    'recusa meta negativa de centavo');

  -- O CHECK também vale na INSERÇÃO, não só no update.
  perform pg_temp.deny_check(
    $q$ insert into public.trips
          (id, user_id, destination_city, destination_country, country_code,
           timezone, start_date, end_date, budget_total, budget_currency,
           daily_spending_goal)
        values ('c0770000-0000-4000-8000-00000000000f',
                'c0a00000-0000-4000-8000-0000000000aa',
                'Inválida', 'Brasil', 'BR', 'America/Sao_Paulo',
                current_date + 1, current_date + 2, 100, 'BRL', 0) $q$,
    'recusa meta zero também no insert');

  -- E null continua aceito: "não perguntei ainda".
  perform pg_temp.allow_dml(
    $q$ update public.trips set daily_spending_goal = null
         where id = 'c0770000-0000-4000-8000-00000000000a' $q$,
    1, 'aceita voltar a null (sem meta)');
  select daily_spending_goal into meta from public.trips
   where id = 'c0770000-0000-4000-8000-00000000000a';
  perform pg_temp.check(meta is null, 'a meta voltou a null');

  -- Deixa a viagem A com meta definida para o resto da suíte.
  update public.trips set daily_spending_goal = 300
   where id = 'c0770000-0000-4000-8000-00000000000a';
end;
$$;

-- =============================================================================
-- 4. `cover_image_path` guarda CAMINHO, e o caminho sobrevive à leitura
-- =============================================================================
do $$
declare capa text;
begin
  raise notice '--- 4. cover_image_path ---';

  perform pg_temp.allow_dml(
    $q$ update public.trips
           set cover_image_path = 'c0770000-0000-4000-8000-00000000000a/cover-11111111.jpg'
         where id = 'c0770000-0000-4000-8000-00000000000a' $q$,
    1, 'aceita caminho válido');

  select cover_image_path into capa from public.trips
   where id = 'c0770000-0000-4000-8000-00000000000a';
  perform pg_temp.check(
    capa = 'c0770000-0000-4000-8000-00000000000a/cover-11111111.jpg',
    'o caminho volta da leitura idêntico ao gravado');
  perform pg_temp.check(capa not like 'http%',
    'o que está gravado é caminho, não URL assinada');

  perform pg_temp.allow_dml(
    $q$ update public.trips set cover_image_path = null
         where id = 'c0770000-0000-4000-8000-00000000000a' $q$,
    1, 'aceita null (restaurar a imagem sugerida do destino)');
  select cover_image_path into capa from public.trips
   where id = 'c0770000-0000-4000-8000-00000000000a';
  perform pg_temp.check(capa is null, 'restaurar o padrão volta a coluna para null');

  update public.trips
     set cover_image_path = 'c0770000-0000-4000-8000-00000000000a/cover-11111111.jpg'
   where id = 'c0770000-0000-4000-8000-00000000000a';
end;
$$;

-- =============================================================================
-- 5. O bucket `trip-covers`
-- =============================================================================
do $$
declare
  publico  boolean;
  limite   bigint;
  mimes    text[];
begin
  raise notice '--- 5. bucket trip-covers ---';

  select public, file_size_limit, allowed_mime_types
    into publico, limite, mimes
    from storage.buckets where id = 'trip-covers';

  perform pg_temp.check(publico is not null, 'o bucket trip-covers existe');
  -- A capa diz para onde a pessoa vai e quando. Público seria vazamento.
  perform pg_temp.check(publico = false, 'o bucket trip-covers é PRIVADO');
  perform pg_temp.check(limite = 5242880, 'o limite é 5 MiB, como TRIP_COVER_POLICY');
  perform pg_temp.check(mimes @> array['image/jpeg', 'image/png', 'image/webp'],
    'aceita image/jpeg, image/png e image/webp');
  perform pg_temp.check(array_length(mimes, 1) = 3,
    'e NADA além dos três tipos de imagem');

  -- `content` continua sendo o único bucket público do projeto (0007).
  perform pg_temp.check(
    (select public from storage.buckets where id = 'content') = true,
    'o bucket content continua público (nada foi trocado por engano)');
end;
$$;

-- =============================================================================
-- 6. `trip_cover_trip_id` — extrair o tripId, e não inventar um
--
-- Esta função é o ponto onde uma policy de Storage vira uma pergunta sobre
-- viagem. Um caminho malformado tem de virar `null`, porque `is_trip_member(null)`
-- e `is_trip_owner(null)` são `false` — negar. O que NÃO pode acontecer é o
-- `::uuid` levantar exceção dentro da policy: isso derrubaria a listagem inteira
-- do bucket em vez de recusar um objeto.
-- =============================================================================
do $$
declare id_extraido uuid;
begin
  raise notice '--- 6. trip_cover_trip_id ---';

  -- Caminho no formato que a aplicação grava.
  select public.trip_cover_trip_id(
    'c0770000-0000-4000-8000-00000000000a/cover-11111111.jpg') into id_extraido;
  perform pg_temp.check(id_extraido = 'c0770000-0000-4000-8000-00000000000a',
    'extrai o tripId de um caminho válido');

  -- Maiúsculas: o regex aceita os dois casos, e o `::uuid` normaliza.
  select public.trip_cover_trip_id(
    'C0770000-0000-4000-8000-00000000000A/cover-1.png') into id_extraido;
  perform pg_temp.check(id_extraido = 'c0770000-0000-4000-8000-00000000000a',
    'aceita o uuid em maiúsculas e normaliza');

  -- Subpasta: o primeiro segmento continua mandando.
  select public.trip_cover_trip_id(
    'c0770000-0000-4000-8000-00000000000a/thumbs/cover-1.png') into id_extraido;
  perform pg_temp.check(id_extraido = 'c0770000-0000-4000-8000-00000000000a',
    'o primeiro segmento decide, mesmo com subpasta');

  -- ---- e agora tudo o que NÃO pode virar um tripId ----
  perform pg_temp.check(public.trip_cover_trip_id('cover-1.jpg') is null,
    'arquivo na raiz do bucket → null');
  perform pg_temp.check(public.trip_cover_trip_id('c0770000-0000-4000-8000-00000000000a') is null,
    'objeto cujo NOME é um uuid, sem pasta → null');
  perform pg_temp.check(public.trip_cover_trip_id('naoehuuid/cover-1.jpg') is null,
    'primeiro segmento que não é uuid → null');
  perform pg_temp.check(public.trip_cover_trip_id('../c0770000-0000-4000-8000-00000000000a/x.jpg') is null,
    'travessia de caminho → null');
  perform pg_temp.check(public.trip_cover_trip_id('/c0770000-0000-4000-8000-00000000000a/x.jpg') is null,
    'barra inicial (primeiro segmento vazio) → null');
  perform pg_temp.check(public.trip_cover_trip_id('c0770000-0000-4000-8000-00000000000/x.jpg') is null,
    'uuid com um dígito a menos → null');
  perform pg_temp.check(public.trip_cover_trip_id('c0770000_0000_4000_8000_00000000000a/x.jpg') is null,
    'uuid com underscore no lugar do hífen → null');
  perform pg_temp.check(public.trip_cover_trip_id('g0770000-0000-4000-8000-00000000000a/x.jpg') is null,
    'caractere fora do hexadecimal → null');
  perform pg_temp.check(public.trip_cover_trip_id('') is null, 'caminho vazio → null');
  perform pg_temp.check(public.trip_cover_trip_id(null) is null, 'caminho null → null');

  -- O regex é a razão de nada disso levantar exceção. Se o `::uuid` fosse
  -- direto, as linhas acima abortariam a policy em vez de negar o objeto.
  raise notice '  OK   nenhum caminho malformado levantou exceção';
end;
$$;

-- =============================================================================
-- 7. Quem alcança `trip_cover_trip_id`
-- =============================================================================
do $$
begin
  raise notice '--- 7. grants da função ---';
  perform pg_temp.check(
    not has_function_privilege('anon', 'public.trip_cover_trip_id(text)', 'execute'),
    'anon NÃO executa trip_cover_trip_id');
  perform pg_temp.check(
    has_function_privilege('authenticated', 'public.trip_cover_trip_id(text)', 'execute'),
    'authenticated executa trip_cover_trip_id');
  perform pg_temp.check(
    has_function_privilege('service_role', 'public.trip_cover_trip_id(text)', 'execute'),
    'service_role executa trip_cover_trip_id');
end;
$$;

-- =============================================================================
-- 8. As quatro policies existem e cobrem os quatro comandos
-- =============================================================================
do $$
declare comandos text;
begin
  raise notice '--- 8. policies de storage ---';

  select string_agg(cmd, ',' order by cmd) into comandos
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname like 'trip_covers_%';
  perform pg_temp.check(comandos = 'DELETE,INSERT,SELECT,UPDATE',
    'há uma policy para cada um dos quatro comandos');

  perform pg_temp.check(
    (select count(*) from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname like 'trip_covers_%' and 'authenticated' = any(roles)) = 4,
    'as quatro valem para authenticated (e não para anon)');

  perform pg_temp.check(
    (select relrowsecurity from pg_class
      where oid = 'storage.objects'::regclass),
    'a RLS está ligada em storage.objects');
end;
$$;

-- =============================================================================
-- 9. LEITURA da capa — o membro vê, o estranho não
--
-- Duas capas, uma por viagem, inseridas fora de sessão (o storage-api escreve
-- com service_role). As asserções medem quem consegue enxergá-las depois.
-- =============================================================================
insert into storage.objects (bucket_id, name) values
  ('trip-covers', 'c0770000-0000-4000-8000-00000000000a/cover-11111111.jpg'),
  ('trip-covers', 'c0770000-0000-4000-8000-00000000000b/cover-22222222.jpg')
on conflict do nothing;

do $$
declare visiveis integer;
begin
  raise notice '--- 9. leitura ---';

  -- OWNER_A
  perform pg_temp.as_user('c0a00000-0000-4000-8000-0000000000aa');
  select count(*) into visiveis from storage.objects
   where bucket_id = 'trip-covers'
     and name = 'c0770000-0000-4000-8000-00000000000a/cover-11111111.jpg';
  perform pg_temp.check(visiveis = 1, 'proprietário lê a capa da própria viagem');

  -- EDITOR_B — a asserção que justifica o prefixo ser a viagem e não o usuário.
  perform pg_temp.as_user('c0b00000-0000-4000-8000-0000000000bb');
  select count(*) into visiveis from storage.objects
   where bucket_id = 'trip-covers'
     and name = 'c0770000-0000-4000-8000-00000000000a/cover-11111111.jpg';
  perform pg_temp.check(visiveis = 1, 'editor convidado lê a capa da viagem');

  -- VIEWER_C
  perform pg_temp.as_user('c0c00000-0000-4000-8000-0000000000cc');
  select count(*) into visiveis from storage.objects
   where bucket_id = 'trip-covers'
     and name = 'c0770000-0000-4000-8000-00000000000a/cover-11111111.jpg';
  perform pg_temp.check(visiveis = 1, 'viewer convidado lê a capa da viagem');

  -- OUTSIDER_D
  perform pg_temp.as_user('c0d00000-0000-4000-8000-0000000000dd');
  select count(*) into visiveis from storage.objects
   where bucket_id = 'trip-covers'
     and name = 'c0770000-0000-4000-8000-00000000000a/cover-11111111.jpg';
  perform pg_temp.check(visiveis = 0, 'estranho NÃO lê a capa');

  select count(*) into visiveis from storage.objects where bucket_id = 'trip-covers';
  perform pg_temp.check(visiveis = 0, 'estranho não enxerga capa nenhuma no bucket');

  perform pg_temp.as_postgres();
end;
$$;

-- =============================================================================
-- 10. ISOLAMENTO entre viagens — membro de A não alcança a capa de B
-- =============================================================================
do $$
declare visiveis integer;
begin
  raise notice '--- 10. isolamento A × B ---';

  perform pg_temp.as_user('c0a00000-0000-4000-8000-0000000000aa');
  select count(*) into visiveis from storage.objects
   where bucket_id = 'trip-covers'
     and name = 'c0770000-0000-4000-8000-00000000000b/cover-22222222.jpg';
  perform pg_temp.check(visiveis = 0, 'dono da viagem A NÃO lê a capa da viagem B');

  select count(*) into visiveis from storage.objects where bucket_id = 'trip-covers';
  perform pg_temp.check(visiveis = 1, 'dono de A enxerga exatamente 1 capa: a dele');

  perform pg_temp.as_user('c0b00000-0000-4000-8000-0000000000bb');
  select count(*) into visiveis from storage.objects
   where bucket_id = 'trip-covers'
     and name = 'c0770000-0000-4000-8000-00000000000b/cover-22222222.jpg';
  perform pg_temp.check(visiveis = 0, 'editor de A NÃO lê a capa da viagem B');

  perform pg_temp.as_user('c0e00000-0000-4000-8000-0000000000ee');
  select count(*) into visiveis from storage.objects where bucket_id = 'trip-covers';
  perform pg_temp.check(visiveis = 1, 'dono de B enxerga exatamente 1 capa: a dele');

  -- E ninguém escreve na pasta da viagem alheia.
  perform pg_temp.as_user('c0a00000-0000-4000-8000-0000000000aa');
  perform pg_temp.deny_dml(
    $q$ insert into storage.objects (bucket_id, name)
        values ('trip-covers',
                'c0770000-0000-4000-8000-00000000000b/cover-invasao.jpg') $q$,
    'dono de A não grava capa na pasta da viagem B');

  perform pg_temp.as_postgres();
end;
$$;

-- =============================================================================
-- 11. ESCRITA — só o proprietário
-- =============================================================================
do $$
begin
  raise notice '--- 11. escrita: proprietário ---';
  perform pg_temp.as_user('c0a00000-0000-4000-8000-0000000000aa');

  -- Trocar a capa grava um objeto NOVO (sufixo aleatório, para a URL assinada
  -- anterior não passar a servir outro conteúdo) e depois remove o antigo.
  perform pg_temp.allow_dml(
    $q$ insert into storage.objects (bucket_id, name)
        values ('trip-covers',
                'c0770000-0000-4000-8000-00000000000a/cover-33333333.webp') $q$,
    1, 'proprietário INSERE a capa nova');

  perform pg_temp.allow_dml(
    $q$ update storage.objects
           set name = 'c0770000-0000-4000-8000-00000000000a/cover-44444444.webp'
         where bucket_id = 'trip-covers'
           and name = 'c0770000-0000-4000-8000-00000000000a/cover-33333333.webp' $q$,
    1, 'proprietário ATUALIZA a capa');

  perform pg_temp.allow_dml(
    $q$ delete from storage.objects
         where bucket_id = 'trip-covers'
           and name = 'c0770000-0000-4000-8000-00000000000a/cover-44444444.webp' $q$,
    1, 'proprietário EXCLUI a capa antiga');

  -- O `with check` do update também vale: não dá para renomear a capa para
  -- dentro da pasta de outra viagem.
  perform pg_temp.deny_dml(
    $q$ update storage.objects
           set name = 'c0770000-0000-4000-8000-00000000000b/roubada.jpg'
         where bucket_id = 'trip-covers'
           and name = 'c0770000-0000-4000-8000-00000000000a/cover-11111111.jpg' $q$,
    'proprietário não move a própria capa para a viagem de outro');

  perform pg_temp.as_postgres();
end;
$$;

-- =============================================================================
-- 12. EDITOR não escreve a capa
--
-- Esta é a assimetria intencional da 0013: o editor PODE escrever conteúdo
-- compartilhado da viagem (`can_edit_trip`), mas a capa é propriedade dela e
-- segue `is_trip_owner`, igual ao `trips_update` da 0008.
-- =============================================================================
do $$
declare pode_editar boolean;
begin
  raise notice '--- 12. editor ---';
  perform pg_temp.as_user('c0b00000-0000-4000-8000-0000000000bb');

  -- Primeiro provamos que ele É editor de verdade: sem isto, as três recusas
  -- abaixo passariam com o editor tendo perdido o convite por acidente.
  select public.can_edit_trip('c0770000-0000-4000-8000-00000000000a') into pode_editar;
  perform pg_temp.check(pode_editar, 'o editor realmente pode editar o conteúdo da viagem');
  perform pg_temp.check(
    not public.is_trip_owner('c0770000-0000-4000-8000-00000000000a'),
    'e não é proprietário dela');

  perform pg_temp.deny_dml(
    $q$ insert into storage.objects (bucket_id, name)
        values ('trip-covers',
                'c0770000-0000-4000-8000-00000000000a/cover-editor.jpg') $q$,
    'editor NÃO insere capa');

  perform pg_temp.deny_dml(
    $q$ update storage.objects
           set name = 'c0770000-0000-4000-8000-00000000000a/cover-editor.jpg'
         where bucket_id = 'trip-covers'
           and name = 'c0770000-0000-4000-8000-00000000000a/cover-11111111.jpg' $q$,
    'editor NÃO atualiza capa');

  perform pg_temp.deny_dml(
    $q$ delete from storage.objects
         where bucket_id = 'trip-covers'
           and name = 'c0770000-0000-4000-8000-00000000000a/cover-11111111.jpg' $q$,
    'editor NÃO exclui capa');

  -- Mesma regra do lado da tabela: a meta diária é do proprietário (0008).
  perform pg_temp.deny_dml(
    $q$ update public.trips set daily_spending_goal = 999
         where id = 'c0770000-0000-4000-8000-00000000000a' $q$,
    'editor NÃO grava a meta diária');

  perform pg_temp.deny_dml(
    $q$ update public.trips set cover_image_path = 'x/y.jpg'
         where id = 'c0770000-0000-4000-8000-00000000000a' $q$,
    'editor NÃO grava cover_image_path');

  perform pg_temp.as_postgres();
end;
$$;

-- =============================================================================
-- 13. VIEWER não escreve nada
-- =============================================================================
do $$
begin
  raise notice '--- 13. viewer ---';
  perform pg_temp.as_user('c0c00000-0000-4000-8000-0000000000cc');

  perform pg_temp.check(
    public.is_trip_member('c0770000-0000-4000-8000-00000000000a'),
    'o viewer realmente participa da viagem');

  perform pg_temp.deny_dml(
    $q$ insert into storage.objects (bucket_id, name)
        values ('trip-covers',
                'c0770000-0000-4000-8000-00000000000a/cover-viewer.jpg') $q$,
    'viewer NÃO insere capa');

  perform pg_temp.deny_dml(
    $q$ update storage.objects
           set name = 'c0770000-0000-4000-8000-00000000000a/cover-viewer.jpg'
         where bucket_id = 'trip-covers'
           and name = 'c0770000-0000-4000-8000-00000000000a/cover-11111111.jpg' $q$,
    'viewer NÃO atualiza capa');

  perform pg_temp.deny_dml(
    $q$ delete from storage.objects
         where bucket_id = 'trip-covers'
           and name = 'c0770000-0000-4000-8000-00000000000a/cover-11111111.jpg' $q$,
    'viewer NÃO exclui capa');

  perform pg_temp.deny_dml(
    $q$ update public.trips set daily_spending_goal = 999
         where id = 'c0770000-0000-4000-8000-00000000000a' $q$,
    'viewer NÃO grava a meta diária');

  perform pg_temp.as_postgres();
end;
$$;

-- =============================================================================
-- 14. ESTRANHO não lê nem escreve
-- =============================================================================
do $$
begin
  raise notice '--- 14. estranho ---';
  perform pg_temp.as_user('c0d00000-0000-4000-8000-0000000000dd');

  perform pg_temp.check(
    not public.is_trip_member('c0770000-0000-4000-8000-00000000000a'),
    'o estranho realmente não participa da viagem');

  perform pg_temp.deny_dml(
    $q$ insert into storage.objects (bucket_id, name)
        values ('trip-covers',
                'c0770000-0000-4000-8000-00000000000a/cover-estranho.jpg') $q$,
    'estranho NÃO insere capa');

  perform pg_temp.deny_dml(
    $q$ update storage.objects
           set name = 'c0770000-0000-4000-8000-00000000000a/cover-estranho.jpg'
         where bucket_id = 'trip-covers'
           and name = 'c0770000-0000-4000-8000-00000000000a/cover-11111111.jpg' $q$,
    'estranho NÃO atualiza capa');

  perform pg_temp.deny_dml(
    $q$ delete from storage.objects
         where bucket_id = 'trip-covers'
           and name = 'c0770000-0000-4000-8000-00000000000a/cover-11111111.jpg' $q$,
    'estranho NÃO exclui capa');

  -- Um objeto na RAIZ do bucket não é de ninguém: `trip_cover_trip_id` devolve
  -- null e `is_trip_owner(null)` é false. Sem o regex, um nome inesperado
  -- levantaria exceção aqui em vez de ser recusado.
  perform pg_temp.deny_dml(
    $q$ insert into storage.objects (bucket_id, name)
        values ('trip-covers', 'cover-solta.jpg') $q$,
    'ninguém grava objeto na raiz do bucket');

  perform pg_temp.deny_dml(
    $q$ insert into storage.objects (bucket_id, name)
        values ('trip-covers', 'c0770000-0000-4000-8000-00000000000a') $q$,
    'objeto cujo nome é o uuid da viagem, sem pasta, também é recusado');

  perform pg_temp.as_postgres();
end;
$$;

-- =============================================================================
-- 15. Nada do que foi recusado entrou
--
-- Fecha a suíte contando as linhas fora de sessão. Se qualquer `deny_dml` acima
-- tivesse contado 0 linhas por um motivo errado — a linha não existir, o filtro
-- não bater — esta contagem denunciaria.
-- =============================================================================
do $$
declare
  total integer;
  intrusos integer;
begin
  raise notice '--- 15. estado final ---';

  select count(*) into total from storage.objects where bucket_id = 'trip-covers';
  perform pg_temp.check(total = 2,
    'o bucket terminou com exatamente as 2 capas legítimas');

  select count(*) into intrusos from storage.objects
   where bucket_id = 'trip-covers'
     and (name like '%editor%' or name like '%viewer%' or name like '%estranho%'
          or name like '%invasao%' or name like '%roubada%' or name like '%solta%');
  perform pg_temp.check(intrusos = 0, 'nenhuma escrita recusada deixou objeto para trás');

  perform pg_temp.check(
    (select daily_spending_goal from public.trips
      where id = 'c0770000-0000-4000-8000-00000000000a') = 300,
    'a meta continua 300: nem editor nem viewer conseguiram mudá-la');

  perform pg_temp.check(
    (select cover_image_path from public.trips
      where id = 'c0770000-0000-4000-8000-00000000000a')
      = 'c0770000-0000-4000-8000-00000000000a/cover-11111111.jpg',
    'o caminho da capa continua o que o proprietário gravou');

  perform pg_temp.check(
    not exists (select 1 from public.trips
                 where id = 'c0770000-0000-4000-8000-00000000000f'),
    'a viagem com meta zero nunca foi criada');
end;
$$;

do $$ begin raise notice 'trip_cover_and_daily_goal.test.sql — todas as asserções passaram'; end; $$;
