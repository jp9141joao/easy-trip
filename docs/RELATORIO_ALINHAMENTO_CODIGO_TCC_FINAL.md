# ALINHAMENTO CÓDIGO × TCC FINAL — EASY TRIP

## 1. Resumo executivo

Auditoria de 21/09/2026 do repositório e consulta **somente leitura** do projeto
Supabase `easy-trip` (`mqyrtajbfwucjvkfqwbn`). Referência: texto integral fornecido
pelo autor de **“EASY TRIP: DESENVOLVIMENTO E AVALIAÇÃO DE UM PLANEJADOR INTELIGENTE
DE VIAGENS COM INTELIGÊNCIA ARTIFICIAL”**, João Pedro Rosa de Paula, orientado
pelo Prof. Dr. Daniel Facciolo Pires.

O anexo disponibilizado nesta sessão é `pasted-text.txt`, com o conteúdo do TCC;
não foi recebido um binário DOCX nem os arquivos das figuras referenciadas.
O texto foi lido integralmente, inclusive resultados, limitações e referências.
Nenhum arquivo do TCC foi alterado. Documentos internos antigos não substituíram
a fonte acadêmica.

Foram encontradas divergências atuais que exigiam correção: atalho que pulava
a revisão visual de propostas simples, valor de IA apresentado como informado
pelo usuário a partir de uma flag do próprio modelo, envio da fila offline após
troca de identidade e referências forjadas a arquivos privados. Foram corrigidas
também documentação obsoleta, patches incompatíveis com a recomendação do SDK e
a prontidão dos bancos descartáveis usados pelos instrumentos de avaliação.

As 17 migrations históricas permanecem intactas. A correção de Storage é
aditiva (`0018`), sem publicação. O remoto observado continua na `0012`, com
quatro Functions: isso confirma o snapshot remoto do TCC, não o alinhamento
integral do ambiente publicado com todas as correções locais.

## 2. Snapshot analisado

Estado capturado antes de editar arquivos:

```text
date -Is:                  2026-09-21T12:43:45+00:00
node -v:                   v24.21.0
npm -v:                    11.19.0
git branch --show-current: main
git log -1 --oneline:       85758ba fix: gate AI action proposals on user intent and polish trip UI
git rev-parse HEAD:         85758ba885999512c86bfe0f9bd24c905fcd2ce3
git rev-parse origin/main:  85758ba885999512c86bfe0f9bd24c905fcd2ce3
git status --short:          M package-lock.json
```

Versões instaladas iniciais: Expo **57.0.23**, React Native **0.86.3**,
TypeScript **6.0.3**, Supabase CLI **2.117.0**. Existiam **17 migrations** e
**6 Edge Functions** (excluído `_shared`). O lockfile já tinha `dev: true` em
`node_modules/fsevents`; essa alteração do usuário foi preservada após a
atualização das dependências. SHA-256 inicial do lockfile:
`bba4226580aee050c617df13b2f5f27b2d6d68f980675949f6372d7158417816`.

Stack após atualização compatível: Expo **57.0.24**, RN **0.86.3**, TS **6.0.3**.
Nenhum downgrade de Expo/RN, commit, push, deploy ou escrita remota foi realizado.
`origin/main` significa a referência disponível localmente: não houve fetch.

## 3. Classificação dos snapshots do TCC

Esta classificação orientou a decisão de corrigir ou preservar cada área.

| Afirmação / seção | Tipo | Evidência esperada / local | Decisão |
|---|---|---|---|
| 74 RF / 70 RNF, tabelas 1 e quadro 6 | HISTÓRICA | Recorte formal de 2/9/2026 no texto oficial | Preservar; não recontar funcionalidades para forçar equivalência |
| Expo 54 / RN 0.81 na Figura 2 | HISTÓRICA | Legenda da figura | Não fazer downgrade |
| Expo 57 / RN 0.86 / TS estrito, §3.3 | ATUAL | `package.json`, lockfile, `tsconfig.json` | Manter linha de versões e atualizar patches recomendados |
| 17 migrations, 26 tabelas, 77 políticas, §3.4 | HISTÓRICA (conjunto avaliado) | Aplicação 0001–0017 e catálogos PostgreSQL | Medir separadamente a base histórica e a extensão atual |
| RLS sem bypass de proprietário, §3.6 | ATUAL | Migrations, RPCs, políticas materializadas e testes SQL | Exigir a regra no banco e nos arquivos |
| Papéis contextuais, anexos e capa privados, §3.2/3.6 | ATUAL | `collaboration.ts`, 0008/0009/0013/0014, repositórios | Preservar sem tratar papel por viagem como papel global |
| Seis ações, READ×WRITE, três validações e confirmação, §3.5 | ATUAL | Function → serviço/hook → parser/revisão → executor | Corrigir caminhos que violam essas garantias |
| Diário novo privado; despesas como estimativas, §3.5 | ATUAL | Parser, revisão, contexto e executor | Impedir que o modelo declare preços comprovados |
| Fila durável nos cinco domínios, quadro 4/§4.2 | ATUAL | Domínio, AsyncStorage, hook, executor e testes | Interromper envio quando a identidade muda |
| 134 suítes/1.835 Jest, 18/18 Doctor, tabela 2 | HISTÓRICA | Rodada de 2/9/2026 | Não substituir retroativamente |
| 143 suítes/2.227 Jest, 411 SQL, 403 E2E, 18 IA, 21 Doctor | REVALIDAÇÃO | Rodada posterior descrita na tabela 2 | Comparar à nova execução, sem apagar testes |
| Remoto na 0012 com quatro Functions | HISTÓRICA e REVALIDAÇÃO | `list_migrations`, `list_edge_functions`, catálogos | Conferir agora; nenhuma alteração remota |
| `journal.add` ainda fora de origin/main, §4.5 | REVALIDAÇÃO | Referência Git observada naquela rodada | Evolução posterior: já existe no HEAD/origin/main local desta auditoria |
| Ausência de estudo com usuários/Gemini real, §4.6 | REVALIDAÇÃO / limitação | Instrumentos disponíveis e execução registrada | Não transformar testes sintéticos em avaliação humana |

## 4. Divergências encontradas

| ID | Antes | Afirmação afetada | Evidência |
|---|---|---|---|
| D1 | `implement()` chamava `applyActions()` diretamente para um bloco sem avisos | Revisão visual antes da confirmação | Dois testes novos de interface falharam antes da correção |
| D2 | `estimated=false` vindo do modelo produzia “Valor informado por você” e descrição sem prefixo | Inferência financeira apresentada como estimativa | Protocol/parser aceitavam a flag; testes antigos esperavam esse comportamento |
| D3 | A fila selecionava itens pelo usuário inicial e continuava após esperas, sem observar logout | Isolamento da fila por identidade | Leitura do caminho real; regressões de logout/troca durante persistência e entre envios |
| D4 | INSERT/UPDATE podia ligar `file_path` alheio a registro compartilhado, concedendo leitura pela policy de 0009 | Arquivo herda privacidade sem vazamento entre usuários | Regressão SQL falhou no banco 0001–0017: `INSERT não publica anexo de outro usuário` |
| D5 | README citava modelagem ausente, 105/62/41 sem fonte disponível e 73 testes | Documentação fiel aos snapshots | Busca no workspace e `git log --all -- docs/modelagem` sem artefatos |
| D6 | Expo Doctor: 20/21; oito versões instaladas abaixo dos patches esperados | Ambiente compatível | Saída da ferramenta; correção sem alterar SDK/RN principais |
| D7 | Scripts aceitavam o PostgreSQL temporário pelo socket antes de seu reinício | Medição reprodutível do schema | Primeiras execuções interrompidas por `database system is shutting down` |

## 5. Correções aplicadas

- **D1:** `src/app/(tabs)/advisor.tsx` sempre abre a revisão. Só `onConfirm` da
  folha chega a `applyActions`. Cancelar preserva a proposta sem chamar o executor.
- **D2:** `protocol.ts` força estimativa; `aiActions.ts` revalida inclusive respostas
  de Functions antigas; a revisão sempre rotula “Estimativa da IA”; a descrição
  persistida mantém `Estimativa —` mesmo se uma proposta editada contiver `false`.
  O CRUD manual de despesas permanece disponível para valores efetivamente registrados.
- **D3:** `useOfflineQueue` confere a sessão do adaptador e escuta mudanças durante
  a drenagem; `offlineSync` confere a guarda antes de cada item e depois de salvar
  `syncing`. Interromper preserva a fila da conta original e não repopula seu cache
  após logout. Envios já iniciados não são descritos como cancelados retroativamente.
- **D4:** `0018_storage_record_binding.sql` valida novos vínculos/alterações de
  caminho no banco: prefixo do usuário autenticado e identificador da viagem ou
  entrada de diário correspondente. A função de trigger é `security invoker`,
  possui `search_path` fixo e não é executável diretamente por clientes.
  Atualizar o título de uma reserva compartilhada preservando o anexo continua
  permitido. Dados legados não são reescritos; o teste HTTP mantém cenários de
  limpeza defensiva de referências antigas, preparados apenas com credencial local
  privilegiada, e acrescenta a recusa de uma nova referência forjada.
- **D5:** README corrigido; planos antigos identificados explicitamente como
  históricos; links quebrados substituídos por evidência real. Não foram recriados
  catálogos de requisitos inexistentes.
- **D6:** `npx expo install --fix --npm`, com alteração prévia do lockfile preservada.
- **D7:** checagem de prontidão por TCP nos dois scripts, evitando confundir o
  servidor temporário de inicialização com a instância pronta para migrations.

Arquivos alterados ou criados nesta tarefa (26; o lockfile já continha a
alteração de usuário descrita na seção 2):

```text
GO_LIVE_SUPABASE.md
README.md
SUPABASE_IMPLEMENTATION_PLAN.md
docs/RELATORIO_ALINHAMENTO_CODIGO_TCC_FINAL.md
package-lock.json
package.json
scripts/count-artifacts.sh
scripts/sql-test.sh
src/app/(tabs)/advisor.tsx
src/components/ai/actions/ExpenseActionPreview.tsx
src/domain/aiActions.ts
src/domain/aiIntent.ts
src/hooks/useAIActions.ts
src/hooks/useOfflineQueue.ts
src/services/offlineSync.ts
supabase/functions/ai-chat/protocol.ts
supabase/migrations/0018_storage_record_binding.sql
supabase/tests/lifecycle_e2e.mjs
supabase/tests/storage_record_binding.test.sql
tests/integration/ai-actionable.test.ts
tests/integration/offline-queue-lifecycle.test.ts
tests/unit/ai-action-executor.test.ts
tests/unit/ai-action-followup.test.tsx
tests/unit/ai-actions-schema.test.ts
tests/unit/ai-chat-protocol.test.ts
tests/unit/offline-queue-session.test.tsx
```

## 6. RF e RNF

**74 RF / 70 RNF** são o inventário formal avaliado em 2/9/2026. O texto relata
62 RF operantes no schema publicado e 12 dependentes de publicação; para RNF,
58 com evidência forte, sete pendentes de publicação e cinco lacunas.
Essas classificações históricas não foram recalculadas nesta tarefa.

Não foi localizada fonte que sustente as contagens posteriores de 105 RF,
62 RNF e 41 casos de uso. Não se conclui que as funcionalidades correspondentes
não existam; retira-se apenas a alegação de catálogo versionado comprovado.
O relatório presente não é uma reconstrução fictícia desses documentos nem uma
nova avaliação com usuários.

## 7. Arquitetura

`package.json`/lockfile confirmam Expo Router, Expo 57, RN 0.86 e TS 6;
`tsconfig.json` e o projeto de Functions usam `strict: true`.
Há dois aliases explícitos `Record<string, any>` nas fronteiras de mapeamento
Supabase (`SupabaseDataSource.ts` e `collaboration.ts`); isso não desativa o modo
estrito nem sustenta uma alegação de ausência absoluta de `any`.
Apresentação em `src/app`/componentes, orquestração em hooks/providers, regras em
`src/domain`, contratos em `src/repositories/types.ts`, adaptadores
`local/LocalDataSource.ts` e `supabase/SupabaseDataSource.ts`, integrações em
serviços/Functions. Não foi necessária refatoração nominal ou reorganização.

`trips.daily_spending_goal` é persistido pela 0013; situação, contagem regressiva,
totais/saldo e gasto diário são calculados pelos seletores. Não foi introduzida
duplicação de estado derivado. As integrações reais incluem Gemini nas Functions,
Open-Meteo, Frankfurter/ExchangeRate-API e mapas nativos/links Google Maps.

## 8. Banco e migrations

Medição feita por aplicação das migrations em PostgreSQL descartável, imagem
`public.ecr.aws/supabase/postgres:17.6.1.155`, seguida de consulta aos catálogos
por `scripts/count-artifacts.sh`. Não é inferência a partir de nomes de arquivos.

| Objeto materializado | 0001–0017 (referência TCC) | 0001–0018 (correção atual) |
|---|---:|---:|
| Tabelas públicas / com RLS | 26 / 26 | 26 / 26 |
| Colunas públicas | 291 | 291 |
| Políticas em public | 66 | 66 |
| Políticas em storage.objects | 11 | 11 |
| Total de políticas | 77 | 77 |
| Funções do projeto em public | 43 | 44 |
| SECURITY DEFINER / com search_path fixo | 35 / 35 | 35 / 35 |
| Triggers não internos | 16 | 18 |
| Índices públicos | 61 | 61 |
| Constraints | 120 | 120 |
| CHECK / FK / PK / UNIQUE | 45 / 45 / 26 / 4 | 45 / 45 / 26 / 4 |
| Buckets / privados / públicos | 5 / 4 / 1 | 5 / 4 / 1 |
| Tabelas públicas com SELECT para anon | 0 | 0 |

Funções pertencentes a extensões são excluídas pela relação `pg_depend` com
`pg_extension` (`deptype='e'`), conforme implementado no script.

Escopo da revisão das migrations: 0001–0007 (schema, grants, papel administrativo,
perfil e buckets); 0008–0009 (membros, convites, autoria, visibilidade e Storage);
0010–0012 (avisos, reservas e sugestões); 0013–0014 (capa/meta diária,
transferência/guarda de exclusão); 0015–0017 (cron, push e reserva atômica).
A 0018 foi criada inicialmente pela CLI e recebeu numeração sequencial coerente
com os instrumentos do repositório. Nenhuma migration existente foi editada.

Instalação limpa e atualização 0001–0007 + dados legados + migrations posteriores
fazem parte de `scripts/sql-test.sh`. A nova suite mede recusa de INSERT/UPDATE
forjado, separação entre viagens/entradas e caminhos legítimos de proprietário/editor.

## 9. Segurança, RLS e privacidade

Nas tabelas `itinerary_items`, `checklist_items`, `expenses`, `tickets` e
`journal_entries`, a 0009 materializa:

```text
is_trip_member(trip_id) AND (visibility = 'shared' OR created_by = auth.uid())
```

UPDATE/DELETE exigem também `can_edit_trip`; UPDATE aplica a condição tanto em
USING quanto em WITH CHECK. `set_created_by` atribui a autoria na criação e
preserva a original na alteração. Não existe bypass de proprietário nessas
políticas. `journal_media` herda a regra da entrada; RPCs de nomes históricos
retornam apenas autores de conteúdo compartilhado a membros autorizados.

Essa garantia de linhas estava presente, mas não bastava para impedir referências
forjadas de arquivos: D4 foi corrigida no banco, não só na interface. Os buckets
privados são `avatars`, `attachments`, `journal` e `trip-covers`; `content` é
público por conter imagens editoriais. URLs assinadas não são identidade durável
e podem continuar válidas até expirar; a correção não promete revogar URLs já emitidas.

Regressões existentes cobrem usuário sem autenticação, viewer/editor/owner,
cache privado, logout, troca de conta e Realtime: `rls_collaboration.test.sql`,
`rls_matrix_e2e.mjs`, `storage_e2e.mjs`, `file-mirror-accounts.test.ts`,
`query-persistence.test.ts`, `logout-flow.test.tsx`, `passive-signout.test.tsx`,
`realtime-identity-reset.test.tsx`. Novas regressões de Storage e fila complementam
essas verificações.

Busca nos arquivos versionados do checkout por assinaturas de chaves privadas,
Google API keys, Supabase secret keys, tokens GitHub e JWTs completos não encontrou
credenciais reais. Nomes `GEMINI_API_KEY`/`SUPABASE_SERVICE_ROLE_KEY`, placeholders
e segredos fixos da pilha local de teste foram distinguidos de valores de produção.
Não houve impressão de segredo real, exportação de credenciais remotas nem auditoria
exaustiva de todos os blobs históricos do Git.

Referência técnica consultada: [RLS do Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security).
A revisão distingue permissões de tabela de políticas por linha; os testes
executam ambas no banco materializado. Também foi consultado o
[changelog oficial](https://supabase.com/changelog.md) para mudanças recentes.

## 10. Colaboração

`owner`, `editor` e `viewer` são papéis por viagem em `trip_members` e no domínio
`collaboration.ts`. Convites admitem editor/viewer; o proprietário gerencia
participantes. Convites/membros não permitem escrita direta do cliente: a 0008
encapsula as transições em RPCs com identidade da sessão, validações e grants.
A 0014 implementa transferência, impede saída indevida do proprietário e guarda
exclusão de conta enquanto há propriedade compartilhada a resolver.
O papel administrativo de conteúdo é independente, protegido por grants de
coluna, gatilho e checagem de perfil. Não foi alterado para “tipo de conta de viagem”.

## 11. Offline

Domínios permitidos: roteiro, preparação, despesas, diário e metas; create/update/
remove. A fila é persistida por conta (`src/lib/offlineQueue.ts`), com `userId`
também em cada item, `tripId`/alvo no payload operacional, IDs estáveis,
recuperação de envios interrompidos e reconexão em `useOfflineQueue`.

`classifyFailure` separa transporte/retry, permissionamento/dado inválido/registro
ausente e repetição idempotente. `needs_resolution` fica visível ao usuário.
A correção D3 fecha a troca de conta entre operações e durante a persistência
prévia ao envio; os testes verificam que a pendência original permanece no disco.

Conta, participantes, administração e arquivos continuam fora da fila. Propostas
da IA exigem rede e nova interação; o comentário antigo de `useAIActions` que
negava a existência de qualquer fila offline foi corrigido.

## 12. Inteligência artificial

Contrato mantido: `itinerary.add`, `checklist.add`, `expenses.add`, `budget.update`,
`goal.add`, `journal.add`. Não há ações de exclusão, remoção de participantes,
transferência de propriedade ou mutação administrativa nesse contrato.
`undoAIActions` é ação explícita da pessoa sobre IDs que o executor acabou de
criar; não é uma ferramenta destrutiva fornecida ao modelo.

| Camada | Arquivo / função | Responsabilidade real | Testes |
|---|---|---|---|
| Servidor | `supabase/functions/ai-chat/protocol.ts`: `validateActions`, `readModelOutput`; `index.ts` chama `gateActionsByIntent` | Lista de seis tipos, campos, limites, datas e separação de leitura/escrita antes da resposta | `ai-chat-protocol`, `ai-intent`, `ai-full-day-itinerary` |
| Cliente | `src/services/ai.ts`: `RemoteAIService`; `src/hooks/useAI.ts`; `src/domain/aiActions.ts`: `parseAIActions`; `aiActionReview.ts`: `buildReviewGroups` | Bloqueia proposta READ de servidor antigo, valida novamente, vincula viagem, detecta duplicatas/datas e produz revisão | `ai-intent`, `ai-actions-service`, `ai-actions-schema`, `ai-action-ui` |
| Executor | `src/services/aiActionExecutor.ts`: `executeAIActions`, `rejectionReason` | Confere tripId e campos essenciais antes das chamadas de repositório; persiste com a sessão sob RLS e informa falhas parciais | `ai-action-executor`, `ai-actionable`, `supabase-ai-write-contract` |

Confirmação: resposta → proposta → validação → **revisão visual obrigatória** →
botão de confirmação → executor. D1 removeu o único caminho direto identificado.
“Pode aplicar” na conversa abre revisão e não grava. Cancelar ou só receber uma
resposta não executa ação.

`journal.add` cria entrada privada. `buildAIContext` e `sanitizeContext` não
incluem o diário existente. A revisão não expõe seletor de compartilhamento para
essa categoria e `runJournal` fixa `DEFAULT_VISIBILITY.journal`. Despesas geradas
mantêm rótulo de estimativa da revisão até o registro persistido (D2).

| Edge Function local | Objetivo | Autenticação/autorização | Variáveis sensíveis (somente nomes) | Evidência local |
|---|---|---|---|---|
| `ai-chat` | Conversa e propostas | JWT + `auth.getUser`, limite por usuário | `GEMINI_API_KEY` | Tipagem, protocolos, intent, E2E HTTP |
| `admin-generate-content` | Proposta editorial | JWT + perfil admin antes de configuração/provedor | `GEMINI_API_KEY` | Ordem de autenticação em `push-notifications.test.ts`, testes editoriais, HTTP |
| `trip-suggestions` | Sugestões da viagem | JWT + RPCs com sessão, reserva atômica da 0017 | `GEMINI_API_KEY` | Protocol/policy, `suggestion_refresh_window`, HTTP |
| `trip-daily-briefing` | Resumo diário | Service role + header de segredo dedicado; filtro explícito de visibilidade | `GEMINI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TRIP_DAILY_BRIEFING_CRON_SECRET` | Protocolo, `briefing_schedule`, HTTP |
| `delete-account` | Exclusão solicitada da conta | JWT validado, RPC de bloqueios antes da operação privilegiada | `SUPABASE_SERVICE_ROLE_KEY` | Storage purge e `delete_account_e2e` |
| `send-push` | Entrega de notificações | Service role + segredo dedicado | `SUPABASE_SERVICE_ROLE_KEY`, `EASY_TRIP_PUSH_SECRET` | Protocolo, `push_tokens`, HTTP |

URL e chave pública Supabase configuram os clientes das Functions; não são
credenciais do Gemini. A existência desses seis diretórios comprova implementação
local, não publicação. Tipagem é `npm run check:functions`, usando o projeto TS
existente; isso não equivale a execução real do provedor ou teste em aparelho.

## 13. Supabase remoto — somente leitura

Fontes autoritativas: ferramentas Supabase `list_projects`, `list_migrations`,
`list_edge_functions`, `get_edge_function(ai-chat)` e SELECTs de catálogos via
`execute_sql`. Não foram consultados conteúdos privados de viagens.

| Medida | Registrado no TCC | Observado em 21/09/2026 |
|---|---|---|
| Última migration | 0012 | 0012 `trip_suggestions` |
| Histórico aplicado | 0001–0012 | As 12 versões 0001, 0002, 0003, 0004, 0005, 0006, 0007, 0008, 0009, 0010, 0011, 0012 |
| Functions publicadas | 4 de 6 | 4 ACTIVE; `verify_jwt=true` nas quatro |
| Pendentes locais | 0013–0017 | 0013–0017 e nova correção 0018 |
| Tabelas / RLS | Snapshot remoto parcial | 25 / 25 |
| Políticas public / storage | Não atribuir o total local ao remoto | 62 / 7 (69 no total) |
| Leitura de tabelas públicas por anon | Sem acesso | 0 tabelas com privilégio SELECT |

Functions observadas: `ai-chat` **v14**, `admin-generate-content` **v2**,
`trip-suggestions` **v2**, `trip-daily-briefing` **v1**, todas ACTIVE.
`delete-account` e `send-push` não constam da listagem publicada.

Buckets remotos: `avatars` privado/5 MiB, `attachments` privado/10 MiB,
`journal` privado/10 MiB e `content` público/5 MiB. Ausente `trip-covers`.
`daily_spending_goal` e `cover_image_path` não constam de `trips`; ausente
`push_tokens`. São diferenças coerentes com a ausência de 0013/0016.

Os catálogos remotos confirmam, nas cinco tabelas, o predicado de associação e
visibilidade, sem exceção para owner, e apenas SELECT nas políticas de membros/
convites. O código publicado de `ai-chat` contém `journal.add`, mas não contém
`gateActionsByIntent`/`classifyRequestIntent` da implementação local. Portanto
a correção READ×WRITE local não deve ser anunciada como publicada.

Nenhum INSERT/UPDATE/DELETE, DDL, migration, configuração de bucket, secret ou
deploy foi enviado ao remoto. Os resultados SQL/E2E deste relatório não são
testes contra produção. A nova 0018 também permanece pendente de publicação;
o remoto ainda não recebe essa proteção adicional de arquivos.

## 14. Documentação interna

README passou a separar o recorte acadêmico, a execução atual e o estado remoto;
documenta comandos reais de testes, a exceção do bucket editorial público,
fallback de câmbio e limitações do modo local. Foram removidos links que alegavam
documentação inexistente, inclusive `PUBLICACAO_CONJUNTA_0017.md`; a ordem de
publicação da 0017 aponta para a migration real.

`GO_LIVE_SUPABASE.md` e `SUPABASE_IMPLEMENTATION_PLAN.md` ganharam notas de
snapshot. Seus resultados históricos não foram apagados ou atualizados como se
tivessem sido reexecutados. Documentos de MASVS, avaliação defensiva e protocolo
de usuários foram preservados como avaliações/instrumentos datados.

## 15. Testes executados

Comandos e evidências da rodada local de 21/09/2026:

| Verificação | Revalidação descrita no TCC | Execução atual | Exit |
|---|---|---|---:|
| `npm run typecheck` | Sem erros | Sem erros | 0 |
| `npm run check:functions` | Sem erros | Sem erros | 0 |
| `npx eslint .` | 0 erros / 11 warnings | 0 erros / 11 warnings | 0 |
| `npm run lint` | — | 0 erros / 2 warnings no escopo padrão Expo | 0 |
| `npm test -- --runInBand` | 143 suítes / 2.227 testes | 144 suítes / 2.235 testes; 0 falhas | 0 |
| `bash scripts/sql-test.sh` | 9 suítes / 411 asserções | 10 suítes / 422 asserções; 0 falhas | 0 |
| E2E local, 11 arquivos `*_e2e.mjs` | 403 asserções / 0 falhas / 0 ignoradas | 11 arquivos / 404 asserções / 0 falhas / 0 ignoradas (pilha adaptada, abaixo) | 0 |
| Avaliação defensiva IA offline | 18/18 | 18/18 | 0 |
| `npx expo-doctor` | 21/21 | 21/21 | 0 |
| `bash scripts/count-artifacts.sh` | 26 tabelas / 77 políticas | 26 tabelas / 77 políticas; catálogo completo na seção 8 | 0 |
| `git diff --check` | — | Sem problemas de whitespace | 0 |

Comando da IA offline:

```bash
EVAL_STUB_EXPO=1 AI_EVAL_LIVE=0 node --experimental-strip-types \
  --import ./scripts/alias-loader.mjs scripts/ai-eval/run.mjs
```

`AI_EVAL_LIVE=0` impede chamada ao Gemini; `EVAL_STUB_EXPO=1` substitui apenas
IDs nativos incompatíveis com a execução Node. O primeiro comando sem esse stub
falhou ao importar módulos nativos, antes dos cenários, e não foi contado como
avaliação aprovada.

SQL inclui atualização com dados legados (31 asserções), bases novas por suíte,
as nove suítes anteriores e a nova regressão `storage_record_binding` (11
asserções). As migrations 0001–0017 não foram editadas. E2E mantém os cenários
anteriores e acrescenta a recusa HTTP de uma nova referência forjada; referências
legadas são preparadas com credencial privilegiada **exclusivamente local**.

Tentativas de preparação são distintas dos resultados dos testes. A primeira
checagem por socket nos scripts SQL alcançou o servidor temporário de bootstrap;
a correção TCP foi validada nas execuções posteriores. O Expo Doctor inicial
registrou 20/21; após atualização dos patches compatíveis, registrou 21/21.

Uma rodada Jest teve 143 suítes aprovadas e uma falha por timeout de 5 segundos
no primeiro caso de `logout-flow` durante preparação pesada dos contêineres.
A mesma suíte passou isoladamente (20/20), sem alteração de timeout ou remoção
de testes. O resultado completo definitivo foi 144/144 suítes e 2.235/2.235 testes,
exit 0, em 49,251 segundos, conforme a tabela acima. Os oito casos adicionais
são dois de confirmação visual e seis de interrupção da fila por identidade
(três do serviço e três do hook).

A E2E pelo runner padrão foi efetivamente tentada e saiu com código 1 **antes de
executar qualquer um dos 11 arquivos**. Primeiro, o firewall legado do ambiente
bloqueava tráfego na bridge Docker; depois, Logflare/Vector não ficaram saudáveis.
O diagnóstico de rede foi reproduzido em dois contêineres descartáveis. Para a
rodada adaptada, regras temporárias ficaram limitadas à bridge exclusiva da E2E;
a cópia local do runner usou `supa start --exclude logflare,vector`. Apenas esses
dois serviços de logs foram excluídos. Banco, Auth, Storage, Realtime, gateway e
Edge Runtime permanecem na pilha; todos os arquivos e critérios de teste foram
preservados. Ao terminar, os contêineres/volumes da pilha foram removidos e as
regras temporárias de firewall foram retiradas, conferindo o retorno à lista
inicial de regras. Isso não comprova a saúde de Logflare/Vector nem uma subida integral
sem adaptação neste ambiente.

Logs desta sessão ficam em `.expo/tcc-audit/` (ignorado pelo Git), incluindo
`typecheck.log`, `functions.log`, `lint.log`, `expo-lint.log`, `sql.log`, `ai.log`,
`doctor.log`, `jest.log`, `jest-final.log`, `logout-isolated.log`, `e2e.log`,
`e2e-analytics-failed.log`, `e2e-fixed.log`, `e2e-report.txt` e
`artifacts-final.log`.
Nenhum resultado foi deduzido da contagem estática de testes.

## 16. Matriz de conformidade

| Área / afirmação | Classificação | Evidência | Estado nesta auditoria |
|---|---|---|---|
| 74 RF / 70 RNF | HISTÓRICA | Texto oficial, quadro 6 | Preservado; inventário formal não recontado |
| Figura 2, Expo 54 / RN 0.81 | HISTÓRICA | Legenda do TCC | Preservado, sem downgrade |
| Expo 57 / RN 0.86 / TS estrito | ATUAL | Manifesto, lockfile, projetos TS | Conforme; patches compatíveis atualizados |
| Arquitetura em camadas | ATUAL | App/hooks/domain/repositories/services | Conforme |
| 17 migrations avaliadas | HISTÓRICA | Arquivos 0001–0017 e catálogos | Intactas; 0018 aditiva identificada separadamente |
| 26 tabelas / 77 políticas | HISTÓRICA | Banco materializado | Mantidos também na base atual |
| Isolamento de linhas privadas | ATUAL | 0009, RLS SQL e catálogos remotos | Conforme; sem bypass de proprietário |
| Privacidade dos arquivos | ATUAL | 0018 e regressão de referência forjada | Corrigida localmente; publicação pendente |
| Buckets privados | ATUAL | Catálogos de Storage | Quatro privados locais; `content` editorial público |
| Colaboração e convites | ATUAL | RPCs 0008, contratos, testes | Conforme; papéis por viagem |
| Transferência e saída do owner | ATUAL | 0014 e testes SQL | Conforme localmente; remoto sem 0014 |
| Fila dos cinco domínios | ATUAL | Persistência, hook e executor | Conforme após guarda de identidade |
| Seis categorias de IA | ATUAL | Protocolo, parser e executor | Conforme localmente |
| Separação READ×WRITE | ATUAL | Gate servidor e cliente, testes de intent | Conforme localmente; Function publicada sem gate |
| Três validações de IA | ATUAL | Servidor, cliente/revisão, executor | Conforme |
| Confirmação humana visual | ATUAL | Advisor e regressões de interface | Corrigida; conversa sozinha não persiste |
| Sem ações destrutivas do modelo | ATUAL | Allowlist de seis ações de criação | Conforme; undo explícito não é ferramenta do modelo |
| `journal.add` privado | ATUAL | Defaults, contexto, executor e testes | Conforme; diário existente excluído do contexto |
| Valores de IA como estimativa | ATUAL | Protocolo, parser, preview e descrição | Corrigido; `estimated=false` não comprova preço |
| `journal.add` fora de origin/main | REVALIDAÇÃO | HEAD/origin/main observados | Diferença temporal legítima: já integrado |
| Remoto na 0012 / quatro Functions | REVALIDAÇÃO | API Supabase e SELECTs de catálogo | Confirmado; nenhuma escrita remota |
| Números dos testes do TCC | REVALIDAÇÃO | Seção 15 desta auditoria | Separados da execução atual; nenhum teste excluído |
| Documentação interna | ATUAL | README e notas nos runbooks | Corrigida; fontes históricas preservadas |
| Avaliação com usuários e Gemini real | Limitação declarada | Protocolos e execução offline | Não executada; não alegada como concluída |

## 17. Pendências reais

1. **Publicação separada:** remoto permanece na 0012. Migrations 0013–0018,
   `delete-account` e `send-push`, além de atualização das Functions existentes,
   exigem uma tarefa de publicação própria. Em particular, o gate READ×WRITE e
   a proteção adicional de Storage não devem ser apresentados como publicados.
   Nenhuma dessas operações foi executada nesta auditoria.
2. **Dados legados de arquivos:** a 0018 impede novas referências forjadas e
   alterações do vínculo, sem reescrever linhas antigas. Uma futura publicação
   deve examinar referências legadas no ambiente de destino antes de afirmar
   que todos os dados existentes satisfazem o novo vínculo. Não se consultaram
   arquivos ou conteúdo privado dos usuários remotos.
3. **Limitações de avaliação preservadas:** Gemini real, estudo com usuários,
   desempenho em dispositivo físico e comportamento de notificações no aparelho
   continuam fora da evidência produzida. Testes sintéticos não resolvem essas
   lacunas descritas no TCC.
4. **Warnings existentes:** ESLint de todo o checkout registra 11 warnings e
   zero erros. Não se desativaram regras nem se reduziram escopos para ocultá-los.
5. **Infraestrutura local da E2E:** os 11 roteiros passaram na pilha adaptada,
   mas a subida integral padrão ficou bloqueada por Logflare/Vector. Para
   repetir exatamente o runner padrão neste ambiente, ainda é necessário
   resolver a saúde desses serviços e a convivência dos firewalls Docker.

## 18. Veredito final

🟠 CORREÇÕES APLICADAS — AINDA EXISTEM PENDÊNCIAS

As contradições funcionais identificadas no código local foram corrigidas, com
regressões para confirmação da IA, estimativas, troca de identidade offline e
vínculos de arquivos. Permanecem a publicação remota, fora do escopo desta
sessão, e o bloqueio da infraestrutura de logs na subida E2E padrão, embora
todos os roteiros tenham passado na pilha local adaptada. As limitações de
avaliação do TCC continuam explícitas. Não houve alteração do TCC, commit,
push, deploy ou escrita no Supabase remoto.
