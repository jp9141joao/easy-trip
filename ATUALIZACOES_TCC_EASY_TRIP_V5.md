# ATUALIZAÇÕES — TCC EASY TRIP V5

Relatório das alterações aplicadas ao passar de `tcc_easy_trip_v4(1).md` para `tcc_easy_trip_v5.md`.

---

## 1. Versão analisada

| Item | Valor |
|---|---|
| Repositório | `easy-trip-3.0` — https://github.com/jp9141joao/easy-trip-3.0 |
| Branch | `main` |
| HEAD | `c5af399954e8fcb72af954ccfce7bd8f9287fdd6` (`c5af399`) |
| `origin/main` | `c5af399…` — idêntico ao HEAD, sem divergência |
| Working tree | **SUJA** — 20 arquivos modificados, 16 não rastreados |
| `git diff --check` | limpo (sem erros de espaço em branco) |
| Data da análise | 2026-08-28 |
| Versão efetivamente avaliada | `c5af399` **+ alterações locais não versionadas** |

**Alterações locais que compõem a versão avaliada** (rodada de melhorias): capa da viagem, meta de gasto diário, idioma do destino, avisos globais, reposicionamento das Sugestões, registro central de metadados de país, conversor de moedas contextual, `supabase/migrations/0013_trip_cover_and_daily_goal.sql` e oito arquivos de teste novos.

> **Recomendação de checkpoint.** Enquanto essas alterações não forem versionadas, a avaliação **não é reproduzível por terceiros**: quem partir do `c5af399` obterá os números anteriores à rodada. Isto está registrado como limitação 2 na seção 4.6 do TCC e como PEND-01 no relatório de inconsistências. É a correção de menor custo e maior impacto na reprodutibilidade.

---

## 2. Mudança de posicionamento

O título já havia sido corrigido na v4 e foi mantido: **EASY TRIP: DESENVOLVIMENTO E AVALIAÇÃO DE UM PLANEJADOR INTELIGENTE DE VIAGENS COM INTELIGÊNCIA ARTIFICIAL**. Nenhuma expressão de "conformidade" ou "auditoria" foi reintroduzida. A palavra "auditoria" não ocorre no documento final.

---

## 3. Números antigos × números atuais

Todas as contagens de banco passaram a ser **medidas contra uma instância PostgreSQL 17.11 real**, com as *migrations* aplicadas, em vez de contadas no texto das migrações. Essa mudança de instrumento explica a maior parte das divergências: parte das políticas é criada dinamicamente em laço `foreach`, e uma contagem de instruções não a alcança.

### 3.1 Verificações executadas

| Métrica | v4 | v5 | Classificação |
|---|---|---|---|
| Conjuntos de teste (Jest) | 110 | **119** | CRÍTICA |
| Casos de teste (Jest) | 1.337 | **1.542** | CRÍTICA |
| Falhas | 0 | **0** | — |
| Tempo da suíte | 73,781 s | **37,974 s** | RECOMENDADA |
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
| Políticas nomeadas | 27 | **69** (62 public + 7 storage) | CRÍTICA |
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

### 3.4 Suítes de banco e de ponta a ponta

| Métrica | v4 | v5 | Classificação |
|---|---|---|---|
| Asserções SQL | 151, **não executadas** | **159, EXECUTADAS, 0 falhas** | CRÍTICA |
| — conteúdo editorial | — | 28 | — |
| — publicação de artigos | — | 8 | — |
| — colaboração e visibilidade | — | 92 | — |
| — atualização de banco legado | — | 31 | — |
| Blocos de ponta a ponta | 292, não executados | **292, não executados** | — |

O valor 151 da v4 não é reproduzível: os quatro arquivos `.test.sql` estão **inalterados** desde o `9f33e2b`, e a contagem estática dos seus dois auxiliares de asserção resulta em 146, não 151. A execução real emitiu 159 confirmações. Ver INC-02.

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

Somas conferidas: 59 + 4 + 1 + 0 = 64 ✓ · 12+10+8+8+6+5+5+4+3 = 61 ✓ · 53 + 2 + 6 = 61 ✓

---

## 4. Estado remoto (verificado por inspeção do ambiente publicado)

| Componente | Estado | Como foi verificado |
|---|---|---|
| Backend Supabase | **PUBLICADO e operante** | REST respondeu a todas as sondas |
| *Migrations* 0001–0012 | **APLICADAS** | Colunas e tabelas de cada migração presentes |
| *Migration* 0013 | **NÃO APLICADA** | `cover_image_path` e `daily_spending_goal` retornam `42703 — column does not exist`, mesmo código de uma coluna-controle inexistente |
| Privilégios do papel anônimo | **REVOGADOS** | Toda tabela responde `42501 — permission denied` |
| `ai-chat` | **PUBLICADA** | Responde com a própria checagem de sessão (HTTP 401 da função) |
| `trip-suggestions` | **PUBLICADA** | idem |
| `trip-daily-briefing` | **PUBLICADA** | Responde HTTP 403 da própria checagem de segredo |
| `admin-generate-content` | **PUBLICADA** | idem `ai-chat` |
| `delete-account` | **NÃO PUBLICADA** | HTTP 404 `NOT_FOUND`, idêntico ao de uma função-controle inexistente |
| Agendamento do resumo diário | **NÃO CONFIGURADO** | Nenhum agendamento nas *migrations*; instruções constam apenas como comentário |

**Afirmação da v4 que ficou falsa:** *"as cinco funções serverless não estavam publicadas"* e *"não há ambiente de produção"*. Quatro das cinco estão publicadas e há backend em produção. Corrigido em 3.3, 4.1, 4.6 e na conclusão.

---

## 5. Funcionalidades novas documentadas

| Funcionalidade | Onde entrou no TCC | Estado |
|---|---|---|
| Capa personalizada da viagem (galeria, prévia, confirmação, cancelamento, restauração do padrão) | 3.2, 3.6, 4.1 | IMPLEMENTADO · VALIDADO LOCALMENTE · **NÃO PUBLICADO** |
| Bucket privado `trip-covers` com prefixo por viagem e URL assinada | 3.6, 4.2 | idem |
| Meta de gasto diário (valor usado, disponível, excesso) | 3.2, 3.4, 4.1 | idem |
| Aviso derivado de meta ultrapassada | 3.4 | idem |
| Idioma do destino, exibido só quando difere do idioma do aparelho | 3.2, 3.3, 4.1 | IMPLEMENTADO · PUBLICADO (não depende de esquema novo) |
| Registro central de metadados de país (país → idiomas, país → moeda) | 3.3, 4.2 | idem |
| Conversor de moedas contextual (base = moeda do orçamento; oculto quando as moedas coincidem) | 3.2, 4.2 | idem |
| Avisos globais entre todas as viagens acessíveis, com identificação da origem | 3.2, 4.1 | idem |
| Sugestões reposicionadas para dentro da Jornada | 3.2, 4.1 | idem — **reposicionada, não removida** |
| Cadeia de cinco modelos Gemini com fallback | 3.3, 3.5, 4.2 | IMPLEMENTADO · PUBLICADO |
| Resolução de data para pedidos de roteiro de dia inteiro | 3.5 | idem |
| Reservas: sete tipos nomeados | 3.2 | idem |
| Papéis owner/editor/viewer explicitados | 3.2, 3.6 | idem |

---

## 6. Seções modificadas

| Seção | Alteração | Classificação |
|---|---|---|
| Resumo / Abstract | Reescritos por último, com os números novos; agrupam funcionalidades em vez de listá-las | IMPORTANTE |
| Quadro 1 | 12 → 13 *migrations*; "matriz de políticas" → "matriz de políticas executada" | CRÍTICA |
| 3.2 / Quadro 4 | Módulos atualizados; "Notificações" → "Avisos e lembretes"; acrescentadas capa, idioma, meta diária, Jornada, tipos de reserva, papéis; terceira característica transversal (não exibir informação redundante) | IMPORTANTE |
| 3.3 | Versões revalidadas; +Supabase JS; 19 contratos; 20 módulos de domínio; metadados de país; "funções serverless" → "Edge Functions"; Gemini como cadeia de modelos | CRÍTICA |
| Figura 1 | Todos os números recontados; distinção entre Edge Functions implementadas e publicadas | CRÍTICA |
| 3.4 | 13 *migrations* com estado de publicação; números medidos; meta diária como valor derivado | CRÍTICA |
| 3.5 | **Reescrita.** Abre explicando como a IA auxilia o planejamento e só depois como é validada; acrescenta tipos de ação, roteiro de dia inteiro, cadeia de modelos, filtragem de privacidade | IMPORTANTE |
| Figura 2 | Pipeline atualizado com Edge Function nomeada, contexto autorizado e cadeia de modelos | IMPORTANTE |
| 3.6 | Papéis de colaboração; correção de três → duas tabelas de protocolo; regime próprio da tabela de notificações; regra distinta de armazenamento da capa | CRÍTICA |
| 3.7 | Delimitação explícita da versão avaliada (HEAD + alterações locais); URL do repositório corrigida; quinta etapa de procedimento (inventário executado do banco) | CRÍTICA |
| Quadro 6 | Duas métricas novas: aplicação das *migrations* e execução das suítes SQL; qualidade do conteúdo da IA movida para os itens descartados | IMPORTANTE |
| 4.1 / Tabela 1 | 64 RF; coluna de estado de publicação substituindo a leitura binária anterior | CRÍTICA |
| 4.2 / Quadro 7 | 61 RNF; coluna nova "forte no código, pendente de publicação" | CRÍTICA |
| 4.3 / Tabela 2 | Números novos; duas linhas novas (migrations, suítes SQL); ressalva do arcabouço de teste; Android como teste manual do desenvolvedor | CRÍTICA |
| 4.4 | Passa de "verificado por leitura" a "verificado por execução" para a camada de banco | CRÍTICA |
| 4.5 | Discussão reescrita em torno das três camadas de evidência; achado novo sobre contagem estática de banco | IMPORTANTE |
| 4.6 | **Reescrita.** 8 → 12 limitações | CRÍTICA |
| 5 | Reescrita com os números novos e cinco frentes de trabalho futuro | CRÍTICA |
| Referências | Datas de acesso 26 → 28 ago. 2026; nenhuma referência acrescentada ou removida | ESTILÍSTICA |

---

## 7. Limitações removidas e acrescentadas

**Removidas** (deixaram de ser verdadeiras):

- "As cinco funções serverless não estavam publicadas" → quatro estão.
- "As suítes de banco não foram executadas" → foram, 159 asserções, 0 falhas.
- "A camada de banco está verificada por leitura, e não por execução" → passou a estar por execução.

**Acrescentadas** (verdadeiras e antes ausentes):

- Versão avaliada não versionada (reprodutibilidade).
- *Migration* 0013 não publicada.
- Resumo diário publicado, mas sem agendamento.
- Ausência de fila de escrita fora de rede.
- Avisos apenas dentro do aplicativo, sem notificação do sistema operacional.

**Mantidas:** ausência de avaliação com usuários; exclusão de conta não publicada; ponta a ponta não executada; ausência de CI/CD; sem medição de desempenho; sem verificação formal de segurança; sem avaliação da qualidade do conteúdo da IA; remoção em cascata na exclusão do proprietário.

---

## 8. Afirmações corrigidas

| Afirmação da v4 | Correção na v5 |
|---|---|
| "as cinco funções serverless não estavam publicadas" | Quatro publicadas; apenas `delete-account` não |
| "não há ambiente de produção" | Há backend publicado e operante |
| "três tabelas de protocolo não possuem política de escrita alguma" | Duas (participantes e convites); notificações não tem política de **inserção**, mas tem de atualização e exclusão |
| "as 26 funções SQL têm caminho de busca fixo" | 23 das 26 são `security definer`, e **essas 23** têm caminho fixo; a restante é `security invoker`, onde o vetor não se aplica |
| "27 políticas nomeadas" | 69 políticas |
| "doze *migrations*" | Treze, das quais doze publicadas |
| "151 asserções SQL" | 159 executadas (a contagem estática dá 146; 151 não é reproduzível) |
| "chave anônima" | "chave publicável" — o formato em uso é `sb_publishable_…`, não JWT anônimo |
| repositório em `.../easy-trip` | `.../easy-trip-3.0` |
| commit `9f33e2b`, 26 ago. 2026 | `c5af399` + alterações locais, 28 ago. 2026 |
| "as suítes SQL exigem instância local que não foi provisionada" | Foi provisionada e as suítes foram executadas |

---

## 9. Comandos executados

```
git status / git log -10 --oneline / git rev-parse HEAD / git rev-parse origin/main
git diff --check / git diff --stat
npx tsc --noEmit --pretty false                          → 0 erros
npx tsc -p supabase/functions/tsconfig.json --pretty false → 0 erros
npx jest --runInBand      → 119 suítes, 1.542 testes, 0 falhas, 37,974 s
npx eslint .              → 0 erros, 8 avisos (todos em tests/)
npx expo-doctor           → 18/18
docker run postgres:17    → PostgreSQL 17.11 descartável
  bootstrap + migrations 0001–0012  → todas aplicam, verificações internas aprovadas
  migration 0013                    → aplica, verificação interna aprovada
  rls_content.test.sql              → 28 asserções, 0 falhas
  rls_articles.test.sql             → 8 asserções, 0 falhas
  rls_collaboration.test.sql        → 92 asserções, 0 falhas
  legacy_upgrade.test.sql           → 31 asserções, 0 falhas
sondagem do backend publicado (REST + Edge Functions)
```

Nenhum arquivo de `src/`, `supabase/functions/`, `supabase/migrations/`, `tests/`, `package.json` ou de configuração foi modificado. O contêiner PostgreSQL foi descartado ao final.
