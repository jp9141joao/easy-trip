-- =============================================================================
-- Easy Trip — Visibilidade por item: `shared` ou `private`
--
-- A 0008 respondeu "quem participa da viagem". Esta responde a pergunta que
-- sobra: **dentro** de uma viagem compartilhada, nem tudo é de todos.
--
-- Duas colunas em cada tabela de conteúdo:
--
--   visibility  'shared'  — todos os membros da viagem veem
--               'private' — só quem criou vê, inclusive o proprietário não vê
--   created_by  quem criou a linha
--
-- REGRA ÚNICA DE LEITURA, e ela não tem exceção:
--
--   é membro da viagem  AND  (visibility = 'shared'  OR  created_by = auth.uid())
--
-- Não existe bypass de proprietário. O diário privado de um viajante não é
-- legível pelo dono da viagem — se fosse, "somente eu" seria uma etiqueta, e
-- não uma garantia.
--
-- ESTRATÉGIA DE BACKFILL (§11, §67)
--
-- O default de criação e o backfill do que já existe são decisões separadas, e
-- de propósito:
--
--   roteiro    default shared  · backfill shared   — é logística da viagem
--   checklist  default shared  · backfill shared   — idem
--   reservas   default shared  · backfill PRIVATE  — ver abaixo
--   despesas   default private · backfill private
--   diário     default private · backfill private
--
-- A assimetria das reservas é deliberada. Uma reserva criada de hoje em diante
-- nasce compartilhada porque quem a cria já sabe que a viagem tem gente dentro.
-- Uma reserva que já existia foi criada quando a viagem era de uma pessoa só,
-- muitas vezes com o documento anexado (cartão de embarque, voucher com nome
-- completo e localizador). Marcá-la `shared` no backfill entregaria esse
-- arquivo ao primeiro convidado sem que ninguém tivesse decidido nada. Entrar
-- como `private` e deixar a pessoa compartilhar é o erro reversível; o
-- contrário não é.
--
-- Nenhuma linha é apagada, nenhuma coluna é removida, nenhum dado muda de
-- lugar. As duas colunas entram com `not null default`, então todo registro
-- existente recebe um valor sem precisar ser reescrito à mão.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Colunas
-- ----------------------------------------------------------------------------

alter table public.itinerary_items
  add column if not exists visibility text not null default 'shared',
  add column if not exists created_by uuid references auth.users (id) on delete set null;

alter table public.checklist_items
  add column if not exists visibility text not null default 'shared',
  add column if not exists created_by uuid references auth.users (id) on delete set null;

-- `expenses` e `journal_entries` já têm `user_id`, que sempre significou "quem
-- criou". `created_by` entra ao lado por uniformidade — a policy fica igual nas
-- cinco tabelas — e é preenchido a partir dele.
alter table public.expenses
  add column if not exists visibility text not null default 'private',
  add column if not exists created_by uuid references auth.users (id) on delete set null,
  -- Quem pagou pode não ser quem lançou. Não há divisão de conta nesta fase
  -- (§14) — o campo existe para que a evolução futura tenha o dado, e para que
  -- o filtro "Minhas" da Carteira signifique algo preciso.
  add column if not exists paid_by uuid references auth.users (id) on delete set null;

alter table public.journal_entries
  add column if not exists visibility text not null default 'private',
  add column if not exists created_by uuid references auth.users (id) on delete set null;

alter table public.tickets
  add column if not exists visibility text not null default 'shared',
  add column if not exists created_by uuid references auth.users (id) on delete set null;

-- O CHECK é adicionado depois do backfill, porque `add constraint` valida a
-- tabela inteira na hora. `not valid` + `validate` seria o caminho para uma
-- tabela grande; aqui a base é pequena e a validação imediata é a que dá o erro
-- no lugar certo se algum backfill estiver errado.

-- ----------------------------------------------------------------------------
-- 2. Backfill
-- ----------------------------------------------------------------------------

update public.itinerary_items i
   set created_by = t.user_id
  from public.trips t
 where t.id = i.trip_id and i.created_by is null;

update public.checklist_items c
   set created_by = t.user_id
  from public.trips t
 where t.id = c.trip_id and c.created_by is null;

update public.expenses
   set created_by = coalesce(created_by, user_id),
       paid_by    = coalesce(paid_by, user_id);

update public.journal_entries
   set created_by = coalesce(created_by, user_id);

update public.tickets
   set created_by = coalesce(created_by, user_id);

-- A assimetria documentada no cabeçalho. Só toca no que já existia: linhas
-- criadas a partir de agora recebem o default da coluna.
update public.tickets set visibility = 'private' where created_at < now();

-- ----------------------------------------------------------------------------
-- 3. Constraints
-- ----------------------------------------------------------------------------
do $$
declare
  alvo text;
begin
  foreach alvo in array array[
    'itinerary_items', 'checklist_items', 'expenses', 'journal_entries', 'tickets'
  ]
  loop
    execute format('alter table public.%I drop constraint if exists %I', alvo, alvo || '_visibility_check');
    execute format(
      'alter table public.%I add constraint %I check (visibility in (''shared'', ''private''))',
      alvo, alvo || '_visibility_check');

    execute format(
      'create index if not exists %I on public.%I (trip_id, visibility, created_by)',
      alvo || '_visibility_idx', alvo);
  end loop;
end;
$$;

comment on column public.itinerary_items.visibility is
  'shared: todos os membros veem. private: só created_by, sem exceção de proprietário.';
comment on column public.expenses.paid_by is
  'Quem pagou. Guardado para atribuição; não há divisão automática de conta nesta fase.';

-- ----------------------------------------------------------------------------
-- 4. Autoria automática
--
-- `created_by` preenchido pelo banco, e não pelo cliente. Se dependesse do
-- aplicativo, uma escrita por um caminho que esquecesse o campo criaria uma
-- linha privada sem dono — invisível para todo mundo, inclusive para quem a
-- criou, e impossível de apagar pela interface.
--
-- O trigger é `before insert` e só age quando o campo veio vazio, então uma
-- escrita server-side legítima (migração, Edge Function) ainda consegue
-- declarar o autor. E `auth.uid()` é a sessão, nunca um id de formulário.
-- ----------------------------------------------------------------------------
create or replace function public.set_created_by()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

do $$
declare
  alvo text;
begin
  foreach alvo in array array[
    'itinerary_items', 'checklist_items', 'expenses', 'journal_entries', 'tickets'
  ]
  loop
    execute format('drop trigger if exists set_created_by on public.%I', alvo);
    execute format(
      'create trigger set_created_by before insert on public.%I
         for each row execute function public.set_created_by()', alvo);
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. RLS — a regra única, aplicada às cinco tabelas
--
-- SELECT  membro E (shared OU meu)
-- INSERT  posso escrever na viagem, E o que é privado nasce meu
-- UPDATE  posso escrever na viagem, E a linha é visível para mim
-- DELETE  idem
--
-- O `using` de UPDATE/DELETE repete a condição de SELECT porque sem isso um
-- editor conseguiria apagar uma linha privada de outro membro *sem nunca poder
-- lê-la*: bastaria acertar o id. Apagar às cegas continua sendo vazamento — o
-- de existência, e o do conteúdo junto.
-- ----------------------------------------------------------------------------
do $$
declare
  alvo text;
  visivel text := '(public.is_trip_member(trip_id) and (visibility = ''shared'' or created_by = auth.uid()))';
begin
  foreach alvo in array array[
    'itinerary_items', 'checklist_items', 'expenses', 'journal_entries', 'tickets'
  ]
  loop
    execute format('drop policy if exists %I_select on public.%I', alvo, alvo);
    execute format('create policy %I_select on public.%I for select using %s', alvo, alvo, visivel);

    execute format('drop policy if exists %I_insert on public.%I', alvo, alvo);
    execute format(
      'create policy %I_insert on public.%I for insert with check (
         public.can_edit_trip(trip_id)
         and (visibility = ''shared'' or created_by = auth.uid() or created_by is null)
       )', alvo, alvo);

    execute format('drop policy if exists %I_update on public.%I', alvo, alvo);
    execute format(
      'create policy %I_update on public.%I for update
         using (public.can_edit_trip(trip_id) and %s)
         with check (public.can_edit_trip(trip_id) and %s)', alvo, alvo, visivel, visivel);

    execute format('drop policy if exists %I_delete on public.%I', alvo, alvo);
    execute format(
      'create policy %I_delete on public.%I for delete
         using (public.can_edit_trip(trip_id) and %s)', alvo, alvo, visivel);
  end loop;
end;
$$;

-- Mídia do diário herda a visibilidade da entrada. Não ganha coluna própria: a
-- foto pertence à entrada, e duas fontes de verdade para a mesma pergunta
-- divergiriam no primeiro `update` que esquecesse uma delas.
drop policy if exists journal_media_select on public.journal_media;
create policy journal_media_select on public.journal_media
  for select using (
    exists (
      select 1 from public.journal_entries e
       where e.id = journal_entry_id
         and public.is_trip_member(e.trip_id)
         and (e.visibility = 'shared' or e.created_by = auth.uid())
    )
  );

drop policy if exists journal_media_write on public.journal_media;
create policy journal_media_write on public.journal_media
  for all
  using (
    exists (
      select 1 from public.journal_entries e
       where e.id = journal_entry_id
         and public.can_edit_trip(e.trip_id)
         and (e.visibility = 'shared' or e.created_by = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.journal_entries e
       where e.id = journal_entry_id
         and public.can_edit_trip(e.trip_id)
         and (e.visibility = 'shared' or e.created_by = auth.uid())
    )
  );

-- ----------------------------------------------------------------------------
-- 6. Storage: o arquivo precisa seguir a mesma regra da linha
--
-- Sem esta seção a visibilidade seria meia verdade. As policies `*_owner` da
-- 0002 prendem o objeto ao prefixo `{auth.uid()}/`, então um membro conseguiria
-- LER a reserva compartilhada e receberia um caminho de Storage que a policy
-- recusa — a lista abriria com "documento indisponível" e ninguém entenderia
-- por quê.
--
-- A permissão é dada pelo registro, nunca pelo prefixo do caminho: o objeto só
-- é legível se existir uma linha `shared` que o referencie e o leitor for
-- membro daquela viagem. Um arquivo cuja linha é privada, ou que não tem linha
-- nenhuma, continua alcançável só por quem o enviou.
-- ----------------------------------------------------------------------------
create or replace function public.can_read_shared_attachment(object_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.tickets t
     where t.file_path = object_path
       and t.visibility = 'shared'
       and public.is_trip_member(t.trip_id)
  );
$$;

create or replace function public.can_read_shared_journal_media(object_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.journal_media m
      join public.journal_entries e on e.id = m.journal_entry_id
     where m.file_path = object_path
       and e.visibility = 'shared'
       and public.is_trip_member(e.trip_id)
  );
$$;

drop policy if exists attachments_shared_read on storage.objects;
create policy attachments_shared_read on storage.objects
  for select to authenticated
  using (bucket_id = 'attachments' and public.can_read_shared_attachment(name));

drop policy if exists journal_shared_read on storage.objects;
create policy journal_shared_read on storage.objects
  for select to authenticated
  using (bucket_id = 'journal' and public.can_read_shared_journal_media(name));

do $$
begin
  execute 'revoke all on function public.can_read_shared_attachment(text) from public, anon';
  execute 'grant execute on function public.can_read_shared_attachment(text) to authenticated, service_role';
  execute 'revoke all on function public.can_read_shared_journal_media(text) from public, anon';
  execute 'grant execute on function public.can_read_shared_journal_media(text) to authenticated, service_role';
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. Conferência — nenhum registro pode ter ficado sem visibilidade ou sem dono
-- ----------------------------------------------------------------------------
do $$
declare
  alvo text;
  pendentes integer;
begin
  foreach alvo in array array[
    'itinerary_items', 'checklist_items', 'expenses', 'journal_entries', 'tickets'
  ]
  loop
    execute format(
      'select count(*) from public.%I where visibility is null or visibility not in (''shared'', ''private'')',
      alvo) into pendentes;
    if pendentes > 0 then
      raise exception 'Backfill de visibilidade incompleto em %: % linha(s).', alvo, pendentes;
    end if;

    -- `created_by` pode ser nulo em linha cuja conta criadora foi excluída
    -- (`on delete set null`). O que não pode é linha PRIVADA sem dono: ela
    -- seria invisível para todo mundo e impossível de remover pela interface.
    execute format(
      'select count(*) from public.%I where visibility = ''private'' and created_by is null',
      alvo) into pendentes;
    if pendentes > 0 then
      raise exception 'Linha privada sem autor em %: % linha(s).', alvo, pendentes;
    end if;
  end loop;
end;
$$;
