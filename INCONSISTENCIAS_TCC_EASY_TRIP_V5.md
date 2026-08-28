# INCONSISTÊNCIAS E PENDÊNCIAS — TCC EASY TRIP V5

Registro do que **não** pôde ser comprovado, do que foi comprovado **contra** o texto anterior, e do que exige decisão do autor. Nada aqui foi preenchido por suposição.

Data: 2026-08-28 · HEAD `c5af399` + alterações locais não versionadas.

---

## PEND-01 — A versão avaliada não está versionada

**ITEM:** Reprodutibilidade da avaliação.

**TCC antigo:** avaliação sobre o *commit* `9f33e2b`, "sem alterações locais pendentes".

**Contexto:** o `tcc_contexto.txt` também trata um *commit* congelado como base da auditoria.

**Código atual:** HEAD é `c5af399` (= `origin/main`). Sobre ele há 20 arquivos modificados e 16 não rastreados, que constituem a rodada de melhorias avaliada neste artigo — incluindo a *migration* 0013 e oito arquivos de teste. Os números de teste (119 suítes / 1.542 casos) **só são obtidos com essas alterações presentes**; a partir do `c5af399` isolado, oito arquivos de teste não existem.

**Estado remoto:** não aplicável.

**Conclusão:** a versão medida não é recuperável por terceiros a partir do histórico Git. O TCC declara isso explicitamente (seções 3.7 e 4.6, limitação 2) em vez de atribuir os resultados ao *commit*.

**Ação necessária:** **versionar a rodada de melhorias em um novo *commit*** e substituir, no TCC, "`c5af399` acrescido de alterações locais" pelo novo hash. É a pendência de menor custo e maior impacto do conjunto. Enquanto não for feita, a seção 3.7 deve permanecer como está.

---

## INC-02 — As 151 asserções SQL do TCC anterior não são reproduzíveis

**ITEM:** Contagem de asserções das suítes SQL de controle de acesso.

**TCC antigo:** "151 asserções distribuídas em quatro arquivos", apresentadas como contagem estática não executada.

**Contexto:** `tcc_contexto.txt` repete 151.

**Código atual:** os quatro arquivos `.test.sql` estão **inalterados** desde o `9f33e2b` (`git diff --stat 9f33e2b HEAD -- supabase/tests/` é vazio). Contagem estática dos dois auxiliares de asserção — `pg_temp.check` e `pg_temp.deny`, descontadas as definições — resulta em **146** (31 + 8 + 79 + 28). A **execução real** emitiu **159** confirmações (31 + 8 + 92 + 28), porque parte das asserções está em laços e o auxiliar `deny` emite mais de uma confirmação por chamada.

**Estado remoto:** não aplicável (suítes rodam contra instância descartável).

**Conclusão:** 151 não corresponde nem à contagem estática (146) nem à execução (159). É erro do artigo anterior, de origem não determinável.

**Ação necessária:** nenhuma sobre o código. O v5 adota **159, por execução**, que é o número mais forte e o único verificável. O 151 não aparece no v5.

---

## INC-03 — Divergência entre o auxiliar de teste local e a função de identidade real

**ITEM:** `supabase/tests/_local_bootstrap.sql`, função `auth.uid()`.

**TCC antigo:** não menciona.

**Contexto:** não menciona.

**Código atual:** o arcabouço define

```sql
select nullif(current_setting('request.jwt.claims', true)::json ->> 'sub', '')::uuid;
```

O cast `::json` ocorre **antes** do tratamento de valor vazio. A definição do serviço gerenciado aplica `nullif(…, '')` **antes** do cast. O auxiliar `pg_temp.as_postgres()` de `rls_collaboration.test.sql` faz `set local request.jwt.claims = ''`, e a chamada seguinte a `auth.uid()` levanta `invalid input syntax for type json`, interrompendo a suíte após 78 asserções.

**Estado remoto:** **não afeta** o ambiente publicado, que usa a definição própria do Supabase. Nenhuma *migration* e nenhuma política estão envolvidas.

**Conclusão:** é defeito do **arcabouço de teste**, não do produto. Foi a causa de as suítes SQL nunca terem sido executadas até o fim.

**Ação necessária:** corrigir `_local_bootstrap.sql` para `nullif(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub', '')::uuid`. **Não foi feito nesta rodada**, que é exclusivamente documental. Para completar a execução, a definição fiel foi instalada **apenas na instância descartável**, sem tocar em arquivo do repositório — e isso está declarado na seção 4.3 do TCC.

---

## INC-04 — Contagens de banco do TCC anterior subestimavam o esquema

**ITEM:** Políticas, gatilhos, índices e restrições de verificação.

**TCC antigo:** 27 políticas, 11 gatilhos, 25 índices, 26 restrições.

**Contexto:** repete os mesmos valores.

**Código atual (medido em PostgreSQL 17.11 com 0001–0012 aplicadas):** 69 políticas (62 no esquema público + 7 sobre objetos de armazenamento), 15 gatilhos, 58 índices (30 explícitos + 28 de constraint), 43 restrições de verificação.

**Estado remoto:** o esquema publicado corresponde a 0001–0012, logo a esses mesmos valores.

**Conclusão:** os números antigos vieram de contagem de instruções no texto das migrações, que não alcança as políticas criadas em laço `foreach` nem os índices criados por constraint. Não há conflito de fato: há conflito de instrumento, e o catálogo do banco é a fonte mais forte.

**Ação necessária:** nenhuma. O v5 usa os valores medidos e declara o instrumento (seção 3.7, etapa 2).

---

## INC-05 — Três tabelas de protocolo, ou duas?

**ITEM:** Tabelas sem política de escrita.

**TCC antigo:** "três tabelas de protocolo — participantes, convites e notificações — não possuem política de escrita alguma".

**Contexto:** idem.

**Código atual (medido):** sem qualquer política de escrita: `trip_members` e `trip_invites` — **duas**. `notifications` tem três políticas: `notifications_select` (SELECT), `notifications_update` (UPDATE) e `notifications_delete` (DELETE). Não tem política de **inserção**.

**Estado remoto:** mesmo esquema.

**Conclusão:** a afirmação antiga é falsa para `notifications`. A propriedade verdadeira e mais precisa é: nenhum cliente **cria** notificação (isso é exclusivo de funções do banco), mas o destinatário pode marcá-la como lida ou removê-la — que é o comportamento desejado e não uma brecha.

**Ação necessária:** nenhuma sobre o código. Corrigido nas seções 3.6 e 4.4 do v5.

---

## INC-06 — "As 26 funções SQL têm caminho de busca fixo"

**ITEM:** Proteção contra sequestro por resolução de esquema.

**TCC antigo:** "As 26 funções SQL têm caminho de busca fixo".

**Código atual (medido):** das 26 funções do projeto, **25** têm `search_path` fixo. A exceção é `touch_updated_at`, que é `security invoker` — executa com o privilégio de quem a chama. Das **23** funções `security definer`, **as 23** têm `search_path` fixo.

**Estado remoto:** mesmo esquema.

**Conclusão:** a afirmação antiga é literalmente falsa, mas a propriedade de segurança que ela pretendia expressar é verdadeira e mais forte quando enunciada corretamente: o vetor de sequestro se aplica a funções `security definer`, e essas estão 23/23 protegidas.

**Ação necessária:** nenhuma sobre o código. Reenunciado na seção 4.4 do v5.

---

## INC-07 — URL do repositório

**ITEM:** Endereço público do projeto.

**TCC antigo:** `https://github.com/jp9141joao/easy-trip`.

**Código atual:** `git remote -v` → `https://github.com/jp9141joao/easy-trip-3.0`.

**Conclusão:** o endereço do artigo anterior não corresponde ao remoto configurado.

**Ação necessária:** confirmar se `easy-trip` também existe e é público. O v5 usa `easy-trip-3.0`, que é o verificável. **Se o repositório publicado para avaliação for outro, o autor deve corrigir a seção 3.7.**

---

## INC-08 — "Chave anônima" no pacote do aplicativo

**ITEM:** Natureza da credencial pública.

**TCC antigo:** "chave anônima no cliente".

**Código atual:** `EXPO_PUBLIC_SUPABASE_ANON_KEY` contém uma chave no formato `sb_publishable_…` (46 caracteres), e não um JWT `anon` legado.

**Estado remoto:** o endpoint de introspecção recusa a chave com `"Only secret API keys can be used for this endpoint"`, comportamento do formato novo.

**Conclusão:** o termo correto é *chave publicável*. A propriedade de segurança não muda: sem sessão válida, ela não concede acesso a tabela alguma — o que foi **confirmado em produção** (todas as tabelas respondem `42501`).

**Ação necessária:** nenhuma. Terminologia corrigida no v5 (seções 3.3 e 3.6).

---

## PEND-09 — *Migration* 0013 não publicada

**ITEM:** Capa da viagem e meta de gasto diário.

**TCC antigo:** não existia.

**Código atual:** `supabase/migrations/0013_trip_cover_and_daily_goal.sql` existe e traz no cabeçalho, em comentário do próprio autor: *"ESTA MIGRATION NÃO FOI APLICADA."* Aplicada nesta avaliação a uma instância descartável, aplica sem erro e sua verificação interna aprova: duas colunas, bucket privado, quatro políticas.

**Estado remoto:** **NÃO APLICADA.** `trips.cover_image_path` e `trips.daily_spending_goal` retornam `42703 — column does not exist`, o mesmo código devolvido para uma coluna-controle inexistente.

**Conclusão:** IMPLEMENTADO · VALIDADO LOCALMENTE · **NÃO PUBLICADO**. Quatro requisitos funcionais e dois não funcionais dependem dela e não operam hoje em produção.

**Ação necessária:** decisão do autor sobre publicar. Enquanto não publicada, a Tabela 1 e o Quadro 7 devem manter a coluna de pendência de publicação.

---

## PEND-10 — `delete-account` não publicada

**ITEM:** Exclusão de conta.

**TCC antigo:** registrada como pendência — e **continua correta**.

**Código atual:** função implementada, passa na verificação de tipos, tem teste de ponta a ponta escrito.

**Estado remoto:** **NÃO PUBLICADA.** HTTP 404 `{"code":"NOT_FOUND"}`, idêntico ao de uma função-controle inexistente, enquanto as outras quatro respondem com suas próprias checagens de autorização.

**Conclusão:** a pendência é deliberada e está corretamente ligada ao risco de remoção em cascata da viagem do proprietário, que continua sem transferência de propriedade.

**Ação necessária:** implementar a transferência de propriedade **antes** de publicar a função. Registrado como limitações 4 e 8 e como terceira frente de trabalho futuro.

---

## PEND-11 — Resumo diário publicado, sem agendamento

**ITEM:** `trip-daily-briefing`.

**TCC antigo:** tratada apenas como "não publicada".

**Código atual:** a função aceita exclusivamente chamada com papel de serviço e segredo dedicado; as instruções de agendamento constam **em comentário** no cabeçalho, na forma de um `cron.schedule` a ser executado manualmente.

**Estado remoto:** **PUBLICADA** (responde HTTP 403 da própria checagem de segredo). Nenhum agendamento configurado — não há `pg_cron` em migração alguma.

**Conclusão:** função publicada ≠ recurso operante. Ela existe e não é disparada sozinha.

**Ação necessária:** configurar o agendamento e o segredo correspondente. Registrado como limitação 6.

---

## NÃO VERIFICADO — itens fora do alcance desta rodada

| Item | Por que não foi verificado |
|---|---|
| Suíte de ponta a ponta (292 blocos) | Exige chave de serviço e contas de teste dedicadas, não disponíveis. Permanece **contagem estática**. |
| Backups / PITR do projeto Supabase | Configuração de painel, não inspecionável pelas credenciais disponíveis. Não citado no TCC. |
| Avisos do Expo Router | `expo-doctor` aprovou 18/18 e a suíte não registra avisos de rota. **Não há evidência de que persistam**, e por isso não figuram como limitação no v5. |
| Comportamento da Open-Meteo em rede móvel | Nenhuma evidência atual de falha. Não reintroduzido como limitação. |
| Usuários reais do aplicativo | Nenhuma evidência. O TCC **não** afirma que existem. |
| Qualidade dos roteiros gerados pela IA | Exigiria instrumento e avaliadores. Declarado como métrica descartada (3.8) e limitação 10. |
| Teste manual em Android | Evidência única: a mensagem do *commit* `c5af399`. Registrado como **teste funcional manual do desenvolvedor**, jamais como teste com usuários. |

---

## Resumo das ações pendentes

| # | Ação | Urgência |
|---|---|---|
| 1 | Versionar a rodada de melhorias (PEND-01) | **Alta** — bloqueia reprodutibilidade |
| 2 | Corrigir `auth.uid()` em `_local_bootstrap.sql` (INC-03) | **Alta** — impede execução limpa das suítes SQL |
| 3 | Confirmar a URL pública do repositório (INC-07) | Média — afeta a seção 3.7 |
| 4 | Decidir sobre publicar a *migration* 0013 (PEND-09) | Média |
| 5 | Transferência de propriedade antes de publicar `delete-account` (PEND-10) | Média |
| 6 | Configurar o agendamento do resumo diário (PEND-11) | Baixa |

Nenhuma dessas ações foi executada nesta rodada, que é **exclusivamente documental**.
