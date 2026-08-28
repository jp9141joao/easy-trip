-- =============================================================================
-- Semente da pilha de ponta a ponta.
--
-- Deliberadamente mínima. Os testes `.mjs` criam as próprias contas, viagens e
-- arquivos, com sufixo aleatório por execução — é isso que os deixa rodar duas
-- vezes seguidas sem colidirem. Dado plantado aqui só criaria acoplamento entre
-- a semente e as asserções.
--
-- A `supabase/seed.sql` do repositório NÃO é usada: ela popula o catálogo
-- editorial inteiro (dezenas de milhares de linhas) e faria a subida ser
-- dominada por conteúdo que nenhuma asserção lê.
--
-- O que fica é só o que os testes NÃO criam por si: uma linha de `advisors` e
-- um artigo publicado. `rls_matrix_e2e` precisa de um de cada para exercitar
-- `consultations` e `article_likes`, que são tabelas de VÍNCULO — sem o alvo do
-- vínculo, a asserção falharia por falta de semente e não por falha de RLS,
-- que é o que ela existe para medir.
-- =============================================================================

insert into public.advisors (id, name, specialty, bio, status)
values ('e2e00000-0000-4000-8000-0000000000a1',
        'Consultora de Teste', 'Roteiros',
        'Linha de semente da pilha de ponta a ponta.', 'online')
on conflict (id) do nothing;

insert into public.articles
  (id, slug, title, category, author_name, content, status, published_at)
values ('e2e00000-0000-4000-8000-0000000000b1',
        'artigo-de-semente-e2e', 'Artigo de semente', 'destinos',
        'Equipe Easy Trip', 'Conteúdo mínimo, só para as tabelas de vínculo terem alvo.',
        'published', now())
on conflict (id) do nothing;
