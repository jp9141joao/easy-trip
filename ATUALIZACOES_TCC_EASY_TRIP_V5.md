# ATUALIZAÇÕES — TCC EASY TRIP V5

Relatório das alterações aplicadas ao `tcc_easy_trip_v5.md` na **rodada de fechamento técnico** de 28 de agosto de 2026.

---

## 1. Versão analisada

| Item | Valor |
|---|---|
| Repositório | `easy-trip-3.0` — https://github.com/jp9141joao/easy-trip-3.0 |
| Branch | `main` |
| HEAD no início da rodada | `a092429ba695ba106f44cced9cfb72f68bae17b6` (`a092429`) — idêntico a `origin/main`, árvore limpa |
| HEAD ao final | `d2e6a3b0e4846cfbd506c52f72c0491d3b851a75` (`d2e6a3b`) |
| `origin/main` | **`a092429`** — o remoto **não** foi atualizado. `AUTORIZAR_PUSH_GITHUB = NÃO` |
| Working tree | limpa no início; limpa após cada *commit*; modificada no momento em que este relatório é escrito, pela atualização documental |
| `git diff --check` | limpo |
| Data | 2026-08-28 |

### *Commits* desta rodada

```
d2e6a3b chore: recount every artifact from the source of truth
ce25dc3 docs: add AI evaluation and user study protocol
8395004 fix: keep the e2e workdir out of the lint
161982c fix: authenticate before reporting provider configuration
5cb77d6 feat: add push notification support
cad8063 feat: add durable offline mutation queue
2fa37f9 feat: schedule the daily briefing without leaking the secret
f2ca286 ci: add quality validation and gated publish workflows
```

Todos locais. **Nenhum foi publicado**, por ausência de autorização de *push*. A recuperação por terceiros exige, portanto, acesso ao repositório local — o que é a única regressão de reprodutibilidade desta rodada em relação à anterior, e é declarada como tal em INC-15 do documento de inconsistências.

### Autorizações vigentes

| Flag | Valor | Consequência |
|---|---|---|
| Commits locais | **SIM** | Sete *commits* criados |
| Push para o GitHub | NÃO | `origin/main` permanece em `a092429` |
| Aplicar *migrations* em produção | NÃO | 0013–0016 permanecem não publicadas |
| Publicar Edge Functions em produção | NÃO | `delete-account` e `send-push` não publicadas; a correção de segurança de `admin-generate-content` não publicada |
| Configurar cron em produção | NÃO | O agendamento do resumo diário não foi criado no ambiente remoto |
| Testes destrutivos em produção | NÃO | Nenhuma escrita foi feita contra o ambiente publicado. Toda execução usou pilhas locais descartáveis |

---

## 2. O que mudou no produto

Sete frentes, todas com teste e todas com o motivo registrado em código.

### 2.1 Transferência de propriedade (*migration* 0014)

Resolve a lacuna funcional §50 e, com ela, um **defeito estrutural que nenhuma política de acesso poderia impedir**.

`public.trips.user_id` referencia `auth.users` com `on delete cascade` (0001). A exclusão da conta do proprietário de uma viagem compartilhada apagaria a viagem inteira — com as despesas, o diário e o roteiro **dos demais participantes**. A cascata acontece abaixo da RLS.

A dificuldade técnica está em `is_trip_owner` (0008), que responde afirmativamente por **duas** origens: o papel em `trip_members` **ou** `trips.user_id`. Promover alguém em `trip_members` não transfere nada — o antigo dono continuaria dono pela segunda origem, e a viagem passaria a ter dois. A função grava as duas na mesma transação, com travamento das linhas para serializar transferências simultâneas.

Regras: só o dono transfere; só quem já aceitou o convite recebe (convite pendente não tem linha em `trip_members`, e é essa a regra, sem consulta extra); o antigo dono vira editor e permanece na viagem; nenhum conteúdo privado muda de dono.

### 2.2 Guarda de exclusão de conta

`account_deletion_blockers()` devolve as viagens em que a sessão é proprietária e há outros participantes. A mesma consulta serve à tela e à Edge Function, deliberadamente: consultas diferentes divergiriam um dia, e a tela diria "pode excluir" para um pedido que o servidor recusa.

`delete-account` recusa **antes** de apagar qualquer arquivo, respondendo 200 com `{ ok: false, reason: 'ownership-blocked' }`. Não 409: `supabase-js` entrega não-2xx sem corpo, e a tela leria "erro de rede, tente de novo" — a leitura errada, porque tentar de novo nunca funcionaria. Falha fechado se a 0014 não estiver aplicada.

Nenhum novo proprietário é escolhido automaticamente.

### 2.3 Execução das suítes de ponta a ponta

O avanço de evidência mais significativo da rodada. Detalhado em `E2E_EXECUTION_REPORT.md`.

### 2.4 Integração e publicação contínuas

Três fluxos de trabalho. `ci.yml` roda a regressão a cada alteração proposta, sem segredo de produção. `e2e.yml` sobe a pilha local sob demanda e diariamente. `deploy.yml` publica **somente** por acionamento manual, a partir de `main`, com a regressão completa antes e aprovação humana depois dela.

### 2.5 Agendamento do resumo diário (*migration* 0015)

`cron.schedule` guarda o comando como texto em `cron.job.command`. Um comando que carregasse a service role a deixaria legível numa tabela que aparece em qualquer dump. O comando agendado é uma linha sem segredo — `select public.dispatch_trip_daily_briefing();` — e é a função que lê as credenciais do Vault no momento da execução.

A *migration* **não agenda e não guarda segredo**: agendar exigiria conhecer a URL e as credenciais, o que devolveria o problema ao Git. O agendamento é ato operacional explícito, e recusa com o nome do segredo que falta se o Vault estiver incompleto.

### 2.6 Fila durável de escrita fora de rede

A fila é o **desvio**, não o caminho: toda escrita tenta ir direto ao servidor, e a fila só entra quando a tentativa falha por algo que pode melhorar sozinho. Não há interruptor consultado antes de escrever — "há rede" e "a escrita vai passar" não são a mesma coisa.

Duas decisões estruturais: a **dobra** (editar a mesma linha quatro vezes sem rede produz uma escrita; criar e apagar produz nenhuma) e o **id gerado no aparelho**, que torna o reenvio idempotente porque a segunda tentativa esbarra na chave primária.

Escopo declarado: roteiro, lista de preparação, despesas, diário e metas. Fora ficam exclusão de conta, transferência de propriedade, papel de membro, convites, administração e arquivos.

### 2.7 Notificações do sistema operacional (*migration* 0016)

A pergunta que definiu as políticas não foi "quem pode ler tokens?", mas "o que um token permite a quem o tem?". É um endereço de entrega: quem o possui faz o telefone de outra pessoa tocar, com o texto que quiser, na tela de bloqueio.

`unique (token)` e não `unique (user_id)`: telefone e tablet recebem nos dois. O `on conflict do update` cobre reinstalação e restauração de backup — o Expo reemite o token, e a linha acompanha quem usa o aparelho agora.

O texto é cortado antes de sair: valor em dinheiro, e-mail, telefone e sequência longa de dígitos não chegam à tela de bloqueio.

---

## 3. Números antigos × números atuais

Todas as contagens de banco são medidas contra uma instância descartável com as *migrations* aplicadas, por consulta aos catálogos, via `scripts/count-artifacts.sh`.

| Métrica | Rodada anterior | Esta rodada | Natureza |
|---|---|---|---|
| Requisitos funcionais | 64 | **74** | 10 acrescentados |
| RF operantes no esquema publicado | 59 | **63** | +4 (fila offline, que não depende de *migration*) |
| RF pendentes de publicação | 5 | **11** | **piorou** — quatro frentes novas trouxeram estrutura de dados |
| Requisitos não funcionais | 61 | **70** | 9 acrescentados |
| RNF com evidência forte | 53 | **59** | |
| Lacunas de RNF | 6 | **5** | CI e medição de desempenho fecharam; monitoração de execução aparece |
| *Migrations* locais | 13 | **16** | |
| *Migrations* publicadas | 12 | **12** | inalterado |
| Tabelas | 25 | **26** | `push_tokens` |
| Políticas | 69 | **77** | |
| Funções do esquema público | 26 | **75** | instrumento diferente: a contagem anterior media um subconjunto |
| Gatilhos | 15 | **16** | |
| Índices | 58 | **61** | |
| Buckets | 4 publicados | **5 no repositório**, 4 publicados | |
| Edge Functions | 5 impl. / 4 publ. | **6 impl. / 4 publ.** | `send-push` |
| Conjuntos Jest | 119 | **124** | |
| Casos Jest | 1.542 | **1.686** | |
| Suítes SQL | 4 | **7** | |
| Asserções SQL | 159 | **265** | |
| Arquivos de ponta a ponta | 9 | **11** | |
| Ponta a ponta | 292 blocos **não executados** | **403 asserções executadas, 0 falhas** | mudança de natureza, não de grandeza |
| Rotas | 47 | **48** | tela de sincronização |

### Sobre 292, 293 e 403

Três números diferentes para a mesma suíte, e nenhum substitui o outro:

- **292** era a contagem estática declarada na rodada anterior;
- **293** é a recontagem estática das chamadas de verificação nos nove arquivos originais;
- **403** é o que a execução emite, nos onze arquivos atuais, porque várias chamadas estão em laços.

O TCC registra os três e não os soma.

---

## 4. Alterações no `tcc_easy_trip_v5.md`

| Seção | Alteração |
|---|---|
| Resumo / Abstract | Revisados **por último**. Números novos, três camadas verificadas por execução, recusa explícita de somá-las, e as limitações remanescentes reescritas |
| 2.5 Quadro comparativo | 26 tabelas, 16 *migrations* |
| 3.2 Quadro 4 | Transferência de propriedade em Colaboração; entrega por notificação em Avisos; módulo novo "Trabalho fora de rede"; nota de publicação reescrita para as cinco dependências |
| 3.3 Arquitetura | Diagrama com 26 tabelas, 75 funções, 77 políticas, 5 buckets, 6 Edge Functions; nota distinguindo esquema **do repositório** de esquema **publicado** |
| 3.4 Modelo de dados | 16 *migrations*, contagens novas, e a distinção entre as doze publicadas e as quatro pendentes |
| 3.7 Reprodutibilidade | **Um único ponto de histórico**, sem separação produto/arcabouço; lista dos seis comandos versionados que reproduzem os números; sexta etapa de procedimento: contraprova |
| 3.8 Métricas | Latência do ambiente publicado e métricas de aparelho continuam descartadas, com a razão; rubrica de avaliação humana registrada como preparada e não aplicada; "teste de intrusão e avaliação formal" reescrito para distinguir avaliação interna de certificação |
| 4.1 | 74 RF, tabela de rastreabilidade com cinco situações, e o registro explícito de que os RF pendentes **cresceram** |
| 4.2 | 70 RNF, quadro dos nove novos, e o fechamento de duas lacunas com a ressalva de que a de desempenho fechou **parcialmente** |
| 4.3 | Tabela 2 com treze verificações; suítes SQL de 4 para 7; **subseção de ponta a ponta inteiramente reescrita**, com a causa do impedimento, as 28 falhas da primeira execução e o resultado final; parágrafo novo sobre contraprova |
| 4.4 | Contagens novas; duas contagens registradas como asserções; avaliação MASVS com o defeito encontrado; distinção entre verificado localmente e verificado em produção; avaliação da validação da IA e o achado sobre medir a camada errada |
| 4.5 Discussão | Reescrita: crescimento dos RF pendentes assumido; três camadas executadas; recusa de somar mantida; dois achados de método novos |
| 4.6 Limitações | **Reorganizada em três grupos** — dependem de pessoas, dependem de publicação, permanecem técnicas. De 11 itens para 15, e o crescimento é honesto |
| Ameaças à validade | Validade interna: as 28 falhas como evidência dos dois sentidos do risco; fragilidade nova declarada (suítes escritas por quem escreveu o produto). Validade de conclusão: risco novo de tratar execução local como evidência sobre produção |
| 5 Conclusão | Quinze módulos; o defeito da cascata em destaque; três camadas executadas; limitações reescritas; trabalhos futuros de quatro para três frentes, com registro de que duas das quatro anteriores foram executadas |

---

## 5. Limitações removidas, mantidas e novas

### Removidas (com evidência)

| Limitação | Por que saiu |
|---|---|
| "Sem fila de escrita fora de rede" | Implementada, com escopo declarado. 78 casos Jest, incluindo o ciclo inteiro atravessando o disco |
| "Avisos apenas dentro do aplicativo" | Implementado. 29 asserções SQL + 25 de ponta a ponta + 43 casos Jest |
| "Risco de remoção em cascata / sem transferência de propriedade" | Corrigido. 38 asserções SQL + 30 de ponta a ponta, com contraprova |
| "Suíte de ponta a ponta não executada" | Executada: 11 arquivos, 403 asserções, 0 falhas |
| "Ausência de integração contínua" | Três fluxos versionados |
| "Ausência de medição de desempenho" | **Parcialmente.** Há medição de domínio e de *backend* local; não há medição em aparelho, e isso virou limitação própria |

### Mantidas integralmente

| Limitação | Estado |
|---|---|
| Ausência de avaliação com usuários | Protocolo pronto, **estudo não executado**. Ter protocolo não é ter resultado |
| Ausência de teste de intrusão independente | Avaliação **interna** conduzida; nenhum avaliador externo |
| Ausência de avaliação humana do conteúdo da IA | Rubrica preparada, **não aplicada** |
| *Migration* 0013 não publicada | Confirmado remotamente |
| Exclusão de conta não publicada | Confirmado remotamente |
| Resumo diário sem agendamento configurado | Mecanismo pronto (0015), agendamento **não criado** no remoto |
| Ausência de monitoração e de política de retenção | Inalteradas |

### Novas

| Limitação | Por quê |
|---|---|
| *Migrations* 0014, 0015 e 0016 não publicadas | Consequência de construir com autorização de publicação negada |
| Função de envio de notificação não publicada | Idem |
| Correção de segurança não publicada | O defeito está corrigido no repositório; a versão publicada é a anterior |
| Sem validação de notificação em aparelho físico | Sem *build* com credencial de notificação |
| Medição de desempenho sem aparelho instrumentado | O que a medição parcial não alcança |
| Fila offline com escopo declarado | Não é correto dizer que o aplicativo funciona integralmente sem rede |
| Vulnerabilidades em dependências de desenvolvimento | 21 ocorrências, todas em cadeia de compilação |
| Toda evidência vem de ambientes locais | O risco simétrico que substitui o de "teste não executado" |

---

## 6. Documentos novos

| Arquivo | Conteúdo | Estado |
|---|---|---|
| `E2E_EXECUTION_REPORT.md` | Causa do impedimento, isolamento, 28 falhas diagnosticadas, resultado final, e o que os testes **não** cobrem | Completo |
| `SECURITY_MASVS_ASSESSMENT.md` | 24 controles do MASVS 2.1.0, evidência por controle, o defeito encontrado, e o que **não** foi avaliado | Completo |
| `PERFORMANCE_BASELINE.md` | Metodologia, resultados com N/média/mediana/p95, tamanho do *bundle*, leitura dos números e o que **não** foi medido | Completo |
| `AI_QUALITY_EVALUATION.md` | 18 cenários sintéticos, critérios, resultado, rubrica humana preparada, limitações | Camada 1 completa; camada 2 **não executada** |
| `USER_EVALUATION_PROTOCOL.md` | Protocolo completo | **Estudo não executado** |
| `USER_EVALUATION_RESULTS_TEMPLATE.md` | Modelo | **Vazio, deliberadamente** |
| `FINAL_HARDENING_REPORT.md` | Consolidação da rodada | Completo |

---

## 7. Comandos executados nesta rodada

```
git status / git log / git rev-parse HEAD / git rev-parse origin/main
git remote -v / git diff --check / git diff --stat
npx tsc --noEmit --pretty false                            → 0 erros
npx tsc -p supabase/functions/tsconfig.json --pretty false → 0 erros
npx jest --runInBand      → 124 conjuntos, 1.686 casos, 0 falhas
npx eslint .              → 0 erros, 9 avisos (todos em tests/)
npx expo-doctor           → 18/18
./scripts/sql-test.sh     → 16 migrations, instalação limpa + atualização,
                            7 suítes, 265 asserções, 0 falhas
./scripts/e2e/e2e-run.sh  → 11 arquivos, 11 executados, 403 asserções, 0 falhas
./scripts/count-artifacts.sh
scripts/benchmark.mjs     → domínio + backend local
scripts/security-probe.mjs → 42 verificações, 0 falhas
scripts/ai-eval/run.mjs   → 18 cenários, 18 aprovados
npm audit                 → 21 (0 críticas, 9 altas), todas de desenvolvimento
npx expo export --platform android → bundle Hermes 8,36 MB
supabase migration list --linked   → somente leitura: remoto na 0012
supabase functions list            → somente leitura: 4 de 6 publicadas
contraprova de 0014 e 0015: defeito reintroduzido, suíte reprova, defeito removido
```

Nenhum `db push`, nenhuma publicação de função, nenhum agendamento remoto, nenhum `git push`. Todos os contêineres descartáveis foram removidos. O *stack* local de desenvolvimento do autor foi parado **com backup** por contenção de recursos (2 vCPU), e é restaurável por `supabase start`.
