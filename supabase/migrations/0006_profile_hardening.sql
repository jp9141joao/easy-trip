-- =============================================================================
-- Easy Trip — endurecimento do perfil e do bucket de avatares (F5)
--
-- A F5 é a primeira fase em que o usuário edita o próprio perfil e envia
-- arquivo por vontade própria. Duas coisas que até aqui eram teóricas passam a
-- ser superfície de ataque real, e as duas se resolvem no banco.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Privilégio de UPDATE por coluna em `profiles`
--
-- Hoje `role` está protegida — e está de verdade: o gatilho
-- `prevent_role_escalation` (0003) recusa a troca, medido contra um Supabase
-- real com JWT de conta comum:
--
--   PATCH /rest/v1/profiles {"role":"admin"}            → 42501
--   PATCH /rest/v1/profiles {"name":"x","role":"admin"} → 42501 (a linha
--                                                          inteira é recusada)
--
-- O que esta seção acrescenta é a segunda barreira. Hoje `authenticated` tem
-- UPDATE em **todas** as colunas, inclusive `role` e `user_id`:
--
--   select privilege_type, column_name from information_schema.column_privileges
--    where grantee = 'authenticated' and table_name = 'profiles';
--
-- Ou seja: a proteção inteira depende de um gatilho continuar existindo. Um
-- `drop trigger` numa migration futura — ou um `create or replace function` que
-- perca a condição — reabriria a escalada de privilégio sem que nada mais
-- avisasse. Sem o privilégio, o UPDATE em `role` é recusado pelo PostgreSQL
-- antes de qualquer gatilho ou policy ser consultado.
--
-- É a mesma ideia da 0005 com `anon`: a segunda barreira existe para o dia em
-- que a primeira falhar.
-- ----------------------------------------------------------------------------
revoke update on public.profiles from authenticated;

grant update (
  name,
  phone,
  avatar_path,
  home_city,
  home_country,
  home_timezone,
  travel_style,
  default_currency,
  updated_at
) on public.profiles to authenticated;

-- O INSERT tem a mesma brecha em menor escala: a policy `profiles_insert`
-- (0003) já exige `role = 'user'`, mas o privilégio permitiria tentar. Sem ele,
-- a coluna simplesmente assume o `default 'user'`.
revoke insert on public.profiles from authenticated;

grant insert (
  user_id,
  name,
  phone,
  avatar_path,
  home_city,
  home_country,
  home_timezone,
  travel_style,
  default_currency
) on public.profiles to authenticated;

-- `service_role` continua com tudo: é ele que a promoção documentada em 0003
-- usa, e é ele que roda nas Edge Functions. Nunca no aplicativo.

-- ----------------------------------------------------------------------------
-- 2. Limites do bucket de avatares
--
-- O aplicativo valida tipo e tamanho antes de enviar (`src/domain/avatar.ts`),
-- mas validação de cliente não é controle: o `anon key` está no bundle e um
-- POST direto em `/storage/v1/object/avatars/{uid}/x.jpg` não passa por tela
-- nenhuma. Sem limite no bucket, qualquer conta autenticada pode usar o Storage
-- do projeto como hospedagem de arquivo arbitrário.
--
-- Os valores acompanham `AVATAR_MAX_BYTES` e `AVATAR_MIME_TYPES`. Se um dos
-- lados mudar sem o outro, o sintoma é upload recusado pelo servidor depois de
-- aprovado pela tela — por isso os dois ficam anotados um no outro.
--
-- Só `avatars`. `attachments` e `journal` recebem PDF e mídia de viagem, com
-- outro perfil de uso; endurecê-los é parte do P-09 e não desta fase.
-- ----------------------------------------------------------------------------
update storage.buckets
   set file_size_limit = 5242880, -- 5 MB
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'avatars';

-- ----------------------------------------------------------------------------
-- 3. Conferência
--
-- Toda coluna de `profiles` precisa estar classificada como editável pelo dono
-- ou como protegida. Uma coluna nova numa migration futura cai fora das duas
-- listas e faz esta migration falhar — que é melhor que ela nascer editável
-- por engano, ou nascer sem privilégio e quebrar o "Salvar" em silêncio.
-- ----------------------------------------------------------------------------
do $$
declare
  editaveis   text[] := array[
    'name', 'phone', 'avatar_path', 'home_city', 'home_country',
    'home_timezone', 'travel_style', 'default_currency', 'updated_at'
  ];
  protegidas  text[] := array['user_id', 'role', 'created_at'];
  problema    text[];
begin
  -- 3.1 Nenhuma coluna sem classificação.
  select array_agg(column_name order by column_name) into problema
    from information_schema.columns
   where table_schema = 'public' and table_name = 'profiles'
     and not (column_name = any (editaveis) or column_name = any (protegidas));
  if problema is not null then
    raise exception
      'Coluna de profiles sem classificação: %. Decida se o dono da conta pode editá-la.',
      array_to_string(problema, ', ');
  end if;

  -- 3.2 O que é protegido não pode ser atualizável.
  select array_agg(coluna order by coluna) into problema
    from unnest(protegidas) as coluna
   where has_column_privilege('authenticated', 'public.profiles', coluna, 'update');
  if problema is not null then
    raise exception
      'Conta comum ainda pode atualizar: %.', array_to_string(problema, ', ');
  end if;

  -- 3.3 E o que é editável precisa continuar sendo, ou o "Salvar" quebra.
  select array_agg(coluna order by coluna) into problema
    from unnest(editaveis) as coluna
   where not has_column_privilege('authenticated', 'public.profiles', coluna, 'update');
  if problema is not null then
    raise exception
      'Faltou UPDATE para o dono da conta em: %.', array_to_string(problema, ', ');
  end if;

  -- 3.4 O bucket de avatar continua privado e com limites.
  if not exists (
    select 1 from storage.buckets
     where id = 'avatars'
       and public = false
       and file_size_limit = 5242880
       and allowed_mime_types @> array['image/jpeg', 'image/png', 'image/webp']
  ) then
    raise exception 'O bucket `avatars` precisa ser privado e ter limite de tamanho e de tipo.';
  end if;
end;
$$;
