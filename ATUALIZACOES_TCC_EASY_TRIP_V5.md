# ATUALIZAÇÕES — TCC EASY TRIP V5

Relatório das alterações aplicadas ao `tcc_easy_trip_v5.md`, consolidado após a **rodada final de saneamento** de 28 de agosto de 2026.

---

## 1. Versão analisada

| Item | Valor |
|---|---|
| Repositório | `easy-trip` — https://github.com/jp9141joao/easy-trip (público) |
| Branch | `main` |
| HEAD | `c8121ba5c5f9a3b10453944442c7d98e6d64b77d` (`c8121ba`) |
| `origin/main` | `c8121ba…` — idêntico ao HEAD, sem divergência |
| Working tree | **LIMPA** no início da rodada (`nothing to commit, working tree clean`) |
| `git diff --check` | limpo (sem erros de espaço em branco) |
| Data da análise | 2026-08-28 |
| Versão efetivamente avaliada | **`c8121ba`** — recuperável por terceiros no repositório público |

O *commit* `c8121ba` ("Add trip cover, global alerts, daily spending goals and travel context improvements") incorpora a rodada de melhorias avaliada: capa da viagem, meta de gasto diário, idioma do destino, avisos globais, reposicionamento das Sugestões, registro central de metadados de país, conversor de moedas contextual, `supabase/migrations/0013_trip_cover_and_daily_goal.sql` e oito arquivos de teste.

> **Reprodutibilidade — resolvida.** A recomendação de *checkpoint* da rodada anterior deixou de existir: a versão medida está versionada e publicada, e o *commit* foi confirmado presente no repositório remoto. A limitação "versão avaliada não versionada" foi removida do TCC.

**Nota sobre o nome do repositório.** O `git remote -v` local ainda aponta para `easy-trip-3.0`, que o GitHub resolve por redirecionamento permanente (HTTP 301) para o nome canônico `easy-trip`. O TCC usa o nome canônico. Corrigir o remoto é higiene local, sem efeito sobre resultado algum.

---

## 2. Mudança de posicionamento

O título foi mantido: **EASY TRIP: DESENVOLVIMENTO E AVALIAÇÃO DE UM PLANEJADOR INTELIGENTE DE VIAGENS COM INTELIGÊNCIA ARTIFICIAL**. Nenhuma expressão de "conformidade" ou "auditoria" foi reintroduzida.

---

## 3. Números antigos × números atuais

Todas as contagens de banco são **medidas contra uma instância PostgreSQL 17.11 real**, com as *migrations* aplicadas, por consulta aos catálogos do sistema. Essa mudança de instrumento explica a maior parte das divergências em relação ao v4: parte das políticas é criada dinamicamente em laço `foreach`, e parte dos índices nasce de constraint — nenhuma das duas é alcançada por contagem de instruções no texto.

### 3.1 Verificações executadas

| Métrica | v4 | v5 (saneado) | Classificação |
|---|---|---|---|
| Conjuntos de teste (Jest) | 110 | **119** | CRÍTICA |
| Casos de teste (Jest) | 1.337 | **1.542** | CRÍTICA |
| Falhas | 0 | **0** | — |
| Tempo da suíte | 73,781 s | **37,941 s** | RECOMENDADA |
| `tsc --noEmit` (app) | 0 erros | **0 erros** | — |
| `tsc -p supabase/functions` | 0 erros | **0 erros** | — |
| `eslint .` | 0 erros, 8 avisos | **0 erros, 8 avisos** (todos em `tests/`) | — |
| `expo-doctor` | 18/18 | **18/18** | — |
| `any` em `src/` | 0 | **0** | — |
| `TODO`/`FIXME` em `src/` | 0 | **0** | — |

### 3.2 Banco de dados (medido, não estimado)

| Métrica | v4 (estático) | v5 (medido) | Classificação |
|---|---|---|---|
| Tabelas no esquema público | 25 | **25** | — |
| Tabelas com RLS habilitada | "todas" | **25 de 25** | RECOMENDADA |
| Políticas nomeadas | 27 | **69** (62 público + 7 storage) | CRÍTICA |
| Funções SQL do projeto | 26 | **26** | — |
| Funções `security definer` | não informado | **23**, todas com `search_path` fixo | IMPORTANTE |
| Gatilhos | 11 | **15** | CRÍTICA |
| Índices | 25 | **58** (30 explícitos + 28 de constraint) | CRÍTICA |
| Restrições de verificação | 26 | **43** | CRÍTICA |
| Buckets de armazenamento | 4 | **4** publicados (5 com a 0013) | IMPORTANTE |
| *Migrations* | 12 | **13** (12 publicadas + 1 pendente) | CRÍTICA |

### 3.3 Inventário do aplicativo

| Métrica | v4 | v5 | Classificação |
|---|---|---|---|
| Arquivos de rota | 47 | **47** | — |
| Módulos de domínio | 19 | **20** (+`tripCover.ts`) | IMPORTANTE |
| *Hooks* | não informado | **18** | RECOMENDADA |
| Contratos de repositório | 18 | **19** (+capa em `TripRepository`) | IMPORTANTE |
| Serviços | não informado | **13** | RECOMENDADA |
| Edge Functions | 5 implementadas | **5 implementadas, 4 publicadas** | IMPORTANTE |

### 3.4 Suítes de banco e de ponta a ponta

| Métrica | v4 | v5 (saneado) | Classificação |
|---|---|---|---|
| Asserções SQL | 151, **não executadas** | **159, EXECUTADAS DO REPOSITÓRIO, 0 falhas** | CRÍTICA |
| — conteúdo editorial | — | 28 | — |
| — publicação de artigos | — | 8 | — |
| — colaboração e visibilidade | — | 92 | — |
| — atualização de banco legado | — | 31 | — |
| Blocos de ponta a ponta | 292, não executados | **292, não executados** | — |

O valor 151 do v4 não é reproduzível: os quatro arquivos `.test.sql` estão inalterados desde o `9f33e2b`, a contagem estática dos seus auxiliares dá 146, e a execução emite 159 confirmações. Ver INC-02. **Nesta rodada as suítes passaram a rodar diretamente do repositório**, sem substituição manual de função na instância — ver INC-03.

### 3.5 Requisitos

| Métrica | v4 | v5 | Classificação |
|---|---|---|---|
| Requisitos funcionais | 56 | **64** (56 + 8 novos) | CRÍTICA |
| RF rastreáveis a código e estrutura | 55 (98,2%) | **64 (100%)** | IMPORTANTE |
| RF operantes sobre esquema publicado | — | **59 (92,2%)** | IMPORTANTE |
| RF pendentes de publicação | 1 | **5** (4 pela 0013 + 1 Edge Function) | CRÍTICA |
| Requisitos não funcionais | 55 | **61** (55 + 6 novos) | CRÍTICA |
| RNF com evidência forte | 49 | **53** | CRÍTICA |
| RNF fortes pendentes de publicação | — | **2** | IMPORTANTE |
| Lacunas de RNF | 6 | **6** | — |
| Limitações declaradas em 4.6 | 8 | **11** | CRÍTICA |

Somas reconferidas nesta rodada: 59 + 4 + 1 + 0 = 64 ✓ · 12+10+8+8+6+5+5+4+3 = 61 ✓ · 11+7+8+7+6+4+4+3+3 = 53 ✓ · 53 + 2 + 6 = 61 ✓

---

## 4. Estado remoto (reverificado nesta rodada)

| Componente | Estado | Como foi verificado |
|---|---|---|
| Backend Supabase | **PUBLICADO e operante** | REST respondeu a todas as sondas |
| *Migrations* 0001–0012 | **APLICADAS** | Colunas e tabelas de cada migração presentes |
| *Migration* 0013 | **NÃO APLICADA** | `cover_image_path` e `daily_spending_goal` → `42703 — column does not exist`, mesmo código de uma coluna-controle inexistente |
| Privilégios do papel anônimo | **REVOGADOS** | `trips.budget_total` → `42501 — permission denied for table trips` |
| `ai-chat` | **PUBLICADA** | HTTP 401 da própria checagem de sessão |
| `trip-suggestions` | **PUBLICADA** | HTTP 401, idem |
| `trip-daily-briefing` | **PUBLICADA** | HTTP 403 da própria checagem de segredo |
| `admin-generate-content` | **PUBLICADA** | HTTP 401, idem |
| `delete-account` | **NÃO PUBLICADA** | HTTP 404 `NOT_FOUND`, idêntico ao de uma função-controle inexistente |
| Agendamento do resumo diário | **NÃO CONFIGURADO** | Nenhum `cron.schedule` em migração alguma; instruções só em comentário |

**Afirmação do v4 que ficou falsa:** *"as cinco funções serverless não estavam publicadas"* e *"não há ambiente de produção"*. Quatro das cinco estão publicadas e há backend em produção.

---

## 5. Funcionalidades novas documentadas

Os estados abaixo foram **reclassificados nesta rodada**. "PUBLICADO" descreve artefato efetivamente implantado no ambiente remoto — Edge Function publicada ou *migration* aplicada. Uma funcionalidade de cliente não é "publicada" apenas porque o backend de que ela depende existe: para essas, o estado correto é *validado localmente* e/ou *compatível com o esquema publicado*.

| Funcionalidade | Onde entrou no TCC | Estado |
|---|---|---|
| Capa personalizada da viagem (galeria, prévia, confirmação, cancelamento, restauração do padrão) | 3.2, 3.6, 4.1 | IMPLEMENTADO · VALIDADO LOCALMENTE · **DEPENDE DA 0013, NÃO PUBLICADA** |
| Bucket privado `trip-covers` com prefixo por viagem e URL assinada | 3.6, 4.2 | idem |
| Meta de gasto diário (valor usado, disponível, excesso) | 3.2, 3.4, 4.1 | idem |
| Aviso derivado de meta ultrapassada | 3.4 | idem |
| Idioma do destino, exibido só quando difere do idioma do aparelho | 3.2, 3.3, 4.1 | IMPLEMENTADO · VALIDADO LOCALMENTE · COMPATÍVEL COM O ESQUEMA PUBLICADO |
| Registro central de metadados de país (país → idiomas, país → moeda) | 3.3, 4.2 | idem |
| Conversor de moedas contextual (base = moeda do orçamento; oculto quando as moedas coincidem) | 3.2, 4.2 | idem |
| Avisos globais entre todas as viagens acessíveis, com identificação da origem | 3.2, 4.1 | idem |
| Sugestões reposicionadas para dentro da Jornada | 3.2, 4.1 | idem — **reposicionada, não removida** |
| Reservas: sete tipos nomeados | 3.2 | IMPLEMENTADO · COMPATÍVEL COM O ESQUEMA PUBLICADO |
| Papéis owner/editor/viewer explicitados | 3.2, 3.6 | idem |
| Cadeia de cinco modelos Gemini com fallback | 3.3, 3.5, 4.2 | IMPLEMENTADO · **PUBLICADO** (reside em `ai-chat`, publicada) |
| Resolução de data para pedidos de roteiro de dia inteiro | 3.5 | IMPLEMENTADO · **PUBLICADO** · VALIDADO MANUALMENTE NO ANDROID |

**Sobre a validação em Android.** A única evidência disponível é a mensagem do *commit* `c5af399` ("Fix AI itinerary action flow, ai-chat v13, validated on Android"), que cobre o **fluxo de ações de roteiro do assistente** e nada além disso. Por isso o marcador aparece em uma única linha da tabela. É teste funcional manual do próprio desenvolvedor, jamais avaliação com usuários.

---

## 6. Seções modificadas nesta rodada de saneamento

| Seção | Alteração |
|---|---|
| 3.7 | Versão avaliada passa a ser o *commit* `c8121ba`, com árvore limpa e *commit* publicado; URL do repositório corrigida para o nome canônico `easy-trip`, agora com "público" respaldado por evidência |
| 4.3 | Tempo da suíte 37,974 s → 37,941 s (medição desta rodada); Tabela 2 passa a dizer "4 arquivos **do repositório**"; a ressalva de substituição manual da função foi **substituída** pelo registro do defeito encontrado, da correção aplicada e do fato de o repositório executar as suítes sozinho |
| 4.6 | Limitação "versão avaliada não versionada" **removida**; demais renumeradas (12 → 11); referências cruzadas entre limitações corrigidas; limitação de ponta a ponta reescrita com o motivo real |
| 4.6 (validade interna) | Deixa de apontar a versão não versionada; mantém a ressalva sobre a fidelidade da instância local, usando o episódio do `auth.uid()` como prova |
| 5 (conclusão) | Trabalhos futuros: cinco → **quatro** frentes; "versionar a rodada" removida; a frente de ponta a ponta passa a incluir o provisionamento de ambiente dedicado |
| Resumo / Abstract | **Revisados por último e mantidos.** Não continham afirmação de versionamento, e todos os seus números (64, 59, 61, 53, 119, 1.542, 159) permanecem válidos após a reverificação |

---

## 7. Limitações removidas e mantidas

**Removidas nesta rodada** (deixaram de ser verdadeiras):

- Versão avaliada não versionada → a versão medida é o *commit* `c8121ba`, publicado.

**Removidas na rodada anterior:**

- "As cinco funções serverless não estavam publicadas" → quatro estão.
- "As suítes de banco não foram executadas" → foram, 159 asserções, 0 falhas.
- "A camada de banco está verificada por leitura, e não por execução" → passou a estar por execução.

**Mantidas — nenhuma foi suavizada:** ausência de avaliação com usuários; *migration* 0013 não publicada; exclusão de conta não publicada; remoção em cascata na exclusão do proprietário; ponta a ponta não executada; resumo diário sem agendamento; ausência de CI/CD; sem medição de desempenho; sem verificação formal de segurança; sem avaliação da qualidade do conteúdo da IA; ausência de fila de escrita fora de rede; avisos apenas dentro do aplicativo.

---

## 8. Afirmações corrigidas

| Afirmação anterior | Correção |
|---|---|
| "as cinco funções serverless não estavam publicadas" | Quatro publicadas; apenas `delete-account` não |
| "não há ambiente de produção" | Há backend publicado e operante |
| "três tabelas de protocolo não possuem política de escrita alguma" | Duas (participantes e convites); notificações não tem política de **inserção**, mas tem de atualização e exclusão |
| "as 26 funções SQL têm caminho de busca fixo" | 23 das 26 são `security definer`, e **essas 23** têm caminho fixo; das três `security invoker`, duas também o têm |
| "27 políticas nomeadas" | 69 políticas |
| "doze *migrations*" | Treze, das quais doze publicadas |
| "151 asserções SQL" | 159 executadas (a contagem estática dá 146; 151 não é reproduzível) |
| "chave anônima" | "chave publicável" — o formato em uso é `sb_publishable_…`, não JWT anônimo |
| `c5af399` + alterações locais | **`c8121ba`**, árvore limpa, *commit* publicado |
| repositório em `.../easy-trip-3.0` | **`.../easy-trip`** — `easy-trip-3.0` é nome antigo, resolvido por redirecionamento 301 |
| "foi necessário substituir a função apenas na instância descartável" | O defeito foi corrigido no repositório; as suítes rodam direto dele |
| ponta a ponta bloqueada por "falta de credencial de serviço" | Credencial local é obtível; o bloqueio real é pilha incompleta + gravação na base de desenvolvimento |
| funcionalidades de cliente marcadas "PUBLICADO" | Reclassificadas como *validado localmente* / *compatível com o esquema publicado* |

---

## 9. Matriz de consistência entre os três documentos

| Métrica | TCC | Atualizações | Inconsistências |
|---|---|---|---|
| HEAD | `c8121ba` | `c8121ba` | `c8121ba` |
| Working tree | limpa | limpa | limpa |
| Data | 28 ago. 2026 | 28 ago. 2026 | 28 ago. 2026 |
| Repositório | `.../easy-trip` (público) | `.../easy-trip` (público) | `.../easy-trip` (público) |
| RF | 64 | 64 | 64 |
| RNF | 61 | 61 | 61 |
| Jest | 119 / 1.542 / 0 falhas | 119 / 1.542 / 0 falhas | 119 / 1.542 / 0 falhas |
| Asserções SQL | 159, executadas, 0 falhas | 159, executadas, 0 falhas | 159, executadas, 0 falhas |
| Blocos E2E | 292, não executados | 292, não executados | 292, não executados |
| *Migrations* locais | 13 | 13 | 13 |
| *Migrations* publicadas | 12 | 12 | 12 |
| Edge Functions implementadas | 5 | 5 | 5 |
| Edge Functions publicadas | 4 | 4 | 4 |
| `delete-account` | não publicada | não publicada | não publicada (PEND-10) |
| *Migration* 0013 | não publicada | não publicada | não publicada (PEND-09) |
| Resumo diário | publicado, sem agendamento | publicado, sem agendamento | publicado, sem agendamento (PEND-11) |
| Limitações em 4.6 | 11 | 11 | 11 |

Nenhum valor diverge entre os três documentos.

---

## 10. Comandos executados nesta rodada

```
git status / git log -10 --oneline / git rev-parse HEAD / git rev-parse origin/main
git diff --check / git diff --stat / git remote -v
npx tsc --noEmit --pretty false                            → 0 erros
npx tsc -p supabase/functions/tsconfig.json --pretty false → 0 erros
npx jest --runInBand      → 119 conjuntos, 1.542 casos, 0 falhas, 37,941 s
npx eslint .              → 0 erros, 8 avisos (todos em tests/)
npx expo-doctor           → 18/18
docker run postgres:17    → PostgreSQL 17.11 descartável, banco novo por suíte
  bootstrap + migrations 0001–0012   → todas aplicam
  migration 0013, instalação limpa   → 0001–0013 aplicam, verificação interna aprovada
  migration 0013, sobre 0001–0012    → aplica, verificação interna aprovada
  rls_content.test.sql               → 28 asserções, 0 falhas, exit 0
  rls_articles.test.sql              → 8 asserções, 0 falhas, exit 0
  rls_collaboration.test.sql         → 92 asserções, 0 falhas, exit 0
  legacy_upgrade.test.sql            → 31 asserções, 0 falhas, exit 0
  contraprova com a definição antiga → para em 78 asserções, exit 3
  catálogos: pg_tables, pg_policies, pg_trigger, pg_indexes, pg_constraint, pg_proc
sondagem do backend publicado (REST + Edge Functions, somente leitura)
api.github.com/repos/... (somente leitura, resolução do nome canônico)
```

Nenhum arquivo de `src/`, `supabase/functions/`, `supabase/migrations/`, `tests/`, `package.json` ou de configuração foi modificado. A única alteração de código é a correção de `auth.uid()` em `supabase/tests/_local_bootstrap.sql`. Os contêineres descartáveis foram removidos ao final. Nenhum `db push`, publicação de função, agendamento remoto ou *commit* foi executado.
