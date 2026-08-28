# Protocolo de avaliação com usuários — Easy Trip

**Versão:** 1.0 · 28 de agosto de 2026
**Estado:** **PREPARADO. NÃO EXECUTADO.**

> Este documento descreve um estudo que **ainda não aconteceu**. Nenhum
> participante foi recrutado, nenhuma sessão foi conduzida e nenhum dado foi
> coletado. A limitação "ausência de avaliação com usuários" **permanece** no
> trabalho, e só sai depois que o estudo for realmente executado e os resultados
> preenchidos em `USER_EVALUATION_RESULTS_TEMPLATE.md`.
>
> Ter um protocolo não é ter um resultado.

---

## 1. Objetivo

Avaliar se pessoas que planejam viagens conseguem, sem treinamento, realizar as
tarefas centrais do Easy Trip; e medir a usabilidade percebida do aplicativo.

### Perguntas de pesquisa

| # | Pergunta | Como será respondida |
|---|---|---|
| PP1 | As tarefas centrais são concluídas sem ajuda? | Taxa de conclusão por tarefa |
| PP2 | Onde as pessoas travam? | Erros, hesitações e pedidos de ajuda, por tarefa |
| PP3 | A usabilidade percebida é aceitável? | SUS |
| PP4 | O roteiro proposto pela IA é considerado útil? | Escala pós-tarefa + pergunta aberta |
| PP5 | O modelo de colaboração é compreendido? | Tarefa 5 + pergunta de compreensão |

**O que este estudo NÃO responde:** se o aplicativo é usado ao longo de uma
viagem real. Isso exigiria estudo longitudinal, que está fora do escopo.

## 2. Participantes

**n = 8 a 12.** O número vem da regra prática de Nielsen — cinco participantes
revelam a maior parte dos problemas de usabilidade de um perfil; dois perfis
pedem o dobro. Acima de doze, o custo por problema novo cresce muito.

### Perfis

| Perfil | n | Definição |
|---|---:|---|
| A — planejador frequente | 4–6 | Viajou ≥ 2 vezes nos últimos 24 meses e organizou a viagem por conta própria |
| B — planejador ocasional | 4–6 | Viajou ≥ 1 vez nos últimos 24 meses, com pouca ou nenhuma organização prévia |

### Inclusão

- 18 anos ou mais;
- usa Android há pelo menos seis meses;
- planejou ao menos uma viagem nos últimos 24 meses;
- consente com a gravação de tela e áudio.

### Exclusão

- participou do desenvolvimento, dos testes ou da especificação do Easy Trip;
- tem relação de subordinação com o pesquisador (orientandos, colegas de
  equipe) — a pressão para agradar contamina a resposta;
- já usou uma versão anterior do aplicativo.

### Recrutamento

Convite aberto em grupos de viagem e na rede pessoal do pesquisador,
**excluindo** quem cai nos critérios de exclusão. Sem remuneração. O convite
diz que se avalia o aplicativo, e não a pessoa.

## 3. Materiais

- Aparelho Android com *build* de desenvolvimento instalado (o pesquisador
  fornece; se o participante preferir o próprio, instalar antes da sessão);
- conta de teste já criada, com senha entregue no início;
- uma segunda conta de teste, para a tarefa de colaboração;
- roteiro do pesquisador (seção 5);
- formulário SUS impresso ou digital;
- gravação de tela + áudio.

**Nenhum dado real do participante é inserido no aplicativo.** As tarefas usam
uma viagem fictícia. Se o participante espontaneamente digitar algo pessoal, o
pesquisador interrompe e pede que use dado fictício.

## 4. Tarefas

Ordem fixa: cada tarefa depende do estado deixada pela anterior. Tempo total
estimado: **45 a 60 minutos**.

| # | Tarefa | Cenário lido ao participante | Sucesso |
|---|---|---|---|
| T1 | Criar viagem | "Você vai a Lisboa de 10 a 15 de setembro, com R$ 6.000. Registre essa viagem." | Viagem criada com destino, datas e orçamento corretos |
| T2 | Montar um dia | "Você quer visitar o Mosteiro dos Jerónimos no dia 11, de manhã. Coloque isso no roteiro." | Item no roteiro, na data certa |
| T3 | Usar a IA | "Peça ao assistente um roteiro para o dia 12 e aceite o que achar útil." | Ao menos uma proposta revisada e aplicada, ou recusada conscientemente |
| T4 | Registrar despesa | "Você almoçou e gastou 25 euros. Registre." | Despesa registrada, com a conversão visível |
| T5 | Convidar alguém | "Sua irmã vai junto. Dê a ela acesso para editar o roteiro." | Convite enviado com papel de editor |
| T6 | Entender permissões | "Ela só deveria ver, não editar. Ajuste." | Papel alterado para visualizador |
| T7 | Meta diária | "Você quer gastar no máximo R$ 400 por dia. Configure." | Meta diária definida |
| T8 | Trabalhar sem rede | *(pesquisador ativa o modo avião)* "Registre um gasto de R$ 30 com transporte." | Despesa registrada; participante entende que ela será enviada depois |
| T9 | Reconectar | *(pesquisador desativa o modo avião)* "Confira se o gasto foi salvo." | Participante localiza a confirmação da sincronização |

**T8 e T9 são o par que mais importa.** A fila offline é invisível quando
funciona, e o que se mede aqui não é se ela funciona — é se a pessoa **confia**
que funcionou.

## 5. Roteiro do pesquisador

### Abertura (5 min)

> "Obrigado por participar. Vou pedir que você use um aplicativo de
> planejamento de viagens e realize algumas tarefas.
>
> **Quem está sendo avaliado é o aplicativo, não você.** Se algo ficar
> confuso, o problema é do aplicativo — e descobrir isso é exatamente o que eu
> preciso.
>
> Peço que **pense em voz alta**: diga o que está procurando, o que espera que
> aconteça, o que te surpreendeu. Não vou poder ajudar durante as tarefas,
> mas se você travar de verdade, diga, e a gente segue para a próxima.
>
> Vou gravar a tela e o áudio. Posso começar a gravação?"

### Durante

**Regras do pesquisador:**

- não responder "onde fica X" nem "o que faço agora";
- se o participante perguntar, devolver: *"o que você faria se eu não estivesse aqui?"*;
- registrar cada erro, hesitação (> 10 s parado) e pedido de ajuda;
- **não defender o aplicativo.** Explicar por que algo está daquele jeito
  contamina as tarefas seguintes;
- se o participante travar por mais de 3 minutos, encerrar a tarefa como
  "não concluída com ajuda" e seguir.

### Pós-tarefa (após cada tarefa)

1. "De 1 a 5, quão fácil foi essa tarefa?" (1 = muito difícil, 5 = muito fácil)
2. "Teve algum momento em que você não soube o que fazer?"

### Pós-sessão (10 min)

1. SUS (10 itens, escala de 5 pontos).
2. "O que mais te ajudou?"
3. "O que mais te atrapalhou?"
4. "Você usaria isso numa viagem de verdade? Por quê?"
5. Só se T3 foi executada: "O roteiro que o assistente propôs fazia sentido? O que você mudaria?"
6. Só se T8/T9 foram executadas: "Quando você registrou o gasto sem internet, você achou que ele tinha sido salvo?"

### Encerramento

> "Terminamos. Alguma coisa que você esperava encontrar e não encontrou?"

## 6. Dados coletados

| Dado | Instrumento |
|---|---|
| Conclusão por tarefa (sim / com ajuda / não) | Observação |
| Tempo por tarefa | Cronômetro |
| Erros por tarefa | Observação |
| Hesitações (> 10 s) | Observação |
| Facilidade percebida (1–5) | Pós-tarefa |
| SUS (0–100) | Pós-sessão |
| Citações relevantes | Transcrição |
| Perfil (A/B), faixa etária, tempo de uso de Android | Ficha inicial |

### O que NÃO é coletado

Nome, e-mail, telefone, endereço, dado de viagem real, imagem do rosto. A
gravação de tela mostra apenas o aplicativo com dado fictício.

## 7. Consentimento

Termo de Consentimento Livre e Esclarecido (TCLE) assinado antes da sessão,
contendo: objetivo, procedimentos, duração, riscos (mínimos — desconforto por
não conseguir concluir uma tarefa), benefícios (nenhum direto), direito de
interromper a qualquer momento sem justificativa, forma de anonimização,
destino e prazo de guarda dos dados, e contato do pesquisador e do orientador.

**Se a instituição exigir submissão a Comitê de Ética, o estudo não começa
antes da aprovação.** Nenhuma sessão é conduzida com TCLE pendente.

## 8. Anonimização

- Cada participante recebe um código (`P01`…`P12`) na primeira sessão;
- a ficha que liga código a pessoa fica em arquivo separado, protegido por
  senha, e é **destruída após a análise**;
- gravações são guardadas por 12 meses e então apagadas;
- nenhuma citação que permita identificação entra no relatório;
- resultados são publicados apenas de forma agregada, exceto citações
  anonimizadas.

## 9. Análise

### Quantitativa

- taxa de conclusão por tarefa: `concluídas sem ajuda / total`;
- tempo por tarefa: mediana e intervalo (n pequeno demais para média);
- SUS: pontuação por participante, mediana e intervalo. Referência: 68 é a
  média da literatura; abaixo de 50 indica problema sério de usabilidade;
- facilidade percebida: mediana por tarefa.

**Sem teste de significância.** Com n ≤ 12 e sem grupo de controle, um
*p-valor* aqui seria decoração estatística. O estudo é diagnóstico, não
comparativo, e o relatório dirá isso.

### Qualitativa

Análise temática das transcrições. Um problema é registrado com: descrição,
tarefa, participantes afetados, severidade (1 cosmético — 4 impeditivo) e
citação de apoio.

### Priorização

Severidade × frequência. Problema que impede a conclusão para ≥ 2 participantes
é tratado como bloqueante.

## 10. Critérios de interrupção

| Situação | Ação |
|---|---|
| Participante demonstra desconforto | Encerrar a sessão imediatamente, sem insistir |
| Falha técnica que impeça 3 tarefas seguidas | Encerrar; a sessão não entra na análise |
| Defeito bloqueante encontrado nos 2 primeiros participantes | **Suspender o estudo**, corrigir, recomeçar. Continuar mediria o mesmo defeito oito vezes |
| Participante pede para parar | Parar. Sem perguntar por quê |

## 11. Desistência

Desistir é um direito, e não precisa de motivo. Ao desistir:

- os dados já coletados são **apagados** se o participante pedir;
- se não pedir, entram na análise com o que foi concluído, marcados como
  sessão parcial;
- uma sessão parcial **não** é completada por outro participante — vira uma
  linha a menos.

## 12. Cronograma

| Etapa | Duração |
|---|---|
| Aprovação ética (se aplicável) | conforme a instituição |
| Piloto (1 participante, descartado da análise) | 1 sessão |
| Ajuste do roteiro após o piloto | 1 dia |
| Sessões | 8–12 sessões, 2 semanas |
| Análise | 1 semana |
| Relatório | 3 dias |

**O piloto é obrigatório e não entra na contagem.** Ele existe para descobrir
que uma tarefa está mal redigida antes que oito pessoas travem na mesma frase.

---

## 13. Estado

| Item | Estado |
|---|---|
| Protocolo | **Pronto** |
| Modelo de resultados | **Pronto** (`USER_EVALUATION_RESULTS_TEMPLATE.md`) |
| Aprovação ética | Não solicitada |
| Recrutamento | Não iniciado |
| Piloto | Não realizado |
| Sessões | **Nenhuma** |
| Dados coletados | **Nenhum** |

**A limitação "ausência de avaliação com usuários" permanece integralmente.**
