-- =============================================================================
-- Easy Trip — Papel de conta e autorização administrativa (Bloco 1)
--
-- Um único aplicativo, um único login. O que separa quem *usa* o Easy Trip de
-- quem *edita o conteúdo editorial* do Easy Trip é uma coluna:
-- `profiles.role`. Ela é a fonte única de verdade (§4) — o cliente apenas a lê.
--
-- Esta migration não cria nenhum CRUD. Ela cria a autorização sobre a qual os
-- CRUDs serão construídos, para que os blocos seguintes sejam trabalho de
-- interface e não de segurança.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. A coluna
--
-- `default 'user'` e `not null` juntos são o que faz as contas já existentes
-- continuarem funcionando: cada linha atual recebe `user` na própria execução
-- do ALTER, sem backfill manual e sem nenhuma conta ficar sem papel (§5).
-- ----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists role text not null default 'user';

-- Um CHECK, e não um enum. O enum obrigaria um `ALTER TYPE` a cada papel novo e
-- não é revertível dentro de uma transação; o CHECK dá a mesma garantia — o
-- banco recusa qualquer valor fora da lista — e é trivial de alterar depois.
-- Para dois papéis, é a solução mais simples que ainda é segura (§6).
alter table public.profiles
  drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('user', 'admin'));

-- ----------------------------------------------------------------------------
-- 2. Impedir auto-promoção
--
-- Esconder o campo na interface não é proteção: o `anon key` está no bundle, e
-- qualquer pessoa pode chamar a API REST diretamente com o próprio JWT e mandar
-- `role: 'admin'` no update do próprio perfil. A policy `profiles_update` de
-- 0002 permite isso hoje, porque ela só verifica de quem é a linha.
--
-- Uma policy não resolve bem este caso: em RLS, `using` enxerga a linha antiga e
-- `with check` a nova, mas nenhuma das duas consegue comparar as duas de forma
-- confiável dentro do mesmo comando. Um gatilho `BEFORE UPDATE` enxerga OLD e
-- NEW ao mesmo tempo, que é exatamente a pergunta que precisamos fazer (§7).
-- ----------------------------------------------------------------------------
create or replace function public.prevent_role_escalation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.role is distinct from old.role then
    -- `auth.uid()` é nulo quando não há usuário final na chamada: SQL Editor,
    -- psql, `service_role`. É por aí que a promoção documentada acontece — fora
    -- do aplicativo, como manda o §8/§33. Havendo sessão de usuário, a troca é
    -- recusada, venha ela da tela de perfil ou de um cliente adulterado.
    if auth.uid() is not null and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
      raise exception 'Alteração de role não permitida'
        using errcode = '42501'; -- insufficient_privilege
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_no_role_escalation on public.profiles;
create trigger profiles_no_role_escalation
  before update on public.profiles
  for each row execute function public.prevent_role_escalation();

-- O INSERT tem a mesma brecha: criar o próprio perfil já com `role = 'admin'`.
-- Toda conta nasce `user`; a promoção é sempre um UPDATE posterior, feito fora
-- do aplicativo.
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert with check (user_id = auth.uid() and role = 'user');

-- ----------------------------------------------------------------------------
-- 3. Helper de autorização
--
-- Uma função em vez de repetir o subselect em cada policy (§10). Além de
-- encurtar, centraliza: quando os CRUDs dos próximos blocos chegarem, "o que é
-- ser admin" continua definido num lugar só.
--
-- `security definer` porque a policy de `profiles` restringe a leitura à própria
-- linha, e a função precisa poder consultar o papel enquanto avalia uma policy
-- de outra tabela. `search_path` fixo para que ninguém consiga apontar
-- `profiles` para outro schema — a mesma precaução já usada em `owns_trip`.
-- ----------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- ----------------------------------------------------------------------------
-- 3.1 Artigos: o administrador também enxerga rascunho (P-01)
--
-- A 0002 já fechou a leitura em `status = 'published'`. Aqui a policy é
-- estendida, e não afrouxada: continua negando rascunho para conta comum e
-- passa a permiti-lo para quem administra — que é o que a lista do painel
-- precisa para existir.
--
-- Sem esta linha, o painel administrativo abriria vazio para os rascunhos: o
-- `listAllArticles()` do aplicativo pede tudo, e a RLS devolveria só os
-- publicados.
-- ----------------------------------------------------------------------------
drop policy if exists articles_read on public.articles;
create policy articles_read on public.articles
  for select to authenticated
  using (status = 'published' or public.is_admin());

-- ----------------------------------------------------------------------------
-- 4. Base de autorização do conteúdo editorial
--
-- Os CRUDs ainda não existem (§36) — nenhuma tela escreve nestas tabelas nesta
-- fase. As policies vêm antes de propósito: assim a autorização é validável
-- agora, isolada, e o Bloco 2 vira trabalho de interface sobre uma base que já
-- foi testada, em vez de duas coisas novas ao mesmo tempo (§11).
--
-- A leitura continua exatamente como 0002 a definiu — nada muda para quem já
-- usa o aplicativo. O que se acrescenta é só a escrita, e só para admin.
-- ----------------------------------------------------------------------------
do $$
declare
  content_table text;
begin
  foreach content_table in array array['offers', 'articles', 'places', 'advisors']
  loop
    execute format('drop policy if exists %I_admin_insert on public.%I', content_table, content_table);
    execute format(
      'create policy %I_admin_insert on public.%I
         for insert to authenticated with check (public.is_admin())',
      content_table, content_table
    );

    execute format('drop policy if exists %I_admin_update on public.%I', content_table, content_table);
    execute format(
      'create policy %I_admin_update on public.%I
         for update to authenticated using (public.is_admin()) with check (public.is_admin())',
      content_table, content_table
    );

    execute format('drop policy if exists %I_admin_delete on public.%I', content_table, content_table);
    execute format(
      'create policy %I_admin_delete on public.%I
         for delete to authenticated using (public.is_admin())',
      content_table, content_table
    );
  end loop;
end;
$$;

-- =============================================================================
-- COMO PROMOVER UMA CONTA A ADMINISTRADOR (§8)
--
-- Não existe tela para isto, e é intencional: uma tela de gerenciamento de
-- administradores é superfície de ataque e trabalho que o TCC não precisa.
--
--   1. Crie a conta normalmente pelo próprio aplicativo (tela de cadastro).
--   2. No painel do Supabase, abra SQL Editor e execute:
--
--        update public.profiles
--           set role = 'admin'
--         where user_id = (
--           select id from auth.users where email = 'SEU-EMAIL@exemplo.com'
--         );
--
--      O SQL Editor roda sem `auth.uid()`, então o gatilho acima deixa passar.
--   3. Saia e entre de novo no aplicativo. O Painel aparece no Perfil.
--
-- Para reverter, o mesmo update com `set role = 'user'`.
--
-- A `service_role key` não aparece em lugar nenhum do aplicativo (§33).
-- =============================================================================
