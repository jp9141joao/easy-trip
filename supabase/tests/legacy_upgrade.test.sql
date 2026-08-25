-- =============================================================================
-- Upgrade de um banco legado: 0001–0007 com dados, depois 0008–0012.
--
-- POR QUE ISTO EXISTE
--
-- O projeto remoto está em 0007. Quem já usa o aplicativo tem viagem, roteiro,
-- checklist, despesa, diário, mídia e passagem gravados sob o schema antigo —
-- em que autorização era `user_id = auth.uid()` e não existiam `visibility`,
-- `created_by`, `paid_by` nem `trip_members`.
--
-- As migrations 0008–0012 introduzem tudo isso. A pergunta que este arquivo
-- responde não é "as migrations aplicam?" (isso a base limpa já mostra), é:
-- **o que já estava lá continua existindo, e com o significado certo?**
--
-- Um backfill errado aqui não dá erro: ele dá silêncio. A viagem some da lista
-- porque ninguém virou membro; o item do roteiro fica `private` sem dono e
-- desaparece para todo mundo; a despesa perde quem pagou. Nada disso levanta
-- exceção — por isso cada propriedade é medida.
--
-- Como rodar (banco descartável, NUNCA o remoto):
--   psql -f supabase/tests/_local_bootstrap.sql
--   psql -f supabase/migrations/0001..0007
--   psql -f supabase/tests/legacy_upgrade.test.sql   <- só a parte 1 (semear)
--   psql -f supabase/migrations/0008..0012
--   psql -v part=2 -f supabase/tests/legacy_upgrade.test.sql
--
-- O script `scripts/legacy-upgrade-check.sh` faz essa sequência inteira.
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

-- =============================================================================
-- Parte 2 — as asserções, depois de 0008–0012
-- =============================================================================

-- ------------------------------------------------------------------ a viagem
select pg_temp.check(
  (select count(*) from public.trips where id = 'aa000000-0000-4000-8000-00000000000a') = 1,
  '1: a viagem legada continua existindo'
);

select pg_temp.check(
  (select user_id from public.trips where id = 'aa000000-0000-4000-8000-00000000000a')
    = 'a0000000-0000-4000-8000-00000000000a',
  '2: a viagem continua apontando para o mesmo dono'
);

-- --------------------------------------------------------- backfill de membro
select pg_temp.check(
  (select count(*) from public.trip_members
    where trip_id = 'aa000000-0000-4000-8000-00000000000a') = 1,
  '3: o backfill criou exatamente um membro para a viagem legada'
);

select pg_temp.check(
  (select role from public.trip_members
    where trip_id = 'aa000000-0000-4000-8000-00000000000a') = 'owner',
  '4: o dono histórico virou `owner`, e não `viewer`'
);

select pg_temp.check(
  (select user_id from public.trip_members
    where trip_id = 'aa000000-0000-4000-8000-00000000000a')
    = 'a0000000-0000-4000-8000-00000000000a',
  '5: o membro criado é o dono da coluna `user_id`'
);

-- -------------------------------------------------------------- o conteúdo
select pg_temp.check(
  (select count(*) from public.itinerary_items
    where trip_id = 'aa000000-0000-4000-8000-00000000000a') = 1,
  '6: o item de roteiro sobreviveu'
);
select pg_temp.check(
  (select title from public.itinerary_items
    where id = 'ab000000-0000-4000-8000-00000000000b') = 'Museu do Louvre',
  '7: e com o mesmo conteúdo'
);
select pg_temp.check(
  (select count(*) from public.checklist_items
    where trip_id = 'aa000000-0000-4000-8000-00000000000a') = 1,
  '8: o item de checklist sobreviveu'
);
select pg_temp.check(
  (select count(*) from public.expenses
    where trip_id = 'aa000000-0000-4000-8000-00000000000a') = 1,
  '9: a despesa sobreviveu'
);
select pg_temp.check(
  (select amount from public.expenses
    where id = 'ad000000-0000-4000-8000-00000000000d') = 250.50,
  '10: e com o mesmo valor'
);
select pg_temp.check(
  (select count(*) from public.journal_entries
    where trip_id = 'aa000000-0000-4000-8000-00000000000a') = 1,
  '11: a entrada de diário sobreviveu'
);
select pg_temp.check(
  (select count(*) from public.journal_media
    where journal_entry_id = 'ae000000-0000-4000-8000-00000000000e') = 1,
  '12: a mídia do diário sobreviveu'
);
select pg_temp.check(
  (select file_path from public.journal_media
    where id = 'af000000-0000-4000-8000-00000000000f')
    = 'a0000000-0000-4000-8000-00000000000a/ae000000-0000-4000-8000-00000000000e/foto.jpg',
  '13: e o caminho de Storage não foi reescrito'
);
select pg_temp.check(
  (select count(*) from public.tickets
    where trip_id = 'aa000000-0000-4000-8000-00000000000a') = 2,
  '14: as duas passagens sobreviveram'
);

-- ---------------------------------------------------- visibilidade (0009)
select pg_temp.check(
  (select bool_and(visibility = 'shared') from public.itinerary_items
    where trip_id = 'aa000000-0000-4000-8000-00000000000a'),
  '15: roteiro legado nasce `shared` — dado que era visível continua visível'
);
select pg_temp.check(
  (select bool_and(visibility = 'shared') from public.checklist_items
    where trip_id = 'aa000000-0000-4000-8000-00000000000a'),
  '16: checklist legado nasce `shared`'
);
/*
 * Daqui em diante o backfill é `private`, e a assimetria é a decisão — não um
 * descuido. O cabeçalho da 0009 a documenta:
 *
 *   roteiro/checklist  shared   — é logística da viagem
 *   despesa/diário     private  — sempre foram de uma pessoa
 *   reserva            private no backfill, shared no default
 *
 * A reserva é o caso que mais importa medir. A COLUNA nasce com default
 * `shared`, porque uma reserva criada de hoje em diante é criada por alguém que
 * já sabe que a viagem tem gente dentro. Mas uma reserva que JÁ EXISTIA foi
 * criada quando a viagem era de uma pessoa só, muitas vezes com o cartão de
 * embarque anexado — nome completo e localizador. Deixá-la seguir o default
 * entregaria esse arquivo ao primeiro convidado sem que ninguém decidisse nada.
 *
 * Se alguém "simplificar" a 0009 removendo o UPDATE que força `private` nas
 * reservas antigas, o default silenciosamente assume e estas asserções caem.
 */
select pg_temp.check(
  (select bool_and(visibility = 'private') from public.expenses
    where trip_id = 'aa000000-0000-4000-8000-00000000000a'),
  '17: despesa legada permanece `private` — ela sempre foi de uma pessoa só'
);
select pg_temp.check(
  (select bool_and(visibility = 'private') from public.journal_entries
    where trip_id = 'aa000000-0000-4000-8000-00000000000a'),
  '18: diário legado permanece `private`'
);
select pg_temp.check(
  (select bool_and(visibility = 'private') from public.tickets
    where trip_id = 'aa000000-0000-4000-8000-00000000000a'),
  '19: reserva legada entra `private`, contra o default `shared` da coluna'
);
select pg_temp.check(
  (select column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'tickets' and column_name = 'visibility')
    like '%shared%',
  '19b: e o default da coluna continua `shared` para as reservas novas'
);

-- -------------------------------------------------------- autoria (0009)
select pg_temp.check(
  (select bool_and(created_by = 'a0000000-0000-4000-8000-00000000000a')
     from public.itinerary_items where trip_id = 'aa000000-0000-4000-8000-00000000000a'),
  '20: `created_by` do roteiro foi preenchido com o dono da viagem'
);
select pg_temp.check(
  (select bool_and(created_by = 'a0000000-0000-4000-8000-00000000000a')
     from public.journal_entries where trip_id = 'aa000000-0000-4000-8000-00000000000a'),
  '21: `created_by` do diário veio do `user_id` histórico'
);
select pg_temp.check(
  (select bool_and(created_by is not null)
     from public.tickets where trip_id = 'aa000000-0000-4000-8000-00000000000a'),
  '22: nenhuma passagem ficou sem autor'
);

-- ------------------------------------------------------------ paid_by (0009)
select pg_temp.check(
  (select paid_by from public.expenses where id = 'ad000000-0000-4000-8000-00000000000d')
    = 'a0000000-0000-4000-8000-00000000000a',
  '23: `paid_by` da despesa legada é quem a lançou'
);

-- --------------------------------------------------------- legacy_type (0011)
select pg_temp.check(
  (select type from public.tickets where id = 'b1000000-0000-4000-8000-000000000011') = 'flight',
  '24: `voo` foi normalizado para `flight`'
);
select pg_temp.check(
  (select legacy_type from public.tickets where id = 'b1000000-0000-4000-8000-000000000011') = 'voo',
  '25: e o valor original ficou guardado em `legacy_type`'
);
select pg_temp.check(
  (select type from public.tickets where id = 'b2000000-0000-4000-8000-000000000022') = 'hotel',
  '26: `hospedagem` foi normalizado para `hotel`'
);
select pg_temp.check(
  (select status from public.tickets where id = 'b1000000-0000-4000-8000-000000000011') = 'confirmed',
  '27: passagem legada nasce `confirmed` — ela existia porque foi reservada'
);

-- ------------------------------------------------- sugestões e marca (0012)
select pg_temp.check(
  (select suggestions_refreshed_at is null from public.trips
    where id = 'aa000000-0000-4000-8000-00000000000a'),
  '28: a viagem legada começa sem marca de atualização de sugestões'
);
select pg_temp.check(
  (select count(*) from public.trip_suggestions
    where trip_id = 'aa000000-0000-4000-8000-00000000000a') = 0,
  '29: nenhuma sugestão foi inventada para a viagem legada'
);

-- ------------------------------------- nada ficou órfão de dono na migração
select pg_temp.check(
  not exists (
    select 1 from public.trips t
     where not exists (select 1 from public.trip_members m where m.trip_id = t.id)
  ),
  '30: nenhuma viagem ficou sem membro depois do backfill'
);

do $$ begin raise notice 'Upgrade legado 0007 → 0012: tudo verde.'; end $$;
