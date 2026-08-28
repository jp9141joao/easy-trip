-- =============================================================================
-- Easy Trip — capa própria da viagem e meta de gasto diário (F-Melhorias)
--
-- Duas necessidades da rodada de melhorias, e nenhuma delas cabia no schema
-- atual:
--
--   §3–§6  Alterar a imagem da viagem. Hoje `trips.cover_image_url` guarda uma
--          URL de terceiro (o Unsplash sugerido em `suggestCoverImage`). Para
--          aceitar uma foto da galeria é preciso um lugar para o ARQUIVO e uma
--          coluna para o CAMINHO dele — que não é a mesma coisa que uma URL, e
--          a diferença já custou caro neste projeto: enquanto `avatar_path` e
--          `avatar_url` foram um campo só, a URL assinada era regravada por
--          cima do caminho e a foto sumia na leitura seguinte. Por isso a
--          coluna nova é `cover_image_path` e a antiga fica exatamente como
--          está.
--
--   §27–§37 Meta de gasto diário. É por VIAGEM, não por conta: Tóquio a 500/dia
--          e São Paulo a 250/dia são a mesma pessoa com dois orçamentos. O
--          lugar natural é ao lado de `budget_total`, na mesma linha e na mesma
--          moeda.
--
-- Nenhuma migration anterior é alterada. 0001–0012 continuam como estão.
--
-- ESTA MIGRATION NÃO FOI APLICADA. Ver o relatório da rodada: a implementação
-- do aplicativo está pronta e aguarda autorização para ir ao banco.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Colunas novas em `trips`
--
-- As duas são `null` por padrão e sem backfill, porque a ausência é um estado
-- legítimo e distinto:
--
--   `cover_image_path is null`     → a viagem usa a imagem sugerida do destino;
--   `daily_spending_goal is null`  → a viagem não tem meta diária.
--
-- Em particular, `daily_spending_goal` NÃO recebe `default 0`. Zero seria uma
-- meta de não gastar nada, e toda viagem existente amanheceria com a meta
-- estourada no primeiro café. `null` é "não perguntei ainda", que é a verdade.
--
-- O CHECK existe pelo mesmo motivo: o aplicativo já recusa valor não positivo,
-- mas o `anon key` está no pacote e um PATCH direto no PostgREST não passa por
-- tela nenhuma.
-- ----------------------------------------------------------------------------
alter table public.trips
  add column if not exists cover_image_path text;

alter table public.trips
  add column if not exists daily_spending_goal numeric(12, 2);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'trips_daily_spending_goal_positive'
  ) then
    alter table public.trips
      add constraint trips_daily_spending_goal_positive
      check (daily_spending_goal is null or daily_spending_goal > 0);
  end if;
end;
$$;

comment on column public.trips.cover_image_path is
  'Caminho do objeto no bucket trip-covers ({trip_id}/cover-{uuid}.{ext}). '
  'NUNCA uma URL: a URL assinada é derivada na leitura e não volta para cá.';

comment on column public.trips.daily_spending_goal is
  'Meta de gasto por dia, na mesma moeda de budget_currency. null = sem meta.';

-- ----------------------------------------------------------------------------
-- 2. RLS de `trips` — nada a fazer, e é de propósito
--
-- As policies `trips_select` / `trips_update` da 0008 valem por LINHA, não por
-- coluna: quem já podia ler a viagem lê as colunas novas, e quem já podia
-- atualizá-la atualiza as duas. É o comportamento correto para os dois campos —
-- a meta é informação da viagem, e a capa é propriedade dela.
--
-- Vale registrar o que ISSO significa para a meta: `trips_update` (0008) exige
-- `is_trip_owner`, então editor e viewer não conseguem gravar a meta mesmo que
-- uma tela futura ofereça o campo. A interface desta rodada mostra o controle só
-- para o proprietário; esta linha é a que garante a regra quando a interface
-- não estiver no caminho.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 3. Bucket `trip-covers`
--
-- PRIVADO. A capa de uma viagem é um dado da viagem: quem tem o link saberia
-- para onde a pessoa vai e quando. O único bucket público do projeto continua
-- sendo `content`, que existe para imagem editorial feita para aparecer sem
-- sessão (0007).
--
-- Os limites acompanham `TRIP_COVER_POLICY` em `src/domain/tripCover.ts`. Se um
-- lado mudar sem o outro, o sintoma é upload recusado pelo servidor depois de
-- aprovado pela tela — por isso ficam anotados um no outro.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('trip-covers', 'trip-covers', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
   set public             = excluded.public,
       file_size_limit    = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

-- ----------------------------------------------------------------------------
-- 4. Policies de Storage — o prefixo é a VIAGEM, não o usuário
--
-- Esta é a diferença que faz a colaboração funcionar, e ela merece a explicação.
--
-- Os buckets privados da 0002 são namespaced por `auth.uid()`, e a policy
-- `*_owner` compara `(storage.foldername(name))[1]` com o UID de quem lê. Para
-- um anexo pessoal isso está certo. Para a capa estaria errado: o arquivo é da
-- VIAGEM, e um editor convidado veria a viagem com um retângulo cinza porque o
-- objeto está sob o prefixo de outra pessoa.
--
-- Então o caminho é `{trip_id}/cover-{uuid}.{ext}` e a pergunta muda:
--
--   ler     → sou membro desta viagem?         `public.is_trip_member`
--   escrever→ sou o proprietário desta viagem?  `public.is_trip_owner`
--
-- As duas funções são as `security definer` da 0008, já usadas pelas policies
-- de `trips`. Usá-las aqui mantém uma definição só de "membro" e "dono" — a
-- alternativa seria repetir o `exists (select 1 from trip_members ...)` numa
-- policy de Storage, onde ninguém iria procurá-lo na próxima mudança.
--
-- O primeiro segmento precisa ser um UUID válido antes do cast: um objeto com
-- nome inesperado faria `::uuid` levantar exceção dentro da policy, e uma
-- exceção ali derruba a listagem inteira do bucket em vez de recusar aquele
-- objeto.
-- ----------------------------------------------------------------------------
create or replace function public.trip_cover_trip_id(object_path text)
returns uuid
language sql
immutable
as $$
  select case
    when (storage.foldername(object_path))[1] ~
         '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then ((storage.foldername(object_path))[1])::uuid
    else null
  end;
$$;

do $$
begin
  execute 'revoke all on function public.trip_cover_trip_id(text) from public, anon';
  execute 'grant execute on function public.trip_cover_trip_id(text) to authenticated, service_role';
end;
$$;

drop policy if exists trip_covers_member_read on storage.objects;
create policy trip_covers_member_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'trip-covers'
    and public.is_trip_member(public.trip_cover_trip_id(name))
  );

drop policy if exists trip_covers_owner_write on storage.objects;
create policy trip_covers_owner_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'trip-covers'
    and public.is_trip_owner(public.trip_cover_trip_id(name))
  );

-- `update` e `delete` separados do `insert`: trocar a capa grava um objeto novo
-- (o nome tem sufixo aleatório, justamente para a URL assinada anterior não
-- passar a servir outro conteúdo) e remove o antigo. As duas operações são do
-- proprietário, pela mesma razão que editar a viagem é.
drop policy if exists trip_covers_owner_modify on storage.objects;
create policy trip_covers_owner_modify on storage.objects
  for update to authenticated
  using (
    bucket_id = 'trip-covers'
    and public.is_trip_owner(public.trip_cover_trip_id(name))
  )
  with check (
    bucket_id = 'trip-covers'
    and public.is_trip_owner(public.trip_cover_trip_id(name))
  );

drop policy if exists trip_covers_owner_delete on storage.objects;
create policy trip_covers_owner_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'trip-covers'
    and public.is_trip_owner(public.trip_cover_trip_id(name))
  );

-- ----------------------------------------------------------------------------
-- 5. Conferência
--
-- Falha alto se o resultado não for o esperado. Uma migration que "passa" sem
-- ter feito efeito é pior do que uma que quebra: o defeito aparece semanas
-- depois, como capa que não sobe em produção e sobe em desenvolvimento.
-- ----------------------------------------------------------------------------
do $$
declare
  faltando text;
begin
  select string_agg(coluna, ', ')
    into faltando
    from unnest(array['cover_image_path', 'daily_spending_goal']) as coluna
   where not exists (
     select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'trips'
        and column_name = coluna
   );
  if faltando is not null then
    raise exception 'Colunas ausentes em public.trips: %', faltando;
  end if;

  if not exists (
    select 1 from storage.buckets
     where id = 'trip-covers'
       and public = false
       and file_size_limit = 5242880
       and allowed_mime_types @> array['image/jpeg', 'image/png', 'image/webp']
  ) then
    raise exception 'Bucket trip-covers ausente ou com limites diferentes do esperado.';
  end if;

  if (select count(*) from pg_policies
       where schemaname = 'storage' and tablename = 'objects'
         and policyname like 'trip_covers_%') <> 4 then
    raise exception 'As quatro policies de trip-covers não foram criadas.';
  end if;
end;
$$;

-- =============================================================================
-- ROLLBACK (manual, se necessário)
--
--   drop policy if exists trip_covers_member_read   on storage.objects;
--   drop policy if exists trip_covers_owner_write   on storage.objects;
--   drop policy if exists trip_covers_owner_modify  on storage.objects;
--   drop policy if exists trip_covers_owner_delete  on storage.objects;
--   drop function if exists public.trip_cover_trip_id(text);
--   -- Esvaziar o bucket ANTES: `delete from storage.buckets` falha com objetos.
--   delete from storage.objects where bucket_id = 'trip-covers';
--   delete from storage.buckets where id = 'trip-covers';
--   alter table public.trips drop constraint if exists trips_daily_spending_goal_positive;
--   alter table public.trips drop column if exists daily_spending_goal;
--   alter table public.trips drop column if exists cover_image_path;
--
-- O rollback das colunas PERDE dado: as capas enviadas e as metas definidas
-- desde a aplicação. `cover_image_url` não é afetada, então toda viagem volta à
-- imagem sugerida do destino em vez de ficar sem imagem.
-- =============================================================================
