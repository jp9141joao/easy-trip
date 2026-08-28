-- =============================================================================
-- Easy Trip — transferência de propriedade e guarda de exclusão de conta (§50)
--
-- A 0008 adiou duas coisas e disse por quê. Esta migration resolve as duas,
-- porque uma depende da outra: enquanto não houver como passar a viagem
-- adiante, bloquear a exclusão da conta do proprietário deixaria a pessoa presa.
--
-- O DEFEITO QUE ISTO CORRIGE
--
-- `public.trips.user_id` referencia `auth.users (id) ON DELETE CASCADE` (0001).
-- Hoje, se o proprietário de uma viagem compartilhada excluir a conta, a viagem
-- inteira é apagada em cascata — e com ela as despesas, o diário e os itens de
-- roteiro DOS OUTROS MEMBROS. Uma pessoa apagando a própria conta destrói dado
-- alheio. Nenhuma policy protege contra isso: a cascata acontece abaixo da RLS.
--
-- O QUE MUDA
--
--   1. `transfer_trip_ownership` — passa a viagem a um membro que já participa.
--   2. `account_deletion_blockers` — lista as viagens que impedem a exclusão.
--   3. `leave_trip` — a mensagem passa a citar a transferência, que agora existe.
--
-- O que NÃO muda: nenhuma policy é reescrita, nenhuma ganha bypass, nenhuma
-- migration anterior é tocada. Conteúdo privado continua preso a `created_by`
-- (0009) e não a quem é dono — transferir a viagem não revela o diário de
-- ninguém, e há teste para isso.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Transferência de propriedade
--
-- A PROPRIEDADE MORA EM DOIS LUGARES, E ESSA É A ARMADILHA
--
-- `is_trip_owner` (0008) responde sim para quem satisfaz QUALQUER uma:
--
--     trip_members.role = 'owner'      OU      trips.user_id = auth.uid()
--
-- O `OR` existe por um bom motivo — é o que mantém acessível uma viagem cujo
-- backfill de membros não tenha rodado. Mas ele significa que promover alguém
-- em `trip_members` NÃO transfere nada: o antigo dono continuaria owner pela
-- segunda perna, e a viagem passaria a ter dois. Por isso esta função grava os
-- dois lados na mesma transação, e é a única forma suportada de fazê-lo.
--
-- QUEM PODE RECEBER
--
-- Apenas quem já tem linha em `trip_members` — ou seja, quem aceitou o convite.
-- Um convite pendente vive em `trip_invites` e não cria membro até `accept`
-- (0008), então esta regra sozinha já exclui convite não aceito e estranho, sem
-- precisar consultar `trip_invites`.
--
-- ATOMICIDADE
--
-- Uma função plpgsql roda numa transação só: ou os três UPDATE valem, ou
-- nenhum. O `for update` nas duas linhas de membro serializa duas transferências
-- simultâneas — sem ele, duas chamadas concorrentes poderiam ler "sou dono" ao
-- mesmo tempo e gravar donos diferentes.
-- ----------------------------------------------------------------------------
create or replace function public.transfer_trip_ownership(
  target_trip uuid,
  new_owner uuid
)
returns public.trip_members
language plpgsql
security definer
set search_path = public
as $$
declare
  caller     uuid := auth.uid();
  novo       public.trip_members;
  antigo_id  uuid;
begin
  if caller is null then
    raise exception 'Sessão inválida.' using errcode = '42501';
  end if;

  if not public.is_trip_owner(target_trip) then
    raise exception 'Apenas o proprietário pode transferir a viagem.' using errcode = '42501';
  end if;

  if new_owner = caller then
    raise exception 'Você já é o proprietário desta viagem.' using errcode = '22023';
  end if;

  -- Trava a viagem antes de decidir qualquer coisa: a partir daqui nenhuma
  -- outra transferência da mesma viagem avança até esta terminar.
  perform 1 from public.trips where id = target_trip for update;

  -- O destinatário precisa ser membro ACEITO. Convite pendente não tem linha
  -- aqui, então não passa — e é essa a regra, não uma checagem extra.
  select * into novo
    from public.trip_members
   where trip_id = target_trip and user_id = new_owner
   for update;

  if novo.id is null then
    raise exception
      'O novo proprietário precisa ser um viajante desta viagem que já aceitou o convite.'
      using errcode = 'P0002';
  end if;

  if novo.role = 'owner' then
    raise exception 'Este viajante já é o proprietário.' using errcode = '22023';
  end if;

  -- ---- os três lados da mesma verdade ----

  -- (a) a coluna que a cascata de exclusão de conta segue, e a segunda perna
  --     de `is_trip_owner`. Sem esta linha a transferência não transfere.
  update public.trips
     set user_id = new_owner, updated_at = now()
   where id = target_trip;

  -- (b) o novo dono
  update public.trip_members
     set role = 'owner', updated_at = now()
   where id = novo.id
  returning * into novo;

  -- (c) o antigo. Vira `editor`, e não `viewer`: quem organizou a viagem
  --     continua podendo escrever nela. Perde só o que é de gerência —
  --     convidar, remover, mudar papel, apagar a viagem.
  --
  --     O `insert ... on conflict` cobre o caso em que o dono estava apenas
  --     pela perna `trips.user_id` e não tinha linha de membro: sem isto ele
  --     sairia da própria viagem ao transferi-la.
  insert into public.trip_members (trip_id, user_id, role)
  values (target_trip, caller, 'editor')
      on conflict (trip_id, user_id)
      do update set role = 'editor', updated_at = now()
  returning id into antigo_id;

  -- Convite pendente para o novo dono perde o sentido: ele já está dentro, e
  -- agora é o dono.
  update public.trip_invites
     set status = 'cancelled', responded_at = now()
   where trip_id = target_trip and invited_user_id = new_owner and status = 'pending';

  return novo;
end;
$$;

comment on function public.transfer_trip_ownership(uuid, uuid) is
  'Passa a viagem a um membro que já aceitou o convite. Grava trips.user_id e '
  'trip_members na mesma transação — as duas pernas de is_trip_owner. O antigo '
  'proprietário fica como editor. Conteúdo privado não muda de dono.';

do $$
begin
  execute 'revoke all on function public.transfer_trip_ownership(uuid, uuid) from public, anon';
  execute 'grant execute on function public.transfer_trip_ownership(uuid, uuid) to authenticated, service_role';
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. O que impede excluir a conta
--
-- Devolve as viagens em que quem chama é proprietário E existe outra pessoa
-- dentro. São exatamente as viagens cuja cascata destruiria dado alheio.
--
-- Viagem só do próprio usuário NÃO aparece: aquela pode ir embora com a conta,
-- que é o que a pessoa pediu.
--
-- A mesma função serve às duas pontas — a tela, para avisar antes; e a Edge
-- Function `delete-account`, para recusar. É de propósito: se a checagem da
-- função e a do aviso fossem consultas diferentes, um dia divergiriam e a tela
-- diria "pode excluir" para um pedido que o servidor recusa.
--
-- Sem argumento: a identidade vem de `auth.uid()`, nunca do corpo da requisição.
-- ----------------------------------------------------------------------------
create or replace function public.account_deletion_blockers()
returns table (
  trip_id          uuid,
  destination_city text,
  other_members    integer
)
language sql
stable
security definer
set search_path = public
as $$
  select t.id,
         t.destination_city,
         (select count(*)::integer
            from public.trip_members m
           where m.trip_id = t.id and m.user_id <> auth.uid())
    from public.trips t
   where t.user_id = auth.uid()
     and exists (
       select 1 from public.trip_members m
        where m.trip_id = t.id and m.user_id <> auth.uid()
     )
   order by t.destination_city;
$$;

comment on function public.account_deletion_blockers() is
  'Viagens em que a sessão é proprietária e há outros viajantes. Enquanto a '
  'lista não estiver vazia, excluir a conta apagaria em cascata (0001) o '
  'conteúdo dos outros membros — por isso delete-account recusa.';

do $$
begin
  execute 'revoke all on function public.account_deletion_blockers() from public, anon';
  execute 'grant execute on function public.account_deletion_blockers() to authenticated, service_role';
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. `leave_trip` — só a mensagem
--
-- A regra continua a mesma: o proprietário não sai. O que mudou é que agora
-- existe um caminho, e a mensagem tem de dizer qual. Redefinida por inteiro
-- porque `create or replace` exige o corpo todo; a única diferença em relação
-- à 0008 é o texto da exceção.
-- ----------------------------------------------------------------------------
create or replace function public.leave_trip(target_trip uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  papel text;
begin
  select role into papel
    from public.trip_members
   where trip_id = target_trip and user_id = auth.uid();

  if papel is null then
    raise exception 'Você não participa desta viagem.' using errcode = 'P0002';
  end if;

  if papel = 'owner' then
    raise exception
      'O proprietário não pode sair da viagem. Transfira a propriedade a outro viajante, remova os demais ou exclua a viagem.'
      using errcode = '22023';
  end if;

  delete from public.trip_members
   where trip_id = target_trip and user_id = auth.uid();
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Conferência
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'transfer_trip_ownership'
  ) then
    raise exception 'transfer_trip_ownership não foi criada.';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'account_deletion_blockers'
  ) then
    raise exception 'account_deletion_blockers não foi criada.';
  end if;

  -- `security definer` sem `search_path` fixo é escalada de privilégio: quem
  -- chama escolheria de qual schema vem `trip_members`. As duas precisam ter.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('transfer_trip_ownership', 'account_deletion_blockers')
       and p.prosecdef
       and not coalesce(array_to_string(p.proconfig, ',') like '%search_path=%', false)
  ) then
    raise exception 'Função security definer sem search_path fixo.';
  end if;

  if has_function_privilege('anon', 'public.transfer_trip_ownership(uuid, uuid)', 'execute') then
    raise exception 'anon não pode executar transfer_trip_ownership.';
  end if;
  if has_function_privilege('anon', 'public.account_deletion_blockers()', 'execute') then
    raise exception 'anon não pode executar account_deletion_blockers.';
  end if;
end;
$$;

-- =============================================================================
-- ROLLBACK (manual, se necessário)
--
--   drop function if exists public.transfer_trip_ownership(uuid, uuid);
--   drop function if exists public.account_deletion_blockers();
--   -- `leave_trip` volta ao corpo da 0008 (só o texto da exceção difere).
--
-- Nenhuma tabela, coluna ou policy é criada aqui: o rollback não perde dado.
-- Viagens já transferidas PERMANECEM transferidas — a transferência é um fato
-- gravado em `trips.user_id`/`trip_members`, não um recurso que se desliga.
-- =============================================================================
