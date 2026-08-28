# INCONSISTÊNCIAS E PENDÊNCIAS — TCC EASY TRIP V5

Registro da rodada de fechamento técnico. Cada pendência da rodada anterior foi reauditada contra o código, o banco e o ambiente publicado, e classificada como **resolvida**, **pendência real** ou **não verificada**. Nada foi removido sem evidência, e nenhuma limitação legítima foi ocultada para encurtar a lista — a lista, aliás, **cresceu**.

Data: 2026-08-28 · HEAD ao final `d2e6a3b` · `origin/main` permanece em `a092429` (sem autorização de *push*) · árvore de trabalho limpa após cada *commit*, modificada no momento em que este relatório é escrito.

Repositório: https://github.com/jp9141joao/easy-trip-3.0 (ramo `main`).

---

# PARTE I — RESOLVIDAS NESTA RODADA

## PEND-04 — Suíte de ponta a ponta não executada

**Estado anterior:** BLOQUEADO_POR_INFRAESTRUTURA. 292 blocos inventariados, nunca executados.

**Estado atual:** **RESOLVIDO.**

**Diagnóstico da causa.** O impedimento não era o código dos testes. A pilha de teste era remontada por baixo dos contêineres em execução: o diretório de trabalho era apagado e recriado com a pilha de pé, os contêineres continuavam montando o *inode* antigo — já removido — e passavam a enxergar uma pasta vazia. O sintoma era o `edge_runtime` respondendo 503 `failed to determine entrypoint`, que se parece com falha de compilação do Deno e não com uma montagem órfã.

**Resolução.** `scripts/e2e/` monta uma pilha Supabase dedicada (`easy-trip-e2e`, portas 54420–54429, volumes próprios), que convive com o ambiente de desenvolvimento do autor sem tocá-lo. `e2e-stop.sh` usa `--no-backup` — sem o que o CLI restauraria, na subida seguinte, as contas da execução anterior.

**Evidência:** 11 arquivos, 11 executados, **403 asserções, 0 falhas, 0 ignoradas**. Relatório completo em `E2E_EXECUTION_REPORT.md`.

**Ressalva mantida:** a execução é **local**. O comportamento da API publicada continua não verificado — ver PEND-16.

---

## PEND-07 — Risco de remoção em cascata e ausência de transferência de propriedade

**Estado anterior:** a pendência funcional mais grave. `trips.user_id` cascateia; excluir a conta do dono de uma viagem compartilhada apagaria dado dos demais participantes.

**Estado atual:** **RESOLVIDO NO CÓDIGO. PUBLICAÇÃO PENDENTE.**

**O que foi feito.** *Migration* 0014: `transfer_trip_ownership` grava as duas origens de autorização de `is_trip_owner` na mesma transação, e `account_deletion_blockers` lista as viagens que impedem a exclusão. `delete-account` recusa antes de apagar qualquer arquivo.

**Evidência:** 38 asserções SQL + 30 de ponta a ponta, incluindo a sequência completa: recusa, transferência, exclusão permitida, e a viagem do outro participante sobrevivendo.

**Contraprova executada:** removida a atualização de `trips.user_id`, a suíte interrompe na asserção 14 com a mensagem `trips.user_id passou para o novo proprietário`.

**O que permanece:** a 0014 **não está publicada** — ver PEND-06.

---

## PEND-10 — Sem fila de escrita fora de rede

**Estado atual:** **RESOLVIDO, COM ESCOPO DECLARADO.**

**Evidência:** 78 casos Jest, entre eles o ciclo inteiro atravessando o disco — cria offline, edita, fecha o aplicativo, abre, conecta, sincroniza, erro temporário, tenta de novo, sai, troca de conta — e a asserção que mais importa: a sessão de uma conta nunca drena a fila de outra, nem quando a fila errada é carregada por engano.

**Escopo, dito para que não seja lido como mais do que é:** roteiro, lista de preparação, despesas, diário e metas. **Não cobre** exclusão de conta, transferência de propriedade, alteração de papel, convites, administração e envio de arquivos. Ver PEND-19.

---

## PEND-11 — Avisos apenas dentro do aplicativo

**Estado atual:** **RESOLVIDO NO CÓDIGO. PUBLICAÇÃO E VALIDAÇÃO EM APARELHO PENDENTES.**

**Evidência:** 29 asserções SQL + 25 de ponta a ponta + 43 casos Jest.

**O que permanece:** a 0016 e a função de envio não estão publicadas (PEND-08), e **não houve entrega verificada em aparelho físico** (PEND-18). Gerar um endereço de entrega não é prova de que a notificação chega.

---

## PEND-06a — Ausência de integração contínua

**Estado atual:** **RESOLVIDO.**

Três fluxos versionados. `ci.yml` e `e2e.yml` não usam segredo de produção, o que é propriedade e não limitação. `deploy.yml` publica somente por acionamento manual, a partir de `main`, com regressão completa antes e aprovação humana depois.

**Ressalva registrada no próprio arquivo:** a trava real é a configuração do *environment* `production` com revisor obrigatório. Sem ela, o fluxo é um botão, não uma trava.

---

## PEND-06b — Ausência de medição de desempenho

**Estado atual:** **PARCIALMENTE RESOLVIDO.** Ver PEND-17.

---

## INC-15 — Agendamento do resumo diário sem mecanismo seguro

**Estado anterior:** o cabeçalho da função trazia um `cron.schedule` comentado, com a service role escrita no meio do comando.

**Estado atual:** **MECANISMO RESOLVIDO. AGENDAMENTO NÃO CRIADO.**

`cron.job.command` guarda o comando como texto. A 0015 agenda uma linha sem segredo, e a função lê as credenciais do Vault na execução. 39 asserções, entre elas a que dá nome ao arquivo: nenhuma credencial aparece em `cron.job.command`.

**O que permanece:** o trabalho de agendamento **não foi criado** no ambiente publicado. Ver PEND-05.

---

## INC-16 — Divulgação de configuração a chamador não autenticado

**Tipo:** DEFEITO ENCONTRADO E CORRIGIDO NESTA RODADA.

`admin-generate-content` verificava a chave do provedor de IA **antes** de autenticar, respondendo 503 "o serviço de IA não está configurado" a qualquer chamador sem credencial.

**Severidade:** baixa. Nenhum dado de usuário; é informação de implantação.

**Como foi encontrado:** `scripts/security-probe.mjs` esperava 401/403 de toda Edge Function sem credencial.

**Correção:** a verificação foi movida para depois da autenticação e da autorização por papel. A regressão prende a ordem nas **três** funções com credencial de servidor. Contraprova executada.

**O que permanece:** a correção **não está publicada** — ver PEND-09.

---

# PARTE II — PENDÊNCIAS REAIS

## Grupo A — dependem de pessoas. Nenhuma resolvida.

### PEND-01 — Ausência de avaliação com usuários

**Tipo:** PREPARADO_MAS_EXIGE_EVIDENCIA_HUMANA.

`USER_EVALUATION_PROTOCOL.md` traz perfis, critérios de inclusão e exclusão, nove tarefas, roteiro do pesquisador, SUS, consentimento, anonimização, plano de análise, critérios de interrupção e tratamento de desistência. `USER_EVALUATION_RESULTS_TEMPLATE.md` está **vazio**.

**Nenhum participante foi recrutado. Nenhuma sessão foi conduzida. Nenhum dado foi coletado.**

**Esta pendência NÃO é reduzida pela existência do protocolo.** Ter um instrumento não é ter um resultado, e o próprio documento começa dizendo isso.

**O que falta:** aprovação ética quando aplicável, recrutamento, piloto, 8–12 sessões, análise.

### PEND-02 — Sem teste de intrusão independente

**Tipo:** PREPARADO_MAS_EXIGE_EVIDENCIA_HUMANA.

Foi conduzida uma avaliação **interna** orientada pelo MASVS 2.1.0: 24 controles, 16 com evidência automatizada, 5 por revisão, 1 inaplicável com justificativa, 1 parcial, 1 não verificado, **1 defeito encontrado e corrigido**.

**O TCC não declara conformidade ao MASVS**, e o documento de avaliação começa dizendo que não é pentest. Não houve avaliador independente, análise de binário nem tentativa de exploração além de leitura e chamadas malformadas.

**O que falta:** avaliador externo.

### PEND-03 — Sem avaliação humana da qualidade do conteúdo da IA

**Tipo:** PREPARADO_MAS_EXIGE_EVIDENCIA_HUMANA.

O instrumento mede as **defesas** — 18 cenários sintéticos, 18 aprovados — e não a utilidade dos roteiros. Uma rubrica de cinco dimensões foi preparada e **não aplicada**.

**O que falta:** dois avaliadores independentes, ≥ 20 roteiros, 4 destinos.

### PEND-18 — Notificação não validada em aparelho físico

**Tipo:** BLOQUEADO_POR_INFRAESTRUTURA.

Implementado e testado automaticamente. **Sem entrega verificada em Android real**: não há *build* de desenvolvimento com credencial de notificação nesta rodada.

**O que falta:** *build* EAS com credencial e um aparelho.

### PEND-20 — Camada de avaliação do modelo real não executada

**Tipo:** BLOQUEADO_POR_INFRAESTRUTURA.

`GEMINI_API_KEY` não estava disponível. **Nenhum número foi estimado no lugar**: a seção correspondente do relatório declara "NÃO EXECUTADA". O executor traz teto de chamadas para quando houver chave.

## Grupo B — dependem de autorização de publicação

Todas confirmadas por inspeção remota somente leitura: o projeto publicado está na *migration* **0012** e possui **4 das 6** Edge Functions.

### PEND-05 — *Migration* 0013 não publicada
**Tipo:** IMPLEMENTADO_LOCALMENTE_PUBLICACAO_PENDENTE. Capa e meta diária. **4 RF** não operam em produção.

### PEND-06 — *Migration* 0014 não publicada
**Tipo:** IMPLEMENTADO_LOCALMENTE_PUBLICACAO_PENDENTE. Transferência de propriedade e guarda de exclusão. **3 RF** não operam em produção. É a mais consequente do grupo: enquanto não for publicada, o defeito de cascata descrito em PEND-07 permanece alcançável no ambiente publicado — mitigado apenas por `delete-account` também não estar publicada.

### PEND-07b — *Migration* 0015 e agendamento não criado
**Tipo:** IMPLEMENTADO_LOCALMENTE_PUBLICACAO_PENDENTE. O resumo diário continua sem ser disparado sozinho.

### PEND-08 — *Migration* 0016 e função de envio não publicadas
**Tipo:** IMPLEMENTADO_LOCALMENTE_PUBLICACAO_PENDENTE. **3 RF** não operam em produção.

### PEND-09 — `delete-account` não publicada e correção de segurança não publicada
**Tipo:** IMPLEMENTADO_LOCALMENTE_PUBLICACAO_PENDENTE.

Do ponto de vista do titular dos dados, a exclusão de conta continua sendo a pendência mais séria — com a diferença de que **a razão mudou**: antes era retida porque publicá-la tornaria alcançável um defeito conhecido; agora o defeito está corrigido, e o que falta é publicar a correção junto.

A correção de INC-16 também não está publicada: a versão publicada da função afetada ainda é a anterior.

## Grupo C — pendências técnicas em aberto

### PEND-16 — Toda a evidência de execução vem de ambientes locais

**Tipo:** PENDENCIA_REAL.

As 265 asserções de banco e as 403 de ponta a ponta rodam contra pilhas descartáveis, e as suítes recusam por construção qualquer endereço não local, porque criam e apagam dados. **O ambiente publicado não foi medido sob nenhuma delas.**

Este é o risco que **substitui** o antigo "teste escrito e não executado", e é preciso nomeá-lo para que a resolução de PEND-04 não seja lida como mais do que é.

### PEND-17 — Medição de desempenho parcial

**Tipo:** PARCIALMENTE_RESOLVIDO.

Há medição reprodutível das funções de domínio e da leitura do *backend* local, com N, média, mediana e p95, e o tamanho do *bundle* Hermes (8,36 MB). **Não há medição em aparelho**: tempo de partida, taxa de quadros e consumo de memória exigem Android instrumentado, e nenhum foi estimado. Não há linha de base histórica — esta é a primeira medição.

### PEND-19 — Fila offline com escopo declarado

**Tipo:** PENDENCIA_REAL_DECLARADA.

Exclusão de conta, transferência de propriedade, alteração de papel, convites, administração e envio de arquivos continuam exigindo conexão. Cada exclusão tem motivo registrado em código. **Não é correto afirmar que o aplicativo funciona integralmente fora de rede**, e o TCC não o afirma.

### PEND-21 — Vulnerabilidades em dependências de desenvolvimento

**Tipo:** PENDENCIA_REAL.

21 ocorrências, 0 críticas, 9 altas — todas em cadeia de compilação (`metro`, `@expo/cli`, `postcss`, `image-size`), nenhuma no caminho de execução do aplicativo publicado. Isso **reduz** a severidade prática, não a elimina.

`npm audit fix --force` não foi executado: traria mudança de versão maior do Expo, que não se faz junto com um fechamento.

### PEND-12 — Ausência de monitoração de execução
### PEND-13 — Ausência de política automática de retenção de dados

**Tipo:** PENDENCIA_OPERACIONAL. Inalteradas. A segunda continua sendo a única limitação arquitetural não declarada em comentário no próprio código.

---

# PARTE III — NÃO VERIFICADO

## NV-01 — Comportamento do ambiente publicado sob as suítes

Não verificado, e **não verificável sem autorização**: as suítes escrevem e apagam dados, e testes destrutivos em produção estão proibidos. Mesmo com autorização de publicação, esta continuaria sendo a resposta correta.

## NV-02 — Assinatura e *build* de release (MASVS-CODE-2)

Exige *build* nativo. Não avaliado.

## NV-03 — Resiliência a engenharia reversa (MASVS-RESILIENCE)

Não avaliado. O MASVS trata esse perfil como opcional, aplicável a aplicativo com requisito de proteção de conteúdo — não é o caso.

## NV-04 — Conformidade WCAG

Apenas inspeção estática. Sem ferramenta automatizada integrada.

---

# PARTE IV — INCONSISTÊNCIAS DOCUMENTAIS CORRIGIDAS

## INC-17 — O número 292

O TCC anterior declarava 292 blocos, sempre com a ressalva de que era contagem estática e não resultado. A recontagem dá **293**, e a execução emite **403**.

A ressalva estava correta, e a distância entre os números mostra por quê: nem mesmo a contagem estática previa o que a execução mediria. O TCC agora registra os três, explica a diferença e **não os soma**.

## INC-18 — "26 funções SQL"

A rodada anterior declarava 26 funções, das quais 23 `security definer`. A medição desta rodada, sobre o esquema completo, dá **75 funções** e **34 `security definer`**. A divergência é de instrumento: a contagem anterior media um subconjunto. O número atual vem de consulta ao catálogo, por roteiro versionado.

## INC-19 — Nome do repositório

O TCC anterior usava `easy-trip` como nome canônico, com nota de que o remoto local apontava para `easy-trip-3.0`. A verificação desta rodada mostra que **`easy-trip-3.0` é o nome atual do remoto**, e o TCC passou a usá-lo.

## INC-20 — Módulos: quatorze → quinze

"Trabalho fora de rede" passou a ser um módulo do Quadro 4, e a conclusão foi ajustada.

---

# RESUMO

| Categoria | Quantidade |
|---|---:|
| Resolvidas nesta rodada | 8 |
| Parcialmente resolvidas | 1 (medição de desempenho) |
| Pendências que dependem de pessoas | 5 |
| Pendências que dependem de publicação | 5 |
| Pendências técnicas em aberto | 6 |
| Não verificado | 4 |
| Inconsistências documentais corrigidas | 4 |

**A lista de pendências cresceu.** Isso é o resultado esperado de construir com autorização de publicação negada: cada frente nova acrescenta uma pendência de publicação. Um relatório que quisesse encurtar a lista teria construído menos, ou teria publicado sem autorização.
