-- =============================================================================
-- Easy Trip — endurecimento do Storage e bucket de conteúdo editorial (F7)
--
-- Fecha dois defeitos da auditoria (§31):
--
--   P-09  `attachments` e `journal` foram criados em `0002` sem
--         `file_size_limit` e sem `allowed_mime_types`. A `0006` resolveu o
--         caso de `avatars`; estes dois ficaram, e são justamente os que
--         recebem arquivo grande.
--
--   P-04  Não existe bucket para imagem editorial. As capas de artigo, foto de
--         lugar e imagem de oferta são URL de terceiro (`images.unsplash.com`,
--         29 ocorrências em `seed.sql`), e o formulário administrativo pede a
--         URL em vez de aceitar um arquivo.
--
-- Estado medido no Postgres local ANTES desta migration:
--
--        id      | public | file_size_limit |        allowed_mime_types
--   -------------+--------+-----------------+-----------------------------------
--    attachments | f      |                 |
--    avatars     | f      |         5242880 | {image/jpeg,image/png,image/webp}
--    journal     | f      |                 |
--
-- Nenhuma migration anterior é alterada. 0001–0006 continuam como estão.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. P-09 — limites nos dois buckets privados que faltavam
--
-- Sem estas duas colunas preenchidas, o Storage aceita qualquer coisa de
-- qualquer tamanho. Validar na tela não resolve: o `anon key` está no bundle e
-- um POST direto em `/storage/v1/object/attachments/{uid}/x` não passa por tela
-- nenhuma. Qualquer conta autenticada poderia usar o projeto como hospedagem.
--
-- Os valores acompanham `ATTACHMENT_POLICY` e `JOURNAL_POLICY` em
-- `src/domain/upload.ts`. Se um lado mudar sem o outro, o sintoma é upload
-- recusado pelo servidor depois de aprovado pela tela — por isso os dois ficam
-- anotados um no outro.
-- ----------------------------------------------------------------------------

-- Bilhetes e apólices: PDF **e** imagem.
--
-- O PDF entra porque é o formato em que companhia aérea e seguradora entregam
-- o documento; sem ele o recurso não serve para o caso principal. 10 MB porque
-- um cartão de embarque digitalizado passa fácil dos 2 MB do avatar, e nada
-- aqui é vídeo.
update storage.buckets
   set file_size_limit = 10485760, -- 10 MB
       allowed_mime_types = array[
         'image/jpeg', 'image/png', 'image/webp', 'application/pdf'
       ]
 where id = 'attachments';

-- Diário: só imagem.
--
-- PDF fica de fora de propósito. A tela renderiza cada mídia numa galeria com
-- `expo-image`; um PDF apareceria como quadro quebrado. O seletor já pede
-- `mediaTypes: ['images']` — aqui o servidor diz a mesma coisa.
update storage.buckets
   set file_size_limit = 10485760, -- 10 MB
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'journal';

-- As policies de dono (`*_owner`, criadas em `0002`) continuam valendo e não
-- são tocadas: elas prendem a escrita ao prefixo `{auth.uid()}/`, que é a outra
-- metade do problema e já estava certa.

-- ----------------------------------------------------------------------------
-- 2. P-04 — bucket `content`
--
-- Um bucket só, com prefixo por família (`places/`, `articles/`, `offers/`),
-- em vez de três buckets. As três teriam exatamente a mesma política — leitura
-- aberta, escrita só da administração — e três cópias de uma política é uma a
-- mais do que se consegue manter em sincronia.
--
-- **Por que este é público e os outros três não.** Os outros guardam documento
-- de viagem, foto de diário e retrato: dado de uma pessoa, servido por URL
-- assinada de uma hora. Este guarda a capa do artigo que o aplicativo publica
-- para todo mundo ver. Assinar cada imagem de uma lista de ofertas custaria uma
-- chamada por item, e a URL assinada expira — o cache do aparelho não a
-- reaproveita no dia seguinte. Público aqui é a decisão certa **porque não há
-- nada privado dentro**, e a policy de escrita garante que continue assim.
--
-- `do update` e não `do nothing`: se o bucket já existir com configuração
-- diferente, "não fazer nada" deixaria a configuração errada de pé sem avisar.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('content', 'content', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
   set public             = excluded.public,
       file_size_limit    = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

-- Leitura: qualquer um, inclusive sem sessão. É o que "público" significa, e
-- está limitado a este bucket — `using` fixa `bucket_id`.
drop policy if exists content_read on storage.objects;
create policy content_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'content');

-- Escrita: só administração.
--
-- Aqui o dono do arquivo não é uma pessoa, então não há prefixo de UID para
-- comparar — quem decide é `public.is_admin()` (0003), a mesma função que
-- guarda o CRUD de `articles`, `places`, `offers` e `advisors`. Um usuário
-- comum autenticado não escreve, não sobrescreve e não apaga.
--
-- `for all` cobre insert, update e delete; `using` vale para as duas últimas e
-- `with check` para as duas primeiras. Faltando qualquer uma das duas cláusulas
-- sobraria um buraco: só `using` deixaria inserir, só `with check` deixaria
-- apagar.
drop policy if exists content_write on storage.objects;
create policy content_write on storage.objects
  for all to authenticated
  using (bucket_id = 'content' and public.is_admin())
  with check (bucket_id = 'content' and public.is_admin());

-- ----------------------------------------------------------------------------
-- 3. Conferência
--
-- Uma migration de configuração que roda sem erro mas não configura nada é o
-- pior resultado possível: some da lista de pendências sem ter feito nada. Um
-- `update` que não encontra a linha devolve "sucesso" com zero linhas — foi
-- assim que os buckets ficaram sem limite desde `0002`.
-- ----------------------------------------------------------------------------
do $$
declare
  faltando text[];
begin
  -- 3.1 Todo bucket privado precisa de teto de tamanho e lista de tipos.
  select array_agg(id order by id) into faltando
    from storage.buckets
   where public = false
     and (file_size_limit is null or allowed_mime_types is null);
  if faltando is not null then
    raise exception
      'Bucket privado sem limite de tamanho ou de tipo: %. Ver P-09.',
      array_to_string(faltando, ', ');
  end if;

  -- 3.2 Os três privados continuam privados. Um `public = true` aqui exporia
  --     documento de viagem e foto de diário por URL permanente.
  select array_agg(id order by id) into faltando
    from storage.buckets
   where id in ('avatars', 'attachments', 'journal') and public;
  if faltando is not null then
    raise exception
      'Bucket que deveria ser privado está público: %.', array_to_string(faltando, ', ');
  end if;

  -- 3.3 Nenhum bucket privado aceita executável, arquivo compactado ou
  --     `application/octet-stream` — o curinga que faz qualquer coisa passar.
  select array_agg(id order by id) into faltando
    from storage.buckets
   where public = false and allowed_mime_types && array['application/octet-stream', '*/*'];
  if faltando is not null then
    raise exception
      'Bucket privado aceitando tipo curinga: %.', array_to_string(faltando, ', ');
  end if;

  -- 3.4 `content` existe, é público e só a administração escreve nele.
  if not exists (
    select 1 from storage.buckets
     where id = 'content' and public
       and file_size_limit = 5242880
       and allowed_mime_types @> array['image/jpeg', 'image/png', 'image/webp']
  ) then
    raise exception 'O bucket `content` precisa existir, ser público e ter limites. Ver P-04.';
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects' and policyname = 'content_write'
  ) then
    raise exception 'Faltou a policy `content_write`: o bucket público ficaria gravável por qualquer conta.';
  end if;

  -- 3.5 As policies de dono de `0002` continuam de pé. Esta migration não as
  --     toca, e é justamente por isso que vale conferir: se uma delas sumir
  --     numa migration futura, o namespace por UID vai junto.
  select array_agg(b order by b) into faltando
    from unnest(array['attachments', 'journal', 'avatars']) as b
   where not exists (
     select 1 from pg_policies
      where schemaname = 'storage' and tablename = 'objects' and policyname = b || '_owner'
   );
  if faltando is not null then
    raise exception
      'Sumiu a policy de dono do bucket: %.', array_to_string(faltando, ', ');
  end if;
end;
$$;
