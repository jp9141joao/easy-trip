# Relatório de fechamento técnico — Easy Trip

**Data:** 28 de agosto de 2026
**HEAD inicial:** `a092429` · **HEAD final:** `d2e6a3b` · **`origin/main`:** `a092429` (sem *push*)

---

## 1. O que esta rodada se propôs, e o critério que a governou

Resolver todas as pendências tecnicamente resolvíveis, executar todas as validações ao alcance, e **só então** atualizar o texto acadêmico para refletir o estado comprovado.

O critério que governou cada decisão: **nada é declarado resolvido sem evidência executável, e a distância entre "implementado" e "operante em produção" é sempre dita.** A consequência aparece na seção 4 — a lista de pendências **cresceu**, e isso é o resultado correto de construir com autorização de publicação negada.

## 2. Estado inicial, medido e não presumido

Os *commits* citados no pedido (`c8121ba`, `93463a8`, `abaa9d9`) estavam desatualizados: o repositório havia avançado para `a092429`. A rodada partiu do estado real.

Linha de base confirmada por execução: 119 conjuntos Jest / 1.542 casos, 159 asserções SQL, 0 erros de tipo, 0 erros de análise estática, 18/18 no verificador de ambiente.

## 3. O que foi feito

### 3.1 Transferência de propriedade e exclusão de conta segura — RESOLVIDO (publicação pendente)

O defeito, encontrado ao investigar a lacuna §50: `public.trips.user_id` referencia `auth.users` com `on delete cascade`. Excluir a conta do proprietário de uma viagem compartilhada apagaria a viagem inteira, com as despesas, o diário e o roteiro **dos outros membros**. A cascata acontece abaixo da RLS, e nenhuma política a impediria.

A armadilha técnica: `is_trip_owner` responde afirmativamente por duas origens. Uma transferência que atualizasse só `trip_members` deixaria a viagem com dois donos.

  - *migration* 0014, sem tocar nenhuma anterior
  - `delete-account` recusa **antes** de apagar arquivos, com 200 e motivo legível
  - 38 asserções SQL + 30 de ponta a ponta + 23 casos Jest
  - **contraprova:** removida a atualização de `trips.user_id`, a suíte para na asserção 14

### 3.2 Suítes de ponta a ponta — RESOLVIDO

De 292 blocos inventariados para **403 asserções executadas, 0 falhas, 0 ignoradas**, em 11 arquivos.

A causa do impedimento era uma montagem órfã de sistema de arquivos, cujo sintoma (503 `failed to determine entrypoint`) não se parece com ela. A primeira execução real produziu 28 falhas, **nenhuma do produto**, todas diagnosticadas até a causa e corrigidas no arcabouço.

### 3.3 Integração e publicação contínuas — RESOLVIDO

Três fluxos versionados. Nenhum dos dois de qualidade usa segredo de produção. A publicação exige acionamento manual, ramo `main`, regressão completa e aprovação humana — nessa ordem, para quem aprova ver o resultado antes de decidir.

### 3.4 Agendamento do resumo diário — MECANISMO RESOLVIDO (agendamento não criado)

`cron.job.command` guarda texto. A 0015 agenda uma linha sem segredo; a função lê o Vault na execução. 39 asserções, entre elas a que verifica que nenhuma credencial aparece na tabela de agendamento.

### 3.5 Fila de escrita fora de rede — RESOLVIDO (escopo declarado)

A fila é o desvio, não o caminho. Dobra de mutações e id gerado no aparelho são as duas decisões que a tornam correta. 78 casos Jest, incluindo o ciclo inteiro atravessando o disco.

### 3.6 Notificações do sistema — RESOLVIDO (publicação e aparelho pendentes)

*migration* 0016, função de envio, cliente e controle em Configurações. O texto é cortado antes de sair: valor em dinheiro, e-mail, telefone e sequência longa de dígitos não chegam à tela de bloqueio.

### 3.7 Avaliação interna de segurança — CONCLUÍDA (não é pentest)

24 controles do MASVS 2.1.0. **Um defeito encontrado e corrigido**: uma Edge Function verificava a configuração antes de autenticar, revelando estado de implantação a chamador anônimo. A regressão prende a ordem nas três funções com credencial de servidor, não só na que estava errada.

### 3.8 Medição de desempenho — PARCIAL

Domínio e *backend* local medidos, com aquecimento descartado e p95. *Bundle* Hermes: 8,36 MB. **Sem medição em aparelho.**

### 3.9 Avaliação da IA — CAMADA 1 CONCLUÍDA, CAMADA 2 NÃO EXECUTADA

18 cenários sintéticos, 18 aprovados. A construção do instrumento produziu um achado sobre o próprio objeto: a primeira versão reprovou quatro cenários corretos, por medir uma camada só. O erro foi corrigido **no instrumento**, não no produto.

### 3.10 Avaliação com usuários — PROTOCOLO PRONTO, ESTUDO NÃO EXECUTADO

## 4. Números

| | Antes | Depois |
|---|---|---|
| RF | 64 | **74** |
| RF operantes em produção | 59 | **63** |
| RF pendentes de publicação | 5 | **11** |
| RNF | 61 | **70** |
| *Migrations* (repositório / publicadas) | 13 / 12 | **16 / 12** |
| Tabelas · políticas | 25 · 69 | **26 · 77** |
| Edge Functions (impl. / publ.) | 5 / 4 | **6 / 4** |
| Jest | 119 / 1.542 | **124 / 1.686** |
| Asserções SQL | 159 | **265** |
| Ponta a ponta | 292 **não executadas** | **403 executadas, 0 falhas** |

As três contagens de teste **não são somadas**.

## 5. O que NÃO foi feito, e por quê

| Item | Motivo |
|---|---|
| Publicar 0013–0016 | `AUTORIZAR_APLICAR_MIGRATIONS_PRODUCAO = NÃO` |
| Publicar `delete-account`, `send-push` e a correção de segurança | `AUTORIZAR_DEPLOY_EDGE_FUNCTIONS_PRODUCAO = NÃO` |
| Criar o agendamento no remoto | `AUTORIZAR_CONFIGURAR_CRON_PRODUCAO = NÃO` |
| `git push` | `AUTORIZAR_PUSH_GITHUB = NÃO` |
| Avaliação com usuários | Exige pessoas |
| Pentest independente | Exige avaliador externo |
| Avaliação humana do conteúdo da IA | Exige avaliadores |
| Validação de push em aparelho | Sem *build* com credencial |
| Benchmark do modelo real | Sem `GEMINI_API_KEY` |
| Métricas de aparelho | Sem Android instrumentado |
| `npm audit fix --force` | Traria mudança de versão maior do Expo |

## 6. Três coisas que esta rodada aprendeu

**Contraprova.** Um teste que passa não prova nada até que se verifique que ele reprova com o defeito presente. Em dois dos três casos testados, a versão ingênua do teste teria continuado passando.

**Medir a camada certa.** O instrumento de avaliação da IA reprovou quatro cenários corretos porque supunha uma camada onde havia duas, com respostas deliberadamente diferentes. A tentação oposta — ajustar o produto para o instrumento passar — teria produzido um sistema pior com um relatório melhor.

**A lista de pendências deve poder crescer.** Construir quatro frentes com publicação negada aumenta a distância entre implementado e operante. Um relatório que quisesse encurtar a lista teria construído menos.
