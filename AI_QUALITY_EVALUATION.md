# Avaliação técnica da IA acionável — Easy Trip

**Data:** 28 de agosto de 2026
**Commit:** `161982c`
**Instrumento:** `scripts/ai-eval/` (cenários + executor), versionado no repositório

---

## 1. O que está sendo avaliado, e o que não está

O Easy Trip usa um modelo de linguagem para propor conteúdo de viagem —
roteiro, checklist, despesas, metas. A proposta **nunca é aplicada
diretamente**: ela passa por duas camadas de validação e chega ao usuário numa
tela de revisão, item a item, onde ele marca o que aceita.

Esta avaliação mede **as duas camadas de validação**. Ela não mede — e não
pretende medir — se o roteiro proposto é *bom*.

> **Não houve avaliação humana da utilidade do conteúdo gerado.** Nenhum
> avaliador leu um roteiro e disse se ele faz sentido para uma viagem real.
> Essa continua sendo uma limitação declarada do trabalho, e a rubrica da
> seção 6 existe para quando ela for endereçada.

### Nenhum dado real foi usado

Todos os cenários são sintéticos. A viagem é inventada (Lisboa, 10–15 de
setembro de 2026), e as "respostas do modelo" foram construídas à mão para
exercitar um comportamento específico cada — inclusive os comportamentos ruins.
**Nenhum diário, nenhuma despesa e nenhuma viagem de pessoa real** participa da
avaliação.

## 2. As duas camadas — e por que medir só uma dá o resultado errado

Vale registrar, porque a primeira versão deste instrumento **reprovou quatro
cenários que estavam corretos no produto**. O erro era meu, não do código, e o
que ele revelou é o desenho da validação:

| Camada | O que valida | O que faz com o problema |
|---|---|---|
| `parseAIActions` | **contrato** — tipo, formato, faixa | Descarta. Tipo desconhecido, data impossível, valor absurdo: não vira ação. |
| `parseAIActions` (campo acessório) | idem | Um horário `25:99` vira **campo ausente**, não item recusado. Derrubar "Café" do dia porque o modelo escreveu um horário torto custaria mais a quem pediu do que o horário vale — e `25:99` não chega ao banco de qualquer forma. |
| `buildReviewGroups` | **coerência com a viagem** | **Não descarta: avisa.** Uma data fora do período chega à tela desmarcada, com o texto "12 de dezembro está fora do período". A pessoa pediu aquilo; ver o motivo explica, o item sumir não. |

Uma avaliação que medisse só a primeira camada concluiria que o produto aceita
datas fora da viagem. Uma que medisse só a segunda concluiria que ele aceita
qualquer coisa. Os cenários abaixo medem as duas, e por isso cada um declara até
quatro números: propostas, itens, itens **marcados** e itens **avisados**.

## 3. Critérios objetivos

| Critério | Como é medido |
|---|---|
| Aderência às datas | Item fora do período da viagem chega desmarcado e com aviso; item com data impossível não chega. |
| Estrutura válida | A proposta é aceita apenas se casar com o *schema* Zod do tipo declarado. |
| Não introdução de informação incompatível | Campo fora do contrato (preço, telefone, avaliação) é removido antes de chegar à tela. |
| Ações executáveis | Toda ação que sobrevive tem tipo conhecido e ao menos um item. |
| Consistência do destino | `tripId` é carimbado pelo cliente, nunca lido do modelo. |
| Propostas descartadas | Contadas e reportadas (taxa de descarte). |
| Robustez a resposta malformada | Nenhuma entrada pode levantar exceção. |
| Tempo de resposta | Só na camada 2, que exige a API. |

## 4. Reprodução

```
EVAL_STUB_EXPO=1 node --experimental-strip-types \
  --import ./scripts/alias-loader.mjs scripts/ai-eval/run.mjs

# com o modelo real, e com teto de chamadas:
GEMINI_API_KEY=... AI_EVAL_LIVE=1 AI_EVAL_MAX_CALLS=12 node ... scripts/ai-eval/run.mjs
```

`EVAL_STUB_EXPO=1` troca `expo-crypto` por um substituto (`scripts/ai-eval/expo-crypto-stub.mjs`),
porque `expo-modules-core` não roda no `node` puro. A troca é explícita e opcional
de propósito; nada do que se mede depende dela, e o arquivo diz o que aconteceria
se um dia dependesse.

---

## 5. Resultado

## Camada 1 — validação de propostas (sempre executada)

| # | cenário | família | esperado | obtido | resultado |
|---:|---|---|---|---|---|
| 1 | roteiro dentro das datas da viagem | datas | sem exceção, 1 ação(ões), 2 item(ns) | 1a / 2i / 2✓ / 0⚠ | **PASS** |
| 2 | item ANTES do início chega desmarcado, com aviso | datas | sem exceção, 1 ação(ões), 2 item(ns), 1 marcado(s), 1 avisado(s) | 1a / 2i / 1✓ / 1⚠ | **PASS** |
| 3 | proposta só com item fora do período chega inteira desligada | datas | sem exceção, 1 ação(ões), 1 item(ns), 0 marcado(s), 1 avisado(s), grupo desligado | 1a / 1i / 0✓ / 1⚠ | **PASS** |
| 4 | data inexistente no calendário é descartada | datas | sem exceção, 0 ação(ões), 0 item(ns) | 0a / 0i / 0✓ / 0⚠ | **PASS** |
| 5 | data em formato errado é descartada | datas | sem exceção, 0 ação(ões), 0 item(ns) | 0a / 0i / 0✓ / 0⚠ | **PASS** |
| 6 | campo que não existe no contrato é ignorado | alucinação | sem exceção, 1 ação(ões), 1 item(ns), sem "preco", sem "telefone", sem "avaliacao" | 1a / 1i / 1✓ / 0⚠ | **PASS** |
| 7 | tipo de ação desconhecido é descartado | alucinação | sem exceção, 0 ação(ões), 0 item(ns) | 0a / 0i / 0✓ / 0⚠ | **PASS** |
| 8 | ação sem items é descartada | alucinação | sem exceção, 0 ação(ões), 0 item(ns) | 0a / 0i / 0✓ / 0⚠ | **PASS** |
| 9 | payload malformado não derruba a validação | alucinação | sem exceção, 0 ação(ões), 0 item(ns) | 0a / 0i / 0✓ / 0⚠ | **PASS** |
| 10 | resposta que não é lista devolve lista vazia | alucinação | sem exceção, 0 ação(ões), 0 item(ns) | 0a / 0i / 0✓ / 0⚠ | **PASS** |
| 11 | mais ações do que o limite: o excesso é cortado | limites | sem exceção, ≤ 4 ações | 4a / 4i / 4✓ / 0⚠ | **PASS** |
| 12 | duas ações do MESMO tipo: só a primeira sobrevive | limites | sem exceção, 1 ação(ões) | 1a / 1i / 1✓ / 0⚠ | **PASS** |
| 13 | lista de itens acima do teto é truncada | limites | sem exceção, 1 ação(ões), ≤ 20 itens | 1a / 20i / 20✓ / 0⚠ | **PASS** |
| 14 | valor negativo é descartado | orçamento | sem exceção, 1 ação(ões), 1 item(ns) | 1a / 1i / 1✓ / 0⚠ | **PASS** |
| 15 | valor absurdo é descartado | orçamento | sem exceção, 0 ação(ões), 0 item(ns) | 0a / 0i / 0✓ / 0⚠ | **PASS** |
| 16 | despesa fora das datas chega desmarcada, com aviso | orçamento | sem exceção, 1 ação(ões), 1 item(ns), 0 marcado(s), 1 avisado(s) | 1a / 1i / 0✓ / 1⚠ | **PASS** |
| 17 | roteiro de dia inteiro com horários crescentes | dia inteiro | sem exceção, 1 ação(ões), 5 item(ns) | 1a / 5i / 5✓ / 0⚠ | **PASS** |
| 18 | horário impossível vira campo ausente, o item fica | dia inteiro | sem exceção, 1 ação(ões), 2 item(ns), 2 marcado(s), sem "25:99" | 1a / 2i / 2✓ / 0⚠ | **PASS** |

**18/18 cenários aprovados.**

### Por família de risco

| família | cenários | aprovados |
|---|---:|---:|
| datas | 5 | 5 |
| alucinação | 5 | 5 |
| limites | 3 | 3 |
| orçamento | 3 | 3 |
| dia inteiro | 2 | 2 |

Propostas oferecidas pelos cenários: **23**
Propostas que sobreviveram à validação: **14**
Taxa de descarte: **39.1%**

A taxa de descarte é alta **de propósito**: a maioria dos cenários existe para exercitar uma resposta ruim. Ela não descreve a qualidade do modelo — descreve a severidade da validação.

## Camada 2 — modelo real

**NÃO EXECUTADA.** `GEMINI_API_KEY` ausente ou `AI_EVAL_LIVE` desligado.

Nenhum número desta seção foi estimado, simulado ou inferido. Para executar:

```
GEMINI_API_KEY=... AI_EVAL_LIVE=1 node --experimental-strip-types \
  --import ./scripts/alias-loader.mjs scripts/ai-eval/run.mjs
```

---

## 6. Rubrica para avaliação humana futura

Preparada, **não aplicada**. Existe para que a limitação "não houve avaliação
humana da utilidade do conteúdo" possa ser endereçada sem redesenhar o
instrumento.

Cada roteiro proposto seria avaliado por pelo menos dois avaliadores
independentes, em escala de 1 a 5:

| Dimensão | 1 | 3 | 5 |
|---|---|---|---|
| **Plausibilidade geográfica** | Lugares que não existem, ou em outra cidade | Existem, mas o deslocamento entre eles é irreal | Existem e o dia é caminhável/viável |
| **Ritmo do dia** | Sobreposição de horários, ou dia vazio | Cheio ou frouxo demais | Ritmo que uma pessoa aguenta |
| **Aderência ao pedido** | Ignora a restrição declarada | Atende em parte | Atende integralmente (dieta, orçamento, mobilidade) |
| **Utilidade** | Genérico; qualquer cidade serviria | Alguns itens específicos do destino | Claramente sobre aquele destino |
| **Honestidade** | Afirma preço, horário de funcionamento ou reserva | Insinua | Não afirma o que não pode saber |

Concordância entre avaliadores por Kappa de Cohen ponderado. Amostra mínima
sugerida: 20 roteiros, 4 destinos, 2 avaliadores.

## 7. Limitações desta avaliação

| Limitação | Consequência |
|---|---|
| **A camada 2 não foi executada** | Não há nesta rodada nenhum número sobre o modelo real: nem tempo de resposta, nem taxa de proposta válida, nem aderência a pedido em linguagem natural. `GEMINI_API_KEY` não estava disponível. Nada foi estimado no lugar. |
| **Nenhuma avaliação humana** | Não se sabe se os roteiros são bons. Sabe-se que os inválidos não passam. |
| **Cenários escritos por quem escreveu o produto** | Um cenário pode não existir justamente onde a implementação tem um ponto cego. É a fraqueza estrutural de qualquer suíte escrita pelo próprio autor, e a resposta correta é revisão externa — que não houve. |
| **Sem variação de modelo** | A cadeia de fallback (`TEXT_MODEL_CHAIN`) não foi exercitada contra provedores reais. |
| **Sem medição de custo** | Nem tokens, nem preço por proposta. |
