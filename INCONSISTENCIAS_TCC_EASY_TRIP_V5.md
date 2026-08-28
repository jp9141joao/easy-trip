# INCONSISTÊNCIAS E PENDÊNCIAS — TCC EASY TRIP V5

Registro do saneamento final. Cada item da rodada anterior foi reauditado contra o código, o banco e o ambiente publicado, e classificado como **resolvido** ou **pendência real**. Nada foi removido sem verificação, e nenhuma limitação legítima foi ocultada para reduzir a lista.

Data: 2026-08-28 · versão funcional avaliada `c8121ba` · correção do arcabouço de teste `93463a8` · atualização documental `abaa9d9` · HEAD ao final da rodada `abaa9d9`, idêntico a `origin/main` · árvore de trabalho limpa no início da rodada, limpa após esses dois *commits*, e **modificada no momento em que este relatório é escrito** pelo ajuste final de consistência (INC-14), ainda não versionado.

Repositório: https://github.com/jp9141joao/easy-trip (público, ramo `main`).

---

# RESOLVIDAS

## PEND-01 — Versão avaliada não versionada

**Tipo:** RESOLVIDO NESTA RODADA (era PENDENCIA_OPERACIONAL).

**Problema:** a rodada de melhorias existia apenas como alteração local sobre o `c5af399` (20 arquivos modificados, 16 não rastreados). Os números do artigo não eram recuperáveis por terceiros a partir do histórico.

**Como foi resolvido:** as alterações foram versionadas no *commit* `c8121ba` ("Add trip cover, global alerts, daily spending goals and travel context improvements") e publicadas no remoto. **Não houve *commit* nesta rodada** — a versionagem já estava feita quando a reauditoria começou.

**Evidência:**
- `git rev-parse HEAD` → `c8121ba5c5f9a3b10453944442c7d98e6d64b77d`
- `git rev-parse origin/main` → idêntico ao HEAD
- `git status` → `nothing to commit, working tree clean`
- `GET api.github.com/repos/jp9141joao/easy-trip/commits/c8121ba…` → 200, *commit* presente no repositório público

**Escopo do que foi resolvido:** o **software avaliado está versionado** em `c8121ba`. Essa constatação não foi reaberta: o que se acrescenta abaixo, em INC-14, é apenas a distinção entre o *commit* do produto e o *commit* posterior do arcabouço de teste — questão de reprodutibilidade documental, não pendência funcional do produto.

**Impacto no TCC:** a seção 3.7 passou a nomear `c8121ba` como versão avaliada e a declarar árvore limpa e *commit* publicado. A limitação 2 de 4.6 ("versão avaliada não versionada") foi **removida** e as demais renumeradas (12 → 11 limitações). A fragilidade correspondente saiu do parágrafo de validade interna, e a frente "versionar a rodada" saiu dos trabalhos futuros (cinco → quatro frentes).

---

## INC-02 — As 151 asserções SQL do artigo anterior

**Tipo:** DOCUMENTAL_CORRIGIDO.

**Problema:** o TCC v4 declarava 151 asserções, número que não corresponde nem à contagem estática nem à execução.

**Como foi resolvido:** o v5 adota **159, por execução**, único número verificável. O 151 não aparece no TCC — apenas neste relatório e no de atualizações, como explicação histórica.

**Evidência:** execução das quatro suítes contra PostgreSQL 17.11 descartável: 28 + 8 + 92 + 31 = **159 confirmações, 0 falhas**, todas com `exit=0`. A contagem estática dos auxiliares `pg_temp.check`/`pg_temp.deny` dá 146; a diferença para 159 vem de asserções em laço e de o auxiliar `deny` emitir mais de uma confirmação por chamada. `grep -n "151" tcc_easy_trip_v5.md` → sem ocorrências.

**Impacto no TCC:** nenhum ajuste necessário nesta rodada. Nenhuma alteração de código foi feita para "fazer a contagem virar 151".

---

## INC-03 — Divergência entre o auxiliar de teste local e a função de identidade real

**Tipo:** BUG_TESTE → **RESOLVIDO NESTA RODADA**. É a única alteração de código desta rodada, versionada no *commit* `93463a8` ("Fix local Supabase auth test bootstrap"), que altera exclusivamente `supabase/tests/_local_bootstrap.sql` — uma linha.

**Problema:** `supabase/tests/_local_bootstrap.sql` reimplementava `auth.uid()` convertendo o token **antes** de tratar valor vazio:

```sql
select nullif(current_setting('request.jwt.claims', true)::json ->> 'sub', '')::uuid;
```

Quando `rls_collaboration.test.sql` retornava ao papel administrativo via `set local request.jwt.claims = ''`, a conversão levantava `invalid input syntax for type json` e interrompia a suíte. Era a razão de as suítes SQL nunca terem sido executadas até o fim a partir do repositório.

**Como foi resolvido:** inversão da ordem das duas operações, tratando o vazio antes da conversão — a mesma forma que `auth.jwt()`, na linha seguinte do próprio arquivo, já usava:

```sql
select nullif(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub', '')::uuid;
```

**Evidência (causal, medida nos dois sentidos):**

| Cenário | Definição antiga | Definição corrigida |
|---|---|---|
| GUC ausente | NULL | NULL |
| `claims = ''` | **ERRO `invalid input syntax for type json`** | NULL |
| `claims` com `sub` real | UUID correto | UUID correto |
| `claims` com `sub` vazio | — | NULL |
| `rls_collaboration.test.sql` completo | **`exit=3`, para em 78 asserções** | **`exit=0`, 92 asserções** |

Regressão completa depois da correção, cada suíte em banco novo (bootstrap → *migrations* 0001–0012 → suíte), executada **diretamente dos arquivos do repositório**, sem substituição manual de função:

| Suíte | Saída | Asserções | Falhas |
|---|---|---|---|
| `rls_content.test.sql` | 0 | 28 | 0 |
| `rls_articles.test.sql` | 0 | 8 | 0 |
| `rls_collaboration.test.sql` | 0 | 92 | 0 |
| `legacy_upgrade.test.sql` | 0 | 31 | 0 |
| **Total** | — | **159** | **0** |

**Impacto no TCC:** a seção 4.3 deixou de declarar que "a função foi substituída apenas na instância descartável" e passa a registrar o defeito, a correção e o fato de que **o repositório sozinho executa as quatro suítes**. A Tabela 2 diz agora "4 arquivos do repositório contra instância provisionada". O parágrafo de validade interna manteve — corretamente — a ressalva de que a instância local é uma reconstrução do ambiente gerenciado, usando este próprio episódio como prova de que tal reconstrução pode divergir sem aviso.

**Nota histórica:** o defeito nunca alcançou o produto. Nenhuma *migration*, política ou função do esquema foi tocada, e o ambiente publicado usa a definição própria da plataforma.

---

## INC-04 — Contagens de banco

**Tipo:** DOCUMENTAL_CORRIGIDO.

**Problema:** o v4 contava instruções no texto das migrações (27 políticas, 11 gatilhos, 25 índices, 26 restrições), instrumento que não alcança políticas criadas em laço `foreach` nem índices criados por constraint.

**Como foi resolvido:** o v5 usa o catálogo do PostgreSQL como fonte de verdade. Revalidado nesta rodada, com os mesmos valores.

**Evidência:** consulta a `pg_tables`, `pg_policies`, `pg_trigger`, `pg_indexes`, `pg_constraint` e `storage.buckets` em instância com 0001–0012 aplicadas:

| Métrica | Medido | v5 |
|---|---:|---|
| Tabelas (esquema público) | 25 | ✓ |
| Tabelas com RLS habilitada | 25 | ✓ |
| Políticas (62 público + 7 storage) | 69 | ✓ |
| Gatilhos | 15 | ✓ |
| Índices | 58 | ✓ |
| Restrições de verificação | 43 | ✓ |
| Funções do projeto | 26 | ✓ |
| Buckets | 4 | ✓ |

**Impacto no TCC:** nenhum. Nenhum código foi criado ou alterado para mover esses números.

---

## INC-05 — Três tabelas de protocolo, ou duas?

**Tipo:** DOCUMENTAL_CORRIGIDO.

**Problema:** o v4 afirmava que participantes, convites e notificações não possuíam política de escrita alguma. É falso para `notifications`.

**Como foi resolvido:** o v5 enuncia a propriedade verdadeira e mais precisa — nenhum cliente **cria** notificação, mas o destinatário pode marcá-la como lida ou removê-la. Revalidado nesta rodada.

**Evidência:** tabelas sem qualquer política de escrita: `trip_members` e `trip_invites` — **duas**. `notifications` tem `notifications_select` (SELECT), `notifications_update` (UPDATE) e `notifications_delete` (DELETE), e **nenhuma política de INSERT**.

**Impacto no TCC:** nenhum ajuste nesta rodada; seções 3.6 e 4.4 já corretas. Nenhuma política válida foi removida para fazer o código coincidir com o texto antigo.

---

## INC-06 — "As 26 funções SQL têm caminho de busca fixo"

**Tipo:** DOCUMENTAL_CORRIGIDO.

**Problema:** a frase do v4 é literalmente falsa.

**Como foi resolvido:** o v5 enuncia a propriedade de segurança que de fato importa — o vetor de sequestro por resolução de esquema se aplica a funções `security definer`, e essas estão integralmente protegidas.

**Evidência:** contagem restrita às funções do projeto (excluídas as da extensão `pgcrypto`, que o bootstrap instala em `public`):

- funções do projeto: **26**
- `security definer`: **23** — **23 com `search_path` fixo**, nenhuma sem
- `security invoker`: 3 (`prevent_role_escalation`, `set_updated_at` com `search_path=public`; `touch_updated_at` sem)
- total com `search_path` fixo: **25 de 26**

**Impacto no TCC:** nenhum. Nenhuma função `security invoker` foi alterada para restaurar a frase antiga.

---

## INC-07 — URL do repositório

**Tipo:** DOCUMENTAL_CORRIGIDO — **e a correção do v5 estava errada, em sentido oposto ao registrado antes.**

**Problema:** o v4 usava `.../easy-trip`; o v5 "corrigiu" para `.../easy-trip-3.0` com base no `git remote -v`. A reauditoria mostra que o remoto configurado está **desatualizado**: `easy-trip-3.0` é um nome antigo que o GitHub resolve por redirecionamento permanente.

**Como foi resolvido:** o nome canônico foi determinado pela API do GitHub e o TCC voltou a `.../easy-trip` — desta vez por evidência, e não por herança do documento antigo.

**Evidência:**
- `GET api.github.com/repos/jp9141joao/easy-trip-3.0` → **HTTP 301** (redirecionamento)
- seguindo o redirecionamento → `full_name: jp9141joao/easy-trip`
- `GET api.github.com/repos/jp9141joao/easy-trip` → **HTTP 200**, `private: false`, `default_branch: main`
- o *commit* `c8121ba` é recuperável nesse repositório (HTTP 200)

Como a API responde sem autenticação e informa `private: false`, o termo "público" é sustentável e foi usado.

**Impacto no TCC:** a seção 3.7 passou a `easy-trip` / `https://github.com/jp9141joao/easy-trip`, com a palavra "público" agora respaldada.

**Observação operacional (não é inconsistência do artigo):** o `git remote -v` local ainda aponta para o nome antigo. Funciona por redirecionamento e não afeta nenhum resultado; atualizá-lo é higiene, não correção.

---

## INC-08 — "Chave anônima" no pacote do aplicativo

**Tipo:** DOCUMENTAL_CORRIGIDO.

**Problema:** o v4 chamava de "chave anônima" (JWT `anon` legado) uma credencial que não é isso.

**Como foi resolvido:** o v5 usa "chave publicável". Revalidado nesta rodada por inspeção de **formato**, sem imprimir valor.

**Evidência:** `EXPO_PUBLIC_SUPABASE_ANON_KEY` tem prefixo `sb_publishable_` e 46 caracteres — não é um JWT (que começaria por `eyJ`). Confirmação independente em produção: com essa chave, `trips.budget_total` responde `42501 — permission denied for table trips`, isto é, nenhum privilégio sobre tabela sem sessão válida.

**Impacto no TCC:** nenhum ajuste nesta rodada; seções 3.3 e 3.6 já corretas. Nenhum valor de chave foi registrado em log, arquivo ou relatório.

---

# PENDÊNCIAS REAIS

## PEND-09 — *Migration* 0013 não publicada

**Tipo:** PENDENCIA_PUBLICACAO · DECISAO_AUTOR.

**Estado atual:** IMPLEMENTADO · VALIDADO LOCALMENTE · **NÃO PUBLICADO**. Auditada nesta rodada nos dois caminhos, sem erro:

- **instalação limpa** — 0001 a 0013 em banco novo: 13 de 13 aplicam;
- **atualização** — 0013 sobre 0001–0012 já aplicadas: aplica, e o bloco de verificação interna da própria migração aprova.

Objetos resultantes conferidos: `trips.cover_image_path` (text) e `trips.daily_spending_goal` (numeric) criadas, `trips.cover_image_url` preservada; restrição `trips_daily_spending_goal_positive`; bucket `trip-covers` com `public = false`; quatro políticas de Storage — `trip_covers_member_read` (SELECT, por participação na viagem) e `trip_covers_owner_write` / `_owner_modify` / `_owner_delete` (INSERT/UPDATE/DELETE, pelo proprietário). Totais com a 0013: 5 buckets e 73 políticas, contra 4 e 69 sem ela.

**Por que permanece:** publicar depende de autorização do autor, que não foi dada. **A migração não foi aplicada ao ambiente remoto nesta rodada.**

**Impacto:** quatro requisitos funcionais e dois não funcionais estão implementados e rastreáveis, mas não operam em produção. Confirmado nesta rodada: `cover_image_path` e `daily_spending_goal` retornam `42703 — column does not exist`, o mesmo código devolvido para uma coluna-controle inexistente.

**Ação futura:** decidir sobre a publicação. Enquanto não publicada, a Tabela 1 e o Quadro 7 mantêm a coluna de pendência de publicação, e a limitação 2 de 4.6 permanece.

---

## PEND-10 — `delete-account` não publicada

**Tipo:** PENDENCIA_PUBLICACAO deliberada, ligada a BUG_PRODUTO conhecido.

**Estado atual:** função implementada, aprovada na verificação de tipos, com teste de ponta a ponta escrito. **NÃO PUBLICADA** — confirmado nesta rodada: HTTP 404 `{"code":"NOT_FOUND"}`, idêntico ao de uma função-controle inexistente, enquanto `ai-chat`, `trip-suggestions`, `trip-daily-briefing` e `admin-generate-content` respondem com as suas próprias checagens de autorização.

**Por que permanece:** a pendência é deliberada e correta. A exclusão da conta do proprietário removeria em cascata a viagem inteira, incluindo registros dos demais participantes, e **não existe transferência de propriedade**. Publicar antes de resolver isso tornaria o problema alcançável pelo usuário. Nada foi publicado nem tentado nesta rodada.

**Impacto:** um requisito funcional não operante; é a pendência mais séria do ponto de vista do titular dos dados. Registrada como limitações 3 e 7 de 4.6.

**Ação futura:** implementar a transferência de propriedade da viagem e só então publicar a função — nesta ordem.

---

## PEND-11 — Resumo diário publicado, sem agendamento

**Tipo:** PENDENCIA_OPERACIONAL. **Não é inconsistência documental.**

**Estado atual:** `trip-daily-briefing` está **publicada** e responde HTTP 403 da própria checagem de segredo. Nenhum agendamento configurado: `grep -rn "cron" supabase/migrations/` não encontra nenhuma chamada `cron.schedule` — as únicas ocorrências são comentários explicativos em 0010, e as instruções de agendamento constam apenas em comentário no cabeçalho de `supabase/functions/trip-daily-briefing/index.ts`.

**Por que permanece:** função publicada não é o mesmo que recurso operante. Ela existe e não é disparada sozinha.

**Impacto:** o resumo diário só ocorre por chamada manual autenticada por segredo. Registrado como limitação 5 de 4.6.

**Ação futura:** configurar o agendamento periódico e o segredo correspondente.

---

## PEND-12 — Suíte de ponta a ponta não executada

**Tipo:** PENDENCIA_OPERACIONAL. Motivo agora mais preciso do que na rodada anterior.

**Estado atual:** **292 blocos** de verificação em nove arquivos — contagem estática reconfirmada nesta rodada, arquivo a arquivo (auth 33, content_admin 62, delete_account 13, functions_http 17, lifecycle 41, offer_window 10, profile_avatar 34, rls_matrix 23, storage 59). **Não executados.**

**Por que permanece:** três obstáculos, nenhum deles contornável com segurança nesta rodada.

1. As suítes **recusam por construção** qualquer endereço que não seja local (`Recusado: … não é local. Este teste cria e apaga dados.`), de modo que não podem ser dirigidas ao ambiente publicado — e não deveriam.
2. A pilha local não está completa: `supabase_edge_runtime` está **parado**, o que inviabiliza as suítes de Edge Function (`functions_http_e2e`, `delete_account_e2e`) por ausência de infraestrutura, não por defeito do produto.
3. As suítes gravam dados na **base de desenvolvimento do autor**, sem garantia verificada de limpeza. Executá-las parcialmente produziria falhas de infraestrutura misturadas a resultados de produto — pior que a não execução honesta.

Chaves locais são obtíveis via `npx supabase status -o env`; a credencial **não** é o obstáculo restante, ao contrário do que a rodada anterior registrou.

**Impacto:** os 292 são **contagem estática de blocos escritos, jamais resultado de aprovação**, e em nenhum ponto do TCC são apresentados como tal. Registrado como limitação 4 de 4.6.

**Ação futura:** provisionar um ambiente de teste dedicado e descartável, com a pilha completa ativa, e executar a suíte fora da base de desenvolvimento.

---

## PEND-13 — Limitações legítimas que permanecem por natureza

**Tipo:** LIMITACAO_LEGITIMA. Nenhuma delas é defeito; todas estão declaradas no TCC e nenhuma foi suavizada nesta rodada.

| Item | Estado | Onde consta |
|---|---|---|
| Ausência de avaliação com usuários | Nenhum estudo com participantes. O teste manual em Android é do próprio desenvolvedor. | Limitação 1 |
| Sem avaliação da qualidade do conteúdo da IA | Exigiria instrumento e avaliadores. Métrica descartada em 3.8. | Limitação 9 |
| Sem verificação formal de segurança | Sem teste de intrusão nem avaliação formal de conformidade ao OWASP MASVS. | Limitação 8 |
| Ausência de CI/CD e de medição de desempenho | Nada impede que alteração futura quebre o estado verificado. | Limitação 6 |
| Sem fila de escrita fora de rede | Decisão registrada em comentário no código. | Limitação 10 |
| Avisos apenas dentro do aplicativo | Sem notificação do sistema operacional. | Limitação 11 |

---

## NÃO VERIFICADO — fora do alcance desta rodada

| Item | Situação |
|---|---|
| Avisos do Expo Router | `npx expo-doctor` aprovou **18 de 18** nesta rodada e a suíte não registra aviso de rota. **Não há evidência de que persistam**, e por isso não figuram como limitação. Não se afirma que o problema tenha sido definitivamente eliminado: nenhum teste específico para ele foi conduzido. |
| Open-Meteo em rede móvel | **NÃO VERIFICADO.** Nenhuma evidência atual de falha e nenhum teste novo. Não reintroduzido como limitação comprovada nem declarado resolvido. |
| Backups / PITR do projeto Supabase | Configuração de painel, não inspecionável pelas credenciais disponíveis. Não citado no TCC. |
| Teste manual em Android | Evidência única: a mensagem do *commit* `c5af399`. Registrado como **teste funcional manual do desenvolvedor**, jamais como teste com usuários. |
| Usuários reais do aplicativo | Nenhuma evidência. O TCC **não** afirma que existem. |

---

## INC-14 — Correção do arcabouço de teste posterior ao *commit* funcional

**Tipo:** DOCUMENTAL / REPRODUTIBILIDADE DO TESTE → **RESOLVIDO**. **Não é pendência funcional do produto.**

**Problema:** o TCC declarava `c8121ba` como versão avaliada e afirmava que *todos* os números da seção 4 seriam recuperáveis por terceiros "bastando posicionar-se nesse *commit*". A afirmação era forte demais: a correção de `auth.uid()` descrita em INC-03, sem a qual `rls_collaboration.test.sql` para em 78 asserções, **não está contida em `c8121ba`**. Quem se posicionasse apenas em `c8121ba` reproduziria a camada de aplicação, mas não as 159 asserções SQL.

**Evidência:**
- `git show --stat c8121ba` → não inclui `supabase/tests/_local_bootstrap.sql`
- `git show --stat 93463a8` → `supabase/tests/_local_bootstrap.sql | 2 +-` (1 inserção, 1 remoção), arquivo único
- `git log --oneline` → `abaa9d9` (documentação) ← `93463a8` (suporte de teste) ← `c8121ba` (produto)
- `git rev-parse 93463a8` → `93463a8de8d64d0fa6205510345e66ef43639e71`

**Como foi resolvido:** a versão funcional avaliada **permanece `c8121ba`** — não foi movida para o HEAD documental, o que criaria um ciclo em que cada edição do texto invalidaria a referência declarada pelo próprio texto. O que mudou foi a redação: 3.7 passa a distinguir **versão do produto** de **ajuste do arcabouço de testes**, nomeando `93463a8` e afirmando explicitamente que a correção não altera código funcional, *migrations*, políticas de acesso nem o comportamento do ambiente publicado; e 4.3 passa a nomear o mesmo *commit* ao registrar a correção. A combinação dos dois pontos do histórico reproduz integralmente a avaliação.

**Estado do arquivo:** `supabase/tests/_local_bootstrap.sql` está **commitado** em `93463a8`, com a correção de `auth.uid()` verificada e não reaberta nesta passagem. Marcado como **RESOLVIDO**.

---

## Resumo das ações pendentes

| # | Ação | Tipo | Urgência |
|---|---|---|---|
| 1 | Decidir sobre publicar a *migration* 0013 (PEND-09) | Publicação · decisão do autor | Média |
| 2 | Transferência de propriedade **antes** de publicar `delete-account` (PEND-10) | Produto · publicação | Média |
| 3 | Provisionar ambiente dedicado e executar a suíte de ponta a ponta (PEND-12) | Operacional | Média |
| 4 | Configurar o agendamento do resumo diário (PEND-11) | Operacional | Baixa |
| 5 | Atualizar o `git remote` para o nome canônico do repositório (INC-07) | Higiene | Baixa |

Nesta rodada foi executada **uma única alteração de código**: a correção de `auth.uid()` em `supabase/tests/_local_bootstrap.sql` (INC-03), versionada em `93463a8`; a atualização dos três documentos foi versionada em `abaa9d9`. Nenhuma migração foi aplicada ao ambiente remoto, nenhuma Edge Function foi publicada e nenhum agendamento foi criado. Nenhum arquivo de produto — `src/`, `supabase/functions/`, `supabase/migrations/`, `package.json`, `app.json` — difere entre `c8121ba` e o HEAD atual.
