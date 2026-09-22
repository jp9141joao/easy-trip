# Easy Trip — Plano de Implementação do Supabase

> **Documento histórico das fases de agosto de 2026.** Versões, contagens e
> pendências registram a evolução naquelas datas. Não substituem os 74 RF/70 RNF
> do recorte formal do TCC nem o [relatório atual de alinhamento](docs/RELATORIO_ALINHAMENTO_CODIGO_TCC_FINAL.md).

> Documento de auditoria. Nenhum arquivo do aplicativo foi alterado para produzi-lo.
> Gerado a partir da leitura de 23.679 linhas em `src/`, das 3 migrations, das 3
> Edge Functions e dos 26 arquivos de teste.

---

## Registro de execução

| Fase | Status | Data |
|---|---|---|
| **F0 — Baseline** | ✅ Concluída | 20/08/2026 |
| **F1 — Projeto Supabase e CLI** | ✅ Concluída (projeto `easy-trip` vinculado, ref `mqyrtajbfwucjvkfqwbn`, Postgres 17.6.1.155) | 20/08/2026 |
| **F2 — Correções de segurança (P-01, P-02)** | ✅ Concluída | 20/08/2026 |
| **F3 — Ofertas e Especialistas administráveis (`0004`)** | ✅ Concluída | 20/08/2026 |
| **F4 — Autenticação ponta a ponta (`0005`)** | ✅ Concluída | 20/08/2026 |
| **F5 — Perfil, preferências e avatar (`0006`)** | ✅ Concluída | 21/08/2026 |
| **F6 — Paridade do LocalDataSource (P-05)** | ✅ Concluída | 21/08/2026 |
| **F7 — Hardening de Storage e filtros (`0007`)** | ✅ Concluída (P-03, P-08, P-09 fechados; P-04 parcial) | 21/08/2026 |
| **F8 — Ciclo de vida dos arquivos e offline (P-07, D-04)** | ✅ Concluída | 21/08/2026 |
| **F9 — Conteúdo editorial, painel completo e upload de imagem** | ✅ Concluída (D-03 fechada; P-04 com o fluxo fechado e a migração do conteúdo legado pendente de asset) | 21/08/2026 |
| **F10 — Auditoria final e preparação do go-live** | ✅ Concluída (D-05 fechada; runbook criado; nenhuma pendência de código) | 21/08/2026 |

### F1 — o que foi feito

**Arquivos criados**
- `supabase/config.toml` — gerado por `supabase init`, depois ajustado (abaixo)
- `supabase/.gitignore` — gerado por `supabase init` (`.branches`, `.temp`, `.env.keys`)
- `supabase/.temp/` — cache do CLI, já ignorado

**Arquivos alterados**
- `package.json` / `package-lock.json` — `supabase@^2.115.0` como **devDependency**
- `.env.example` — distinção entre chave publicável e secreta; correção sobre os
  secrets das Edge Functions
- Este documento

**Arquivos NÃO tocados** (checksums MD5 conferidos antes e depois do `init`):
`0001_schema.sql`, `0002_rls.sql`, `0003_admin_roles.sql`, `seed.sql`, as três
Edge Functions e `SupabaseDataSource.ts` — todos byte-idênticos ao baseline.

### F1 — decisões tomadas

| # | Decisão | Motivo |
|---|---|---|
| 1 | CLI como **devDependency**, não global | O formato do `config.toml` é sensível à versão do CLI; `npx supabase` sem pin pegaria um major novo silenciosamente numa fase futura |
| 2 | `project_id = "easy-trip"` (era `easy-trip-3.0`, vindo do nome da pasta) | Identifica a stack local do Docker. Não é o ref remoto |
| 3 | `minimum_password_length = 8` e `password_requirements = "letters_digits"` | Alinha o servidor com o que `registerSchema` já exige. Sem isso, o servidor aceitaria uma senha de 6 caracteres que o formulário recusa |
| 4 | `[functions.*]` declaradas com `verify_jwt = true` | Torna o deploy reproduzível e a decisão explícita. As três já validam o JWT internamente; o gateway apenas evita gastar execução com chamada anônima |
| 5 | Manter o nome `EXPO_PUBLIC_SUPABASE_ANON_KEY` | `supabase-js` recebe a chave legada (`eyJ…`) e a nova (`sb_publishable_…`) na mesma posição. Renomear a variável exigiria mexer em `src/lib/config.ts` sem ganho funcional |
| 6 | **D-04 resolvida: tickets e documentos DEVEM funcionar offline** | Ver abaixo |

### Decisão arquitetural D-04 — arquivos offline

**Tickets, passagens, reservas e documentos têm de abrir sem internet.**

Hoje isso funciona: `src/lib/files.ts` copia o arquivo escolhido para o
diretório do aplicativo, e a URL local sobrevive ao fechamento do app.

Com o Supabase Storage, `fileUrl` passa a ser **URL assinada com validade de 1
hora**. Sozinha, ela é uma regressão: o usuário abriria o aplicativo no aeroporto
sem sinal e não veria o próprio cartão de embarque.

**Regra para a F8:** o Supabase Storage é a *origem oficial* do arquivo, nunca a
*única forma de acesso*. Uma cópia local é gravada ao anexar e ao baixar; a
leitura prefere a cópia local e só recorre à URL assinada quando não houver uma.
A exclusão precisa remover as duas.

### F1 — validações realizadas

| Verificação | Resultado |
|---|---|
| `supabase init` preservou os arquivos existentes | ✅ 7 checksums MD5 idênticos |
| `config.toml` é TOML válido | ✅ `tomllib` parseia |
| CLI lê o `config.toml` | ✅ container esperado é `supabase_db_easy-trip` |
| CLI reconhece os nomes `0001_`/`0002_`/`0003_` | ✅ `migration list` retorna as três versões |
| Ordenação das migrations | ✅ prefixo com zero à esquerda ordena antes de timestamps futuros |
| Migrations aplicam num PostgreSQL 17 real | ✅ as três, sem erro |
| **Idempotência das migrations** | ✅ aplicadas **duas vezes**, sem erro na segunda |
| Estado final do schema | ✅ 20 tabelas, 20 com RLS, 38 policies, 4 helpers |
| `seed.sql` aplica contra o schema | ✅ 6 offers, 6 articles, 12 places, 5 advisors |
| **Idempotência do seed** | ✅ aplicado duas vezes, contagens inalteradas |
| `db.seed.sql_paths` aponta para o seed existente | ✅ `["./seed.sql"]` |
| `.env` ignorado pelo git | ✅ `.gitignore:46` |
| `supabase/.temp` ignorado | ✅ `supabase/.gitignore:3` |
| Segredos no que seria commitado | ✅ nenhum |
| `tsc` / ESLint / testes | ✅ 0 / 0 / 236 passando |

> As migrations foram validadas **localmente, em contêiner descartável**. Nada
> foi executado no projeto remoto: sem `db push`, sem seed remoto, sem deploy.

### F1 — pendências que bloqueiam o encerramento

| # | Pendência | Quem resolve |
|---|---|---|
| B-1 | `EXPO_PUBLIC_SUPABASE_ANON_KEY` no `.env` contém **texto de placeholder**, não uma chave | Você |
| B-2 | O host de `EXPO_PUBLIC_SUPABASE_URL` **não resolve em DNS** — ref provavelmente também é placeholder | Você |
| B-3 | CLI não autenticado (`supabase login`) e projeto não vinculado (`supabase link`) | Você |
| B-4 | `[db] major_version = 17` precisa bater com a versão do projeto remoto | Verificar após B-3 |
| B-5 | `[auth] site_url` continua no placeholder `http://127.0.0.1:3000`; o app usa o scheme `easytrip://`. Relevante para a recuperação de senha na F4 | F4 |

> ⚠️ **Efeito colateral imediato do `.env` preenchido com placeholders:**
> `config.hasSupabase` passou a ser `true`, porque a checagem é apenas
> "as duas variáveis estão preenchidas". O aplicativo já não roda mais em modo
> demonstração — ele tenta falar com um host inexistente e **toda leitura e
> escrita falha**. Até que as credenciais reais entrem, esvaziar as duas
> variáveis devolve o app ao modo local funcional.

### F2 — o que foi feito

**Escopo:** exclusivamente P-01 e P-02. Nenhum outro defeito foi tocado.

#### P-01 — rascunhos expostos pela RLS

**Onde estava:** `articles_read` era criada por um laço em `0002_rls.sql` que
aplicava `using (true)` às quatro tabelas editoriais de uma vez. As outras três
não têm noção de rascunho; `articles` tem `status`, e por isso precisava de
regra própria.

**Decisão de versionamento — Opção A (corrigir `0002` no lugar), com uma ressalva.**

Verifiquei antes de decidir: `supabase migration list` **contra o remoto** devolveu
`remote: ""` nas três migrations. Nenhum banco, em lugar nenhum, chegou a ter a
policy vulnerável. A regra "não reescreva migration aplicada" não se aplica
quando nada foi aplicado — e criar uma migration de correção para um defeito que
nunca existiu em banco algum seria arqueologia, não histórico.

A ressalva: a primeira tentativa colocou `public.is_admin()` na policy de
`0002` — e **isso quebraria a aplicação em ordem**, porque `is_admin()` e
`profiles.role` só nascem em `0003`. A correção final mantém cada migration
autoconsistente:

| Migration | O que faz |
|---|---|
| `0002_rls.sql` | Tira `articles` do laço e cria `articles_read` com `using (status = 'published')`. Sem administrador, porque administrador ainda não existe aqui |
| `0003_admin_roles.sql` | Logo após criar `is_admin()`, **estende** a policy para `using (status = 'published' or public.is_admin())` |

As demais policies de `articles` (`admin_insert`, `admin_update`, `admin_delete`,
todas em `is_admin()`) não foram tocadas. Nenhuma permissão foi aberta.

#### P-02 — exclusão de conta não removia os arquivos

**Onde estava:** `storage.list(userId)` não é recursivo. Com anexos em
`{uid}/{tripId}/arquivo` e fotos em `{uid}/{entryId}/arquivo`, a listagem
devolvia os *prefixos*, e `remove(['uid/trip'])` não apagava nada.

A auditoria tinha registrado isso. Lendo o código de novo, o defeito é maior:

1. A listagem não é recursiva.
2. O erro de `list` era descartado — falha virava "pasta vazia".
3. O erro de `remove` era descartado — e a função respondia `ok: true` com os
   arquivos ainda no bucket.

**Correção:** a lógica saiu do handler HTTP para
`supabase/functions/_shared/storagePurge.ts`, um módulo puro sem globais do Deno
— o que permite testá-lo em Jest, sem rede e sem deploy. Ele:

- percorre recursivamente (pasta = entrada com `id: null`), com teto de profundidade;
- pagina em blocos de 100 até a página vir incompleta;
- apaga em lotes de 100;
- **relista ao final** e reporta o que sobrou;
- valida o formato do `userId` e confirma que todo caminho está sob `{uid}/`.

**Ordem de exclusão (mantida, agora com falha explícita):** arquivos → conta.
Se a limpeza não terminar íntegra, a função **aborta antes de apagar a conta** e
devolve 500. O motivo é o modo de falha: apagando a conta primeiro, uma falha
deixaria arquivos pessoais sem dono — não atribuíveis e sem conta para o usuário
tentar de novo. Falhando antes, nada foi destruído pela metade e a operação é
repetível.

A identidade continua vindo do JWT (`auth.getUser()`); a função não lê corpo de
requisição, então não há `userId` de cliente para forjar. Isso já era seguro e
foi preservado.

#### Arquivos alterados na F2

| Arquivo | Mudança |
|---|---|
| `supabase/migrations/0002_rls.sql` | `articles` fora do laço + policy própria |
| `supabase/migrations/0003_admin_roles.sql` | Estende `articles_read` para admin |
| `supabase/functions/delete-account/index.ts` | Usa `purgeUserFiles`; aborta se a limpeza falhar |
| `supabase/functions/_shared/storagePurge.ts` | **Novo** — lógica recursiva testável |
| `supabase/tests/_local_bootstrap.sql` | **Novo** — stubs de `auth`/`storage` + grants |
| `supabase/tests/rls_articles.test.sql` | **Novo** — cenários A–E do P-01 |
| `tests/unit/storage-purge.test.ts` | **Novo** — 10 testes do P-02 |

#### Testes e validação

**P-01** — contra PostgreSQL 17 descartável, migrations aplicadas em ordem:

| Cenário | Resultado |
|---|---|
| A — conta comum lê publicado | ✅ |
| B — conta comum **não** lê rascunho | ✅ |
| C — administrador lê rascunho e publicado | ✅ |
| D — sem autenticação não lê nada (regra atual do produto) | ✅ |
| E — `select * from articles` sem filtro devolve só publicados | ✅ |
| Regressão — offers/places/advisors seguem legíveis | ✅ |

Com a policy vulnerável restaurada, **o cenário B falha** — o teste mede a RLS,
não uma condição SQL isolada.

**P-02** — 10 testes com um dublê que reproduz a semântica real do `list`
(filhos imediatos, pasta como `id: null`): avatar plano, documento aninhado,
foto de diário, 5 níveis de profundidade, 250 arquivos (paginação e lotes),
arquivos de outro usuário intactos, falha de `remove`, falha de `list`,
identificador malformado, e varredura dos três buckets.

**Migrations continuam idempotentes** — aplicadas duas vezes numa base limpa,
sem erro.

#### O que continua pendente (não corrigido nesta F2, por decisão)

**P-07 — arquivos órfãos ao excluir ticket ou apólice individualmente.**
Analisado: a correção do P-02 **não** resolve. `purgeUserFiles` só roda na
exclusão de conta; apagar um ticket avulso continua removendo a linha e deixando
o objeto no bucket. A correção fica em `SupabaseDataSource.ts` (código do
aplicativo) e altera o comportamento de duas operações — fora do escopo da F2,
que o pedido restringiu a P-01 e P-02. **Sugerido para a F8**, junto com o
requisito de offline (D-04), já que as duas mexem no mesmo caminho de arquivo.

Os demais defeitos (P-03, P-04, P-05, P-06, P-08, P-09) permanecem como na
auditoria.

---

### F3 — o que foi feito

**Decisão D-06 fechada pelo responsável: SIM**, Ofertas e Especialistas terão
CRUD administrativo. A F3 põe isso no banco.

**Migration criada:** `0004_content_publishing.sql`.

| Tabela | Colunas novas | Efeito |
|---|---|---|
| `offers` | `status` (CHECK `draft`/`published`, default `published`), `sort_order`, `created_at`, `updated_at` | rascunho e ordem editorial |
| `advisors` | `active` (default `true`), `created_at`, `updated_at` | tirar do ar sem apagar o cadastro |

**Objetos:** função `public.set_updated_at()` e gatilhos
`offers_set_updated_at` / `advisors_set_updated_at`; índices
`offers_published_idx (status, sort_order, id)` e `advisors_active_idx (active, name)`.

**RLS reescrita** (o mesmo defeito de P-01 nasceria aqui no instante em que as
colunas existissem):

- `offers_read` → `(status = 'published' and dentro da vigência) or is_admin()`
- `advisors_read` → `active or is_admin()`

As seis policies de escrita já vinham da `0003`. A `0004` não as recria — ela
**verifica** que as seis existem e aborta se faltar alguma.

**Divergências em relação ao rascunho de `0004` registrado nesta auditoria:**

1. `places.active` / `places.featured` **não** foram criadas. Nenhuma tela tem
   noção de lugar em destaque, e `places` já tem CRUD funcionando — seriam
   colunas gravadas que nada lê, o mesmo motivo pelo qual esta auditoria recusou
   `places.short_description`.
2. `0005_rls_fixes.sql` **não existe**: a F2 já corrigiu P-01 dentro de `0002` +
   `0003`.
3. `created_at` / `updated_at` ficaram fora dos tipos TypeScript. São colunas de
   auditoria que nenhuma tela mostra; expô-las obrigaria o catálogo local a
   inventar timestamps para conteúdo sem data real de criação.
4. `active_from` / `active_until` (colunas mortas desde a `0001`) passaram a ter
   efeito, dentro da própria `offers_read`.

**Tipos:** `ContentStatus` novo (compartilhado por `Article` e `Offer`),
`Offer.status`, `Offer.sortOrder`, `Advisor.active`.

**Validação:** 28 cenários RLS contra PostgreSQL 17 real
(`supabase/tests/rls_content.test.sql`) + 7 testes Jest. Revertendo
`offers_read` para `using (true)`, o cenário B falha — o teste mede a policy.
Aplicar a `0004` sem a `0003` aborta com erro explícito.

---

### F4 — o que foi feito

**O achado que definiu a fase.** Subindo o Supabase local e exercitando o fluxo
real de cadastro/login, a primeira leitura autenticada respondeu:

```
GET /rest/v1/profiles  →  42501  permission denied for table profiles
```

Acessar tabela no PostgreSQL exige **duas** autorizações: o GRANT e a policy.
As migrations 0001–0004 cuidaram só da segunda, na suposição de que o Supabase
concederia os privilégios. Ele concede — mas apenas para objetos criados pelo
papel `supabase_admin`, e as migrations rodam como `postgres`:

```sql
select defaclrole::regrole, defaclnamespace::regnamespace from pg_default_acl;
-- supabase_admin | public   ← anon, authenticated, service_role
-- (nenhuma linha para postgres em public)
```

Apontado a um projeto real, **nada carregaria** — nem perfil, nem viagens, nem
conteúdo. E o sintoma engana: parece erro de RLS ou de sessão, e as duas estão
certas. A auditoria não podia ter visto isso, porque nada tinha sido executado
contra um Supabase de verdade até aqui.

**Migration criada: `0005_grants.sql`** (justificada pelo §6 do pedido: defeito
provado, migration nova, nunca editar 0001–0004).

- GRANT em todas as tabelas de `public` para `authenticated` e `service_role`;
- `ALTER DEFAULT PRIVILEGES` para que a próxima migration não reintroduza o
  defeito em silêncio;
- **`anon` fica de fora, deliberadamente.** O padrão do Supabase é conceder e
  confiar na RLS; aqui não há área pública, então a falta do GRANT vira uma
  segunda barreira;
- bloco final que aborta a migration se faltar SELECT para `authenticated` ou
  sobrar SELECT para `anon`.

**Correção do teste de F2/F3.** O `_local_bootstrap.sql` concedia os privilégios
por conta própria, com o comentário "o Supabase concede por padrão" — a mesma
suposição errada. Os grants saíram de lá: agora quem os fornece é a `0005`, e
removê-la faz os testes falharem.

**Autenticação.** O adaptador ganhou `onAuthStateChange` (fonte única de
verdade, inclusive para token revogado por fora), cadastro passou a devolver
`SignUpOutcome` em vez de sinalizar "confirme seu e-mail" como exceção, e as
mensagens do provedor deixaram de chegar cruas à tela.

**Recuperação de senha** implementada até o limite local: `redirectTo` derivado
de `Linking.createURL`, leitura do deep link (`src/lib/authLinking.ts`, formatos
implícito e PKCE), resgate da sessão e tela `(auth)/reset-password`. A sessão de
recuperação **não** vale como sessão comum. Falta configuração no dashboard —
ver "Limitações externas" no relatório da fase.

**Proteção de rotas** passou a ser estrutural (`Stack.Protected` no layout raiz),
cobrindo as 12 rotas de topo. Antes, só `(tabs)` e `admin` eram guardadas:
`trip/`, `profile/`, `utilities/`, `trips/new`, `alerts` e as telas editoriais
ficavam de fora. `tests/unit/route-guard.test.ts` lê o diretório de rotas e falha
se aparecer uma rota nova sem classificação.

**P-06 corrigido de passagem** (o §2 do pedido exige limpar cache privado no
logout): `currentTripId` sai do aparelho junto com a sessão.

**Exclusão de conta:** nada reimplementado. Removida a dupla exclusão — o
provider apagava as linhas pelo cliente *antes* de chamar a Edge Function, o que,
numa falha dela, deixaria conta viva e sem dado nenhum.

**Validação:** 33 verificações ponta a ponta com JWTs reais contra o Supabase
local (`supabase/tests/auth_e2e.mjs`), incluindo o isolamento USER_A/USER_B em
`trips` e na entidade filha `itinerary_items`. Antes da `0005`, 18 delas
falhavam.

Mais 18 verificações da exclusão de conta rodando a Edge Function de verdade
(`supabase/tests/delete_account_e2e.mjs`): arquivos em quatro caminhos e três
buckets, um deles aninhado em dois níveis, mais um arquivo de outra conta que
precisa sobreviver. É a primeira execução real do P-02 — a F2 o havia provado só
no nível de unidade.

---

### F5 — o que foi feito

**Escalada de papel: não havia vulnerabilidade.** Medido contra o Supabase local
com JWT de conta comum, antes de qualquer alteração: `PATCH {"role":"admin"}` →
`42501`, o mesmo com `role` escondido entre campos legítimos (e aí a linha
inteira é recusada, então nem o nome passa), `user_id` de outra conta → recusado
pela RLS, e `is_admin()` continua falso depois das tentativas. O gatilho
`prevent_role_escalation` (0003) faz o que promete.

**O que faltava era a segunda barreira.** `authenticated` tinha UPDATE em
*todas* as colunas de `profiles`, `role` inclusive — a proteção inteira dependia
de um gatilho continuar existindo. A `0006` passa a conceder UPDATE por coluna.
Demonstração das duas camadas, cada uma isolada:

| | `role` editável? |
|---|---|
| Com gatilho + privilégio por coluna | não (`42501`) |
| Gatilho removido, só a `0006` | não (`42501`) |
| Ambos removidos | **sim** — a conta vira admin |

**O defeito que a fase encontrou: a coluna do avatar era corrompida a cada
"Salvar".** `Profile.avatarUrl` carregava caminho na escrita e URL assinada na
leitura. O `upsert` gravava `avatar_path = profile.avatarUrl`, e como a leitura
devolvia a URL assinada, salvar o formulário escrevia uma URL — com token e
prazo — na coluna do caminho. Na leitura seguinte não havia arquivo naquele
"caminho" e **a foto sumia**. `Profile` passou a ter `avatarPath` (gravado) e
`avatarUrl` (derivado, nunca gravado).

**Contrato do repositório.** `upsert(draft)` virou `update(userId, patch)` com
`ProfilePatch` — allowlist declarada, não `Omit`: coluna nova não entra em
"editável" por descuido. `uploadAvatar` virou `replaceAvatar`, que sobe, aponta
e só então remove a anterior; se o perfil não puder ser atualizado, o arquivo
recém-enviado é removido. Antes, cada troca de foto deixava a anterior no bucket
para sempre.

**Bucket de avatares:** era privado (correto) mas sem limites. A `0006` põe 5 MB
e a lista de tipos no próprio bucket, casada com `src/domain/avatar.ts`.
`attachments` e `journal` continuam sem limites — parte do P-09, não desta fase.

**Dados fictícios: nenhum encontrado.** Busca dirigida por Arthur Albuquerque,
Viajante Pro, Premium, pravatar, `15.420`, `128h`, Easy Points, badges de
protótipo — zero ocorrências. Estatísticas e conquistas já eram derivadas de
viagens e metas reais, com condição objetiva visível.

**Validação:** 34 verificações E2E contra o Supabase local
(`supabase/tests/profile_avatar_e2e.mjs`) e 35 testes Jest novos.

---

### F6 — o que foi feito

**P-05 era maior do que a auditoria registrou.** O defeito conhecido —
`OFFERS`/`ADVISORS` lidos direto da constante, sem caminho de escrita — era o
menos grave. O outro estava escondido dentro da própria `LocalCollection`:

```ts
new LocalCollection<Article>('articles', () => ARTICLES)
```

A semente devolvia **o próprio array do módulo**, e `load()` fazia
`this.cache = this.seed()`. A partir daí `insert` e `update` escreviam dentro de
`catalog.ts`. Medido antes da correção: criar um artigo levava `ARTICLES` de 6
para 7 itens, e criar um lugar levava `PLACES` de 12 para 13 — permanentemente,
enquanto o módulo vivesse, e vazando de um teste para o seguinte.

**Correções:**

1. `LocalCollection` passou a copiar em profundidade na fronteira — na semente,
   na leitura e na escrita. Nada mais atravessa por referência.
2. `offers` e `advisors` viraram coleções semeadas, como as outras quatro.
3. Os contratos ganharam o que a decisão D-06 já previa e faltava na camada de
   dados: `listAllOffers`/`upsertOffer`/`removeOffer` e
   `listAll`/`upsert`/`remove` de especialistas — implementados nas **duas**
   fontes. Nenhuma tela nova.
4. **Paridade de vigência.** `listOffers` local filtrava só por `status`,
   ignorando `activeFrom`/`activeUntil` que a policy `offers_read` (0004) aplica.
   O lado Supabase tinha o mesmo buraco para o administrador, a quem a RLS
   devolve tudo. A regra foi extraída para `src/domain/offerWindow.ts` e agora os
   dois lados chamam a mesma função.

**Varredura:** as 13 entidades com escrita passaram por um ciclo
create → read → update → read → delete → read. Nenhum outro P-05 silencioso.

**Validação:** 41 testes Jest novos, incluindo um contrato parametrizado
(`tests/contracts/catalogContract.ts`), e 10 verificações E2E
(`supabase/tests/offer_window_e2e.mjs`) provando que a consulta que o aplicativo
envia ao PostgREST decide a vigência igual à fonte local, para as mesmas seis
situações.

**Nenhuma migration foi criada ou alterada.**

---

### F7 — o que foi feito

**Escopo:** P-03, P-04, P-08 e P-09, cada um a partir da definição original da
seção 31 deste documento. P-07 e D-04 permaneceram intocados.

**P-08 era maior do que a auditoria registrou — em duas direções.**

A auditoria descreveu a injeção no filtro e classificou o risco como Baixo
porque "a RLS ainda protege". Medido contra o PostgREST local, as duas metades
se confirmaram, e apareceu uma terceira coisa:

```
or=(id.eq.<valor>,slug.eq.<valor>)   com valor = "<uuid>,status.eq.draft"
  → com service_role (sem RLS): devolve o rascunho
  → com JWT de conta comum:     devolve []
```

Ou seja: o filtro **é** alterável pelo parâmetro da rota, e o que impede o
vazamento hoje é a policy `articles_read` corrigida no P-01. A defesa em
camadas funcionou — e é exatamente por isso que a camada de cima também precisa
existir.

A terceira coisa: `getArticle` **nunca funcionou por slug**. O ramo
`id.eq.<texto>` estoura o cast de uuid (`22P02`) e derruba a consulta inteira,
com HTTP 400. A fonte local resolvia id ou slug corretamente; a remota não
resolvia slug de jeito nenhum.

A correção elimina o filtro composto: a forma do valor diz qual coluna
consultar, e `.eq()` viaja como parâmetro próprio, fora do parser de árvore.
A mesma classe de defeito estava na busca de lugares — ali com valor **digitado
pelo usuário**, não vindo da rota — e foi corrigida junto, com escape de aspas
e dos curingas do `LIKE` (`src/lib/postgrest.ts`).

**P-09 — os dois buckets que faltavam.** `attachments` e `journal` continuavam
sem `file_size_limit` e sem `allowed_mime_types` desde a `0002`. Não são cópias
da regra do avatar: bilhete aceita PDF (é como a companhia aérea entrega o
documento) e diário não (a galeria renderiza com `expo-image`). A `0007` põe os
limites no servidor; `src/domain/upload.ts` põe a mesma regra na tela, para a
recusa vir com motivo antes de o upload começar.

**Os caminhos passaram a ser construídos, nunca recebidos.** Antes:
`${userId}/${tripId}/${Date.now()}-${file.name}` — com o nome vindo do seletor.
Agora o nome não participa: extensão derivada do tipo validado e sufixo
aleatório.

**P-03 — o tipo mentiroso tinha consequência.** `scheduledAt` e `requestedFor`
diziam ser `ISODateTime`; a coluna é `text` e a tela pede texto ("quinta à
tarde"). Os dois viraram `ScheduleText`. O efeito real era a ordenação:
`listConsultations` ordenava por esse campo nas **duas** fontes, comparando
frases como se fossem datas. A lista passou a ordenar por `createdAt`, que é
`timestamptz` de verdade e foi exposto no tipo.

**P-04 — metade fechada.** A infraestrutura existe e está provada: bucket
`content` público, 5 MB, só imagem, escrita restrita a `is_admin()`, mais
`uploadEditorialImage` nas duas fontes. A outra metade da correção original —
trocar o campo "Imagem (URL)" do formulário administrativo por um upload — é UI
administrativa, que o pedido da F7 proibiu explicitamente. As imagens
editoriais continuam sendo URLs do Unsplash (`src/data/images.ts` e 29
ocorrências em `seed.sql`).

**Validação:** 49 testes Jest novos (418/38 no total, eram 369/35) e 59
verificações E2E contra o Supabase local (`supabase/tests/storage_e2e.mjs`),
incluindo a bateria A–J do §15 com dois usuários reais nos dois buckets
privados. Cada correção foi revertida de propósito para confirmar que algum
teste cai.

---

### F8 — o que foi feito

**A auditoria errou o alcance do P-07 — e medir mostrou onde.**

A definição original diz que excluir "um `ticket` ou uma `insurance_policy`"
deixa o arquivo no bucket. Reproduzido contra o Storage local, linha por linha:

| Entidade | linha depois | arquivo depois |
|---|---|---|
| `tickets` | sumiu | **sumiu** — já estava correto |
| `insurance_policies` | sumiu | **ficou** — P-07 confirmado |
| `journal_entries` + mídias | sumiu | sumiu — já estava correto |

Ou seja: o defeito era real, mas só em **uma** das duas entidades apontadas. O
código de `tickets` já removia o objeto desde o commit base. Corrigir "os dois"
sem medir teria produzido um relatório falso.

**O que estava errado em todos eles, e não estava na auditoria.** Medido contra
a pilha local, `DELETE /storage/v1/object/{bucket}` devolve **HTTP 200 com
`[]`** tanto quando a policy barra a remoção quanto quando o objeto já não
existe. Não existe `error` para checar. As três implementações ignoravam o
retorno, então uma remoção barrada seguia direto para o `delete` da linha — e
produzia exatamente o órfão que o P-07 descreve, por um caminho que ninguém
tinha considerado.

A correção centraliza a ordem em `repositories/supabase/fileLifecycle.ts`:
arquivo primeiro, linha depois, **e a linha só cai se o arquivo caiu**. As duas
operações são idempotentes, então repetir converge de qualquer ponto. A ordem
inversa trocaria um estado visível e recuperável por lixo invisível e
permanente.

**D-04 é mais estreita do que "offline" sugere — e a documentação é explícita.**
A decisão (§32) pede que "tickets, passagens, reservas e documentos abram sem
internet", com a regra: *"o Supabase Storage é a origem oficial do arquivo,
nunca a única forma de acesso"*. E a §21 **decide contra** fila de
sincronização, com justificativa técnica: *"exige resolução de conflitos,
idempotência e reconciliação de ids — semanas de trabalho e uma classe inteira
de bugs difíceis"*.

Implementado, portanto: cópia local do arquivo (`src/lib/fileMirror.ts`), com o
caminho derivado do `storagePath` — que já começa pelo UID, então o espelho fica
isolado por conta sem índice nenhum para dessincronizar; e cache de **leitura**
persistido (`src/lib/queryPersistence.ts`), sem o qual a tela de documentos
abriria vazia em modo avião e não haveria o que tocar. Escrita offline continua
fora de escopo, por decisão registrada.

**Validação:** 59 testes Jest novos (477/42 no total, eram 418/38) e 41
verificações E2E (`supabase/tests/lifecycle_e2e.mjs`), incluindo o fluxo antigo
preservado como prova do defeito. **Nenhuma migration foi criada**: as colunas
`file_path` já existiam e, sem escrita offline, não há coluna de conflito a
acrescentar.

---

### F9 — o que foi feito

**Escopo:** fechar a decisão D-03, completar a metade aberta do P-04 e construir
os dois módulos administrativos que a D-06 previa e que ainda não existiam.

**D-03 fechada: SIM, o bucket `content` passa a ser o mecanismo principal.**
A pergunta original era "imagens editoriais: bucket `content` ou continuar com
URL externa?". A F7 respondeu metade — criou e provou o bucket — e a F9 aplicou
a decisão onde ela aparece para quem usa: **o formulário administrativo deixou
de ter campo de URL**. `articleFormSchema` e `placeFormSchema` não têm mais
`imageUrl`; não existe caminho na interface para colar um endereço do Unsplash.

**O upload não acontece ao abrir o seletor.** `EditorialImageField` produz um
arquivo em memória e mostra a pré-visualização; o envio é parte do "Salvar".
Quem escolhe uma foto e abandona o cadastro não deixa objeto no bucket.

**A ordem entre as duas gravações virou um módulo.** `repositories/editorialImage.ts`
centraliza o que antes seria repetido em quatro telas: sobe a imagem nova, grava
o registro e **só então** remove a anterior; se a gravação falhar, a imagem que
acabou de subir é removida antes de o erro subir. Não reaproveita o
`fileLifecycle` da F8 de propósito — lá o arquivo sai antes da linha e a
exclusão é abortada se o arquivo sobreviver, porque um documento privado
acessível é o P-07; aqui abortar a exclusão de um artigo por causa da capa
deixaria no ar o conteúdo que o administrador mandou tirar. E `fileLifecycle`
autoriza o caminho por `auth.uid()`, que em `content` não existe: quem autoriza
é `is_admin()`.

**Gerenciada x legada, uma distinção com consequência.** `managedContentPath` e
`managedPathBelongsTo` (em `domain/upload.ts`) decidem se um valor gravado é um
arquivo do próprio Easy Trip — pela **estrutura** do caminho, não pelo host, que
muda entre ambientes. Uma URL do Unsplash nunca chega a virar um
`storage.remove()`; o arquivo de outro registro também não, porque o caminho
`content/{kind}/{entityId}/{uuid}.{ext}` prova de quem é o objeto.

**Os dois módulos "Em breve" viraram cadastro.** `Em Alta` (ofertas) e
`Especialistas` ganharam lista e formulário, ligados aos repositories que a F3 já
tinha criado — `listAllOffers`/`upsertOffer`/`removeOffer` e
`listAll`/`upsert`/`remove` de advisors existiam desde a `0004` e não tinham
interface. Nenhum dos dois tem "Preencher com IA", como as decisões §48/§49
registram: preço, desconto, vigência e dados de pessoas reais não se pedem a um
modelo. A foto do especialista vai para `content/advisors/…`, e **não** para o
bucket `avatars`: aquele é privado e preso a `auth.uid()`, e um especialista não
tem conta no aplicativo.

**Nenhuma migration nova.** O schema já suportava tudo: `image_url` é `text` e
recebe a URL pública do bucket (o contrato que a F7 aprovou), `offers.image_url`
é `NOT NULL` — por isso o formulário de oferta exige a imagem —, e
`advisors.avatar_url` é anulável. A `0007` já tinha o bucket e as policies.

**A migração do conteúdo legado ficou pendente de asset, e está registrado.**
As 29 URLs do `seed.sql` continuam apontando para o Unsplash porque as
fotografias correspondentes não existem no repositório, e as três saídas
possíveis eram piores do que a pendência: baixar da internet durante o seed
tornaria `supabase db reset` dependente de rede; gerar imagens sintéticas
apresentaria fotos inventadas como se fossem lugares reais; repetir a mesma foto
em 22 registros degradaria o catálogo. O que existe é o mecanismo pronto:
`scripts/seed-content-assets.mjs` lê `assets/content/{kind}/{slug}.{jpg|png|webp}`,
envia para o bucket, aponta a coluna e **falha listando o que falta** — sem
baixar nada e recusando qualquer host que não seja local. O seed do banco
continua sendo SQL puro e reproduzível offline; a etapa de imagens é separada e
explícita.

**Validação:** 54 testes Jest novos (531/46 no total, eram 477/42) e 62
verificações E2E novas (`supabase/tests/content_admin_e2e.mjs`), totalizando 257
verificações E2E contra o Supabase local. A bateria da F9 cobre o ciclo completo
com JWT real (rascunho invisível → publicado visível → troca de imagem →
exclusão), as falhas parciais A–G do §31, a curtida de artigo continuando presa
a `auth.uid()` e o administrador rebaixado perdendo escrita no bucket e nas
tabelas. Cada verificação de invisibilidade é precedida
de uma confirmação por `service_role` de que a linha existe — sem isso, "o
rascunho não vaza" passaria porque o preparo falhou.

---

### F10 — o que foi feito

**Escopo:** auditoria final, sem funcionalidade nova. A pergunta era uma só —
o Easy Trip pode receber as migrations num Supabase hospedado? — e o trabalho
foi produzir evidência para respondê-la.

**Uma regressão de verdade foi encontrada, e era minha.** Ao extrair `uuidFrom`
para um módulo comum na F9, `supabase/seed.sql` foi regenerado por um gerador
que nunca tinha sido atualizado para a `0004`: as colunas `status`,
`sort_order`, `active_from`, `active_until` (ofertas) e `active`
(especialistas) sumiram do arquivo. O efeito era silencioso e real — depois de
um `db reset`, as seis ofertas nasciam com `sort_order = 0` e a faixa Em Alta
perdia a ordem editorial que o catálogo declara. O gerador foi corrigido e o
seed regenerado; a ordem voltou (10, 20, 30…). Nenhum teste pegava isso porque
nenhum teste lia o **arquivo** — liam o banco depois de um seed feito à mão.

**D-05 fechada: os especialistas fictícios não vão para produção.** A definição
original perguntava se eles iriam "e, se sim, se precisariam ser rotulados como
demonstrativos". O rótulo foi descartado: um selo não impede alguém de tocar em
"Agendar consulta" com uma pessoa que não existe. A saída foi separar os seeds.

**`supabase/seed.production.sql`, gerado do mesmo catálogo.** Três coisas do
conteúdo de demonstração não sobrevivem ao contato com um usuário real, e a
diferença entre os dois arquivos é exatamente essa lista: especialistas
fictícios (D-05), ofertas com preço inventado (o próprio formulário de oferta
diz que "os valores são digitados por quem os assume") e, nos lugares, `phone` e
`rating` — um número de oito dígitos inventado para um bistrô em Paris toca no
telefone de um estranho, e uma nota sem fonte é alegação que o produto não
sustenta, num aplicativo que exibe aviso fixo dizendo que ainda não mostra
avaliações. As assinaturas dos artigos passam a ser institucionais: o texto é da
equipe, e é isso que o crédito diz. Nada foi inventado para substituir o que
saiu.

**Três defeitos pequenos, corrigidos.**

1. *Chave secreta no lugar da pública.* As duas ficam lado a lado no painel e se
   parecem. Colar a errada não quebrava nada visível: o aplicativo funcionaria,
   em modo produção, com a RLS **desligada para todo mundo** — `service_role` a
   ignora por definição. `src/lib/config.ts` passa a detectar as duas formas
   (`sb_secret_…` e JWT com `role: service_role`), **descartar** a chave e
   explicar o motivo em Ajustes. Entre "funciona e vaza" e "não conecta e diz
   por quê", só a segunda é aceitável.
2. *Configuração pela metade.* URL sem chave (ou o contrário) tinha o mesmo
   sintoma de configuração ausente: o aplicativo simplesmente ficava local.
   Agora aparece como problema de instalação, na tela de Ajustes.
3. *Promessa de seguro.* O estado vazio do SOS dizia "Adicionar documento" e
   levava para Documentos, sugerindo que anexar um PDF encheria a seção de
   apólices — e não enche: o cadastro de `insurance_policies` não existe nesta
   versão. O destino continua (é lá que a apólice fica e abre offline), com o
   texto dizendo o que a ação realmente faz.

**Rede de segurança de renderização.** Não havia `ErrorBoundary`: em build de
produção, um erro de render deixava a tela preta e sem explicação. O mecanismo
nativo do Expo Router — exportar `ErrorBoundary` do layout raiz — resolve em
poucas linhas, sem telemetria e sem arquitetura nova.

**A matriz de RLS completa, que faltava.** As baterias anteriores mediram o
isolamento onde havia defeito conhecido. `supabase/tests/rls_matrix_e2e.mjs`
varre o resto: cinco identidades (anônimo, dois usuários comuns, administrador,
`service_role`) contra nove tabelas privadas, com leitura, alteração e exclusão
testadas separadamente, e cada "não vê" precedido de uma confirmação por
`service_role` de que a linha existe. 74 verificações. Resultado que merece
registro: **o administrador não lê viagem nem diário de ninguém** — administrar
conteúdo não é administrar gente.

**P-04 continua com uma pendência que não é de código.** As 18 imagens que o
ambiente real precisaria (artigos e lugares; ofertas e especialistas não vão
para produção) não existem no repositório e não podem ser baixadas, geradas ou
repetidas. `assets/content/manifest.json` e `assets/content/README.md` listam
exatamente quais são e o que fazer quando existirem.

**Validação:** 11 testes Jest novos (542/48 no total, eram 531/46) e 74
verificações E2E novas — 331 no total contra o Supabase local, distribuídas em
oito baterias. A base foi reconstruída do zero (`supabase stop --no-backup` →
`start` → `db reset`), as migrations `0001`→`0007` foram aplicadas num banco
descartável e reaplicadas por cima para confirmar idempotência, e as 206 colunas
do schema foram conferidas uma a uma contra o adaptador remoto: nenhuma órfã,
nenhuma faltando.

**Nenhuma migration foi criada ou alterada.** O primeiro deploy remoto está
documentado em `GO_LIVE_SUPABASE.md` e **não foi executado**.

---

## 1. Resumo executivo

**A conclusão mais importante desta auditoria contraria a premissa do pedido: o
Easy Trip não precisa de uma integração com Supabase, porque ela já está
escrita.**

O projeto foi construído desde o início sobre uma abstração `DataSource` com
duas implementações completas — `LocalDataSource` (AsyncStorage, modo
demonstração) e `SupabaseDataSource` (PostgreSQL + RLS + Storage). Existem:

| Já existe no repositório | Estado |
|---|---|
| `supabase/migrations/0001_schema.sql` | 20 tabelas, índices, constraints, trigger de criação de perfil |
| `supabase/migrations/0002_rls.sql` | RLS habilitada nas 20 tabelas + 3 buckets de Storage com políticas |
| `supabase/migrations/0003_admin_roles.sql` | `profiles.role`, `is_admin()`, gatilho anti-auto-promoção, policies de escrita admin |
| `supabase/seed.sql` | 186 linhas de conteúdo editorial, gerado de `src/data/catalog.ts` |
| `supabase/functions/ai-chat` | Gemini via BFF, com JWT e rate limit |
| `supabase/functions/admin-generate-content` | Geração assistida, valida `role = admin` |
| `supabase/functions/delete-account` | Exclusão de conta com `service_role` |
| `src/repositories/supabase/SupabaseDataSource.ts` | 1.142 linhas — todos os repositórios implementados |
| `src/repositories/supabase/client.ts` | Cliente com `AsyncStorage`, `autoRefreshToken`, `detectSessionInUrl: false` |
| `src/repositories/auth.ts` | `SupabaseAuthAdapter` completo |

**O que realmente falta não é código de integração. É:**

1. **Configuração** — não existe `.env`, e por isso `config.hasSupabase === false`
   e o aplicativo roda hoje 100% em modo local.
2. **`supabase/config.toml`** — o CLI nunca foi inicializado, então as migrations
   existem mas nunca foram aplicadas a um projeto real.
3. **Sete defeitos concretos** encontrados na auditoria (seção 31), sendo dois
   com impacto de privacidade real.
4. **Quatro lacunas de modelo** para os módulos administrativos que ainda serão
   construídos (Ofertas e Especialistas).

O esforço estimado é de **configuração + correções**, não de reescrita.

### Divergências entre o pedido e o código real

O prompt pressupõe funcionalidades que **não existem** neste aplicativo. Registro
aqui em vez de assumir, conforme instruído:

| O pedido pressupõe | O que o código realmente tem |
|---|---|
| `trip_members`, viagens compartilhadas, convites, colaboração | **Não existe.** Uma viagem pertence a exatamente um `user_id`. Não há convite, participante ou permissão compartilhada em nenhum lugar do código. |
| Comunidade com posts de usuário, comentários, denúncias, moderação | **Não existe.** "Comunidade" é uma seção **editorial**: artigos escritos pela equipe. O usuário só pode **curtir** (`article_likes`). Não há criação de post, nem comentário, nem compartilhamento social. |
| `trip_days` | **Não existe e não deve existir.** Os dias são derivados de `start_date`/`end_date` em `src/domain/selectors.ts`. |
| `destinations` como tabela | **Não existe.** O destino é desnormalizado no `trips` (cidade, país, código ISO, lat/lon, timezone), resolvido pelo geocoding do Open-Meteo no momento da criação. |
| `bookings` | Existem `reservation_requests` e `consultations` — e o produto é explícito em **nunca** apresentá-las como reserva confirmada. |
| `expense_participants`, divisão de gastos | **Não existe.** Despesas são individuais. |
| Avaliações e comentários de usuários sobre lugares | **Proibido pelo produto.** A tela de Place traz um aviso fixo: "O Easy Trip ainda não exibe avaliações de usuários." |
| Notificações push | **Não existe.** `expo-notifications` não está instalado. O sino do app abre `/alerts`, que é **derivado** dos dados da viagem, sem persistência. |
| `hotels` / `restaurants` / `attractions` como tabelas separadas | Uma tabela `places` com `type` discriminador. Manter assim. |

---

## 2. Arquitetura atual encontrada

```
Expo SDK 54 · RN 0.81.5 · New Architecture · Hermes · expo-router 6 (typed routes)
│
├── src/app/            41 rotas (file-based)
├── src/providers/      AppProviders → SafeArea → QueryClient → Theme → Toast
│                                    → Connectivity → Auth → TripSelection
├── src/hooks/          44 hooks; toda leitura/escrita passa por TanStack Query
├── src/repositories/   ► DataSource (interface)
│                          ├── LocalDataSource     (AsyncStorage)
│                          └── SupabaseDataSource  (Postgres + Storage)
│                       ► AuthAdapter (interface)
│                          ├── LocalAuthAdapter    (SHA-256 + SecureStore)
│                          └── SupabaseAuthAdapter
├── src/domain/         types, schemas (Zod), selectors (derivados), roles, aiGrounding
├── src/services/       http, ai, adminContent, weather, currency, geocoding,
│                       timezone, emergency
└── src/lib/            storage (3 namespaces), date, currency, files, id, labels, url
```

**A escolha do adapter acontece em um único ponto** (`src/repositories/index.ts`):

```ts
export const dataSource: DataSource =
  config.hasSupabase ? supabaseDataSource : localDataSource;
```

`config.hasSupabase` é `Boolean(EXPO_PUBLIC_SUPABASE_URL && EXPO_PUBLIC_SUPABASE_ANON_KEY)`.
Como não há `.env`, **hoje o aplicativo inteiro roda no adapter local**. Nenhuma
tela sabe disso — é exatamente o que a abstração garante.

### Camada de armazenamento local (`src/lib/storage.ts`)

Três namespaces deliberadamente separados:

| Namespace | Prefixo | Conteúdo | Limpo no logout? |
|---|---|---|---|
| `jsonStorage` | `et:data:` | Registros do `LocalDataSource` | Não (é o "banco" local) |
| `cacheStorage` | `et:cache:` | Clima, câmbio (com `updatedAt`) | **Sim** |
| `prefsStorage` | `et:prefs:` | `themeMode`, `currentTripId`, `onboardingSeen` | **Não** — ver defeito P-06 |
| `secureStorage` | SecureStore | Sessão local | Sim |

---

## 3. Funcionalidades existentes

Levantamento a partir das 41 rotas e dos 44 hooks.

### 3.1 Autenticação
| Funcionalidade | Tela | Persistência |
|---|---|---|
| Cadastro (nome, e-mail, senha, moeda, estilo) | `(auth)/register.tsx` | `auth.users` + `profiles` (trigger) |
| Login | `(auth)/login.tsx` | Supabase Auth |
| Recuperação de senha | `(auth)/forgot-password.tsx` | `resetPasswordForEmail` |
| Logout | `profile/settings.tsx` | Limpa sessão + cache + React Query |
| Exclusão de conta (LGPD) | `profile/settings.tsx` | Edge Function `delete-account` |
| Restauração de sessão | `_layout.tsx` + `AuthProvider` | Splash segurado até resolver |
| Papel `user`/`admin` | `AuthProvider` | `profiles.role` |

### 3.2 Perfil
Nome, telefone, avatar, cidade/país de origem, timezone, estilo de viagem, moeda
padrão. Upload de avatar via `expo-image-picker` → bucket `avatars`.

### 3.3 Viagens
Criar (com busca de destino por geocoding), listar, abrir, editar, excluir,
selecionar viagem ativa. Status (`upcoming`/`active`/`completed`) e contagem
regressiva são **derivados**, nunca persistidos.

### 3.4 Trip Hub — 6 módulos
| Módulo | Tela | Tabela |
|---|---|---|
| Roteiro / Jornada | `trip/[tripId]/itinerary.tsx` | `itinerary_items` |
| Checklist | `trip/[tripId]/checklist.tsx` | `checklist_items` |
| Diário | `trip/[tripId]/journal.tsx` | `journal_entries` + `journal_media` |
| Carteira (despesas) | `trip/[tripId]/finance.tsx` | `expenses` |
| Tickets / documentos | `trip/[tripId]/tickets.tsx` | `tickets` |
| Editar viagem | `trip/[tripId]/edit.tsx` | `trips` |

### 3.5 Conteúdo editorial (leitura pública autenticada)
| Área | Tela | Tabela |
|---|---|---|
| Em Alta / Ofertas | `offers/index.tsx`, `offers/[offerId].tsx` | `offers` |
| Comunidade (artigos) | `community/index.tsx`, `community/[articleId].tsx` | `articles`, `article_likes` |
| Restaurantes / Hotéis / Atrações | `places/index.tsx`, `places/[placeId].tsx` | `places`, `place_favorites` |
| Especialistas | `(tabs)/advisor.tsx` | `advisors`, `consultations` |

### 3.6 Assessoria
Easy Trip IA (chat com contexto real da viagem) → `ai_conversations`, `ai_messages`.
Agendamento com especialista → `consultations`.

### 3.7 Objetivos
Metas de economia/destino/preparação/frequência com aportes → `goals`.

### 3.8 Utilitários
| Utilitário | Tela | Fonte |
|---|---|---|
| Clima | `utilities/weather.tsx` | Open-Meteo (sem chave) + cache |
| Fuso horário | `utilities/timezone.tsx` | `Intl.DateTimeFormat` — **puro cliente** |
| Mapa | `utilities/map.tsx` | `react-native-maps` + `places`/`itinerary_items` |
| SOS | `utilities/sos.tsx` | Dataset embarcado + `insurance_policies` |
| Câmbio | dentro de `finance.tsx` | Frankfurter (sem chave) + cache |
| Alertas | `alerts.tsx` | **Derivado** — sem tabela |

### 3.9 Painel administrativo
| Módulo | Estado |
|---|---|
| Comunidade (artigos) | CRUD completo + "Preencher com IA" + upload de capa (F9) |
| Restaurantes e Hotéis | CRUD completo + "Preencher com IA" + upload de foto (F9) |
| Em Alta / Ofertas | CRUD completo, **sem IA por decisão** (§48) — construído na F9 |
| Especialistas | CRUD completo, **sem IA por decisão** (§49) — construído na F9 |

### 3.10 Contato comercial
Botão WhatsApp com mensagem pré-montada + botão de link externo, na tela de
Place. Número em `src/constants/contact.ts`, link em `places.partner_url`.

---

## 4. Dados locais/mockados encontrados

| Arquivo | Dado | Estrutura hoje | Destino |
|---|---|---|---|
| `src/data/catalog.ts` | `OFFERS` (6) | `Offer[]` constante | **Supabase `offers`** — já no `seed.sql` |
| `src/data/catalog.ts` | `ARTICLES` (6) | `Article[]` constante | **Supabase `articles`** — já no `seed.sql`; em modo local já vira `LocalCollection` semeada |
| `src/data/catalog.ts` | `PLACES` (~14) | `Place[]` constante | **Supabase `places`** — idem |
| `src/data/catalog.ts` | `ADVISORS` (4) | `Advisor[]` constante | **Supabase `advisors`** — já no `seed.sql` |
| `src/data/images.ts` | `COVER_BY_CITY` | Mapa cidade→URL Unsplash | **Permanece local.** É fallback de imagem de capa, não dado de negócio |
| `src/services/emergency.ts` | Contatos de emergência por país | Dataset embarcado | **Permanece local, e deliberadamente.** SOS tem de funcionar sem rede |
| `src/lib/labels.ts` | Rótulos de enums em PT-BR | `Record<>` | **Permanece local.** É i18n, não dado |
| `src/theme/` | Tokens | Objetos | **Permanece local** |
| `src/constants/community.ts` | URL do grupo WhatsApp | `string` vazia | **Permanece local.** Configuração pública, não muda por usuário |
| `src/constants/contact.ts` | WhatsApp comercial | `string` vazia | **Permanece local**, mesmo motivo |
| `prefsStorage` | `themeMode` | AsyncStorage | **Permanece local.** É preferência de aparelho, não de conta |
| `prefsStorage` | `currentTripId` | AsyncStorage | **Permanece local** — mas ver defeito P-06 |
| `prefsStorage` | `onboardingSeen` | AsyncStorage | **Permanece local** |
| `cacheStorage` | Clima, câmbio | AsyncStorage com `updatedAt` | **Permanece local.** Cache de API externa |

> **Nota importante:** `OFFERS` e `ADVISORS` ainda são lidos como constantes no
> `LocalDataSource`, enquanto `ARTICLES` e `PLACES` já foram convertidos em
> `LocalCollection` semeada. Essa assimetria é intencional (os CRUDs de Ofertas e
> Especialistas ainda não existem), mas precisa ser resolvida quando eles
> chegarem — ver defeito P-05.

---

## 5. Entidades identificadas

20 entidades, todas já modeladas em `src/domain/types.ts` **e** em
`0001_schema.sql`:

`User` (auth) · `Profile` · `Trip` · `ItineraryItem` · `ChecklistItem` ·
`Expense` · `Ticket` · `JournalEntry` · `JournalMedia` · `Goal` · `Offer` ·
`Article` · `ArticleLike` · `Place` · `PlaceFavorite` · `Advisor` ·
`Consultation` · `ReservationRequest` · `AIConversation` · `AIMessage` ·
`InsurancePolicy`

**Entidades derivadas, que não são tabelas e não devem virar tabelas:**
`TripStatus`, `DerivedAlert`, `ChecklistProgress`, `WeatherReading`,
`ExchangeRate`, `ZoneClock`, `EmergencyContacts`.

---

## 6. Modelo de banco recomendado

**Recomendação: manter o schema de `0001_schema.sql` como está.** Ele foi
derivado do mesmo modelo de domínio que as telas usam, está normalizado, tem
constraints e índices, e passou por validação real nesta auditoria (as três
migrations foram aplicadas com sucesso a um PostgreSQL 16 durante o bloco
anterior).

As alterações necessárias são **aditivas** e cabem em migrations novas:

### `0004_content_publishing.sql` (necessária para Ofertas e Especialistas)

```sql
-- Ofertas precisam de rascunho/publicado e ordenação, como articles já tem.
alter table public.offers add column if not exists status text not null default 'published'
  check (status in ('draft','published'));
alter table public.offers add column if not exists sort_order integer not null default 0;
alter table public.offers add column if not exists created_at timestamptz not null default now();
alter table public.offers add column if not exists updated_at timestamptz not null default now();

-- Especialistas precisam de ativo/inativo (independente de online/offline,
-- que é presença e não cadastro).
alter table public.advisors add column if not exists active boolean not null default true;
alter table public.advisors add column if not exists created_at timestamptz not null default now();

-- Places: destaque e ativo/inativo (§9 do pedido).
alter table public.places add column if not exists active boolean not null default true;
alter table public.places add column if not exists featured boolean not null default false;
alter table public.places add column if not exists created_at timestamptz not null default now();
alter table public.places add column if not exists updated_at timestamptz not null default now();
```

### `0005_rls_fixes.sql` (correção de segurança — ver defeito P-01)

```sql
-- Hoje qualquer usuário autenticado consegue ler rascunhos pela API REST.
drop policy if exists articles_read on public.articles;
create policy articles_read on public.articles
  for select to authenticated
  using (status = 'published' or public.is_admin());
```

### Campos que **não** recomendo adicionar

| Campo pedido | Por quê não |
|---|---|
| `places.whatsapp` | O WhatsApp é da **Easy Trip**, não do estabelecimento (`src/constants/contact.ts`). Uma coluna por lugar sugeriria o contrário. |
| `places.google_maps_url` separado de `partner_url` | `partner_url` já aceita Google Maps, e o rótulo do botão é derivado do domínio em `src/lib/url.ts`. Dois campos criariam ambiguidade sobre qual abrir. |
| `places.short_description` | Nenhuma tela renderiza resumo de lugar. Criaria dado salvo que não aparece. |
| `articles.summary` | Idem — nenhuma tela o exibe hoje. Se for desejado, é mudança de UI **e** de schema, decidir junto. |
| `places.state` | O geocoding devolve `admin1`, mas nenhuma tela usa. Só adicionar se houver filtro por estado. |
| Soft delete generalizado | Ver seção 24. Só faz sentido em `places`/`offers`/`advisors`, e ali `active` já resolve. |

---

## 7. Tabelas e respectivas colunas

Todas já existem. Resumo do que está em `0001` + `0003`:

### `profiles`
| Coluna | Tipo | Notas |
|---|---|---|
| `user_id` | `uuid` PK → `auth.users(id)` ON DELETE CASCADE | 1:1 com a conta |
| `name` | `text NOT NULL` | |
| `phone`, `avatar_path`, `home_city`, `home_country`, `home_timezone`, `travel_style` | `text` | `avatar_path` é caminho de Storage, **nunca URL pública** |
| `default_currency` | `text NOT NULL DEFAULT 'BRL'` | |
| `role` | `text NOT NULL DEFAULT 'user'` CHECK `('user','admin')` | Fonte única de autorização |
| `created_at`, `updated_at` | `timestamptz NOT NULL DEFAULT now()` | |

Protegida pelo gatilho `profiles_no_role_escalation` (0003), que recusa mudança
de `role` quando há sessão de usuário final.

### `trips`
`id` PK · `user_id` → `auth.users` CASCADE · `destination_city` · `destination_country` ·
`country_code char(2)` · `latitude`/`longitude` `double precision` · `timezone text` ·
`start_date`/`end_date date` · `cover_image_url` · `budget_total numeric(12,2) >= 0` ·
`budget_currency` · timestamps.
Constraint `trips_date_order CHECK (end_date >= start_date)`.
Índice `trips_user_idx (user_id, start_date desc)`.

### `itinerary_items`
`id` PK · `trip_id` → `trips` CASCADE · `date` · `start_time`/`end_time time` ·
`type` CHECK (7 valores) · `title` · `description` · `place_name` · lat/lon ·
`reservation_reference` · `completed boolean` · `sort_order integer`.
Índice `(trip_id, date, start_time, sort_order)`.
**Sem `user_id`** — a autorização passa pelo trip pai, de propósito.

### `checklist_items`
`id` · `trip_id` CASCADE · `label` · `category` CHECK (6) · `completed` ·
`priority` CHECK · `due_date` · `created_at`. Índice `(trip_id)`.

### `expenses`
`id` · `trip_id` CASCADE · `user_id` CASCADE · `category` CHECK (6) ·
`amount numeric(12,2) > 0` · `currency` · `amount_in_budget_currency` ·
`exchange_rate numeric(18,8)` · `exchange_rate_timestamp` · `transaction_date` ·
`description`. Índice `(trip_id, transaction_date desc)`.

> A taxa de câmbio é gravada **junto com a despesa**. É a decisão que impede uma
> despesa histórica de mudar de valor quando o mercado se move.

### `tickets`
`id` · `trip_id` CASCADE · `user_id` CASCADE · `type` CHECK (5) · `title` ·
`provider` · `reference` · `start_date_time`/`end_date_time timestamptz` ·
`origin`/`destination` · **`file_path`** · `mime_type` · `notes`. Índice `(trip_id)`.

### `journal_entries` / `journal_media`
`journal_entries`: `id` · `trip_id` CASCADE · `user_id` CASCADE · `entry_date` ·
`content` · lat/lon · `place_name` · timestamps. Índice `(trip_id, entry_date desc)`.
`journal_media`: `id` · `journal_entry_id` CASCADE · **`file_path`** · `mime_type` ·
`sort_order`. Índice `(journal_entry_id, sort_order)`.

### `goals`
`id` · `user_id` CASCADE · `trip_id` **ON DELETE SET NULL** · `type` CHECK (4) ·
`title` · `target_value > 0` · `current_value >= 0` · `unit` · `status` CHECK (3) ·
`deadline`. Índice `(user_id)`.

> `SET NULL` e não CASCADE: apagar a viagem não deve apagar a meta de economia
> que a financiava.

### `offers`, `articles`, `places`, `advisors` (editorial)
Ver `0001`. `articles` já tem `status ('draft','published')` e `slug` UNIQUE.
`places` tem índice `(city, type)`.

### `article_likes` / `place_favorites`
Tabelas de junção N:N com PK composta `(user_id, article_id)` / `(user_id, place_id)` —
o que já garante a unicidade sem constraint extra.

### `consultations`, `reservation_requests`
Ambas nascem com `status = 'requested'`. **Nunca** como confirmadas.

### `ai_conversations`, `ai_messages`
`ai_messages.conversation_id` CASCADE. Índice `(conversation_id, created_at)`.

### `insurance_policies`
`user_id` CASCADE · `trip_id` SET NULL · `provider` · `policy_number` ·
`emergency_phone` · **`file_path`** · `valid_until`.

---

## 8. Relacionamentos

```
auth.users (1)
 ├─1:1─ profiles
 ├─1:N─ trips
 │       ├─1:N─ itinerary_items          (CASCADE)
 │       ├─1:N─ checklist_items          (CASCADE)
 │       ├─1:N─ expenses                 (CASCADE)
 │       ├─1:N─ tickets                  (CASCADE) ──► Storage: attachments/
 │       └─1:N─ journal_entries          (CASCADE)
 │                └─1:N─ journal_media   (CASCADE) ──► Storage: journal/
 ├─1:N─ goals                    (trip_id SET NULL)
 ├─1:N─ consultations            ──► advisors
 ├─1:N─ reservation_requests     ──► places, trip_id SET NULL
 ├─1:N─ insurance_policies       (trip_id SET NULL)
 ├─1:N─ ai_conversations
 │        └─1:N─ ai_messages            (CASCADE)
 ├─N:N─ articles   via article_likes    (PK composta)
 └─N:N─ places     via place_favorites  (PK composta)

Conteúdo editorial (sem dono, escrito por admin):
  offers · articles · places · advisors
```

**Não há N:N entre usuários e viagens.** Não existe `trip_members`. Se
colaboração for desejada, é funcionalidade nova — ver seção 32.

---

## 9. Diagrama textual do banco

```
┌──────────────┐
│  auth.users  │  (gerenciado pelo Supabase Auth)
└──────┬───────┘
       │ 1:1 (trigger handle_new_user)
┌──────▼───────┐
│   profiles   │  role: user | admin  ◄── gatilho anti-escalação
└──────┬───────┘
       │ 1:N
┌──────▼───────┐        ┌────────────────┐
│    trips     │───1:N──│ itinerary_items│
│              │───1:N──│ checklist_items│
│              │───1:N──│    expenses    │
│              │───1:N──│    tickets     │──► attachments/{uid}/{trip}/
│              │───1:N──│ journal_entries│───1:N──┐
└──────┬───────┘        └────────────────┘        │
       │ SET NULL                          ┌──────▼────────┐
┌──────▼───────┐                           │ journal_media │──► journal/{uid}/{entry}/
│    goals     │                           └───────────────┘
└──────────────┘

┌──────────────────────────── conteúdo editorial ────────────────────────────┐
│  offers      articles ──N:N── article_likes ──── users                     │
│              places   ──N:N── place_favorites ── users                     │
│                       ──1:N── reservation_requests                         │
│              advisors ──1:N── consultations                                │
└────────────────────────────────────────────────────────────────────────────┘

┌──── privado do usuário ────┐
│ ai_conversations ─1:N─ ai_messages                                          │
│ insurance_policies ──► attachments/                                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 10. Autenticação

### Já implementado (`src/repositories/auth.ts`)

| Operação | Método Supabase | Tela |
|---|---|---|
| Cadastro | `signUp({ email, password, options: { data: { name } } })` | `(auth)/register.tsx` |
| Login | `signInWithPassword` | `(auth)/login.tsx` |
| Restaurar sessão | `getSession()` | `AuthProvider` no boot |
| Recuperar senha | `resetPasswordForEmail` | `(auth)/forgot-password.tsx` |
| Logout | `signOut()` | `profile/settings.tsx` |
| Excluir conta | `functions.invoke('delete-account')` | `profile/settings.tsx` |

### Persistência de sessão

Já configurada em `src/repositories/supabase/client.ts`:

```ts
auth: {
  storage: AsyncStorage,
  autoRefreshToken: true,
  persistSession: true,
  detectSessionInUrl: false,   // React Native não tem barra de endereço
}
```

**Decisão a confirmar:** a sessão do Supabase fica em `AsyncStorage`, não em
`SecureStore`. É o padrão recomendado pelo Supabase para RN (o `SecureStore` do
iOS tem limite de ~2 KB por item e o JWT + refresh token frequentemente
ultrapassa). O `LocalAuthAdapter` usa `SecureStore` porque guarda apenas um id.
**Recomendo manter `AsyncStorage`.**

### `auth.users` ↔ `profiles`

Ligados pelo trigger `on_auth_user_created` (0001), que cria o perfil com
`name` vindo de `raw_user_meta_data.name`, `default_currency = 'BRL'` e
`role = 'user'` (default da coluna). O `ON CONFLICT DO NOTHING` torna a operação
idempotente.

**Consequência importante:** o `signUp` do `AuthProvider` também chama
`profile.upsert(...)` logo depois. Como o trigger já criou a linha, esse upsert
cai no caminho de UPDATE — o que funciona, mas significa que a criação do perfil
acontece em dois lugares. Não é bug, mas convém saber ao depurar.

### Confirmação de e-mail

O `SupabaseAuthAdapter` **já trata** o caso em que o projeto exige confirmação:
quando `signUp` não devolve sessão, lança `AuthError('Conta criada. Confirme o
e-mail enviado para concluir o acesso.', 'not-found')`.

**Decisão necessária:** ativar ou não a confirmação de e-mail no painel do
Supabase. Para uma banca de TCC, desativar simplifica a demonstração; para
produção, deve ficar ativa. Ver seção 46.

### Google/Apple

**Não recomendo nesta fase.** O `AuthAdapter` não tem método OAuth, exigiria
`expo-auth-session`, configuração de client ids por plataforma e, no caso da
Apple, um build nativo — o que quebra a compatibilidade com Expo Go que o
projeto mantém desde o início.

### Proteção de rotas

Já implementada em três camadas:
1. `src/app/index.tsx` — redireciona para onboarding/login/tabs.
2. `src/app/(auth)/_layout.tsx` — bloqueia o stack de auth para quem já entrou.
3. `src/app/admin/_layout.tsx` — `<Redirect>` antes de renderizar, para não-admins.

---

## 11. RLS e permissões

**Já implementada em `0002` e estendida em `0003`.** Tabela por tabela:

| Tabela | RLS | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|---|
| `profiles` | ✅ | dono | dono, e `role='user'` obrigatório | dono, `role` bloqueada por gatilho | dono |
| `trips` | ✅ | dono | dono | dono | dono |
| `itinerary_items` | ✅ | `owns_trip()` | `owns_trip()` | `owns_trip()` | `owns_trip()` |
| `checklist_items` | ✅ | `owns_trip()` | idem | idem | idem |
| `expenses` | ✅ | `owns_trip()` | idem | idem | idem |
| `tickets` | ✅ | `owns_trip()` | idem | idem | idem |
| `journal_entries` | ✅ | `owns_trip()` | idem | idem | idem |
| `journal_media` | ✅ | via entrada → trip | idem | idem | idem |
| `goals` | ✅ | dono | dono | dono | dono |
| `article_likes` | ✅ | dono | dono | dono | dono |
| `place_favorites` | ✅ | dono | dono | dono | dono |
| `consultations` | ✅ | dono | dono | dono | dono |
| `reservation_requests` | ✅ | dono | dono | dono | dono |
| `ai_conversations` | ✅ | dono | dono | dono | dono |
| `ai_messages` | ✅ | via conversa | idem | idem | idem |
| `insurance_policies` | ✅ | dono | dono | dono | dono |
| `offers` | ✅ | autenticado | `is_admin()` | `is_admin()` | `is_admin()` |
| `articles` | ✅ | autenticado ⚠️ **ver P-01** | `is_admin()` | `is_admin()` | `is_admin()` |
| `places` | ✅ | autenticado | `is_admin()` | `is_admin()` | `is_admin()` |
| `advisors` | ✅ | autenticado | `is_admin()` | `is_admin()` | `is_admin()` |

### Helpers em SQL

```sql
public.owns_trip(uuid)  -- security definer, search_path fixo (0002)
public.is_admin()       -- security definer, search_path fixo (0003)
```

Ambos são `SECURITY DEFINER` com `SET search_path = public`, e `is_admin()` tem
`REVOKE ALL FROM public` + `GRANT EXECUTE TO authenticated`.

### Anti-auto-promoção

```sql
create trigger profiles_no_role_escalation before update on public.profiles ...
-- recusa a mudança de role quando auth.uid() não é nulo e o JWT não é service_role
```

Validado nesta auditoria contra PostgreSQL 16 real: a tentativa de `update
profiles set role='admin'` com sessão de usuário devolve
`ERROR: Alteração de role não permitida (42501)`.

### O que **não** fazer

Nenhuma policy `using (true)` para escrita. Nenhuma tabela sem RLS. Nenhum
`GRANT` direto ao papel `anon` em tabela de usuário.

---

## 12. Administradores

### Como identificar
Coluna `profiles.role text CHECK (role in ('user','admin'))`. **Fonte única.**

**Por que coluna e não tabela `admins` própria:** com dois papéis e uma relação
1:1 com o perfil, uma tabela separada acrescentaria um JOIN a cada policy sem
acrescentar nenhuma capacidade. Se um dia houver papéis por escopo (ex.: admin
só de Comunidade), aí sim uma tabela `user_roles` se justifica.

### Como impedir promoção
Três barreiras, em profundidade:
1. **Tipo** — `ProfileDraft = Omit<Profile,'role'>`; nenhuma tela consegue expressar a mudança.
2. **Policy de INSERT** — `with check (user_id = auth.uid() and role = 'user')`.
3. **Gatilho de UPDATE** — recusa mudança de `role` sob sessão de usuário.

Só (3) é segurança de verdade; (1) e (2) são defesa em profundidade.

### Como promover (operação manual, documentada em `0003`)
```sql
update public.profiles set role = 'admin'
 where user_id = (select id from auth.users where email = 'SEU-EMAIL@exemplo.com');
```
Rodado no SQL Editor, onde `auth.uid()` é nulo e o gatilho deixa passar.

### Operações exclusivas do admin
| Operação | Estado |
|---|---|
| CRUD de `articles` | ✅ implementado |
| CRUD de `places` | ✅ implementado |
| CRUD de `offers` | ⏳ policies prontas, UI não |
| CRUD de `advisors` | ⏳ policies prontas, UI não |
| Geração de conteúdo por IA | ✅ Edge Function valida `role` |

---

## 13. Storage

### Buckets já criados em `0002`

| Bucket | Público? | Estrutura | Conteúdo |
|---|---|---|---|
| `avatars` | **privado** | `{uid}/avatar-{ts}-{nome}` | Foto de perfil |
| `attachments` | **privado** | `{uid}/{tripId}/{ts}-{nome}` | Tickets, apólices |
| `journal` | **privado** | `{uid}/{entryId}/{ts}-{nome}` | Fotos do diário |

Política (idêntica nos três):
```sql
using (bucket_id = '<b>' and (storage.foldername(name))[1] = auth.uid()::text)
```
O primeiro segmento do caminho tem de ser o id do próprio usuário. O cliente
nunca recebe URL pública: `signUrl()` gera URL assinada com TTL de 1 hora.

### Bucket que **falta** (defeito P-04)

| Bucket | Público? | Estrutura | Motivo |
|---|---|---|---|
| `content` | **público** | `places/{id}/{ts}.jpg`, `articles/{id}/{ts}.jpg`, `offers/{id}/{ts}.jpg` | Imagens editoriais |

Hoje os formulários administrativos aceitam **URL** de imagem, e o catálogo usa
URLs do Unsplash. Isso funciona, mas significa que o Easy Trip depende de um
host de terceiros para exibir o próprio conteúdo.

Um único bucket com prefixos por tipo, em vez de `place-images` +
`article-images` + `offer-images`: as três têm exatamente a mesma política
(leitura pública, escrita só de admin), e três buckets significariam três
políticas para manter em sincronia.

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('content','content', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy content_read on storage.objects for select to public
  using (bucket_id = 'content');
create policy content_write on storage.objects for all to authenticated
  using (bucket_id = 'content' and public.is_admin())
  with check (bucket_id = 'content' and public.is_admin());
```

### Limites nos buckets existentes (recomendação)
Os três buckets privados foram criados **sem** `file_size_limit` nem
`allowed_mime_types`. Recomendo:

| Bucket | Limite | MIME |
|---|---|---|
| `avatars` | 2 MB | `image/jpeg`, `image/png`, `image/webp` |
| `attachments` | 10 MB | + `application/pdf` |
| `journal` | 10 MB | imagens |

---

## 14. Realtime

**Recomendação: não habilitar Realtime em nenhuma tabela.**

Justificativa: todo dado deste aplicativo é **de um único usuário, editado em um
único aparelho**. Não há viagem compartilhada, checklist colaborativo,
comentários ou qualquer escrita concorrente. O React Query com
`invalidateQueries` após cada mutação já mantém a tela correta, e o
`ConnectivityProvider` invalida tudo ao reconectar.

Habilitar Realtime hoje custaria conexões WebSocket permanentes (bateria, dados
móveis) para resolver um problema que não existe.

**Reavaliar se e quando:** viagens compartilhadas forem implementadas
(`trip_members`), ou se `reservation_requests`/`consultations` passarem a ser
confirmadas por um operador — aí o usuário se beneficiaria de ver o status mudar
sem puxar para atualizar.

---

## 15. Edge Functions

### Já implementadas

| Função | Motivo de existir | Segredo que protege |
|---|---|---|
| `ai-chat` | Gemini não pode ser chamado do cliente | `GEMINI_API_KEY` |
| `admin-generate-content` | Idem + valida `role='admin'` | `GEMINI_API_KEY` |
| `delete-account` | Apagar usuário do Auth exige privilégio | `SUPABASE_SERVICE_ROLE_KEY` |

Todas seguem o mesmo padrão: identidade vem do JWT (`auth.getUser()`), nunca do
corpo; CORS explícito; rate limit em memória; erro honesto quando a chave não
está configurada (503, sem inventar resposta).

### Recomendada (correção do defeito P-02)

| Função | Motivo |
|---|---|
| `delete-account` **corrigida** | A listagem de arquivos não é recursiva e deixa anexos para trás — ver seção 31 |

### Não recomendadas agora
- Processamento de imagem: `expo-image-picker` já redimensiona no cliente.
- Envio de notificação: não há notificações.
- Webhooks: não há integração que os exija.

---

## 16. APIs externas

| API | Uso | Onde é chamada | Chave? | Onde deve ficar |
|---|---|---|---|---|
| **Open-Meteo Forecast** | Clima do destino | `src/services/weather.ts`, direto do app | Não | — |
| **Open-Meteo Geocoding** | Busca de destino (cidade, país, ISO, lat/lon, timezone) | `src/services/geocoding.ts`, direto do app | Não | — |
| **Frankfurter (BCE)** | Câmbio | `src/services/currency.ts`, direto do app | Não | — |
| **Google Gemini** | Easy Trip IA + preenchimento admin | `supabase/functions/*` | **Sim** | `supabase secrets set GEMINI_API_KEY` |
| **WhatsApp** | `https://wa.me/...` | `src/constants/contact.ts` | Não | Constante no cliente (número é público) |
| **Unsplash** | Imagens do catálogo | URLs diretas em `catalog.ts` | Não | Substituir por bucket `content` a prazo |
| **`react-native-maps`** | Mapa | `src/app/utilities/map.tsx` | Não (provider padrão) | — |

**Três das quatro APIs de dados não têm chave nenhuma** — foi uma escolha
deliberada do projeto, e é o que permite que clima e câmbio sejam reais em vez
de simulados sem exigir backend.

---

## 17. IA

### Arquitetura (já implementada)

```
Expo  ──POST + JWT──►  Edge Function          ──►  Gemini 2.5 Flash
                       ├─ auth.getUser()
                       ├─ profiles.role = admin?   (só admin-generate-content)
                       ├─ rate limit
                       ├─ system prompt (server-side, não adulterável)
                       └─ responseSchema (JSON estruturado)
                                │
Expo  ◄──JSON──────────────────┘
       ├─ Zod parse            (rejeita o que não bate com o schema)
       ├─ groundPlaceDraft()   (descarta fato sem procedência no briefing)
       └─ preenche o formulário — admin revisa — admin salva
```

### Regras já codificadas
- **Nunca publica sozinha.** A IA escreve nos campos; `status` continua sendo escolha do admin.
- **Não inventa fato.** Três camadas: prompt, schema sem os campos perigosos (`rating`, `price`, `openingHours`, coordenadas não existem na saída) e verificação de procedência contra o briefing.
- **Não gera imagem de lugar real.** Para artigos devolve `imagePrompt`; para lugares devolve `imageSearchQuery` (termo para achar foto real).
- **Sem IA em Ofertas e Especialistas.** Preço, desconto e dados de pessoas reais não se pedem a um modelo.

### Geração automática de imagem
**Não adotada.** Os modelos de imagem do Gemini não estão no tier gratuito da
API. O fallback (prompt/termo de busca + upload manual) está implementado.

---

## 18. Variáveis de ambiente

### Cliente — podem ir no bundle (`EXPO_PUBLIC_*`)
```env
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
EXPO_PUBLIC_BFF_URL=
```

### Servidor — somente `supabase secrets set`
```
GEMINI_API_KEY               (ai-chat, admin-generate-content)
SUPABASE_SERVICE_ROLE_KEY    (delete-account)
```
`SUPABASE_URL` e `SUPABASE_ANON_KEY` são injetadas automaticamente nas Edge
Functions pelo próprio Supabase.

### Não é variável de ambiente
`EASYTRIP_CONTACT_WHATSAPP` mora em `src/constants/contact.ts`, e
`WHATSAPP_COMMUNITY_URL` em `src/constants/community.ts`. Nenhum dos dois é
segredo nem varia por ambiente. **Ambos estão vazios hoje** e precisam ser
preenchidos.

**Varredura de segredos:** nenhum segredo hardcoded encontrado em `src/`,
`app.json` ou `.env.example`. As únicas ocorrências de `service_role` estão na
Edge Function (correto) e em comentários.

---

## 19. Estrutura de integração no Expo

**Nada a criar. A estrutura já existe e é adequada.**

| Item | Onde já está |
|---|---|
| Pacote | `@supabase/supabase-js@^2.112.3` — já no `package.json` |
| Polyfill de URL | `react-native-url-polyfill/auto` — já importado no client |
| Cliente | `src/repositories/supabase/client.ts`, criado sob demanda |
| Persistência de sessão | `AsyncStorage` + `autoRefreshToken` |
| Camada de repositório | `src/repositories/types.ts` (contratos) + duas implementações |
| Hooks | `src/hooks/*` — nenhuma tela chama o Supabase diretamente |

### Tipos gerados (`supabase gen types`)
**Recomendo gerar, mas não substituir o domínio por eles.** O modelo em
`src/domain/types.ts` é `camelCase`, com campos opcionais e semântica de
produto (`fileUrl` já assinada, não `file_path`). Os tipos gerados são
`snake_case` e refletem o banco.

Uso recomendado: gerar em `src/repositories/supabase/database.types.ts` e usar
**apenas** para tipar o client (`createClient<Database>(...)`), mantendo os
mappers `toTrip`/`toPlace`/etc. como a fronteira entre banco e domínio. Isso
transforma erros de nome de coluna em erro de compilação sem contaminar as telas
com o formato do banco.

---

## 20. React Query / cache

**Já configurado em `src/providers/AppProviders.tsx`:**
```ts
queries:   { staleTime: 30_000, gcTime: 30 * 60_000,
             retry: (n) => n < 2, refetchOnWindowFocus: false }
mutations: { retry: 0 }
```

Chaves centralizadas em `src/hooks/queryKeys.ts`. Toda chave com escopo de
viagem embute o `tripId` — é o que impede o cache de servir os dados de uma
viagem em outra.

Já há optimistic update em `useArticleLikes` e `usePlaceFavorites`
(`onMutate` + `setQueryData` + rollback em `onError`).

### Ajustes recomendados ao ligar o Supabase
| Ajuste | Motivo |
|---|---|
| `staleTime` maior para conteúdo editorial (5–10 min) | `offers`/`articles`/`places`/`advisors` mudam raramente e são lidos em quase toda tela |
| `retry` não deve repetir erro de RLS | Um 403 vai falhar igual na segunda vez; hoje o `retry: n < 2` repetiria |
| `gcTime` mantido | 30 min é adequado |

Não criar segunda arquitetura de estado. O React Query já é a camada de cache.

---

## 21. Offline e sincronização

### Como funciona hoje
| Dado | Comportamento offline |
|---|---|
| Clima, câmbio | Cache com `updatedAt`; a UI mostra "Atualizado há 2h" |
| Fuso horário | **100% offline** — `Intl`, sem rede |
| SOS | **100% offline** — dataset embarcado |
| Tickets/documentos | Arquivo copiado para o diretório do app |
| Tudo o mais | Cache do React Query enquanto vivo |

O `ConnectivityProvider` detecta reconexão e invalida todas as queries.

### O que muda com o Supabase
Escritas passam a exigir rede. Hoje, no `LocalDataSource`, tudo grava sempre.

**Recomendação: não implementar fila de sincronização offline nesta fase.**
Justificativa técnica: uma fila de mutações offline exige resolução de
conflitos, idempotência e reconciliação de ids — semanas de trabalho e uma
classe inteira de bugs difíceis. O uso real do aplicativo (planejar viagem,
lançar despesa) tolera "tente de novo quando tiver sinal".

**O que fazer em vez disso:**
1. `OfflineBanner` já existe e deve aparecer nas telas de escrita.
2. Mutações devem falhar com mensagem clara e **preservar o formulário**.
3. Leituras continuam servindo o cache.

**Exceção que merece atenção:** tickets e apólices são justamente o que o
usuário precisa **no aeroporto, sem sinal**. Com o Supabase, `file_url` passa a
ser URL assinada com TTL de 1 hora — ou seja, **deixa de funcionar offline**.
Ver decisão D-04 na seção 32.

### Estado de interface × dado persistente
| Estado de interface (nunca vai ao banco) | Dado persistente |
|---|---|
| Modal/sheet aberto, aba ativa, foco | Viagem, despesa, item de roteiro |
| Texto de busca, filtro selecionado | Perfil, meta, entrada de diário |
| `loading`, `isPending`, animação | Curtida, favorito, conversa de IA |
| Resposta da IA antes de salvar | Artigo/local salvo pelo admin |

---

## 22. Tipos TypeScript

| Tipo | Arquivo | Tabela | Divergência |
|---|---|---|---|
| `Profile` | `domain/types.ts` | `profiles` | `avatarUrl` no domínio é URL assinada; no banco é `avatar_path`. Intencional, tratado no mapper |
| `Trip` | idem | `trips` | Nenhuma |
| `ItineraryItem` | idem | `itinerary_items` | Nenhuma |
| `ChecklistItem` | idem | `checklist_items` | Nenhuma |
| `Expense` | idem | `expenses` | Nenhuma |
| `Ticket` | idem | `tickets` | `fileUrl` ↔ `file_path`, intencional |
| `JournalEntry` / `JournalMedia` | idem | `journal_entries` / `journal_media` | idem |
| `Goal` | idem | `goals` | Nenhuma |
| `Offer` | idem | `offers` | **Falta `status`, `sortOrder`, timestamps** para o CRUD futuro |
| `Article` | idem | `articles` | Nenhuma |
| `Place` | idem | `places` | **Falta `active`, `featured`** |
| `Advisor` | idem | `advisors` | **Falta `active`** |
| `Consultation` | idem | `consultations` | ⚠️ `scheduledAt: ISODateTime` mas a coluna é `text` — ver P-03 |
| `ReservationRequest` | idem | `reservation_requests` | ⚠️ `requestedFor: ISODateTime` mas o formulário aceita texto livre ("20/09 às 20h") — ver P-03 |
| `AIConversation` / `AIMessage` | idem | `ai_conversations` / `ai_messages` | Nenhuma |
| `InsurancePolicy` | idem | `insurance_policies` | Nenhuma |

**Como evitar duplicação:** manter `src/domain/types.ts` como a única verdade do
domínio e usar os tipos gerados apenas para tipar o client. Os mappers já
existem e são o lugar certo para a tradução.

---

## 23. CRUD por entidade

| Entidade | Criar | Ler | Editar | Excluir |
|---|---|---|---|---|
| Profile | `register` (trigger) | `profile/index`, Header | `profile/index` | via exclusão de conta |
| Trip | `trips/new` | Home, `(tabs)/trips`, Trip Hub | `trip/[id]/edit` | `trip/[id]/edit` |
| ItineraryItem | `trip/[id]/itinerary` | idem, Home, Mapa | idem (+ toggle concluído) | idem |
| ChecklistItem | `trip/[id]/checklist` | idem, Home, Alertas | idem | idem |
| Expense | `trip/[id]/finance` | idem, Home, Alertas | idem | idem |
| Ticket | `trip/[id]/tickets` | idem, Alertas | idem | idem |
| JournalEntry | `trip/[id]/journal` | idem | idem | idem |
| JournalMedia | `trip/[id]/journal` | idem | — | idem |
| Goal | `(tabs)/goals` | `(tabs)/goals`, `profile/index` | `(tabs)/goals` (aporte) | `(tabs)/goals` |
| ArticleLike | `community/*` | `community/*` | — | `community/*` (descurtir) |
| PlaceFavorite | `places/*` | `places/*` | — | `places/*` |
| Consultation | `(tabs)/advisor` | `(tabs)/advisor` | — | `(tabs)/advisor` (cancelar) |
| ReservationRequest | `places/[id]` | `places/[id]` | — | — |
| AIConversation/Message | `(tabs)/advisor` | `(tabs)/advisor` | — | `(tabs)/advisor` (limpar) |
| InsurancePolicy | `utilities/sos` | `utilities/sos` | — | `utilities/sos` |
| **Article** (admin) | `admin/community/new` | `admin/community` | `admin/community/[id]` | `admin/community/[id]` |
| **Place** (admin) | `admin/places/new` | `admin/places` | `admin/places/[id]` | `admin/places/[id]` |
| **Offer** (admin) | ⏳ não construído | — | — | — |
| **Advisor** (admin) | ⏳ não construído | — | — | — |

---

## 24. Cascade e exclusão de dados

### Já definido no schema

| Evento | Efeito |
|---|---|
| **Usuário excluído** | CASCADE em: `profiles`, `trips` (e toda a árvore), `goals`, `expenses`, `tickets`, `journal_entries`, `article_likes`, `place_favorites`, `consultations`, `reservation_requests`, `ai_conversations`, `insurance_policies` |
| **Viagem excluída** | CASCADE em `itinerary_items`, `checklist_items`, `expenses`, `tickets`, `journal_entries` → `journal_media`. **SET NULL** em `goals.trip_id`, `reservation_requests.trip_id`, `insurance_policies.trip_id` |
| **Entrada de diário excluída** | CASCADE em `journal_media` (+ remoção explícita dos arquivos no Storage) |
| **Artigo excluído** | CASCADE em `article_likes` |
| **Lugar excluído** | CASCADE em `place_favorites` e `reservation_requests` |
| **Especialista excluído** | CASCADE em `consultations` |

### Onde usar soft delete
| Entidade | Recomendação |
|---|---|
| `places`, `offers`, `advisors` | **`active boolean`**, não delete físico. Um lugar com favoritos e solicitações de reserva não deve sumir do histórico de ninguém |
| `articles` | Já tem `status`. `draft` **é** o soft delete |
| Dados do usuário | **Delete físico.** LGPD: "exclua meus dados" tem de significar exclusão |

### Arquivos no Storage
**Não cascateiam com as linhas.** Precisam de remoção explícita:
- `journal_media` — já implementado (`storage.remove()` antes do delete).
- `tickets` / `insurance_policies` — ⚠️ **não removem o arquivo** ao excluir a linha. Ver P-07.
- Exclusão de conta — ⚠️ **remoção incompleta**. Ver P-02.

---

## 25. Performance e índices

### Já existem
```
trips_user_idx             (user_id, start_date desc)
itinerary_trip_idx         (trip_id, date, start_time, sort_order)
checklist_trip_idx         (trip_id)
expenses_trip_idx          (trip_id, transaction_date desc)
tickets_trip_idx           (trip_id)
journal_trip_idx           (trip_id, entry_date desc)
journal_media_entry_idx    (journal_entry_id, sort_order)
goals_user_idx             (user_id)
places_city_idx            (city, type)
ai_messages_conversation_idx (conversation_id, created_at)
```
Cobrem exatamente as consultas que os repositórios fazem. As PKs compostas de
`article_likes` e `place_favorites` já servem de índice para `user_id`.

### Recomendados ao ligar o Supabase
| Índice | Consulta que atende |
|---|---|
| `articles (status, published_at desc)` | Lista pública da Comunidade |
| `places (active, type)` | Diretório filtrado — depois de `0004` |
| `offers (status, sort_order)` | Em Alta ordenada — depois de `0004` |
| `reservation_requests (user_id, created_at desc)` | Histórico de solicitações |
| `consultations (user_id, scheduled_at)` | Agenda do usuário |

**Um índice importante que falta:** as policies chamam `public.is_admin()`, que
faz `select 1 from profiles where user_id = auth.uid() and role = 'admin'`. Como
`user_id` é PK, o acesso já é por índice. Nenhum índice adicional necessário.

---

## 26. Migrations

### Estrutura recomendada
```
supabase/
├── config.toml          ⚠️ NÃO EXISTE — criar com `supabase init`
├── migrations/
│   ├── 0001_schema.sql        ✅
│   ├── 0002_rls.sql           ✅
│   ├── 0003_admin_roles.sql   ✅
│   ├── 0004_content_publishing.sql   (a criar)
│   └── 0005_rls_fixes.sql            (a criar)
├── functions/
│   ├── ai-chat/                ✅
│   ├── admin-generate-content/ ✅
│   └── delete-account/         ✅
└── seed.sql             ✅ gerado por `npm run seed:generate`
```

### Fluxo
| Ambiente | Comando |
|---|---|
| Local | `supabase start` → `supabase db reset` (aplica migrations + seed) |
| Nova alteração | `supabase migration new <nome>` → editar → `supabase db reset` |
| Produção | `supabase link --project-ref <ref>` → `supabase db push` |
| Functions | `supabase functions deploy <nome>` |

### Rollback
O Supabase CLI **não faz rollback automático**. A prática do projeto deve ser:
toda migration é aditiva e idempotente (`if not exists`, `drop policy if
exists`), como as três atuais já são. Desfazer é escrever uma migration nova.

### Git
`supabase/` inteiro versionado. `.env` **nunca** — já está no `.gitignore`.

---

## 27. Seed

`supabase/seed.sql` já existe: **186 linhas geradas** de `src/data/catalog.ts`
por `npm run seed:generate`, com ids UUID determinísticos e `on conflict do
nothing` — reexecutável sem duplicar.

| Conteúdo | Quantidade | Produção ou desenvolvimento? |
|---|---|---|
| `offers` | 6 | ❌ **Somente demonstração** (F10). Preço, desconto e vigência são compromisso comercial: entram pelo painel, digitados por quem os assume |
| `articles` | 6 | ✅ **Produção**, com assinatura institucional em vez dos nomes de autor inventados (F10) |
| `places` | 12 | ✅ **Produção**, sem `phone` e sem `rating` (F10): telefone não verificado vira botão "Ligar", e nota sem fonte é alegação que o produto não sustenta |
| `advisors` | 5 | ❌ **Somente demonstração** (D-05, fechada na F10). Não entram em `seed.production.sql` |

**Não existe seed de usuário fictício, e não deve existir.** Contas de teste
criam-se pelo cadastro do próprio aplicativo.

### Dois arquivos de seed, e a diferença entre eles (F10)

| Arquivo | Conteúdo | Vai para o remoto? |
|---|---|---|
| `supabase/seed.sql` | catálogo inteiro: 6 ofertas, 6 artigos, 12 lugares, 5 especialistas | **NÃO** — é demonstração |
| `supabase/seed.production.sql` | 6 artigos (assinatura institucional) + 12 lugares (sem `phone`, sem `rating`) | Sim, manualmente |

Os dois saem do mesmo `npm run seed:generate`, do mesmo catálogo — não há
duplicação de conteúdo, só um filtro declarado em um lugar. O que o filtro tira,
e por quê, está no cabeçalho do próprio arquivo gerado e na seção 32 (D-05).

`supabase db push` **não** executa seed nenhum: ele aplica migrations. O banco
recém-migrado está vazio de conteúdo, e é assim que deve ser — ver
`GO_LIVE_SUPABASE.md`.

### As imagens são uma segunda etapa, separada de propósito (F9)

`seed.sql` é SQL puro e continua assim: `supabase db reset` **não pode depender
de rede**, senão deixa de ser reproduzível — e um `curl` para o Unsplash dentro
de uma migration seria a pior versão disso. As imagens editoriais, que não cabem
em SQL, saem por uma etapa explícita:

```bash
npm run seed:generate                  # DB seed — sem rede
npx supabase db reset                  # migrations + seed.sql
node scripts/seed-content-assets.mjs   # content asset seed — envia as imagens
```

O script lê `assets/content/{articles|offers|places|advisors}/{slug}.{jpg|png|webp}`,
envia para `content/{kind}/{uuid}/catalogo.{ext}` — o mesmo padrão de caminho do
painel — e aponta a coluna para a URL pública. Ele **falha listando o que falta**
quando um arquivo não está no repositório, e recusa qualquer host que não seja
`127.0.0.1`/`localhost`. Enquanto as fotografias não existirem em
`assets/content/`, o seed continua apontando para o Unsplash: é a pendência de
asset registrada no P-04, e não algo que o script deva resolver baixando.

---

## 28. Desenvolvimento × produção

**Recomendação: dois projetos Supabase separados.**

| Ambiente | Projeto | Uso |
|---|---|---|
| Desenvolvimento | `supabase start` (Docker local) ou um projeto free "easy-trip-dev" | `db reset` destrutivo à vontade |
| Produção / apresentação | Projeto "easy-trip" | Nunca receber `db reset` |

O `.env` local aponta para dev; o build de apresentação aponta para produção.
Como toda a configuração passa por `EXPO_PUBLIC_*`, trocar de ambiente é trocar
o `.env` — nenhuma alteração de código.

**O risco concreto a evitar:** rodar `supabase db reset` apontando para o
projeto da apresentação na véspera da banca. Um projeto separado torna isso
impossível em vez de improvável.

---

## 29. Timestamps e fuso horário

O projeto já tem uma estratégia consistente, e ela está certa:

| Natureza | Tipo | Exemplo |
|---|---|---|
| Instante absoluto | `timestamptz` (UTC) | `created_at`, `ai_messages.created_at` |
| Data civil sem hora | `date` | `trips.start_date`, `expenses.transaction_date`, `journal_entries.entry_date` |
| Hora local do destino | `time` | `itinerary_items.start_time` |
| Texto livre do usuário | `text` | `reservation_requests.requested_for` |

**A decisão-chave já tomada:** `start_date` é `date`, não `timestamptz`. Uma
viagem que começa em 20/08 começa em 20/08 independentemente do fuso de quem
olha. Se fosse `timestamptz`, um usuário em Tóquio veria 21/08.

Do mesmo modo, `itinerary_items.start_time` é `time` sem fuso: "voo às 14:30" é
14:30 **no destino**. O fuso do destino está em `trips.timezone` e a conversão,
quando necessária, é feita por `src/services/timezone.ts` com `Intl`.

**Nenhuma mudança recomendada.**

---

## 30. Dados que NÃO devem ir ao Supabase

| Item | Onde vive | Por quê |
|---|---|---|
| `themeMode` (claro/escuro/sistema) | `prefsStorage` | Preferência do **aparelho**, não da conta. Sincronizar forçaria o tablet a seguir o celular |
| `currentTripId` | `prefsStorage` | Seleção de interface. O dado real está em `trips` |
| `onboardingSeen` | `prefsStorage` | Estado do aparelho |
| Cache de clima e câmbio | `cacheStorage` | Já vem de API externa; persistir criaria segunda verdade |
| Contatos de emergência (SOS) | Dataset embarcado | **Tem de funcionar sem rede** |
| Rótulos de enum, tokens de tema | Código | i18n e design |
| Status da viagem, dias restantes, total gasto, % do orçamento, progresso do checklist | `domain/selectors.ts` | **Derivados.** Persistir é criar oportunidade de dessincronizar |
| Alertas (`useAlerts`) | Derivado em memória | Calculado das despesas, roteiro, checklist e tickets reais |
| Estado de UI: modal aberto, aba ativa, busca, filtro, `loading`, animação, foco | `useState` | Não sobrevive nem à rotação de tela, e não deve |
| Briefing digitado para a IA, resposta bruta do modelo | `useState` do formulário | Existe só durante a sessão de edição |
| Contadores de curtida/favorito | Calculáveis por `count()` | Ver seção 43 |

---

## 31. Problemas encontrados no projeto atual

| # | Arquivo | Problema | Risco | Correção recomendada |
|---|---|---|---|---|
| **P-01** | `0002_rls.sql` | `articles_read` usa `using (true)`. Qualquer usuário autenticado lê **rascunhos** pela API REST. O filtro `status='published'` só existe no cliente | **Médio** — vazamento de conteúdo não publicado | `using (status = 'published' or public.is_admin())` |
| **P-02** | `functions/delete-account/index.ts` | `storage.list(userId)` **não é recursivo**. Os arquivos estão em `{uid}/{tripId}/arquivo` e `{uid}/{entryId}/arquivo`; a listagem devolve os *prefixos*, e `remove(['uid/trip'])` não apaga nada. **Anexos e fotos do diário sobrevivem à exclusão da conta** | **Alto** — LGPD; dados pessoais permanecem após "excluir tudo" | Listar recursivamente (listar prefixos e depois cada um) antes de remover |
| ~~**P-03**~~ ✅ corrigido na F7 | `domain/types.ts` | `ReservationRequest.requestedFor` e `Consultation.scheduledAt` são tipados `ISODateTime`, mas o formulário grava texto livre e a coluna é `text` | **Baixo** — tipo mentiroso; quebra quem tentar `new Date(...)` | Renomear o tipo para `string` com comentário, ou passar a gravar ISO de verdade |
| **P-04** ⚠️ fluxo fechado na F9; migração do conteúdo legado pendente de asset | `data/catalog.ts` + formulários admin | Imagens editoriais são **URLs do Unsplash**; não há bucket para conteúdo | **Médio** — o produto depende de host de terceiros; admin não consegue subir foto | Criar bucket `content` (seção 13) e trocar o campo URL por upload — feito: bucket na `0007`, upload e remoção de URL na F9. As 29 URLs do `seed.sql` só saem quando as fotos entrarem em `assets/content/` (`scripts/seed-content-assets.mjs`) |
| ~~**P-05**~~ ✅ corrigido na F6 | `local/LocalDataSource.ts` | `OFFERS` e `ADVISORS` ainda são constantes; `ARTICLES` e `PLACES` já são coleções persistidas | **Baixo** — inconsistência; o CRUD de Ofertas não terá onde gravar em modo local | Converter as duas para `LocalCollection` semeada, como já foi feito nas outras |
| ~~**P-06**~~ ✅ corrigido na F4 | `providers/AuthProvider.tsx` | `signOut()` limpa `cacheStorage` e o React Query, mas **não** `prefsStorage.currentTripId` | **Baixo** — o id da viagem da conta anterior sobrevive ao logout. Com RLS a viagem não carrega, mas é estado entre contas | Remover `currentTripId` no `signOut`, como `deleteAccount` já faz |
| ~~**P-07**~~ ✅ corrigido na F8 (reproduzido só em `insurance_policies`) | `SupabaseDataSource.ts` | Excluir um `ticket` ou uma `insurance_policy` apaga a linha mas **não** o arquivo no Storage (o diário já faz certo) | **Médio** — arquivos órfãos acumulam e continuam acessíveis por URL assinada até expirar | Remover do Storage antes do delete, como `journal_media` faz |
| ~~**P-08**~~ ✅ corrigido na F7 | `SupabaseDataSource.ts` | `getArticle` monta filtro PostgREST por interpolação: `.or(\`id.eq.${id},slug.eq.${id}\`)` | **Baixo** — o parâmetro vem da rota; um valor com vírgula/parêntese altera o filtro. RLS ainda protege | Consultar por `slug` e por `id` separadamente, ou escapar |
| ~~**P-09**~~ ✅ corrigido (`0006` avatars na F5, `0007` attachments/journal na F7) | `0002_rls.sql` | Buckets criados sem `file_size_limit` nem `allowed_mime_types` | **Médio** — usuário pode subir arquivo de qualquer tamanho/tipo | Definir limites (seção 13) |

---

## 32. Decisões que precisam ser tomadas antes da implementação

| # | Decisão | Impacto se adiada |
|---|---|---|
| **D-01** | Confirmação de e-mail ativa ou não? | Muda o fluxo de cadastro. O código já trata os dois casos |
| **D-02** | Um projeto Supabase ou dois (dev/prod)? | Define se `db reset` é seguro |
| ~~**D-03**~~ ✅ fechada na F9 | ~~Imagens editoriais: bucket `content` ou continuar com URL externa?~~ | ✅ **DECIDIDO em 21/08/2026: o bucket `content` é o mecanismo principal.** O administrador seleciona e envia a imagem; o campo de URL saiu do formulário; usuário comum apenas consome |
| ~~**D-04**~~ ✅ implementada na F8 | ~~Tickets/documentos precisam abrir **offline**?~~ | ✅ **DECIDIDO em 20/08/2026: SIM, é requisito.** Ver "Decisão arquitetural D-04" abaixo |
| ~~**D-05**~~ ✅ fechada na F10 | ~~Os 4 `advisors` do seed são pessoas fictícias. Vão para produção?~~ | ✅ **DECIDIDO em 21/08/2026: NÃO vão.** Ficam só no seed de demonstração (`seed.sql`) e no modo local. `seed.production.sql` não os inclui: em produção o diretório nasce vazio e é preenchido pelo painel, com pessoas reais. Rotular como "demonstrativo" foi descartado — um selo não impede alguém de agendar uma consulta com quem não existe |
| **D-06** | Ofertas e Especialistas terão CRUD administrativo? | Define se `0004` é necessária |
| **D-07** | `articles.summary` deve existir? | Envolve schema **e** UI |
| **D-08** | Colaboração em viagem (`trip_members`) está no escopo do TCC? | Mudança estrutural grande; hoje não existe nada disso |

---

## 33. Funcionalidades/necessidades que não haviam sido consideradas

Somente itens com justificativa técnica neste projeto:

| Necessidade | Por quê | Prioridade |
|---|---|---|
| **Limpeza de arquivos órfãos no Storage** | P-02 e P-07. Sem isso, "excluir" não exclui | **Alta** |
| **Limites de tamanho/MIME nos buckets** | P-09. Um upload de 500 MB hoje é aceito | **Alta** |
| **Paginação em `places` e `articles`** | Ambos carregam a tabela inteira. Com 14 e 6 registros é irrelevante; com 500 lugares, não | Média |
| **`updated_at` automático** | Várias tabelas têm a coluna, mas quem a atualiza é o cliente. Um trigger `moddatetime` garantiria a verdade | Média |
| **Rate limit durável nas Edge Functions** | O limite atual é `Map` em memória; Edge Functions são efêmeras, então o limite se perde entre instâncias. Com cota gratuita do Gemini, isso importa | Média |
| **Auditoria de ações administrativas** | Quem publicou/despublicou o quê e quando. Uma tabela `admin_audit_log` (append-only) é barata e é o tipo de coisa que uma banca pergunta | Média |
| **`articles.author_user_id`** | Hoje o autor é texto livre. Vincular ao admin que escreveu dá rastreabilidade | Baixa |
| **Índice de busca textual** | A busca de lugares é `ilike %termo%` — não usa índice. `pg_trgm` resolveria se o diretório crescer | Baixa |
| **Backup** | O plano gratuito do Supabase **não faz backup automático**. Para o TCC, `supabase db dump` antes da apresentação | **Alta (operacional)** |

### Sobre PostGIS
**Não recomendo.** As coordenadas são usadas para (a) centralizar o mapa e (b)
montar o link do app de mapas. Não há consulta por proximidade em lugar nenhum
do código. `double precision` + `places_city_idx` bastam. Se um dia houver
"restaurantes a 1 km de mim", aí PostGIS se justifica.

---

## 34. Ordem exata recomendada de implementação

Ver seção seguinte.

---

# PLANO DE IMPLEMENTAÇÃO POR FASES

Cada fase é pequena, verificável e reversível. Nenhuma depende de trabalho
futuro para funcionar.

---

### F0 — Baseline e backup
**Objetivo:** poder voltar atrás.
**Arquivos:** nenhum. **Banco:** nenhum.
**Ações:** commit do estado atual; `npm test`, `npx tsc --noEmit`, `npm run lint`
e bundle registrados como linha de base.
**Risco:** nenhum.
**Concluída quando:** 236 testes passando registrados no commit.

---

### F1 — Projeto Supabase e CLI
**Objetivo:** existir um projeto e o CLI apontar para ele.
**Arquivos:** `supabase/config.toml` (novo), `.env` (não versionado).
**Banco:** projeto criado, vazio.
**Ações:** criar projeto; `supabase init`; `supabase link --project-ref <ref>`;
preencher `EXPO_PUBLIC_SUPABASE_URL` e `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
**Dependências:** D-01, D-02.
**Risco:** baixo.
**Testes:** `config.hasSupabase === true`; Configurações passa a mostrar
"Supabase (nuvem, com RLS)".
**Concluída quando:** o app abre em modo produção e a tela de Configurações confirma.

---

### F2 — Schema
**Objetivo:** as 20 tabelas no banco real.
**Arquivos:** nenhum novo. **Banco:** `0001`, `0002`, `0003`.
**Ações:** `supabase db push`.
**Risco:** baixo — as três já foram validadas contra PostgreSQL 16 nesta auditoria.
**Testes:** conferir 20 tabelas, `owns_trip()`, `is_admin()`, gatilhos e as policies.
**Concluída quando:** `supabase db push` sem erro e as tabelas listadas no dashboard.

---

### F3 — Correções de segurança e modelo
> ✅ **Executada** — ver "F3 — o que foi feito" no topo deste documento. P-01 saiu
> daqui (foi para a F2), `0005_rls_fixes.sql` deixou de ser necessária, e as
> colunas de `places` não foram criadas. O que segue é o plano original.

**Objetivo:** fechar P-01 e preparar Ofertas/Especialistas.
**Arquivos:** `0004_content_publishing.sql`, `0005_rls_fixes.sql`, `domain/types.ts`.
**Banco:** colunas novas + policy de `articles` corrigida.
**Dependências:** F2, D-06.
**Risco:** baixo (aditivo).
**Testes:** **teste obrigatório** — conta `user` tenta ler artigo com
`status='draft'` pela API e recebe 0 linhas.
**Concluída quando:** o teste acima passa e `tsc` continua limpo.

---

### F4 — Autenticação de ponta a ponta
**Objetivo:** cadastro/login/logout reais.
**Arquivos:** nenhum — já implementado.
**Banco:** `auth.users`, `profiles` (trigger).
**Dependências:** F2.
**Risco:** médio — é o primeiro contato real com o backend.
**Testes:** cadastrar; conferir a linha em `profiles` com `role='user'`; fechar e
reabrir o app (sessão restaurada); logout; recuperação de senha.
**Concluída quando:** o ciclo completo funciona no aparelho.

---

### F5 — Perfil e avatar
**Objetivo:** editar perfil e subir foto.
**Arquivos:** nenhum. **Banco:** `profiles`, bucket `avatars`.
**Dependências:** F4.
**Risco:** baixo.
**Testes:** salvar perfil; subir avatar; conferir que o objeto está em
`avatars/{uid}/`; **tentar ler o avatar de outro uid e receber negativa**.
**Concluída quando:** o avatar aparece após reabrir o app (URL assinada renovada).

---

### F6 — Viagens
**Objetivo:** CRUD de viagem contra o Postgres.
**Arquivos:** nenhum. **Banco:** `trips`.
**Dependências:** F4.
**Risco:** médio — é a raiz de toda a árvore.
**Testes:** criar (com geocoding), editar, excluir; **com duas contas, confirmar
que uma não enxerga a viagem da outra** (o teste `tests/integration/trip-isolation.test.ts` já cobre a regra no domínio).
**Concluída quando:** o isolamento entre contas está confirmado no banco real.

---

### F7 — Módulos da viagem (roteiro, checklist, despesas)
**Objetivo:** os três módulos sem arquivo.
**Arquivos:** nenhum. **Banco:** `itinerary_items`, `checklist_items`, `expenses`.
**Dependências:** F6.
**Risco:** baixo — RLS via `owns_trip()`, já validada.
**Testes:** CRUD de cada um; despesa em moeda estrangeira gravando
`exchange_rate` e `exchange_rate_timestamp`.
**Concluída quando:** a Carteira soma corretamente após reabrir o app.

---

### F8 — Arquivos: tickets, diário, apólices
**Objetivo:** upload real no Storage **mantendo o acesso offline (D-04)**.
**Arquivos:** correção de P-07 no `SupabaseDataSource`.
**Banco:** `tickets`, `journal_entries`, `journal_media`, `insurance_policies`;
buckets `attachments` e `journal`.
**Dependências:** F7. D-04 já decidida.
**Risco:** **alto** — é a área com mais defeitos conhecidos (P-02, P-07, P-09) **e**
a única fase que muda um comportamento hoje correto (o arquivo local funciona
sem rede; a URL assinada, não).
**Requisito obrigatório (D-04):** o Supabase Storage passa a ser a *origem
oficial* do arquivo, **não a única forma de acesso**. Ao anexar ou ao abrir pela
primeira vez, o arquivo deve ser gravado no diretório do app (a infraestrutura
já existe: `src/lib/files.ts`, `persistFile`), e a leitura deve preferir a cópia
local, caindo para a URL assinada só quando não houver cópia.
**Testes:** subir PDF e foto; reabrir e conferir que a URL assinada é renovada;
**modo avião: abrir um ticket já baixado — tem de funcionar**; excluir e conferir
que o objeto sumiu do Storage **e** a cópia local também; tentar acessar arquivo
de outro usuário.
**Concluída quando:** um ticket anexado abre em modo avião **e** não sobra
arquivo órfão (remoto ou local) após excluir cada tipo de registro.

---

### F9 — Conteúdo editorial + seed
**Objetivo:** Ofertas, Comunidade, Lugares e Especialistas vindos do banco.
**Arquivos:** correção de P-05, P-08. **Banco:** seed aplicado.
**Dependências:** F3.
**Risco:** baixo.
**Testes:** as quatro áreas carregam do Supabase; curtir artigo e favoritar
lugar persistem entre sessões.
**Concluída quando:** `catalog.ts` deixa de ser a fonte em modo produção.

---

### F10 — Administrador
**Objetivo:** promover a conta e usar o painel contra o banco real.
**Arquivos:** nenhum. **Banco:** `profiles.role`.
**Dependências:** F9.
**Risco:** médio.
**Testes:** promover pelo SQL Editor; **fluxo completo**: login admin → painel →
criar artigo como rascunho → confirmar que **não** aparece na Comunidade →
publicar → confirmar que aparece → editar → despublicar → confirmar que sumiu.
E o negativo: conta comum não vê a entrada, não acessa `/admin`, e **um `INSERT`
direto em `articles` pela API é recusado pela RLS**.
**Concluída quando:** os dois fluxos, positivo e negativo, estão confirmados.

---

### F11 — Edge Functions e IA
**Objetivo:** Easy Trip IA e "Preencher com IA" reais.
**Arquivos:** nenhum. **Banco:** `ai_conversations`, `ai_messages`.
**Ações:** `supabase secrets set GEMINI_API_KEY=...`;
`supabase functions deploy ai-chat admin-generate-content delete-account`;
preencher `EXPO_PUBLIC_BFF_URL`.
**Dependências:** F10.
**Risco:** médio — depende de cota externa.
**Testes:** chat com contexto da viagem; preenchimento de artigo e de local;
**teste do §65** (briefing vago não pode produzir endereço/telefone inventado);
**e o teste de autorização: conta comum chamando `admin-generate-content`
diretamente recebe 403**.
**Concluída quando:** o 403 está confirmado com um JWT de usuário comum.

---

### F12 — Bucket de conteúdo e upload editorial
> ✅ **Absorvida:** a infraestrutura saiu na F7 (`0007`) e o fluxo administrativo
> na F9. Registrado aqui como estava planejado.

**Objetivo:** admin sobe foto em vez de colar URL.
**Arquivos:** formulários de `admin/places` e `admin/community`.
**Banco:** bucket `content`.
**Dependências:** F10, D-03.
**Risco:** médio.
**Testes:** subir imagem; conferir leitura pública; **confirmar que conta comum
não consegue escrever no bucket**.
**Concluída quando:** uma imagem subida pelo painel aparece na tela pública.

---

### F13 — Exclusão de conta (LGPD)
**Objetivo:** "excluir tudo" excluir mesmo.
**Arquivos:** `functions/delete-account/index.ts` (correção de P-02).
**Banco:** CASCADE + Storage.
**Dependências:** F8, F11.
**Risco:** **alto** — operação destrutiva e irreversível.
**Testes:** conta com viagem, ticket, foto de diário e avatar; excluir;
**conferir no dashboard que não sobrou nenhuma linha e nenhum objeto**.
**Concluída quando:** a verificação manual no dashboard não encontra resíduo.

---

### F14 — Erros, offline e resiliência
**Objetivo:** o app não quebrar quando o backend falha.
**Arquivos:** correção de P-06; ajuste de `retry` para não repetir 403.
**Dependências:** F13.
**Risco:** baixo.
**Testes:** modo avião em cada tela de escrita; sessão expirada; RLS negando;
upload falhando. **O formulário nunca pode ser limpo por um erro.**
**Concluída quando:** nenhuma das quatro situações produz tela branca ou crash.

---

### F15 — Performance
**Objetivo:** índices e paginação.
**Arquivos:** hooks de listagem. **Banco:** `0006_indexes.sql`.
**Dependências:** F14.
**Risco:** baixo.
**Testes:** `explain analyze` nas consultas de lista.
**Concluída quando:** nenhuma consulta de tela faz varredura sequencial.

---

### F16 — Revisão de segurança
**Objetivo:** confirmar que nada ficou aberto.
**Ações:** revisar as 20 tabelas com RLS ativa e sem policy permissiva;
`supabase db dump`; varredura de segredos no bundle.
**Dependências:** F15.
**Risco:** nenhum (só leitura).
**Concluída quando:** existe um relatório com as 20 tabelas conferidas uma a uma.

---

### F17 — Produção e apresentação
**Objetivo:** ambiente estável para a banca.
**Ações:** apontar `.env` para o projeto de produção; `db push`; seed;
promover a conta de apresentação; `supabase db dump` de segurança;
ensaiar o roteiro completo.
**Risco:** baixo se F0–F16 estiverem fechadas.
**Concluída quando:** o roteiro de demonstração roda de ponta a ponta sem
intervenção.

---

# INFORMAÇÕES QUE PRECISO DO RESPONSÁVEL PELO PROJETO

| # | Pergunta | Por que é necessária |
|---|---|---|
| 1 | **Confirmação de e-mail** deve ficar ativa no Supabase Auth? | Muda o fluxo de cadastro: sem confirmação o usuário entra direto; com ela, o `signUp` não devolve sessão e o app mostra "confirme o e-mail". O código trata os dois, mas o teste de aceitação é diferente |
| 2 | Vai existir **um projeto Supabase ou dois** (dev + produção)? | Define se `supabase db reset` pode ser usado à vontade. Com um só, um reset apaga o ambiente da apresentação |
| 3 | As imagens de hotéis/restaurantes/artigos devem ser **enviadas pelo painel** ou continuam sendo URLs externas? | Determina se o bucket `content` entra agora (F12) ou não. Hoje o catálogo depende do Unsplash |
| 5 | Os **5 especialistas do seed são fictícios**. Vão para a apresentação? Se sim, posso rotulá-los como demonstrativos? | O produto tem regra explícita de não apresentar dado inventado como real |
| 6 | **Ofertas e Especialistas** terão cadastro administrativo? | Define se a migration `0004` é necessária e se há mais dois blocos de UI |
| 7 | Qual o **número de WhatsApp comercial** e o **link do grupo da comunidade**? | Duas constantes estão vazias; sem elas os dois botões não aparecem |
| 8 | **Colaboração em viagem** (convidar alguém) está no escopo do TCC? | Não existe nada disso hoje. Se estiver, é modelagem nova (`trip_members`), RLS nova e telas novas — é a única mudança realmente estrutural desta lista |
| 9 | Deve existir **registro de auditoria** das ações administrativas? | É barato de implementar e é o tipo de pergunta que uma banca costuma fazer |
| 10 | Existe **política de retenção** para documentos e diário? | LGPD. Se houver, é preciso um job de expiração; se não, os dados ficam até o usuário excluir |
| 11 | O aplicativo será **publicado em loja** ou só demonstrado no Expo Go? | Publicar exige `eas build`, o que muda como as variáveis de ambiente são injetadas |

---

# DADOS DO SUPABASE QUE SERÃO NECESSÁRIOS

### ✅ Pode ser utilizado no aplicativo Expo

| Item | Onde | O que é |
|---|---|---|
| **Project URL** | `EXPO_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co`. Endereço público do projeto |
| **anon / publishable key** | `EXPO_PUBLIC_SUPABASE_ANON_KEY` | JWT público, **projetado para ser distribuído**. Não concede nada por si: toda autorização é feita pela RLS a partir do usuário autenticado. Um APK descompilado revela essa chave — e isso é esperado |
| **Functions URL** | `EXPO_PUBLIC_BFF_URL` | `https://<ref>.functions.supabase.co` |

### 🔒 Deve existir somente no backend / Edge Functions

| Item | Onde | Por quê |
|---|---|---|
| **`GEMINI_API_KEY`** | `supabase secrets set` | Chave cobrada por uso. No bundle, qualquer um a extrai e gasta a cota |
| **`SUPABASE_SERVICE_ROLE_KEY`** | `supabase secrets set` | **Ignora toda a RLS.** No aplicativo, equivale a dar acesso irrestrito ao banco inteiro para qualquer pessoa com o APK |

`SUPABASE_URL` e `SUPABASE_ANON_KEY` são injetadas automaticamente nas Edge
Functions — não precisam ser definidas.

### ⛔ Nunca compartilhar nem colocar no código

| Item | Por quê |
|---|---|
| **Database password** | Acesso direto ao Postgres, sem RLS e sem log de aplicação |
| **JWT Secret** | Permite **forjar tokens**: assinar um JWT com qualquer `sub` e virar qualquer usuário, inclusive admin |
| **Access token do CLI** | Controla o projeto: apagar, migrar, ler segredos |
| **Chaves de terceiros** | Gemini e qualquer outra que venha depois |

### A diferença que mais importa

**anon key** e **service_role key** são os dois JWTs do projeto e parecem
idênticos — ambos começam com `eyJ`. A diferença está na claim `role`:

- `anon` → todas as consultas passam pela RLS. É por isso que pode ir no bundle.
- `service_role` → **a RLS é ignorada por completo**. É por isso que só pode
  existir no servidor.

Colar a chave errada no `.env` é o erro mais comum e mais grave desta
integração, e ele **não dá erro nenhum** — o aplicativo funciona perfeitamente,
com todo o banco exposto. Ao copiar do dashboard, confirmar que o rótulo é
`anon public`.

---

## Verificação desta auditoria

| Item | Resultado |
|---|---|
| Arquivos lidos | 130 em `src/`, `supabase/`, `tests/`, mais configuração |
| Linhas analisadas | 23.679 em `src/` |
| Migrations validadas | 3, aplicadas com sucesso a PostgreSQL 16 real (bloco anterior) |
| Segredos hardcoded encontrados | **Nenhum** |
| Defeitos identificados | 9 (P-01 a P-09), 1 de risco alto |
| Decisões pendentes | 8 (D-01 a D-08) |
| Perguntas ao responsável | 11 |
| Arquivos do aplicativo alterados | **Nenhum** — conforme §48 |
