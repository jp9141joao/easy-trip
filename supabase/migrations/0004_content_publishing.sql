-- =============================================================================
-- Easy Trip — Ofertas e Especialistas como conteúdo administrável (F3, D-06)
--
-- As duas tabelas já existem desde a 0001 e já recebem escrita de administrador
-- desde a 0003. O que falta para elas deixarem de ser lista estática é o que
-- `articles` já tem e elas não: um estado de publicação.
--
-- Sem esse estado, "cadastrar" e "publicar" são o mesmo ato — o administrador
-- não tem como preparar uma oferta antes de exibi-la, nem como tirar um
-- especialista do ar sem apagar o cadastro (e junto as consultas que apontam
-- para ele).
--
-- Esta migration é aditiva: nenhuma coluna é removida ou renomeada, e cada
-- coluna nova nasce com o valor que preserva o comportamento atual
-- (`published` / `active`). As linhas já existentes continuam visíveis
-- exatamente como estão hoje.
--
-- Depende de 0001 (tabelas), 0002 (RLS ligada) e 0003 (`public.is_admin()`).
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Colunas de publicação
-- ----------------------------------------------------------------------------

-- Ofertas: mesmo par rascunho/publicado de `articles`, pelo mesmo motivo — e
-- com os mesmos valores, para que "status" signifique a mesma coisa nas duas
-- tabelas e o painel não precise de dois vocabulários.
alter table public.offers
  add column if not exists status text not null default 'published';

alter table public.offers
  drop constraint if exists offers_status_check;
alter table public.offers
  add constraint offers_status_check check (status in ('draft', 'published'));

-- A Home mostra as ofertas numa faixa horizontal, e a ordem ali é editorial:
-- é o administrador quem decide o que aparece primeiro, não a data de criação.
-- `integer` com passo livre em vez de uma posição contígua: reordenar não pode
-- exigir reescrever todas as linhas.
alter table public.offers
  add column if not exists sort_order integer not null default 0;

-- Auditoria. Deliberadamente fora do domínio TypeScript: nenhuma tela mostra
-- estes valores, e expô-los obrigaria o catálogo local a inventar timestamps
-- para conteúdo que não tem data real de criação.
alter table public.offers
  add column if not exists created_at timestamptz not null default now();
alter table public.offers
  add column if not exists updated_at timestamptz not null default now();

-- Especialistas: `active` é cadastro, `status` é presença.
--
-- A distinção importa e é fácil de confundir: `status` ('online'/'busy'/
-- 'offline') diz se a pessoa pode atender agora e muda várias vezes por dia;
-- `active` diz se ela faz parte do time e muda quando alguém entra ou sai.
-- Um especialista `offline` continua no diretório — está só indisponível.
-- Um especialista inativo não aparece mais.
--
-- Reaproveitar `status = 'offline'` como "desligado" misturaria as duas coisas
-- e deixaria ex-consultores reaparecendo na lista assim que alguém marcasse
-- presença.
alter table public.advisors
  add column if not exists active boolean not null default true;

alter table public.advisors
  add column if not exists created_at timestamptz not null default now();
alter table public.advisors
  add column if not exists updated_at timestamptz not null default now();

-- ----------------------------------------------------------------------------
-- 2. `updated_at` mantido pelo banco
--
-- No restante do schema quem escreve `updated_at` é o aplicativo (`nowISO()` no
-- `SupabaseDataSource`). Aqui não dá para depender disso: estas duas tabelas
-- passam a ser escritas pelo painel administrativo, e um `UPDATE` que esqueça a
-- coluna produziria um registro dizendo ter sido editado antes da própria
-- edição — exatamente o tipo de dado que não se percebe estar errado.
--
-- O gatilho é aplicado só às tabelas desta fase. Retroagir às demais mudaria o
-- comportamento de escrita de código que hoje funciona, e isso é refatoração,
-- não F3.
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists offers_set_updated_at on public.offers;
create trigger offers_set_updated_at
  before update on public.offers
  for each row execute function public.set_updated_at();

drop trigger if exists advisors_set_updated_at on public.advisors;
create trigger advisors_set_updated_at
  before update on public.advisors
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. Índices
--
-- Os dois acompanham exatamente as consultas que as telas fazem: a Home pede
-- ofertas publicadas na ordem editorial, e a tela de Especialistas pede quem
-- está ativo. Sem eles as duas viram varredura completa assim que o catálogo
-- crescer.
-- ----------------------------------------------------------------------------
create index if not exists offers_published_idx
  on public.offers (status, sort_order, id);

create index if not exists advisors_active_idx
  on public.advisors (active, name);

-- ----------------------------------------------------------------------------
-- 4. RLS de leitura — a parte que não pode ficar para depois
--
-- Este é o mesmo defeito que a F2 corrigiu em `articles` (P-01), e ele nasceria
-- de novo aqui no instante em que as colunas acima existissem: a 0002 deixou
-- `offers_read` e `advisors_read` em `using (true)` porque, naquele momento,
-- toda linha das duas tabelas era conteúdo pronto — não havia rascunho a
-- proteger.
--
-- Com `status` e `active` isso deixa de ser verdade. Se a policy continuasse
-- aberta, o filtro passaria a viver só na consulta do aplicativo — e filtro de
-- consulta não é controle de acesso: o `anon key` está no bundle, e um GET
-- direto em `/rest/v1/offers` não passa por tela nenhuma.
--
-- Por isso as colunas e as policies entram na MESMA migration. Separá-las
-- criaria uma janela em que o rascunho existe e não está protegido.
-- ----------------------------------------------------------------------------

-- Ofertas ------------------------------------------------------------------
--
-- Duas condições, não uma. `status` é a decisão editorial ("isto está pronto");
-- `active_from`/`active_until` (colunas da 0001, até aqui sem efeito nenhum) são
-- a vigência comercial ("isto vale neste período"). Uma promoção de inverno
-- publicada em janeiro não deve reaparecer em julho só porque ninguém lembrou de
-- despublicá-la.
--
-- `null` nos dois extremos significa "sem limite", que é o caso de todas as
-- ofertas do seed — nada muda para o conteúdo atual.
--
-- `is_admin()` fecha a regra: quem administra enxerga rascunho e oferta fora de
-- vigência, sem o que a própria lista do painel abriria incompleta.
drop policy if exists offers_read on public.offers;
create policy offers_read on public.offers
  for select to authenticated
  using (
    (
      status = 'published'
      and (active_from is null or active_from <= current_date)
      and (active_until is null or active_until >= current_date)
    )
    or public.is_admin()
  );

-- Especialistas ------------------------------------------------------------
drop policy if exists advisors_read on public.advisors;
create policy advisors_read on public.advisors
  for select to authenticated
  using (active or public.is_admin());

-- ----------------------------------------------------------------------------
-- 5. Escrita: nada a acrescentar, e isso é intencional
--
-- A 0003 já criou `offers_admin_insert/update/delete` e
-- `advisors_admin_insert/update/delete`, todas presas a `public.is_admin()`.
-- A decisão D-06 (CRUD administrativo para Ofertas e Especialistas) já está
-- satisfeita no banco; recriar as policies aqui só duplicaria a definição em
-- dois arquivos, e a próxima alteração seria feita num deles.
--
-- O bloco abaixo não cria permissão nenhuma: ele falha a migration se as seis
-- policies não estiverem lá. É a diferença entre supor que a base da 0003
-- continua de pé e verificar.
-- ----------------------------------------------------------------------------
do $$
declare
  content_table text;
  operation     text;
  missing       text;
begin
  foreach content_table in array array['offers', 'advisors']
  loop
    foreach operation in array array['insert', 'update', 'delete']
    loop
      missing := format('%s_admin_%s', content_table, operation);
      if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = content_table
          and policyname = missing
      ) then
        raise exception
          'Policy % ausente: 0004 depende da base administrativa criada em 0003.', missing;
      end if;
    end loop;
  end loop;
end;
$$;

-- =============================================================================
-- O QUE ESTA MIGRATION DELIBERADAMENTE NÃO FAZ
--
--   * `places`: fica sem `active`/`featured`. O rascunho de 0004 no plano
--     previa as duas colunas, mas nenhuma tela do aplicativo tem noção de lugar
--     em destaque, e `places` já tem CRUD administrativo funcionando. Seriam
--     colunas gravadas que nada lê — o mesmo motivo pelo qual o próprio plano
--     recusou `places.short_description`. Entram quando houver tela.
--
--   * `consultations`: permanece exatamente como a 0002 a deixou (dona do
--     registro, e só ela). Especialista é catálogo; consulta é a solicitação de
--     um usuário — coisas separadas, e a separação já está correta. Dar leitura
--     administrativa às consultas exporia pedidos pessoais sem que exista tela
--     que os gerencie.
-- =============================================================================
