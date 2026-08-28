# Avaliação interna de segurança — Easy Trip

**Referência:** OWASP MASVS 2.1.0
**Data:** 28 de agosto de 2026
**Commit avaliado:** `5cb77d6` (+ a correção de MASVS-CODE-4 descrita na seção 5)
**Avaliador:** a própria equipe de desenvolvimento do projeto

---

## 0. O que esta avaliação é — e o que ela não é

> **Isto NÃO é um teste de invasão.** Não houve avaliador independente, não
> houve tentativa de exploração além de leitura e de chamadas malformadas, e
> não houve análise de binário, engenharia reversa nem instrumentação de
> aparelho. O alvo foi o código-fonte e uma pilha Supabase **local**.
>
> O nome correto do que está aqui é **avaliação interna orientada pelo MASVS**.
> Em nenhum lugar deste documento, nem do TCC, o projeto se declara "conforme"
> ou "certificado" pelo MASVS: a conformidade formal exige verificação por
> terceiro (MASVS-Verification), que não ocorreu.

O que a avaliação sustenta é mais modesto e mais verificável: para cada
controle relevante, existe uma evidência executável no repositório, ou está
escrito que não existe.

### Escalas usadas

| Estado | Significado |
|---|---|
| **PASS** | Há controle implementado **e** evidência automatizada que falha se ele for removido. |
| **PASS (revisão)** | Controle implementado e verificado por leitura de código; sem teste dedicado. |
| **N/A** | O controle não se aplica à arquitetura deste aplicativo. |
| **NÃO VERIFICADO** | Aplica-se, mas exige ferramenta ou ambiente indisponíveis nesta rodada. |
| **FAIL** | Defeito encontrado. |

---

## 1. Como a avaliação foi feita

| Instrumento | O que cobre | Onde está |
|---|---|---|
| Sondagem sem credencial | 42 verificações do que responde a quem não se autenticou: tabelas, RPC, Vault, Storage, Edge Functions | `scripts/security-probe.mjs` |
| Suítes de RLS | 167 asserções de policy com identidade simulada, incluindo a matriz owner/editor/viewer/estranho | `supabase/tests/*.test.sql` |
| Ponta a ponta por HTTP | 403 asserções contra PostgREST, Storage, Auth e Edge Functions reais | `supabase/tests/*_e2e.mjs` |
| Testes de unidade | 1.686 casos, entre eles autorização de função, saneamento de texto de push, classificação de falha da fila | `tests/` |
| `npm audit` | Dependências | seção 6 |
| Varredura de segredos | `service_role`, chave de API, senha, token embutido | seção 4 |

Tudo reprodutível:

```
./scripts/sql-test.sh
./scripts/e2e/e2e-run.sh
source scripts/e2e/e2e-env.sh && e2e_export_keys && node scripts/security-probe.mjs
npx jest --runInBand
npm audit
```

---

## 2. MASVS-STORAGE — armazenamento

| # | Controle | Estado | Evidência |
|---|---|---|---|
| STORAGE-1 | Dado sensível não vai para armazenamento não protegido | **PASS** | Três níveis separados em `src/lib/storage.ts`: `secureStorage` (SecureStore) só para sessão e token; `jsonStorage` para dado do usuário; `prefsStorage` para preferência. Limpar cache não desloga, e deslogar não apaga preferência. |
| STORAGE-1 | Sessão em armazenamento protegido | **PASS** | `expo-secure-store` (Keychain/Keystore). `tests/unit/auth-session.test.tsx`. |
| STORAGE-2 | Dado sensível não vaza para log | **PASS (revisão)** | Nenhum `console.log` de token ou senha. As Edge Functions registram `{ userId, código }`, nunca o corpo nem a credencial. |
| STORAGE-2 | Fila offline separada por conta | **PASS** | Chave por conta **e** `userId` em cada item; `drainableFor` filtra por sessão. `tests/integration/offline-queue-lifecycle.test.ts` — "a sessão do Bento não drena a fila da Alice". |

## 3. MASVS-CRYPTO — criptografia

| # | Controle | Estado | Evidência |
|---|---|---|---|
| CRYPTO-1 | Criptografia padrão, sem implementação própria | **PASS (revisão)** | Nenhuma primitiva escrita à mão. Hash e sessão são do GoTrue; `expo-crypto` só para UUID v4; o Vault usa `pgsodium`. |
| CRYPTO-2 | Chaves geridas com segurança | **PASS** | Segredo de cron e de push no Vault do Postgres, decifrado no momento da execução — nunca em `cron.job.command`. `supabase/tests/briefing_schedule.test.sql`, §6. |

## 4. MASVS-AUTH — autenticação e autorização

| # | Controle | Estado | Evidência |
|---|---|---|---|
| AUTH-1 | Autenticação no servidor, não no cliente | **PASS** | Toda autorização é RLS no Postgres. `src/domain/collaboration.ts` diz no cabeçalho que apagá-lo inteiro deixa o produto feio, não inseguro. |
| AUTH-1 | Identidade nunca vem do corpo da requisição | **PASS** | Todas as funções `security definer` leem `auth.uid()`. `register_push_token` sequer tem parâmetro de usuário. `functions_http_e2e.mjs` §9: papel forjado no *payload* não promove viewer. |
| AUTH-2 | Sessão gerida com segurança | **PASS** | Renovação e revogação pelo GoTrue; `onAuthStateChange` reage à revogação externa. `auth_e2e.mjs`, 33 asserções. |
| AUTH-3 | Autorização por papel aplicada no servidor | **PASS** | Matriz owner/editor/viewer/estranho: `rls_collaboration.test.sql` (92) e `rls_matrix_e2e.mjs` (74). |
| AUTH-3 | Escalada de papel impedida | **PASS** | `set_trip_member_role` recusa promover a `owner`; `profiles.role` tem barreira dupla (0003/0006). Transferência de propriedade só pelo dono e só para membro aceito: `ownership_transfer.test.sql` (38). |
| AUTH-3 | Privilégio do proprietário **não** vaza para conteúdo privado | **PASS** | A asserção que a suíte de colaboração existe para prender: o dono NÃO lê o diário privado dos membros. Preservado após transferência — `ownership_transfer.test.sql` §8. |

## 5. MASVS-NETWORK — rede

| # | Controle | Estado | Evidência |
|---|---|---|---|
| NETWORK-1 | TLS em todo tráfego | **PASS (revisão)** | Todo endpoint é `https://`. Nenhum `http://` fora de `127.0.0.1` nos testes, e cada suíte E2E **recusa** alvo não-local (§53). |
| NETWORK-2 | *Certificate pinning* | **N/A** | Não adotado. Para um aplicativo que fala com o Supabase gerido, o *pinning* troca um risco improvável por uma indisponibilidade provável na rotação de certificado. Registrado como decisão, não como omissão. |

## 6. MASVS-PLATFORM — plataforma

| # | Controle | Estado | Evidência |
|---|---|---|---|
| PLATFORM-1 | IPC e *deep link* tratados como entrada não confiável | **PASS** | `src/lib/deepLink.ts` e `authLinking.ts` validam esquema e parâmetro. `readDestination` (push) descarta tipo inesperado — `tests/unit/push-notifications.test.ts`, "um data com tipo errado não vira rota". |
| PLATFORM-1 | Link profundo não contorna a proteção de rota | **PASS (revisão)** | A navegação por notificação passa pelo mesmo guarda da raiz que qualquer rota. |
| PLATFORM-2 | Entrada do usuário validada | **PASS** | `zod` nos formulários; `CHECK` no banco; validação também nas funções (`register_push_token` recusa token vazio e plataforma desconhecida). |
| PLATFORM-3 | Dado sensível não exposto na interface do sistema | **PASS** | O texto do push é cortado antes de sair: valor em dinheiro, e-mail, telefone e sequência longa de dígitos não chegam à tela de bloqueio. 12 asserções em `tests/unit/push-notifications.test.ts`. Canal Android com `lockscreenVisibility: PRIVATE`. |

## 7. MASVS-CODE — qualidade e implementação

| # | Controle | Estado | Evidência |
|---|---|---|---|
| CODE-1 | Dependências atualizadas | **PARCIAL** | Ver seção 9. 21 vulnerabilidades, todas em cadeia de desenvolvimento. |
| CODE-2 | Aplicativo assinado, build de release | **NÃO VERIFICADO** | Exige *build* nativo (EAS), fora do alcance desta rodada. |
| CODE-3 | Sem segredo embutido | **PASS** | Varredura na seção 8: zero literais com forma de chave. `src/lib/config.ts` vai além e **detecta** uma `service_role` colada no lugar da chave pública, recusando-a com mensagem própria. |
| CODE-4 | Erro tratado sem vazar informação | **FAIL → CORRIGIDO** | Ver abaixo. |

### O defeito encontrado

**MASVS-CODE-4 — divulgação de estado de implantação a chamador não autenticado**

`supabase/functions/admin-generate-content/index.ts` verificava a presença de
`GEMINI_API_KEY` **antes** de autenticar. Qualquer requisição sem credencial
recebia:

```
HTTP 503  {"error":"O serviço de IA não está configurado neste ambiente."}
```

Um chamador anônimo aprendia se a chave do provedor estava configurada naquela
implantação. Não há dado de usuário no vazamento, e a severidade é baixa — mas
é informação de infraestrutura entregue a quem não provou ser ninguém, e é
exatamente o princípio que outra função do mesmo projeto já enunciava:

> *"Um JWT comum continua sendo 403 mesmo se o segredo do cron não tiver sido
> instalado neste ambiente. Configuração interna não é informação para um
> chamador sem privilégio — e auth nunca pode virar 503 por acaso."*
> — `supabase/functions/trip-daily-briefing/protocol.ts`

**Correção:** a verificação foi movida para depois da autenticação e da
autorização por papel. Sem credencial → 401; não-admin → 403; só quem passou
pelas duas descobre se a chave existe.

**Regressão:** `tests/unit/push-notifications.test.ts`, "configuração nunca
vaza para quem não se autenticou", prende a ordem nas **três** funções com
credencial de servidor. Contraprova executada: repondo a checagem antes da
autenticação, o teste falha apontando a função.

**Como foi encontrado:** `scripts/security-probe.mjs` esperava 401/403 de toda
Edge Function sem credencial e recebeu 503.

## 8. MASVS-PRIVACY — privacidade

| # | Controle | Estado | Evidência |
|---|---|---|---|
| PRIVACY-1 | Minimização de dado | **PASS** | `trip_member_profiles` devolve id e nome, e nada mais — `profiles` guarda telefone, cidade e estilo de viagem, e a policy não é afrouxada por causa de uma lista de viajantes. |
| PRIVACY-1 | Conteúdo privado é privado, inclusive do dono | **PASS** | `visibility`/`created_by` (0009), sem exceção de proprietário. 92 asserções. |
| PRIVACY-2 | Exclusão de conta remove o dado | **PASS** | `delete-account` expurga arquivos, confere que sobrou zero e só então apaga a conta. `delete_account_e2e.mjs`, 18 asserções. |
| PRIVACY-2 | Exclusão de conta **não** destrói dado de terceiros | **PASS** | Corrigido nesta rodada. `trips.user_id` cascateia; excluir o dono de uma viagem compartilhada apagava as despesas e o diário dos OUTROS membros. `account_deletion_blockers` recusa; `ownership_transfer_e2e.mjs` §26 prova que a viagem do outro sobrevive. |
| PRIVACY-3 | Consentimento antes de coletar | **PASS (revisão)** | Permissões pedidas no uso: localização ao abrir o mapa, fotos ao anexar, notificação num controle em Configurações — nunca na abertura. |
| PRIVACY-4 | Dado sensível fora de aviso do sistema | **PASS** | Ver PLATFORM-3. |

## 9. Dependências (`npm audit`)

**21 vulnerabilidades: 0 críticas, 9 altas, 12 moderadas.**

| Pacote | Sev. | Direto? | Natureza |
|---|---|---|---|
| `expo`, `@expo/cli`, `@expo/metro*`, `metro*` | alta | via `expo` | Cadeia do *bundler*. |
| `image-size` | alta | não | Negação de serviço no *parser* ICNS. |
| `postcss` | alta | não | XSS no *stringify* de CSS. |
| `uuid` | moderada | não | Limite de *buffer* em v3/v5/v6 com `buf`. |

**Leitura honesta:** todas são de **ferramenta de desenvolvimento**, não do
código que vai no aparelho. `metro`, `@expo/cli` e `postcss` rodam na máquina
de quem compila; `image-size` é usado pelo *bundler*. Nenhuma está no caminho de
execução do aplicativo publicado. Isso **reduz** a severidade prática — não a
elimina: uma cadeia de compilação comprometida é um vetor real, e o `npm audit`
entrou na CI para que a lista não cresça sem ninguém ver.

`npm audit fix --force` não foi executado: ele traria mudança de versão maior do
Expo, que é exatamente o tipo de alteração que não se faz junto com um
fechamento. Fica registrado como pendência.

## 10. O que NÃO foi avaliado

| Área | Por quê |
|---|---|
| Análise de binário, anti-*tampering*, detecção de *root* (MASVS-RESILIENCE) | Exige APK assinado e ferramenta de engenharia reversa. O MASVS trata RESILIENCE como perfil opcional, aplicável a aplicativo com requisito de proteção de conteúdo — não é o caso. |
| Segurança em aparelho real | Sem Android físico instrumentado nesta rodada. |
| Ambiente de produção | Nenhuma sondagem foi feita contra o Supabase hospedado. Toda evidência é de pilha local. |
| Análise estática dedicada (SAST) | Só ESLint e o compilador TypeScript em modo estrito. Nenhuma ferramenta de segurança específica. |
| Fuzzing de entrada | Não realizado. |
| Revisão independente | **Nenhuma.** É a limitação que define este documento. |

## 11. Resumo

| | |
|---|---:|
| Controles avaliados | 24 |
| PASS (com teste) | 16 |
| PASS (por revisão) | 5 |
| N/A com justificativa | 1 |
| PARCIAL | 1 |
| NÃO VERIFICADO | 1 |
| **FAIL encontrados** | **1** — corrigido, com regressão e contraprova |

**Conclusão:** a autorização deste projeto mora no PostgreSQL, e é lá que ela
foi medida — 167 asserções de RLS e 403 de ponta a ponta contra o servidor de
verdade. O único defeito encontrado não expunha dado de usuário.

O que esta avaliação **não** autoriza dizer é que o Easy Trip é seguro. Ela
autoriza dizer que os controles listados existem, que há evidência executável
para a maioria deles, e que uma revisão independente continua ausente.
