# EASY TRIP: DESENVOLVIMENTO E AVALIAÇÃO DE UM PLANEJADOR INTELIGENTE DE VIAGENS COM INTELIGÊNCIA ARTIFICIAL

**João Pedro Rosa de Paula**
Graduando em Engenharia de Software — Uni-FACEF
jp9141joao@gmail.com

**Prof. Dr. Daniel Facciolo Pires**
Docente do Departamento de Computação — Uni-FACEF
daniel@facef.br

---

## Resumo

Planejar uma viagem exige reunir roteiro, lista de preparação, orçamento, despesas em mais de uma moeda, reservas e documentos, informação que na prática se distribui entre ferramentas independentes. Este trabalho apresenta o desenvolvimento e a avaliação do Easy Trip, planejador inteligente de viagens implementado como aplicação móvel em React Native/Expo com backend Supabase. O sistema centraliza roteiro, lista de preparação, controle financeiro com acompanhamento de meta diária e conversão de moedas, reservas, diário, documentos, avisos e informações contextuais do destino; permite a colaboração entre participantes com controle de visibilidade item a item, incluindo transferência de propriedade da viagem; registra em fila durável as alterações feitas sem conexão; entrega avisos por notificação do sistema operacional; e integra um assistente de inteligência artificial que propõe ações de planejamento a partir dos dados da própria viagem. A pesquisa é aplicada, de abordagem mista e objetivo descritivo, conduzida como Design Science Research. A avaliação combinou o levantamento de requisitos a partir da implementação, a rastreabilidade entre requisito, código, estrutura de dados e teste, e a execução de verificações automatizadas. Dos 74 requisitos funcionais identificados, todos são rastreáveis até código e estrutura de dados, e 63 operam sobre o esquema já publicado; dos 70 requisitos não funcionais, 59 apresentam evidência forte. As três camadas do sistema passaram a estar verificadas por execução: a suíte automatizada registrou 124 conjuntos e 1.686 casos sem falhas, com verificação de tipos e análise estática sem erros; as sete suítes SQL de controle de acesso somaram 265 asserções sem falhas contra bancos descartáveis; e as onze suítes de ponta a ponta, antes apenas inventariadas, foram executadas contra uma pilha dedicada e somaram 403 asserções sem falhas. As três contagens não são somadas, por medirem coisas distintas. As sugestões da inteligência artificial passam por três validações e por confirmação explícita do usuário antes de qualquer gravação, mecanismo agora medido por dezoito cenários sintéticos. Permanecem como limitações a ausência de avaliação com usuários — para a qual se elaborou protocolo, sem executá-lo —, a ausência de avaliação de segurança independente e de avaliação humana do conteúdo gerado, e quatro migrações e duas funções implementadas e validadas localmente, mas ainda não publicadas.

**Palavras-chave:** planejamento de viagens; aplicações móveis; inteligência artificial; engenharia de software.

## Abstract

*Planning a trip requires bringing together an itinerary, a packing list, a budget, expenses in more than one currency, bookings and documents — information that in practice is spread across independent tools. This paper presents the development and evaluation of Easy Trip, an intelligent travel planner implemented as a React Native/Expo mobile application with a Supabase backend. The system centralises itinerary, packing list, financial control with daily-goal tracking and currency conversion, bookings, journal, documents, alerts and contextual destination information; it supports collaboration among participants with per-item visibility control, including trip ownership transfer; it queues writes made offline for durable later delivery; it delivers alerts through operating-system notifications; and it integrates an artificial intelligence assistant that proposes planning actions based on the trip's own data. The research is applied, mixed in approach and descriptive in purpose, conducted as Design Science Research. Evaluation combined requirement elicitation from the existing implementation, traceability linking requirement, code, data structure and test, and the execution of automated checks. Of the 74 functional requirements identified, all are traceable to code and to a data structure, and 63 operate over the already-published schema; of the 70 non-functional requirements, 59 present strong evidence. All three layers of the system are now verified by execution: the test suite recorded 124 sets and 1,686 cases with no failures, alongside type checking and static analysis with no errors; the seven SQL access-control suites totalled 265 assertions with no failures against disposable databases; and the eleven end-to-end suites, previously inventoried only, were executed against a dedicated stack and totalled 403 assertions with no failures. The three counts are deliberately not summed, as they measure different things. AI suggestions pass through three validations and explicit user confirmation before any write, a mechanism now measured by eighteen synthetic scenarios. Remaining limitations are the absence of user evaluation — for which a protocol was prepared but not executed —, the absence of independent security assessment and of human evaluation of generated content, and four migrations and two functions that are implemented and locally validated but not yet published.*

**Keywords:** *travel planning; mobile applications; artificial intelligence; software engineering.*

---

## 1 Introdução

Planejar uma viagem produz informação heterogênea e sensível ao tempo: um roteiro organizado por dia, uma lista de preparação, um orçamento com despesas em mais de uma moeda, comprovantes de reserva, documentos anexados e anotações pessoais. Na prática corrente, esse conjunto se distribui entre aplicativos de mensagem, planilhas, caixas de e-mail e blocos de notas. A consequência mais direta não é estética, e sim operacional: o mesmo dado passa a existir em versões divergentes, sem que haja um ponto único de consulta.

Nikam, Verma e Ranade (2025), ao levantar requisitos para um planejador móvel de viagens internacionais junto a trinta participantes, registram que a dificuldade relatada não se concentra na ausência de funcionalidade, mas na necessidade de operar várias ferramentas desconectadas para uma única viagem, e apontam a colaboração em itinerários de grupo como demanda recorrente. A centralização é, portanto, um requisito já reconhecido no projeto de aplicações turísticas.

A dificuldade cresce quando a viagem é compartilhada. Assim que mais de uma pessoa registra despesas, edita o roteiro ou anexa documentos, as perguntas "onde o dado está" e "quem pode vê-lo" deixam de bastar, e passa a ser necessário responder também "quem pode alterá-lo" e "o que permanece privado mesmo dentro de um grupo com acesso à viagem". Um diário pessoal e um extrato individual de gastos não têm o mesmo regime de visibilidade que um roteiro coletivo, ainda que pertençam à mesma viagem. Quando esse controle é resolvido apenas na interface — escondendo botões ou filtrando listas na tela —, ele não constitui garantia: um cliente que converse diretamente com a interface de programação do serviço contorna a restrição.

Some-se a isso a possibilidade de usar modelos de linguagem generativos como apoio ao planejamento. A expectativa é atraente: transformar uma descrição em linguagem natural — destino, datas, interesses — em um roteiro estruturado, poupando o esforço manual de montar dia a dia. Essa expectativa, porém, precisa ser calibrada. Xie *et al.* (2024) demonstram, com um conjunto de 1.225 intenções de planejamento e ferramentas de acesso a cerca de quatro milhões de registros, que agentes baseados em modelos de linguagem ainda falham sistematicamente em tarefas de planejamento de viagem sob restrições, com taxa de sucesso próxima de zero mesmo para modelos de fronteira. Ji *et al.* (2023), em revisão abrangente sobre alucinação em geração de linguagem natural, caracterizam a produção de conteúdo não sustentado pela fonte como propriedade estrutural desses sistemas, e não como defeito pontual. Em um aplicativo que grava registros no banco a partir de sugestões do modelo, essas duas evidências deixam de ser observações acadêmicas e passam a ser requisitos de projeto: a inteligência artificial pode propor, mas a gravação precisa depender de validação e de confirmação do usuário.

Deste contexto nasce o Easy Trip, objeto deste trabalho: um planejador inteligente de viagens, desenvolvido como aplicação móvel, que reúne em uma única solução o roteiro, a lista de preparação, o controle financeiro, as reservas, os documentos, o diário, a colaboração entre participantes e um assistente de inteligência artificial de apoio ao planejamento.

### 1.1 Problema e lacuna

O problema investigado é o seguinte: o planejamento e o acompanhamento de uma viagem exigem informações de naturezas distintas que hoje se encontram fragmentadas entre ferramentas independentes, o que dificulta manter o planejamento organizado, colaborar com os demais participantes e obter, a partir dos dados já registrados, apoio efetivo à tomada de decisão.

Dessa fragmentação decorrem três dificuldades práticas. A primeira é de consistência: roteiro em uma ferramenta, despesas em outra, reservas no e-mail e lista de preparação em um bloco de notas produzem versões divergentes do mesmo plano. A segunda é de colaboração: compartilhar o planejamento com os demais viajantes normalmente significa reencaminhar arquivos e mensagens, sem controle sobre quem pode alterar o quê e sem espaço reservado para o que é pessoal. A terceira é de aproveitamento da informação: mesmo quando os dados existem, transformá-los em um roteiro coerente continua sendo trabalho manual.

Segurança e privacidade aparecem, neste trabalho, como requisitos decorrentes do problema, e não como o problema em si. A partir do momento em que uma mesma viagem contém dados coletivos e dados pessoais, torna-se necessário decidir onde o controle de acesso é aplicado e como a visibilidade de cada item é expressa.

Quanto à lacuna, ela não está na inexistência de aplicativos de viagem: há muitos, comerciais e acadêmicos. Nos trabalhos consultados nesta pesquisa, contudo, os três ângulos aparecem separados. Nikam, Verma e Ranade (2025) tratam do projeto centrado no usuário e avaliam conceito e protótipo. Xie *et al.* (2024) avaliam a capacidade do modelo de linguagem em planejar, sem uma aplicação que o utilize. Karlović *et al.* (2025) avaliam a qualidade de recomendações turísticas geradas por modelos com recuperação de documentos. Nenhum deles descreve uma aplicação móvel implementada que integre centralização, colaboração com controle de visibilidade por item e assistência por inteligência artificial, acompanhada de evidência técnica sobre a própria implementação. É essa integração, documentada e verificada, que este trabalho procura oferecer, sem pretender que o conjunto de trabalhos aqui consultado esgote a literatura da área.

### 1.2 Questão de pesquisa

Em que medida o Easy Trip integra, em uma única aplicação móvel, os recursos de planejamento, organização, controle financeiro, colaboração e assistência por inteligência artificial necessários à gestão de uma viagem, e que evidência técnica sustenta a implementação desses recursos?

A questão é mensurável por quatro classes de evidência disponíveis no próprio sistema: a proporção de requisitos identificados que são rastreáveis até um artefato de código e uma estrutura de dados; o resultado da execução das suítes de testes e das verificações estáticas; a cobertura das políticas de controle de acesso em relação à matriz de acesso pretendida; e a existência de pontos verificáveis de validação entre a sugestão da inteligência artificial e a gravação no banco. Os critérios estão detalhados na seção 3.8.

### 1.3 Objetivos

**Objetivo geral.** Desenvolver e avaliar o Easy Trip, aplicação móvel inteligente destinada ao planejamento e à gestão de viagens, integrando recursos de organização, colaboração, controle financeiro, reservas e assistência por inteligência artificial.

**Objetivos específicos.**

1. Identificar as necessidades e os requisitos relacionados ao planejamento e ao gerenciamento de viagens contemplados pelo Easy Trip.
2. Projetar e implementar a arquitetura da aplicação móvel, sua camada de persistência e os mecanismos de gerenciamento dos dados.
3. Desenvolver os recursos de planejamento de roteiros, organização, controle financeiro, reservas, colaboração e demais funcionalidades da solução.
4. Integrar recursos de inteligência artificial ao aplicativo para auxiliar o usuário durante o planejamento e o acompanhamento da viagem.
5. Implementar mecanismos de segurança, privacidade e controle de acesso adequados ao compartilhamento de informações entre participantes.
6. Avaliar tecnicamente a implementação por meio de testes automatizados, análise estática, verificação de tipos e rastreabilidade entre requisitos e componentes desenvolvidos.

### 1.4 Justificativa

Do ponto de vista prático, o Easy Trip responde a uma necessidade concreta de quem planeja viagens: manter em um só lugar aquilo que hoje se espalha por várias ferramentas, permitir que os demais participantes contribuam sem perder o controle sobre o que é pessoal, e usar a inteligência artificial para reduzir o esforço de transformar informação dispersa em um roteiro organizado.

Do ponto de vista acadêmico, o trabalho contribui com um exemplo documentado de desenvolvimento e avaliação de uma aplicação móvel segundo o referencial de Design Science Research (HEVNER *et al.*, 2004; PEFFERS *et al.*, 2007), em que a evidência apresentada é delimitada pelo que efetivamente se pôde medir. A distinção entre "o teste existe" e "o teste foi executado", mantida ao longo de todo o artigo, é parte dessa contribuição: é o ponto em que relatos de projeto de graduação costumam converter inventário em resultado.

Do ponto de vista técnico, a solução demonstra um padrão replicável para aplicações móveis que compartilham dados entre usuários: expressar o controle de acesso como política no banco de dados, e não no cliente, de modo que a garantia sobreviva à substituição da interface. Beneficiam-se diretamente equipes pequenas que constroem sobre plataformas gerenciadas e precisam de controle de acesso defensável sem operar servidores próprios.

### 1.5 Organização

A seção 2 apresenta os conceitos que sustentam a proposta e compara três trabalhos relacionados. A seção 3 descreve a metodologia adotada, as funcionalidades, a arquitetura, o modelo de dados, a integração de inteligência artificial e os mecanismos de segurança do Easy Trip, além dos procedimentos e métricas de avaliação. A seção 4 apresenta os resultados da avaliação, discute-os frente à questão de pesquisa e registra limitações e ameaças à validade. A seção 5 conclui.

---

## 2 Referencial Teórico

### 2.1 Aplicações móveis e planejamento de viagens

O planejamento de uma viagem é uma atividade de coordenação: envolve decisões sobre destino, datas, deslocamentos, hospedagem, orçamento e atividades, e cada decisão gera informação que precisa ser retomada depois. Nikam, Verma e Ranade (2025) conduzem um estudo de projeto de experiência para um planejador móvel de viagens internacionais e, a partir de levantamento com trinta participantes e da comparação de funcionalidades entre plataformas concorrentes, identificam dois pontos que orientam este trabalho: a insatisfação relatada decorre menos da falta de recursos e mais da necessidade de alternar entre ferramentas desconectadas; e a colaboração em itinerários de grupo aparece como demanda recorrente, e não como funcionalidade acessória.

Esses dois achados sustentam a proposta do Easy Trip. Centralizar significa que roteiro, lista de preparação, despesas, reservas, documentos e anotações compartilham o mesmo modelo de dados e a mesma identidade de usuário. Colaborar significa que mais de uma pessoa opera sobre a mesma viagem, o que introduz a necessidade de decidir a visibilidade de cada item.

### 2.2 Engenharia de software e arquitetura de aplicações móveis

Bass, Clements e Kazman (2021) tratam atributos de qualidade como consequência de decisões arquiteturais localizáveis, e não como propriedades difusas do sistema. Segundo essa perspectiva, perguntas como "o sistema é manutenível?" ou "o sistema é seguro?" só se tornam respondíveis quando reformuladas como perguntas sobre onde, na estrutura do sistema, a decisão correspondente foi tomada. É essa reformulação que permite avaliar um atributo de qualidade por inspeção da arquitetura, e não apenas por observação do comportamento em execução.

Para classificar os requisitos não funcionais, adota-se a ISO/IEC 25010:2023, que substituiu a edição de 2011 e reorganizou o modelo de qualidade de produto em nove características de primeiro nível: foi acrescentada *safety*, e *usability* e *portability* foram substituídas por *interaction capability* e *flexibility*, respectivamente. Deste modelo, três características orientam a classificação apresentada na seção 4.2: adequação funcional, segurança e manutenibilidade. As demais são registradas, mas não são objeto de medição neste artigo, pelas razões dadas em 3.8.

No plano da organização interna, o padrão relevante para este trabalho é o Repository, no qual o acesso a dados é declarado como um contrato e as telas dependem apenas desse contrato, não da tecnologia que o implementa. A consequência prática é que a fonte de dados pode ser substituída sem alterar a interface, o que sustenta tanto a manutenibilidade quanto a possibilidade de executar o aplicativo sem provisionar infraestrutura.

### 2.3 Inteligência artificial aplicada ao planejamento de viagens

O uso de modelos de linguagem generativos em turismo tem sido investigado sob dois ângulos. O primeiro é a capacidade do modelo de produzir planos válidos. Xie *et al.* (2024) propõem o TravelPlanner, ambiente de avaliação com 1.225 intenções de planejamento e ferramentas sobre cerca de quatro milhões de registros, e concluem que agentes de linguagem ainda não dão conta de planejamento de viagem sob restrições múltiplas. O segundo é a qualidade da recomendação apoiada por recuperação de documentos: Karlović *et al.* (2025) avaliam sete modelos em recomendação turística sensível a contexto, sobre uma base de folhetos indexada em armazenamento vetorial, com reordenação semântica dos trechos recuperados.

Cabe uma distinção terminológica. Lewis *et al.* (2020) introduzem a geração aumentada por recuperação (*retrieval-augmented generation*, RAG), em que o modelo é acoplado a uma memória externa consultada por índice vetorial. O Easy Trip fornece ao modelo as informações estruturadas da viagem já conhecida como contexto da solicitação, sem etapa de recuperação sobre um índice de documentos.

Em contrapartida, dois resultados da literatura incidem diretamente sobre o projeto do assistente. Ji *et al.* (2023) sistematizam o fenômeno da alucinação, distinguindo o conteúdo que contradiz a fonte daquele que a extrapola sem contradizê-la. Perez e Ribeiro (2022) demonstram, com o arcabouço PromptInject, dois ataques praticáveis por entrada de usuário — sequestro de objetivo e vazamento de instrução —, evidenciando que a instrução de sistema não constitui uma fronteira de segurança. Em conjunto, os dois trabalhos justificam uma decisão de projeto verificável: a resposta do modelo deve ser tratada como dado não confiável, validada por esquema e submetida a confirmação humana antes de se tornar registro.

### 2.4 Segurança, privacidade e colaboração entre usuários

Em uma aplicação colaborativa, a mesma viagem abriga dados de regimes diferentes: o roteiro é do grupo, o diário é da pessoa. Isso exige decidir onde o controle de acesso é aplicado. Quando a decisão fica na interface, a garantia vale apenas para aquele cliente; qualquer outro consumidor da interface de programação a contorna.

O mecanismo adotado neste trabalho é a segurança em nível de linha (*row-level security*, RLS), recurso do PostgreSQL pelo qual políticas declarativas restringem, linha a linha, quais registros cada identidade pode ler ou gravar. Como a avaliação ocorre no motor do banco de dados, a mesma restrição se aplica ao aplicativo móvel, a um cliente HTTP arbitrário e a uma assinatura em tempo real. Em outras palavras, as políticas são aplicadas pelo banco e independem das validações realizadas pela interface.

Para os requisitos de segurança específicos de aplicações móveis, adota-se como referência o OWASP MASVS, na versão 2.1.0, que organiza os controles em oito categorias, entre elas armazenamento, autenticação, rede, plataforma e privacidade. O MASVS é utilizado aqui como vocabulário de classificação dos controles observados e como conjunto de boas práticas, não como certificação: nenhuma verificação formal de conformidade foi conduzida.

### 2.5 Trabalhos relacionados

Três trabalhos recentes tratam do mesmo domínio por ângulos distintos, e a comparação delimita o que este trabalho acrescenta.

Xie *et al.* (2024) avaliam a **capacidade do modelo** de produzir planos de viagem sob restrições. O Easy Trip toma esse resultado como premissa de projeto: se o planejamento automático erra com frequência, o sistema não pode gravar automaticamente aquilo que o modelo propõe.

Karlović *et al.* (2025) avaliam a **qualidade da recomendação** produzida por um sistema com recuperação vetorial. O Easy Trip não faz recuperação vetorial e não avalia a qualidade do conteúdo gerado; avalia o mecanismo que separa a proposta do modelo da gravação no banco.

Nikam, Verma e Ranade (2025) avaliam **conceito e protótipo** de um planejador móvel, com levantamento junto a usuários. Este trabalho é complementar: não realiza avaliação com usuários e, em contrapartida, apresenta um sistema implementado, com banco de dados, controle de acesso e testes executados.

**Quadro 1 — Comparação com trabalhos relacionados**

| Critério | Xie *et al.* (2024) | Karlović *et al.* (2025) | Nikam *et al.* (2025) | Este trabalho |
|---|---|---|---|---|
| Objeto avaliado | Agente de linguagem | Recuperação vetorial e reordenação | Conceito e protótipo de UX | Aplicação móvel implementada |
| Método | Benchmark com 1.225 intenções | Comparação de 7 modelos | Estudo de caso com 30 participantes | Estudo de caso do sistema desenvolvido |
| Uso de recuperação | Ferramentas sobre base | Índice vetorial e reordenação (RAG) | Não aplicável | Informações da viagem como contexto |
| Persistência avaliada | Não | Não | Não | Sim: 26 tabelas, 16 *migrations* |
| Controle de acesso avaliado | Não | Não | Não | Sim: RLS e matriz de políticas executada |
| Avaliação com usuários | Não | Não | Sim | Não |
| Evidência principal | Taxa de sucesso do plano | Qualidade da recomendação | Achados qualitativos | Rastreabilidade e execução de suítes |

Fonte: elaborado pelo autor (2026).

A leitura conjunta do quadro mostra a posição deste trabalho: nenhum dos três avalia persistência ou controle de acesso, e o único que avalia com usuários não avalia um sistema implementado. A contribuição aqui está no desenvolvimento de uma solução que integra esses recursos e na cadeia de evidência técnica — requisito, código, tabela, teste — construída sobre ela.

---

## 3 Metodologia e Desenvolvimento do Easy Trip

### 3.1 Classificação metodológica

**Quadro 2 — Classificação da pesquisa**

| Dimensão | Classificação | Justificativa |
|---|---|---|
| Natureza | Aplicada | Produz uma solução destinada a uso, não conhecimento puramente teórico |
| Abordagem | Mista | Contagens e execuções produzem dado quantitativo; a análise das decisões de projeto é qualitativa |
| Objetivo | Descritiva | Caracteriza e mede o estado do sistema desenvolvido; não estabelece relação causal nem compara tratamentos |
| Estratégia | Design Science Research | Construção e avaliação de uma solução (HEVNER *et al.*, 2004; PEFFERS *et al.*, 2007) |
| Procedimento | Estudo de caso único | O próprio Easy Trip constitui a unidade analisada; não há amostra de participantes |

Fonte: elaborado pelo autor (2026).

A Design Science Research é o referencial metodológico que orienta trabalhos cujo resultado principal é a construção de algo, e não a descrição de um fenômeno já existente. Hevner *et al.* (2004) formalizam esse paradigma em Sistemas de Informação, no qual o conhecimento é produzido pela construção e pela aplicação de uma solução, e estabelecem duas diretrizes que governam diretamente este trabalho: a solução precisa ser um objeto identificável e demonstrável, e sua utilidade precisa ser avaliada por métodos rigorosos e explicitados. Peffers *et al.* (2007) operacionalizam o paradigma em um processo de seis atividades — identificação do problema, definição de objetivos, projeto e desenvolvimento, demonstração, avaliação e comunicação —, que fornece a estrutura de apresentação adotada aqui e resumida no Quadro 3.

A consequência prática dessa escolha está na etapa de avaliação: em Design Science Research, avaliar não significa relatar que a solução foi construída, e sim confrontá-la com critérios definidos antes da medição. Por isso a seção 3.8 fixa métricas e critérios de aceitação *antes* de qualquer número apresentado na seção 4, e por isso as métricas que o sistema não permite medir são descartadas explicitamente, em vez de substituídas por impressões.

O trabalho **não** é um experimento. Não há grupo de controle, tratamento manipulado nem participantes humanos, e nenhuma afirmação deste artigo depende de inferência estatística. A opção por estudo de caso único decorre da própria questão de pesquisa: avaliar o que foi efetivamente implementado em um sistema específico exige acesso integral a ele, não amostragem.

**Quadro 3 — Atividades da Design Science Research aplicadas ao trabalho**

| Atividade (Peffers *et al.*, 2007) | Realização neste trabalho | Seção |
|---|---|---|
| Identificação do problema | Fragmentação das informações de planejamento e dificuldade de colaboração | 1.1 |
| Definição de objetivos da solução | Centralização, colaboração com privacidade, assistência por IA validada | 1.3 |
| Projeto e desenvolvimento | Aplicativo React Native/Expo com backend gerenciado | 3.2 a 3.6 |
| Demonstração | Modos conectado e de demonstração operantes sobre a mesma interface | 3.3 |
| Avaliação | Rastreabilidade, execução das suítes de testes e das políticas de acesso | 4 |
| Comunicação | Este artigo | — |

Fonte: elaborado pelo autor (2026).

### 3.2 Visão geral e funcionalidades do Easy Trip

O Easy Trip organiza a experiência em torno da viagem: cada viagem é um espaço que reúne o planejamento, os registros e os participantes, e todos os demais recursos operam dentro desse espaço. O Quadro 4 resume os módulos implementados e os recursos que cada um reúne na versão avaliada; a nota que segue o quadro distingue o que está implementado do que já opera no ambiente publicado.

**Quadro 4 — Módulos e funcionalidades do Easy Trip**

| Módulo | Recursos implementados |
|---|---|
| Autenticação e perfil | Cadastro, entrada na conta, recuperação de senha, manutenção do perfil e fluxo de exclusão de conta, este último com publicação pendente |
| Gestão de viagem | Criação e edição de viagens, com situação e contagem regressiva calculadas a partir das datas; capa personalizada escolhida na galeria; informações contextuais do destino, como o idioma falado |
| Roteiro | Atividades organizadas por dia na Jornada, com mapa embarcado e ação "Como chegar"; acesso às Sugestões a partir da própria Jornada |
| Lista de preparação | Itens a providenciar antes da viagem, marcáveis conforme são resolvidos |
| Finanças | Registro de despesas, conversão de valores para a moeda de referência, total gasto e saldo recalculados a cada leitura; meta de gasto diário com acompanhamento do valor utilizado, do disponível e do excesso |
| Carteira | Conversor de moedas de uso avulso, exibido apenas quando a moeda do orçamento e a do destino são diferentes |
| Reservas | Cadastro de reservas de sete tipos — voo, hospedagem, carro, ingresso, trem, ônibus e outros —, com anexo dos documentos correspondentes |
| Diário | Registro pessoal de anotações ao longo da viagem |
| Documentos e arquivos | Armazenamento dos anexos, que herdam o regime de visibilidade do registro a que pertencem |
| Trabalho fora de rede | Fila durável das alterações feitas sem conexão, com envio ao reconectar, indicação do que está pendente e resolução do que não pôde ser enviado |
| Colaboração | Convite de participantes nos papéis de editor e visualizador, gestão de membros, transferência de propriedade da viagem, saída da viagem e definição de visibilidade item a item |
| Avisos e lembretes | Avisos derivados dos compromissos e dos itens de todas as viagens acessíveis, cada um identificando a viagem de origem; entrega por notificação do sistema operacional, com o aparelho registrado por conta |
| Assistente de inteligência artificial | Conversa sobre a viagem e proposta de ações de planejamento revisáveis, além de sugestões por viagem e resumo diário sob acionamento, cuja automação periódica está pendente |
| Conteúdo editorial | Conteúdos e sugestões relacionados a viagens, disponibilizados aos usuários |
| Administração | Publicação e gestão do conteúdo editorial, restrita ao papel administrativo |

Fonte: elaborado pelo autor (2026).

O quadro descreve o que está **implementado** na versão avaliada, que não coincide integralmente com o que já **opera** no ambiente publicado. A capa personalizada e a meta de gasto diário dependem da publicação da *migration* 0013; a transferência de propriedade e a guarda que impede a exclusão de conta destrutiva dependem da 0014; a entrega de notificação fora do aplicativo depende da 0016 e da função de envio; o fluxo de exclusão de conta depende da publicação da Edge Function correspondente; e o resumo diário existe como função publicada e acionável, com o mecanismo de agendamento pronto na 0015 mas sem o agendamento criado no ambiente publicado. Todas essas dependências são retomadas como limitações em 4.6.

A única frente desta rodada que **opera integralmente hoje** é o trabalho fora de rede, que não depende de estrutura de dados nova. Convém, ainda assim, delimitá-la: a fila cobre roteiro, lista de preparação, despesas, diário e metas, e não cobre exclusão de conta, transferência de propriedade, alteração de papel, convites nem envio de arquivos — operações cujo resultado depende do estado do grupo no momento do envio, ou que destroem dado.

Três características atravessam todos os módulos. A primeira é a distinção entre o que pertence ao grupo e o que pertence à pessoa: itens de roteiro e de lista de preparação nascem compartilhados, enquanto entradas de diário e despesas nascem privadas, e o usuário pode alterar essa visibilidade item a item. A segunda é que os valores derivados — situação da viagem, contagem regressiva, total gasto, saldo e estado da meta diária — não são armazenados, e sim recalculados a partir dos registros a cada leitura, o que garante que o número exibido corresponda sempre aos dados existentes. A terceira é que informação redundante não é exibida: o idioma do destino aparece apenas quando difere do idioma do aparelho, e o conversor de moedas aparece apenas quando há de fato conversão a fazer.

Duas decisões de produto desta última rodada merecem registro, por serem representativas do critério adotado. A capa da viagem é escolhida na galeria e permanece como prévia local até que o usuário confirme: quem abre, escolhe e desiste não deixa arquivo algum no servidor, e "restaurar padrão" devolve a viagem à imagem sugerida na criação, que nunca deixou de existir. Já a meta de gasto diário soma exatamente as despesas que a Carteira já soma — não há rateio entre participantes nem uma segunda semântica financeira —, porque dois números da mesma tela que discordassem não seriam explicáveis a quem os lê.

### 3.3 Arquitetura da aplicação

O Easy Trip é uma aplicação móvel multiplataforma construída sobre Expo SDK 54.0.37, React Native 0.81.5, React 19.1.0 e TypeScript 5.9.3 em modo estrito, com roteamento por arquivos via Expo Router 6.0.24 em 48 arquivos de rota. O estado de servidor é gerido por TanStack Query 5.101.4, com o cache segregado por conta; o estado de sessão vive em provedores React; o estado de interface é local. A validação de formulários combina React Hook Form 7.85.0 e Zod 4.4.3, e a suíte de testes usa Jest 29.7.0 com jest-expo 54.0.18 e Testing Library React Native 13.3.3. A comunicação com o backend usa a biblioteca oficial Supabase JS 2.112.3. As versões citadas são as efetivamente resolvidas em `package-lock.json`, e não as faixas declaradas em `package.json`, o que permite reconstruir o mesmo ambiente de dependências.

A decisão arquitetural central do cliente é a camada de repositórios com contrato explícito, seguindo o padrão Repository descrito em 2.2. Dezenove interfaces declaram as operações de dados, e duas implementações completas as satisfazem: uma fonte conectada, que se comunica com o backend gerenciado por API REST sobre o esquema público, armazenamento de arquivos e canal de tempo real; e uma fonte local, persistida no próprio dispositivo, usada quando nenhuma variável de backend está configurada. Nenhuma tela sabe qual das duas está em uso.

Essa separação tem duas consequências verificáveis. A primeira é de manutenibilidade: substituir o backend não exige alterar telas. A segunda é de demonstrabilidade, no sentido de Peffers *et al.* (2007): o aplicativo pode ser executado integralmente sem provisionar infraestrutura, no modo de demonstração, o que sustenta a atividade de demonstração sem depender de um ambiente publicado.

A lógica de negócio é mantida isolada em vinte módulos de domínio que não importam React, React Native nem repositório — propriedade verificada por inspeção nesta avaliação — e cujas únicas dependências são a biblioteca de validação de esquema e utilitários próprios. Esse isolamento é o que torna a lógica testável sem montar componentes de interface. A arquitetura resultante é uma arquitetura em camadas com padrão Repository e domínio isolado, na qual a orquestração dos casos de uso ocorre nos *hooks* que ligam as telas aos repositórios.

Uma decisão de manutenibilidade desta rodada ilustra o critério aplicado à camada de utilitários. O aplicativo precisa responder duas perguntas sobre o destino — qual moeda se gasta e qual idioma se fala — e ambas partem do mesmo dado, o código ISO 3166-1 do país devolvido pelo serviço de geocodificação. Manter duas tabelas independentes produziria bases que divergem na primeira correção. Por isso existe um registro único de metadados de país, do qual a tabela de moedas passou a derivar em vez de manter cópia própria.

Os segredos de integração residem exclusivamente em cinco funções serverless — as Edge Functions do Supabase —, responsáveis pelas integrações que exigem processamento seguro ou credenciais protegidas: assistente de IA, sugestões por viagem, geração de conteúdo editorial, resumo diário e exclusão de conta. A credencial da API generativa (`GEMINI_API_KEY`) é mantida como segredo dessas funções e nunca entra no pacote distribuído do aplicativo.

As integrações externas estão no Quadro 5. Duas observações evitam leituras equivocadas. A primeira é que a conversão de moedas usa **dois** provedores com funções distintas: as despesas de viagem são convertidas pelo Frankfurter, que publica taxas de referência do Banco Central Europeu, enquanto o conversor avulso da Carteira consulta a ExchangeRate-API em modo de acesso aberto. A segunda é que o mapa embarcado não depende de um provedor único: `react-native-maps` delega ao provedor nativo do sistema operacional, o que significa Google Maps no Android e, potencialmente, Apple Maps no iOS. O Google Maps aparece separadamente, por *deep link*, apenas na ação "Como chegar".

**Quadro 5 — Serviços externos integrados**

| Serviço | Função no sistema | Credencial |
|---|---|---|
| Supabase | Autenticação, PostgreSQL, armazenamento, tempo real e Edge Functions | Chave publicável no cliente; chave de serviço no servidor |
| Google Gemini, via Generative Language API | Assistente de IA, sugestões, conteúdo editorial e resumo diário, com cadeia de modelos alternativos (seção 3.5) | `GEMINI_API_KEY`, exclusiva do servidor |
| Open-Meteo Forecast API | Previsão do tempo do destino | Dispensa chave |
| Open-Meteo Geocoding API | País, código ISO, coordenadas e fuso horário do destino | Dispensa chave |
| Frankfurter | Conversão de despesas, sobre taxas de referência do Banco Central Europeu | Dispensa chave |
| ExchangeRate-API (acesso aberto) | Conversor de moedas da Carteira | Dispensa chave |
| Provedor de mapas nativo, via `react-native-maps` 1.20.1 | Mapa embarcado nas telas de roteiro | Herdada da plataforma |
| Google Maps, por *deep link* | Ação "Como chegar" | Não aplicável |

Fonte: elaborado pelo autor (2026).

**Figura 1 — Arquitetura lógica em camadas**

```
Aplicativo (React Native / Expo)
  Telas (47 rotas, Expo Router)
      ↓
  Hooks (18, TanStack Query)  ←  Domínio isolado (20 módulos)
      ↓
  Repositórios (19 contratos)
      ↓                    ↓
  Fonte local          Fonte conectada
  (dispositivo)              ↓
                    ─────────┴─────────
                    ↓                 ↓
        Backend gerenciado      Edge Functions
        · Autenticação          · 6 implementadas
        · PostgreSQL 17           4 publicadas
          26 tabelas · RLS      · Detentoras dos segredos
          75 funções · 16 gatilhos       ↓
          77 políticas            Serviços externos
        · Armazenamento           · Google Gemini
          (5 buckets)             · Open-Meteo
        · Tempo real              · Frankfurter
                                  · ExchangeRate-API
```

Fonte: elaborado pelo autor (2026). Contagens medidas sobre o esquema **do repositório** (*migrations* 0001–0016), aplicado a uma instância descartável. O esquema **publicado** está na 0012 e não contém o que as quatro *migrations* pendentes acrescentam: as colunas de capa e meta diária, o bucket de capas, a transferência de propriedade, o agendamento do resumo diário e o registro de aparelhos para notificação.

### 3.4 Modelo de dados e persistência

O esquema foi construído por *migrations* sequenciais e imutáveis — nenhuma foi editada depois de aplicada, e as quatro acrescentadas nesta rodada não tocaram nenhuma anterior. São **dezesseis no repositório**, e o conjunto delas produz 26 tabelas, 75 funções, 16 gatilhos, 61 índices, 120 restrições e 77 políticas de acesso, medidos contra uma instância descartável com todas aplicadas.

**Doze estão publicadas.** As quatro pendentes — capa e meta diária; transferência de propriedade e guarda de exclusão de conta; agendamento do resumo diário; registro de aparelhos para notificação — foram aplicadas e verificadas contra instâncias descartáveis, tanto em instalação limpa quanto sobre uma base legada com dados, e cada uma traz verificações internas que abortam a aplicação se o resultado não for o esperado. A pendência é de autorização para publicar (seção 4.6).

A progressão registra a evolução da solução: esquema base e políticas iniciais; papéis administrativos e publicação de conteúdo; concessão explícita de privilégios; enrijecimento de perfil e de armazenamento; colaboração por viagem; visibilidade por item; notificações e lembretes; reservas tipadas; sugestões persistidas; e, nas quatro ainda não publicadas, capa e meta diária, transferência de propriedade, agendamento do resumo diário e endereços de entrega de notificação.

Duas decisões de modelagem merecem registro por sustentarem resultados posteriores.

A primeira é que **valores derivados não são persistidos**. Situação da viagem, contagem regressiva, total gasto, saldo e estado da meta diária são recalculados a partir dos registros a cada leitura, em módulos de domínio isolados. A consequência é que não existe classe de defeito por divergência entre o valor armazenado e o valor real: ela é eliminada por construção, e não por sincronização. O aviso de meta ultrapassada é o caso mais claro: por ser derivado, ele deixa de ser produzido no instante em que a despesa é corrigida para baixo, sem que nada precise ser apagado.

A segunda é que **a autoria e a visibilidade são decididas pelo banco**, e não enviadas pelo cliente. Gatilhos preenchem o autor do registro a partir da identidade da sessão, e as colunas de visibilidade têm valores padrão assimétricos por tabela: itens de roteiro e de lista de preparação nascem compartilhados, porque são do grupo; entradas de diário e despesas nascem privadas, porque são da pessoa. O valor padrão codifica a expectativa, e a política a impõe.

As *migrations* incluem verificações que interrompem a aplicação caso o efeito pretendido não se materialize — por exemplo, uma política que não foi criada ou um privilégio que não foi revogado. Assim, uma migração aplicada com sucesso é também uma confirmação de que a configuração pretendida está em vigor. Nesta avaliação, todas as dezesseis foram aplicadas contra instâncias PostgreSQL 17 descartáveis — em instalação limpa e sobre uma base legada com dados —, e essas verificações passaram (seção 4.3).

### 3.5 Assistência por inteligência artificial

A inteligência artificial no Easy Trip tem uma finalidade definida: reduzir o esforço de transformar a informação já registrada na viagem em planejamento organizado. Ela atua em quatro pontos, correspondentes às Edge Functions descritas em 3.3: o assistente, que conversa com o usuário e propõe ações de planejamento; as sugestões por viagem; a geração de conteúdo editorial; e o resumo diário.

**Como a IA auxilia o planejamento.** O usuário conversa com o assistente sobre uma viagem que ele mesmo escolhe. O contexto enviado ao modelo são os dados estruturados dessa viagem — destino, datas, roteiro, itens de preparação e demais registros pertinentes —, e a partir deles o assistente pode responder perguntas, comentar o que já está planejado e propor acréscimos. As propostas que o sistema aceita são de cinco tipos, todos aditivos: incluir atividades no roteiro, acrescentar itens à lista de preparação, registrar despesas, ajustar o valor do orçamento e criar uma meta. Um pedido de roteiro para um dia inteiro recebe tratamento próprio: quando a solicitação identifica de forma inequívoca uma data dentro do período da viagem, essa data é resolvida no servidor, de modo que os itens propostos possam ser validados contra o dia correto em vez de serem descartados por ambiguidade.

**Como as respostas são validadas.** O aplicativo nunca fala diretamente com o serviço generativo: toda chamada passa pelas Edge Functions, que detêm a credencial e montam a solicitação. O modelo é instruído a devolver **duas saídas separadas**: um texto destinado à leitura e uma lista de ações estruturadas que podem virar registros. Essa separação é o eixo do mecanismo de controle: o texto pode conter imprecisão sem consequência para os dados, porque não é ele que grava.

As ações propostas atravessam três pontos de validação independentes, todos localizáveis no código e cobertos por testes: validação por esquema no servidor, imediatamente após a resposta do modelo; revalidação por esquema no cliente, contra a viagem em que a conversa está; e verificação no executor, imediatamente antes da gravação. A elas soma-se uma conferência de coerência entre o que o texto afirma e o que a proposta de fato contém, que impede que uma resposta prometa "confirme no aplicativo" sem nada para confirmar.

**Por que nada é gravado automaticamente.** Nenhuma ação se torna registro sem confirmação explícita do usuário. A proposta é exibida como um cartão revisável, e a gravação subsequente ocorre com a sessão do próprio usuário, sujeita às mesmas políticas de acesso descritas em 3.6. O modelo, portanto, não obtém nenhum privilégio adicional: o que a IA pode gravar é exatamente o que aquela pessoa poderia gravar pela tela.

Há ainda uma barreira que não depende de vigilância. O tipo que representa a saída do modelo não define nenhuma operação destrutiva: não existe ação de exclusão ou de alteração em massa que o modelo possa expressar, porque os tipos definidos no sistema não permitem representá-la, e a verificação de tipos rejeita em tempo de compilação qualquer tentativa de introduzi-la. O mesmo vale para o esquema declarado à API generativa, que não possui campo de identificador, de arquivo ou de endereço externo. Isso responde diretamente ao risco descrito por Perez e Ribeiro (2022): mesmo que a instrução de sistema seja sequestrada por uma entrada adversária, a resposta do modelo não tem como codificar a operação perigosa.

**Como os dados sensíveis são tratados.** O contexto enviado é filtrado em duas dimensões. As entradas de diário, o dado mais sensível do sistema, são excluídas da composição do contexto, mesmo quando compartilhadas — propriedade coberta por teste automatizado. E o conteúdo privado dos demais participantes nunca entra: o contexto é montado a partir do que a identidade da sessão pode ler, de modo que uma despesa privada de outro membro não alcança o provedor externo.

**Disponibilidade do modelo.** O assistente não depende de um único modelo. A requisição percorre uma cadeia de cinco modelos da família Gemini em ordem de preferência, começando pelo `gemini-3.6-flash`. A troca ocorre apenas para falhas que outro modelo pode resolver — indisponibilidade, modelo inexistente e esgotamento de cota —, e não para erros que se repetiriam de todo modo; o conjunto de tentativas respeita um orçamento global da requisição, para que a busca por um modelo disponível não se converta em espera indefinida para o usuário. É um recurso de confiabilidade, e não uma contribuição científica.

**Figura 2 — Fluxo de uma ação sugerida pela inteligência artificial**

```
Usuário → Aplicativo → Edge Function ai-chat
                              ↓
              contexto autorizado da viagem
              (sem diário, sem privado de terceiros)
                              ↓
        Google Gemini (cadeia de 5 modelos, com fallback)
                              ↓
              { texto } + { ações estruturadas }
                              ↓
   [1] Validação por esquema no servidor → descarta ação malformada
                              ↓
   [2] Revalidação por esquema no cliente, contra a viagem da conversa
                              ↓
              Cartão de revisão exibido ao usuário
                              ↓
                 Confirmação humana explícita
                              ↓
   [3] Verificação no executor + gravação com a sessão do usuário
                              ↓
              Políticas de acesso avaliadas pelo banco
```

Fonte: elaborado pelo autor (2026).

### 3.6 Segurança, privacidade e controle de acesso

Como a mesma viagem reúne dados coletivos e pessoais, o controle de acesso do Easy Trip é aplicado pelo banco de dados, por meio de políticas de segurança em nível de linha (RLS). Toda tabela do esquema público tem RLS habilitada, e a identidade usada nas políticas é sempre a extraída do token da sessão, nunca um identificador enviado pelo cliente. É essa propriedade que torna seguro distribuir a chave publicável no pacote do aplicativo: sem uma sessão válida, ela não concede acesso a nada.

O ponto de projeto mais relevante é a **regra única de visibilidade**, aplicada de forma idêntica às cinco tabelas de conteúdo de viagem — roteiro, lista de preparação, despesas, diário e reservas:

> é membro da viagem **E** (o item é compartilhado **OU** o item foi criado pela própria identidade da sessão)

A regra não abre exceção para o proprietário da viagem. O diário privado de um participante não é legível pelo dono, e essa ausência de exceção é deliberada: se houvesse desvio para o proprietário, "somente eu" seria um rótulo de interface, e não uma garantia sobre o dado. A mesma condição é repetida nas políticas de alteração e de exclusão, e não apenas na de leitura, para que não seja possível apagar às cegas um registro que não se pode ver.

A colaboração se organiza em três papéis. O proprietário administra a viagem, seus participantes e suas configurações; o editor contribui com o conteúdo; o visualizador apenas lê. Convites oferecem os papéis de editor e visualizador — a propriedade não se convida, transfere-se —, e duas tabelas de protocolo, participantes e convites, **não possuem política de escrita alguma**. Nenhum cliente as altera diretamente pela API; toda mutação passa por funções do banco executadas com privilégio definido e caminho de busca fixo, que aplicam as regras do protocolo antes de gravar. Retirar a escrita da superfície REST impede que o mecanismo de convite seja usado por alguém para se incluir em uma viagem. A tabela de notificações segue um regime intermediário e igualmente deliberado: não há política de inserção, de modo que apenas funções do banco criam avisos, mas o destinatário pode marcá-los como lidos ou removê-los.

O acesso a arquivos combina dois critérios independentes, e o critério varia conforme a natureza do arquivo. Anexos pessoais e mídia de diário ficam sob o prefixo da identidade que os enviou, e o acesso compartilhado é concedido por consulta ao registro correspondente, não pelo caminho do arquivo: um anexo de reserva compartilhada é legível pelos membros porque a *linha* é compartilhada. A capa da viagem, introduzida na migração ainda não publicada, segue regra distinta e pelo motivo oposto: o arquivo é da viagem, não da pessoa, então o prefixo é o identificador da viagem e a pergunta que a política faz é "quem lê é membro desta viagem?". Fosse namespaced por usuário, um editor convidado veria a viagem sem capa. O bucket é privado e o acesso se dá por URL assinada temporária, e não por endereço público permanente — uma capa pública revelaria para onde a pessoa vai e quando.

Contra escalada de privilégio administrativo há quatro barreiras independentes: a política de inserção de perfil fixa o papel inicial; os privilégios de coluna revogam a atualização do campo de papel; um gatilho bloqueia a alteração; e a verificação de papel administrativo é uma função do banco, não uma consulta feita pelo cliente. Nenhuma das quatro depende das outras.

### 3.7 Objeto de estudo e procedimentos de avaliação

A avaliação foi conduzida sobre o repositório `easy-trip-3.0`, ramo `main`, em https://github.com/jp9141joao/easy-trip-3.0, e sobre o ambiente Supabase em que o projeto está publicado. Todas as medidas da seção 4 foram obtidas em 28 de agosto de 2026.

Uma delimitação de versão precisa ser registrada com precisão, porque afeta a reprodutibilidade. **A versão avaliada é o *commit* `d2e6a3b`**, ponta do ramo `main` no momento da medição, com a árvore de trabalho limpa. Ele acrescenta ao histórico a rodada de fechamento descrita neste artigo — transferência de propriedade, guarda de exclusão de conta, fila de escrita fora de rede, notificações do sistema operacional, agendamento do resumo diário, as *migrations* 0014 a 0016, a infraestrutura de execução das suítes de ponta a ponta, os fluxos de integração e publicação contínuas, e os instrumentos de medição de desempenho, de sondagem de segurança e de avaliação da inteligência artificial.

Diferentemente das rodadas anteriores, **não há separação entre o *commit* do produto e o do arcabouço de teste**: todos os números da seção 4 são reproduzíveis a partir de um único ponto do histórico, por comandos versionados no próprio repositório — `scripts/sql-test.sh` para o banco, `scripts/e2e/e2e-run.sh` para a camada de API, `scripts/count-artifacts.sh` para as contagens de artefato, `scripts/benchmark.mjs` para o desempenho, `scripts/security-probe.mjs` para a sondagem de segurança e `scripts/ai-eval/run.mjs` para a validação da inteligência artificial. Nenhum deles depende de credencial de produção, e todos criam e destroem os ambientes que usam.

Uma advertência de procedência também precisa ser registrada. A documentação interna do projeto — o arquivo `README.md` e os registros de status — declara versões de biblioteca e totais de teste divergentes do que o repositório contém, por não ter sido atualizada ao longo das iterações. Nenhum dado deste artigo provém dessa documentação: as versões foram lidas de `package-lock.json`, `app.json` e `supabase/config.toml`, as contagens de banco foram medidas contra uma instância real, e os totais de teste vieram das execuções descritas em 4.3.

Os procedimentos de avaliação consistiram em seis etapas, aplicadas nesta ordem:

1. **Inventário estático automatizado.** Contagem de arquivos, rotas, módulos de domínio, *hooks*, contratos de repositório, serviços e Edge Functions por roteiro versionado que imprime, ao lado de cada número, o comando que o produziu — o que remove a categoria de erro representada por listas mantidas à mão.
2. **Inventário executado do banco.** Provisionamento de uma instância PostgreSQL 17 descartável, aplicação das *migrations* na ordem e medição do esquema resultante por consulta aos catálogos do sistema, em vez de contagem de instruções no texto das migrações.
3. **Levantamento dos requisitos a partir da implementação existente.** Identificação dos requisitos funcionais e não funcionais a partir do código, das telas e do esquema do banco, uma vez que o projeto não mantinha um documento de requisitos fiel à versão avaliada. Cada requisito só foi registrado quando localizável em um artefato concreto.
4. **Rastreabilidade.** Ligação de cada requisito funcional à tela, ao módulo de código, à estrutura de dados e ao conjunto de teste correspondentes, com registro do estado de publicação de cada dependência.
5. **Verificação executada.** Execução da suíte automatizada, das sete suítes SQL de controle de acesso, das onze suítes de ponta a ponta contra uma pilha Supabase dedicada, da verificação de tipos nos dois projetos TypeScript, da análise estática, da verificação de ambiente, da medição de desempenho, da sondagem de segurança sem credencial e da avaliação da validação da inteligência artificial. Também a inspeção, somente leitura, do estado publicado do backend.
6. **Contraprova das suítes novas.** Para cada suíte criada nesta rodada, o defeito que ela existe para detectar foi deliberadamente reintroduzido, e verificou-se que ela reprova — na asserção esperada e com a mensagem esperada. Uma suíte que continuasse passando com o defeito presente seria evidência de nada, e esta etapa é o que distingue um teste de um enfeite.

### 3.8 Métricas e critérios de aceitação

**Quadro 6 — Métricas adotadas, instrumentos e critérios**

| Métrica | Instrumento | Critério de aceitação |
|---|---|---|
| Cobertura de rastreabilidade dos RF | Matriz requisito → código → tabela → teste | ≥ 90% dos RF com artefato de código **e** estrutura de dados localizados |
| Resultado da suíte automatizada | `npx jest --runInBand` | 0 falhas |
| Erros de tipagem | `npx tsc --noEmit` nos dois projetos | 0 erros |
| Erros de análise estática | `npx eslint .` | 0 erros |
| Verificação de ambiente | `npx expo-doctor` | Todas as verificações aprovadas |
| Aplicação das *migrations* | Aplicação sequencial em PostgreSQL 17 descartável | Todas aplicam, com suas próprias verificações aprovadas |
| Cobertura das políticas de acesso | Consulta aos catálogos do banco × matriz de acesso pretendida | Toda tabela com dado de usuário sob política; nenhuma escrita direta nas tabelas de protocolo |
| Execução das políticas de acesso | Execução das suítes SQL contra instância provisionada | 0 falhas |
| Validação das ações sugeridas pela IA | Leitura do fluxo do modelo até a gravação | ≥ 2 pontos independentes de validação e confirmação humana obrigatória |
| Uso de tipagem estática | Contagem de `any` em `src/` | 0 |

Fonte: elaborado pelo autor (2026).

**Limitações das métricas e itens descartados.** A coerência do trabalho exige declarar o que não se pode medir com o material disponível, em vez de estimar. Foram descartadas, com a respectiva razão:

- **Escala de usabilidade (SUS), tempo de tarefa, taxa de erro por tarefa e satisfação**: exigem estudo com participantes, que não foi conduzido nesta etapa. Nenhuma afirmação sobre carga cognitiva, facilidade de uso ou tempo de planejamento está, por isso, dentro do escopo dos resultados.
- **Latência do ambiente publicado, percentis de resposta e disponibilidade**: exigem ambiente instrumentado. Embora quatro das seis Edge Functions estejam publicadas, não há coleta de métricas nem monitoração configurada. Há, nesta rodada, medição de latência contra a pilha **local** (seção 4.3), que não descreve produção.
- **Tempo de partida, taxa de quadros e consumo de memória do aplicativo**: exigem Android instrumentado e *build* de desenvolvimento, indisponíveis nesta rodada. Nenhum desses valores foi estimado.
- **Cobertura instrumentada de código**: o escopo está configurado no projeto, mas o relatório nunca foi coletado; declarar um percentual sem coletá-lo seria fabricação.
- **Qualidade dos roteiros produzidos pela inteligência artificial**: avalia-se o mecanismo de validação e o comportamento da integração, não a utilidade ou a correção do conteúdo gerado, que exigiria avaliadores humanos. Uma rubrica para essa avaliação foi elaborada nesta rodada e **não aplicada**.
- **Densidade de defeitos em produção**: não há base de usuários que a torne mensurável.
- **Conformidade WCAG e verificação automatizada de acessibilidade**: apenas inspeção estática foi realizada; não há ferramenta de verificação integrada ao projeto.
- **Teste de intrusão independente e certificação de conformidade ao OWASP MASVS**: não foram conduzidos. O que existe é uma avaliação **interna** orientada pelo MASVS 2.1.0, conduzida pela própria equipe e descrita em 4.4; ela não é, e não é apresentada como, certificação.

---

## 4 Avaliação do Easy Trip e Resultados

### 4.1 Avaliação das funcionalidades e rastreabilidade dos requisitos

O levantamento a partir da implementação identificou **74 requisitos funcionais**, distribuídos por autenticação e perfil, gestão de viagem, roteiro, lista de preparação, finanças, reservas, diário, colaboração, avisos, inteligência artificial e sugestões, conteúdo editorial e administração. Esses grupos correspondem aos módulos descritos na seção 3.2, o que atende ao objetivo específico 1.

Desses 74, sessenta e quatro correspondem ao conjunto da rodada anterior e **dez foram acrescentados nesta**, todos decorrentes de funcionalidades novas localizáveis em código, e agrupados em três frentes que respondem diretamente a limitações antes declaradas:

- **transferência de propriedade** — transferir a viagem a outro viajante; escolher o destinatário entre os participantes que já aceitaram o convite;
- **exclusão de conta segura** — ser impedido de excluir a conta enquanto proprietário de viagem compartilhada, com o motivo nomeado e o caminho indicado;
- **fila de escrita fora de rede** — registrar alterações feitas sem conexão para envio posterior; consultar as alterações pendentes; tentar novamente o envio de uma delas; descartá-la;
- **avisos fora do aplicativo** — ligar e desligar as notificações do sistema neste aparelho; receber avisos com o aplicativo fechado; abrir a viagem correspondente ao tocar o aviso.

**Tabela 1 — Rastreabilidade dos requisitos funcionais**

| Situação | RF | Proporção |
|---|---:|---:|
| Implementado, rastreável e operante sobre o esquema publicado | 63 | 85,1% |
| Implementado e rastreável, dependente da *migration* 0013 não publicada | 4 | 5,4% |
| Implementado e rastreável, dependente da *migration* 0014 não publicada | 3 | 4,1% |
| Implementado e rastreável, dependente da *migration* 0016 e da função de envio, não publicadas | 3 | 4,1% |
| Implementado e rastreável, dependente de Edge Function não publicada | 1 | 1,4% |
| Não implementado | 0 | 0% |
| **Total** | **74** | **100%** |

Fonte: elaborado pelo autor (2026).

O critério de aceitação do Quadro 6 diz respeito à rastreabilidade até código e estrutura de dados, e foi atendido: **os 74 requisitos têm ambos localizados**, incluindo os onze cuja dependência de publicação não está satisfeita. A Tabela 1 acrescenta a essa leitura a dimensão que o critério não captura e que importa para a honestidade do resultado: estar implementado não é o mesmo que estar operante no ambiente publicado — e o número de requisitos nessa condição **cresceu** nesta rodada, de cinco para onze, porque foram construídas funcionalidades cujas estruturas de dados aguardam autorização para publicação.

Vale notar o caso que **não** entrou nessa lista. Os quatro requisitos da fila de escrita fora de rede operam sobre o esquema já publicado: a fila vive no aparelho, e o que ela envia ao servidor são as mesmas operações que já existiam. Foi a única das quatro frentes novas que não trouxe *migration* junto, e por isso é a única inteiramente operante hoje.

Os requisitos com dependência pendente são de quatro naturezas. Quatro — capa da viagem, restauração da imagem padrão, definição e acompanhamento da meta diária — dependem da *migration* 0013. Três dependem da 0014, que traz a transferência de propriedade e a consulta que bloqueia a exclusão de conta. Três dependem da 0016, que registra os aparelhos, e da função de envio de notificação. O último é a exclusão de conta em si, cuja Edge Function não está publicada. Em todos os casos a pendência é de autorização para publicar: as quatro *migrations* foram aplicadas com sucesso contra bancos descartáveis, tanto em instalação limpa quanto sobre uma base legada, e tiveram suas próprias verificações internas aprovadas.

Dez casos de uso foram reconstruídos a partir dos requisitos — planejar viagem, compartilhar viagem, registrar despesa em moeda estrangeira, cadastrar reserva com documento, gerar roteiro por inteligência artificial, obter sugestões, publicar conteúdo editorial, sair da viagem, recuperar senha e excluir conta —, cada um ligado ao conjunto de requisitos que cobre e aos módulos que o implementam.

### 4.2 Avaliação dos requisitos não funcionais

Foram identificados **70 requisitos não funcionais**, classificados por categoria e confrontados com a evidência disponível. São os 61 da rodada anterior mais nove decorrentes das mudanças desta:

| Novo RNF | Categoria |
|---|---|
| A transferência de propriedade é atômica — não existe estado intermediário com dois proprietários ou nenhum | Segurança |
| A exclusão de conta não destrói dado de terceiros | Privacidade |
| O segredo do agendamento não é gravado em texto no comando agendado | Segurança |
| O endereço de entrega de notificação de uma conta é inalcançável por outra | Segurança |
| O texto da notificação não expõe dado sensível na tela de bloqueio | Privacidade |
| A fila de escrita sobrevive ao encerramento abrupto do aplicativo | Confiabilidade |
| O reenvio de uma escrita é idempotente, por identificador gerado no aparelho | Confiabilidade |
| Verificação contínua a cada alteração proposta | Manutenibilidade |
| Publicação sujeita a aprovação humana e a regressão completa | Manutenibilidade |

**Quadro 7 — Síntese dos requisitos não funcionais por categoria**

| Categoria | RNF | Evidência forte | Forte no código, pendente de publicação | Ausentes ou não verificáveis |
|---|---:|---:|---:|---|
| Segurança | 15 | 11 | 4 | — |
| Privacidade | 12 | 8 | 2 | Política de privacidade publicada; política de retenção |
| Confiabilidade | 10 | 10 | — | — |
| Manutenibilidade | 10 | 9 | — | Monitoração de execução |
| Usabilidade | 6 | 6 | — | — |
| Acessibilidade | 5 | 4 | — | Verificação automatizada |
| Desempenho | 5 | 5 | — | — |
| Disponibilidade | 4 | 3 | — | Monitoração e acordo de nível de serviço |
| Portabilidade | 3 | 3 | — | — |
| **Total** | **70** | **59** | **6** | **5 lacunas em 4 categorias** |

Fonte: elaborado pelo autor (2026).

Duas lacunas da rodada anterior fecharam, e é preciso ser exato sobre o que fechou.

A de **manutenibilidade** — "verificação contínua (ausência de CI/CD)" — fechou porque existem três fluxos de trabalho versionados: um que roda tipagem, análise estática, suíte automatizada, verificação de ambiente e as suítes SQL a cada alteração proposta; outro que executa a suíte de ponta a ponta sob demanda e diariamente; e um terceiro que publica *migrations* e funções **somente** por acionamento manual, a partir do ramo principal, com a regressão completa executada antes e aprovação humana exigida depois dela. Nenhum dos dois primeiros usa segredo de produção, o que é propriedade e não limitação: uma verificação de qualidade que exigisse credencial de produção não poderia rodar sobre uma contribuição externa.

A de **desempenho** — "métrica medida" — fechou parcialmente, e o adjetivo é a parte importante. Há agora medição reprodutível, com aquecimento descartado, N declarado, média, mediana e p95, sobre as funções de domínio e sobre a leitura do *backend* local. Não há, e continua não havendo, medição em aparelho: tempo de partida, taxa de quadros e consumo de memória exigem Android instrumentado. O que a categoria perdeu foi a lacuna "nenhuma métrica"; o que ela não ganhou está declarado em 4.6.

Em contrapartida, o número de requisitos **pendentes de publicação** subiu de dois para seis, pela mesma razão descrita em 4.1: quatro das cinco frentes desta rodada trouxeram estrutura de dados nova.

As lacunas restantes concentram-se onde seria de esperar em um projeto acadêmico: o que exige operação contínua — monitoração de execução, acordo de nível de serviço — e os instrumentos jurídicos que só fazem sentido com base de usuários real.

Vale destacar um resultado sobre a disciplina de projeto. Das dezesseis limitações arquiteturais identificadas na rodada anterior, quinze estavam declaradas em comentário no próprio código, com a alternativa considerada e a razão da escolha. **Três delas deixaram de ser limitações nesta rodada** — ausência de fila de escrita fora de rede, ausência de notificação do sistema operacional e ausência de transferência de propriedade —, e as duas primeiras foram implementadas exatamente na direção que o comentário antecipava. A resolução de conflito pela última escrita permanece, agora acompanhada de uma política explícita para o que **não** se resolve assim: linha apagada no servidor, permissão negada e dado inválido não são sobrescritos em silêncio, e sim marcados como pendentes de decisão. A única limitação ainda não declarada em código continua sendo a ausência de política automática de retenção de dados.

### 4.3 Verificação por execução

Esta subseção separa deliberadamente os níveis de evidência: o que foi executado sobre a aplicação, o que foi executado contra um banco provisionado, e o que permanece inventariado.

**Tabela 2 — Verificações executadas em 28 de agosto de 2026**

| Verificação | Comando | Resultado | Critério |
|---|---|---|---|
| Suíte automatizada | `npx jest --runInBand` | 124 conjuntos, 1.686 casos, 0 falhas, 39,2 s | Atendido |
| Tipagem do aplicativo | `npx tsc --noEmit` | 0 erros | Atendido |
| Tipagem das Edge Functions | `npx tsc -p supabase/functions/tsconfig.json` | 0 erros | Atendido |
| Análise estática | `npx eslint .` | 0 erros, 9 avisos (todos em `tests/`) | Atendido |
| Ambiente | `npx expo-doctor` | 18 de 18 verificações aprovadas | Atendido |
| Uso de tipagem estática | contagem de `any` em `src/` | 0 | Atendido |
| Marcadores pendentes | contagem de `TODO`/`FIXME` em `src/` | 0 | — |
| Aplicação das *migrations* | 0001–0016 em PostgreSQL 17.6 descartável (`scripts/sql-test.sh`) | 16 de 16 aplicadas, verificações internas aprovadas | Atendido |
| Atualização de base legada | 0001–0007 + dados + 0008–0016 | aplicada, 31 asserções | Atendido |
| Suítes SQL de controle de acesso | 7 arquivos do repositório contra bancos descartáveis | **265 asserções, 0 falhas** | Atendido |
| **Suíte de ponta a ponta** | `./scripts/e2e/e2e-run.sh` | **11 arquivos, 11 executados, 403 asserções, 0 falhas, 0 ignoradas** | Atendido |
| Sondagem de segurança sem credencial | `node scripts/security-probe.mjs` | 42 verificações, 0 falhas | Atendido |
| Avaliação da validação da IA | `scripts/ai-eval/run.mjs` | 18 cenários, 18 aprovados | Atendido |

Fonte: elaborado pelo autor (2026).

Todas as verificações são reproduzíveis por um comando versionado no repositório. As três últimas linhas e as duas de banco de dados usam contêineres descartáveis, criados e destruídos pela própria execução, e nenhuma delas toca o ambiente publicado.

Os 1.686 casos distribuem-se por domínio, validação de esquema, serviços, repositórios, *hooks*, componentes, autenticação, inteligência artificial, autorização de interface e integração. As áreas com cobertura mais densa são domínio, esquemas, autenticação, inteligência artificial e administração. A integração concentra-se em seis conjuntos que exercitam fluxos completos: caminho feliz de criação de viagem, isolamento entre viagens, colaboração, ações de inteligência artificial, conteúdo editorial e comportamento sem rede. Os testes dedicados à inteligência artificial agrupam-se em protocolo da função, cadeia de modelos alternativos, validação das ações, cartão de revisão e execução, roteiro de dia inteiro, isolamento de contexto entre viagens, privacidade na composição do contexto e diagnóstico de falhas.

As suítes SQL de controle de acesso passaram de quatro para sete arquivos, e a execução delas foi automatizada em `scripts/sql-test.sh`, que sobe um PostgreSQL descartável, cria um banco novo por suíte, aplica as *migrations* na ordem e destrói tudo ao final. Resultados: conteúdo editorial, 28 asserções; regra de publicação de artigos, 8; matriz de colaboração e visibilidade por item, 92; atualização de um banco legado, 31; transferência de propriedade, 38; tokens de notificação, 29; e agendamento do resumo diário, 39. Somam **265 asserções, sem falhas**.

Três das novas suítes foram submetidas a **contraprova**, procedimento que este trabalho passou a adotar para distinguir um teste que passa de um teste que mede. Removida a atualização de `trips.user_id` da função de transferência, a suíte correspondente interrompe na asserção 14 com a mensagem exata do defeito; reposta a interpolação da credencial no comando agendado, a suíte de agendamento reprova na asserção que verifica `cron.job.command`. Um teste que continuasse passando depois de o defeito ser reintroduzido não estaria medindo nada.

Um defeito do arcabouço de teste foi encontrado e corrigido no curso desta avaliação, e o registro é devido porque explica por que essas suítes nunca haviam sido executadas até o fim. O arquivo de preparação do ambiente local reimplementa a função de identidade do backend gerenciado, e essa reimplementação divergia da original em um detalhe: convertia o conteúdo do token antes de tratar o caso de valor vazio. Quando um cenário devolvia a sessão ao papel administrativo — situação em que o token é vazio —, a conversão levantava exceção e interrompia a matriz de colaboração após 78 asserções. A correção inverte a ordem das duas operações, tratando o valor vazio antes da conversão, exatamente como faz a definição do serviço gerenciado e como a função vizinha do mesmo arquivo já fazia. A divergência era do arcabouço de teste, e não do produto: nenhuma *migration*, política ou função do esquema foi tocada, e o ambiente publicado, que usa a definição própria da plataforma, nunca esteve afetado. **Com a correção incorporada ao repositório no *commit* `93463a8`, posterior ao `c8121ba` e restrito ao arquivo de suporte de teste, as quatro suítes são executadas diretamente a partir dele**, sem substituição manual de função na instância, e a matriz de colaboração passa a completar as suas 92 asserções.

**A suíte de ponta a ponta passou a ser executada, e este é o principal avanço de evidência desta rodada.** Nas avaliações anteriores ela figurava como contagem estática de blocos escritos — 292, depois recontados em 293 chamadas de verificação em nove arquivos —, explicitamente não apresentada como resultado de aprovação.

O impedimento não era o código dos testes, e a causa merece registro porque não se parece com o sintoma. A pilha de teste era remontada por baixo dos contêineres em execução: o diretório de trabalho era apagado e recriado com a pilha de pé, os contêineres continuavam montando o *inode* antigo — já removido — e passavam a enxergar uma pasta vazia. O efeito era o ambiente de execução das Edge Functions respondendo 503 com "falha ao determinar o ponto de entrada" a toda chamada, o que se assemelha a um erro de compilação e não a uma montagem órfã de sistema de arquivos.

A infraestrutura construída nesta rodada (`scripts/e2e/`) resolve o problema e o isolamento simultaneamente: uma pilha Supabase **dedicada**, com identificador de projeto e portas próprios, que convive com o ambiente de desenvolvimento do autor sem tocá-lo, e cujos volumes são destruídos ao final — sem o que o próprio gerenciador restauraria, na subida seguinte, as contas criadas na execução anterior. A semente é mínima e exclusiva de teste. Cada arquivo mantém o guarda que recusa qualquer endereço que não seja local, e o executor repete a verificação antes de invocar qualquer suíte.

A primeira execução real terminou com **28 falhas**, e nenhuma era defeito do produto: vinte e duas decorriam da montagem órfã descrita acima; quatro, de a semente mínima não conter as duas linhas de conteúdo editorial de que a matriz de acesso depende para exercitar tabelas de vínculo; e duas, de o segredo do agendamento não estar instalado na pilha de teste, o que fazia duas asserções medirem a ausência de configuração em vez da regra de autorização. As três causas foram corrigidas no arcabouço, e a última destravou ainda uma asserção que vinha sendo ignorada.

Resultado final: **11 arquivos, 11 executados, 403 asserções aprovadas, 0 falhas e 0 ignoradas**, em cerca de 17 segundos. Aos nove arquivos originais somaram-se dois criados nesta rodada — transferência de propriedade e tokens de notificação.

Duas observações sobre o número 403, para que ele não seja lido como mais do que é. Primeiro, **403 é execução e 293 é texto-fonte**: a contagem estática conta chamadas escritas, e a execução conta asserções emitidas, que são mais porque várias chamadas estão dentro de laços. Não são a mesma medida e não se somam. Segundo, estes testes exercitam a API HTTP contra uma pilha **local**: o que passa aqui passa contra o esquema do repositório, e não contra o projeto publicado.

Registra-se ainda, com o peso que lhe cabe, que o fluxo de ações de roteiro do assistente foi exercitado manualmente pelo desenvolvedor em aparelho Android físico antes do último *commit*. É um **teste funcional manual do próprio autor**, e não uma avaliação com usuários nem um teste de usabilidade: serve para indicar que o caminho completo — pedido, proposta, confirmação e gravação — foi percorrido contra o ambiente publicado, e nada além disso.

### 4.4 Avaliação dos mecanismos de segurança e da validação da inteligência artificial

A medição do esquema contra uma instância real confirma cobertura integral: as **26 tabelas** do esquema público têm segurança em nível de linha habilitada, sem exceção, e são governadas por **77 políticas** — 66 no esquema público e 11 sobre os objetos de armazenamento. Toda tabela que contém dado de usuário está sob política. Das **75 funções** do esquema público, **34 são executadas com privilégio definido, e todas as 34 têm caminho de busca fixo**, o que impede que a resolução de esquema seja usada para desviar a execução para outro objeto — verificação que passou a ser feita pelas próprias *migrations* 0014, 0015 e 0016, que abortam se alguma função nova violar a regra.

Duas contagens desta medição são asserções disfarçadas, e valem por si: **nenhuma tabela do esquema público está sem segurança em nível de linha**, e **nenhuma concede privilégio de leitura ao papel anônimo**. A segunda é deliberada e mais restritiva do que o padrão da plataforma, que concede ao papel anônimo e confia na política para barrar: o Easy Trip não tem área pública, e a ausência do privilégio é a segunda barreira, para o dia em que a primeira falhar. Uma *migration* verifica isso a cada aplicação.

Duas tabelas de protocolo — participantes e convites — não possuem política de escrita alguma, e sua mutação ocorre exclusivamente por funções do banco, conforme descrito em 3.6. A tabela de notificações não possui política de inserção, mas possui políticas de atualização e de exclusão, para que o destinatário possa marcar um aviso como lido ou removê-lo. Essa distinção é registrada porque a rodada anterior de avaliação descrevia três tabelas sem qualquer escrita, o que a medição não sustenta.

A execução das suítes SQL permite afirmar mais do que a leitura permitia. A regra única de visibilidade foi exercitada contra o motor do banco, com identidades distintas assumindo os papéis de proprietário, editor, visualizador e ex-membro, e as 92 asserções da matriz de colaboração passaram. Entre elas está a propriedade central deste projeto: o conteúdo privado de um participante permanece ilegível para o proprietário da viagem. As 31 asserções do teste de atualização confirmam que um banco no esquema anterior, com dados, atravessa as migrações de colaboração e visibilidade sem que nenhum registro perca dono, visibilidade ou vínculo com a viagem.

As 38 asserções da transferência de propriedade acrescentam a essa matriz a dimensão que faltava. Duas delas merecem menção. A primeira verifica que, **depois da transferência, o antigo proprietário deixa de sê-lo** — o que só é verdade porque a operação grava as duas origens de autorização na mesma transação; uma implementação que atualizasse apenas a tabela de participantes deixaria a viagem com dois donos, e uma suíte que olhasse apenas para ela não perceberia. A segunda verifica que **a transferência não move conteúdo privado**: o novo proprietário continua sem ver o diário do antigo, porque privacidade e propriedade são eixos separados no modelo, e transferir um não move o outro.

O critério relativo às ações sugeridas pela inteligência artificial exigia ao menos dois pontos independentes de validação e confirmação humana obrigatória. Foram observados três pontos de validação, a conferência de coerência entre texto e proposta, a confirmação humana explícita e a impossibilidade de o modelo expressar uma operação destrutiva pelos tipos definidos no sistema; o critério foi atendido com margem.

Nesta rodada esse mecanismo passou a ser **medido**, e não apenas descrito. Foi construído um instrumento com 18 cenários sintéticos — nenhum diário, nenhuma despesa e nenhuma viagem de pessoa real participa — que exercitam cinco famílias de risco: aderência a datas, alucinação de campo, limites de tamanho, coerência de valores e roteiro de dia inteiro. Os 18 são aprovados, e a taxa de descarte observada é de 39,1%, número que descreve a severidade da validação e não a qualidade do modelo, já que a maioria dos cenários existe para exercitar uma resposta ruim.

A construção do instrumento produziu um achado sobre o próprio objeto. A primeira versão reprovou quatro cenários, e o erro era do instrumento: ele media uma camada só. A validação de contrato descarta o que é impossível — tipo desconhecido, data inexistente, valor absurdo —, mas trata um campo acessório inválido como **campo ausente**, e não como item recusado; e a validação de coerência com a viagem **não descarta**, avisa: uma data fora do período chega à tela desmarcada, com o motivo escrito. Uma avaliação que medisse apenas a primeira camada concluiria que o sistema aceita datas fora da viagem; uma que medisse apenas a segunda, que ele aceita qualquer coisa. Nenhuma das duas conclusões seria verdadeira, e a experiência é registrada porque o risco de medir a camada errada não é particular deste projeto.

**A qualidade do conteúdo continua não avaliada.** O instrumento mede as defesas, não a utilidade do roteiro. Além disso, a camada que exercitaria o modelo real **não foi executada** nesta rodada, por indisponibilidade de credencial do provedor; nenhum número foi estimado em seu lugar, e o executor traz teto de chamadas para quando ela puder ser executada.

**Avaliação interna orientada pelo OWASP MASVS.** Foi conduzida nesta rodada uma avaliação de segurança contra os controles do MASVS 2.1.0, registrada em `SECURITY_MASVS_ASSESSMENT.md`. É necessário nomeá-la com precisão: **não é um teste de intrusão**. Não houve avaliador independente, não houve tentativa de exploração além de leitura e de chamadas malformadas, e não houve análise de binário nem instrumentação de aparelho. O trabalho **não** se declara conforme ao MASVS, porque conformidade formal exige verificação por terceiro, que não ocorreu.

O que a avaliação sustenta é mais modesto e verificável: dos 24 controles avaliados, 16 têm controle implementado **e** evidência automatizada que falha se ele for removido, 5 foram verificados por revisão de código, 1 é inaplicável à arquitetura com justificativa registrada, 1 é parcial e 1 permanece não verificado por exigir *build* nativo.

**Um defeito foi encontrado, e o registro é devido.** Uma sondagem sem credencial (`scripts/security-probe.mjs`, 42 verificações) esperava que toda Edge Function recusasse com 401 ou 403 quem não se autenticou, e recebeu 503 de uma delas: a função de geração de conteúdo administrativo verificava a presença da chave do provedor de IA **antes** de autenticar, informando a um chamador anônimo se aquela implantação estava configurada. Não há dado de usuário no vazamento, e a severidade é baixa — mas é informação de infraestrutura entregue a quem não provou identidade alguma, e contrariava um princípio que outra função do mesmo projeto já enunciava em comentário. A verificação foi movida para depois da autenticação e da autorização por papel, e uma regressão prende a ordem nas **três** funções que operam com credencial de servidor, e não apenas naquela que estava errada. A correção foi submetida a contraprova.

É preciso ser exato quanto ao alcance desta subseção. O que foi verificado por execução é que as políticas existem, cobrem as tabelas, expressam a matriz de acesso pretendida, **são aplicadas pelo motor do banco** — 265 asserções SQL — **e são aplicadas pela API HTTP diante de requisições reais** — 403 asserções de ponta a ponta, incluindo 74 da matriz de acesso por HTTP. Esta última camada deixou de ser inventário nesta rodada.

O que permanece **não** verificado por execução é o comportamento do ambiente **publicado**: toda a evidência acima vem de pilhas locais e descartáveis. As quatro *migrations* pendentes — 0013, 0014, 0015 e 0016 — não foram aplicadas ao projeto remoto, e a correção de segurança descrita acima existe no repositório, mas a versão publicada da função ainda é a anterior.

### 4.5 Discussão

Retomando a questão de pesquisa: em que medida o Easy Trip integra os recursos previstos, e com que evidência.

Quanto à **integração das funcionalidades**, a resposta é forte. Os 74 requisitos funcionais identificados cobrem os módulos apresentados no Quadro 4, todos são rastreáveis até um artefato de código e uma estrutura de dados, e 63 operam sobre o esquema já publicado. Planejamento de roteiro, organização, controle financeiro com meta diária e conversão de moedas, reservas, documentos, diário, colaboração e assistência por inteligência artificial coexistem sobre o mesmo modelo de dados e a mesma identidade de usuário, que era precisamente o que a fragmentação descrita em 1.1 impedia. A matriz de rastreabilidade é o que permite afirmar isso requisito a requisito, e não por impressão geral.

Há aqui um resultado que convém não maquiar. O número de requisitos **implementados mas não operantes em produção** cresceu de cinco para onze nesta rodada. Isso não é regressão: é a consequência aritmética de construir quatro frentes novas, três das quais trouxeram estrutura de dados. Um trabalho que quisesse melhorar a aparência da Tabela 1 teria construído menos, ou teria publicado sem autorização. A leitura correta é que a distância entre *implementado* e *operante* é hoje maior do que era, e que ela é inteiramente explicada por quatro *migrations* e duas funções aguardando uma decisão de publicação que não é técnica.

Quanto aos **requisitos não funcionais**, a resposta é forte nas categorias que dependem de projeto — segurança, confiabilidade, portabilidade, usabilidade — e permanece incompleta nas que dependem de operação, embora a fronteira tenha se movido. Integração contínua e medição de desempenho eram lacunas da rodada anterior e deixaram de ser: existem fluxos de trabalho versionados que executam a regressão a cada alteração proposta, e há medição reprodutível das funções de domínio e da leitura do *backend* local. O que continua do outro lado da fronteira é o que exige operação real — monitoração de execução, acordo de nível de serviço — e o que exige aparelho instrumentado, como tempo de partida e consumo de memória. A assimetria não é falha da solução: é a diferença entre construir e operar.

Quanto à **evidência**, esta é a rodada em que a última camada inventariada passou a ser executada, e é aqui que está a principal cautela metodológica do trabalho. A camada de aplicação está verificada por execução: 1.686 casos, tipagem e análise estática sem erro. A camada de banco: 16 *migrations* aplicadas em instalação limpa e sobre base legada, e 265 asserções de política contra o motor. A camada de API: 403 asserções de ponta a ponta contra uma pilha Supabase completa — PostgREST, Auth, Storage e Edge Functions reais.

**As três contagens continuam separadas, e a razão é a mesma de antes.** Um trabalho que somasse 1.686, 265 e 403 e anunciasse "2.354 testes aprovados" produziria um número que nenhuma execução sustenta, porque as três medem coisas diferentes, com granularidades diferentes, e o mesmo comportamento aparece em mais de uma. Manter as contagens separadas custa uma linha de ressalva e mantém cada uma verdadeira.

Uma distinção nova precisa ser feita com o mesmo rigor. As 403 asserções rodam contra uma pilha **local**: elas verificam o esquema do repositório, não o projeto publicado. A frase "a camada de API está verificada" é verdadeira; "a API publicada está verificada" não seria, e as quatro *migrations* pendentes são exatamente a diferença entre as duas.

Vale ainda registrar o que a execução revelou sobre a rodada anterior. O número 292, apresentado então como contagem estática de blocos escritos e explicitamente não como resultado, recontou-se em 293; e a execução emite 403, porque várias chamadas estão dentro de laços. A cautela de não chamar aquilo de aprovação estava correta, e a distância entre os dois números mostra por quê: mesmo a contagem estática não previa o que a execução mediria.

O resultado arquitetural mais transferível é a **posição da decisão de controle de acesso**. Ao expressá-la como política no banco, a garantia deixa de depender do cliente: substituir a interface, escrever outro aplicativo ou consultar diretamente a API não altera o que cada identidade alcança. A regra sem exceção para o proprietário é a consequência concreta dessa escolha, e agora é uma propriedade medida, e não apenas declarada. Um achado colateral da inspeção do ambiente publicado reforça o ponto: a chave distribuída no aplicativo não obtém privilégio algum sobre as tabelas, o que confirma em produção o efeito da migração de privilégios.

Quanto à **inteligência artificial**, o projeto do assistente converte em decisões de implementação os dois achados de 2.3. Aceita como premissa que o planejamento automático erra (XIE *et al.*, 2024) e que o modelo pode gerar conteúdo não sustentado pelos dados (JI *et al.*, 2023), e responde não com melhor engenharia de instrução, mas com controles estruturais: separação entre texto e ação, validação em três pontos, confirmação humana obrigatória e ausência, nos tipos do sistema, de qualquer operação destrutiva que o modelo pudesse expressar. Esta última é a mais robusta, porque é verificada pelo compilador e não depende de alguém lembrar de aplicá-la. Cabe registrar, como observação de método, que foram os testes de integração que expuseram uma divergência entre o formato exigido do modelo e o formato aceito pelo validador — divergência que descartava propostas em silêncio e que foi corrigida no contrato antes da versão aqui avaliada.

A avaliação desta rodada produziu ainda dois achados de método que valem mais do que os números que os acompanham.

O primeiro é sobre **testes que passam sem medir**. Três suítes novas foram submetidas a contraprova: o defeito que elas existem para pegar foi deliberadamente reintroduzido, e verificou-se que elas reprovam, na asserção certa, com a mensagem certa. Em dois dos três casos o teste ingênuo teria continuado passando — a transferência de propriedade, por exemplo, verificada apenas na tabela de participantes, não perceberia que a viagem continuava pertencendo ao antigo dono pela segunda origem de autorização. A contraprova custa uma execução e é a diferença entre um teste e um enfeite.

O segundo é sobre **medir a camada errada**. O instrumento de avaliação da inteligência artificial reprovou, na primeira versão, quatro cenários corretos, porque supunha uma única camada de validação onde havia duas com respostas deliberadamente diferentes — uma que descarta e outra que avisa. O erro era do instrumento, foi corrigido nele, e não no produto. Registra-se porque a tentação oposta — ajustar o produto para o instrumento passar — é real e teria produzido um sistema pior com um relatório melhor.

Por fim, a própria avaliação produziu um resultado sobre disciplina de documentação, e desta vez ele se estende ao artigo anterior. A medição do esquema contra uma instância real mostrou que várias contagens obtidas por leitura do texto das migrações subestimavam o estado efetivo — políticas, gatilhos, índices e restrições —, porque parte das políticas é criada dinamicamente em laço, e uma contagem de instruções não a alcança. É um achado relevante para trabalhos desta natureza: quando o objeto medido é um banco de dados, a fonte confiável é o catálogo do banco depois de aplicado, e não o texto que o produz.

### 4.6 Limitações e ameaças à validade

As limitações abaixo estão organizadas em três grupos, porque a natureza delas é diferente e tratá-las como uma lista única esconderia isso: o que **depende de pessoas**, o que **depende de uma decisão de publicação**, e o que **permanece tecnicamente em aberto**.

**A. Limitações que dependem de pessoas — nenhuma foi resolvida.**

1. **Ausência de avaliação com usuários.** Não houve estudo com participantes. Nenhuma afirmação sobre usabilidade, carga cognitiva, satisfação, redução de tempo de planejamento ou eficiência de tarefa é feita ou pode ser derivada deste artigo. Foi elaborado nesta rodada um protocolo completo — perfis, critérios de inclusão e exclusão, nove tarefas, roteiro do pesquisador, SUS, consentimento, anonimização, plano de análise e critérios de interrupção — junto de um modelo de resultados. **Nenhum participante foi recrutado e nenhuma sessão foi conduzida.** Ter um protocolo não é ter um resultado, e esta limitação permanece integralmente.
2. **Sem teste de intrusão independente.** A avaliação de segurança descrita em 4.4 foi conduzida pela própria equipe de desenvolvimento, e o documento que a registra começa dizendo isso. Não houve avaliador externo, análise de binário nem tentativa de exploração além de leitura e de chamadas malformadas. O trabalho **não se declara conforme** ao OWASP MASVS: conformidade formal exige verificação por terceiro, que não ocorreu. O que existe é uma avaliação interna orientada pelo MASVS, com 24 controles, evidência executável para a maioria e um defeito encontrado e corrigido.
3. **Sem avaliação humana da utilidade do conteúdo gerado pela inteligência artificial.** O instrumento construído nesta rodada mede as defesas — 18 cenários sintéticos, 18 aprovados — e não a qualidade dos roteiros. Nenhum avaliador leu uma proposta e disse se ela faz sentido para uma viagem real. Uma rubrica para essa avaliação foi preparada e **não aplicada**.
4. **Sem validação de notificação em aparelho físico.** O envio está implementado e coberto por testes automatizados, mas não houve entrega verificada em Android real: não há *build* de desenvolvimento com credencial de notificação nesta rodada. Gerar um endereço de entrega não é prova de que a notificação chega.

**B. Limitações que dependem de uma decisão de publicação — implementadas e validadas localmente, não publicadas.**

Quatro *migrations* e duas Edge Functions aguardam autorização. Todas foram aplicadas ou executadas com sucesso contra ambientes descartáveis, em instalação limpa e sobre base legada, com verificações próprias aprovadas. A pendência é de autorização, e foi confirmada por inspeção remota: o projeto publicado está na *migration* 0012 e possui quatro das seis funções.

5. **Migração 0013 não publicada** — capa da viagem e meta de gasto diário. Quatro requisitos não operam em produção.
6. **Migração 0014 não publicada** — transferência de propriedade e a consulta que bloqueia a exclusão de conta. Três requisitos não operam em produção.
7. **Migração 0015 não publicada e agendamento não configurado** — o mecanismo de agendamento do resumo diário existe, foi validado por 39 asserções e não guarda segredo em texto no comando agendado, mas o trabalho de agendamento **não está criado no ambiente publicado**. A função continua publicada e continua não sendo disparada sozinha.
8. **Migração 0016 não publicada e função de envio não publicada** — registro de aparelhos e envio de notificação. Três requisitos não operam em produção.
9. **Exclusão de conta não publicada.** A Edge Function existe, agora recusa a exclusão que destruiria dado de terceiros, e tem 18 asserções de ponta a ponta. Não está publicada. Do ponto de vista do titular dos dados continua sendo a pendência mais séria — com a diferença de que a razão mudou: antes ela era retida porque publicá-la tornaria alcançável um defeito conhecido; agora o defeito está corrigido, e o que falta é publicar a correção junto.
10. **Correção de segurança não publicada.** O defeito descrito em 4.4 foi corrigido no repositório, mas a versão publicada da função afetada ainda é a anterior.

**C. Limitações técnicas que permanecem em aberto.**

11. **Toda a evidência de execução vem de ambientes locais.** As 265 asserções de banco e as 403 de ponta a ponta rodam contra pilhas descartáveis, e as suítes recusam por construção qualquer endereço que não seja local, porque criam e apagam dados. O comportamento do **ambiente publicado** sob essas verificações não foi medido, e a diferença entre os dois é exatamente o grupo B.
12. **Medição de desempenho parcial.** Há medição reprodutível das funções de domínio e da leitura do *backend* local, com N, média, mediana e p95. **Não há medição em aparelho**: tempo de partida, taxa de quadros e consumo de memória exigem Android instrumentado, e nenhum desses números foi estimado. Também não há linha de base histórica — esta é a primeira medição do projeto.
13. **Fila de escrita fora de rede com escopo declarado.** A fila cobre roteiro, lista de preparação, despesas, diário e metas. **Não cobre** exclusão de conta, transferência de propriedade, alteração de papel, convites, administração e envio de arquivos, e cada exclusão tem motivo registrado em código — resumidamente, operações cujo resultado depende de quem mais mexeu no meio tempo, ou que destroem dado. A resolução de conflito é pela última escrita para campo simples; o que não se reconcilia assim não é sobrescrito em silêncio, e sim marcado como pendente de decisão. **Não é correto afirmar que o aplicativo funciona integralmente fora de rede.**
14. **Vulnerabilidades em dependências de desenvolvimento.** A auditoria registra 21 ocorrências, 9 de severidade alta, todas em cadeia de compilação — nenhuma no caminho de execução do aplicativo publicado. A correção automática traria mudança de versão maior do arcabouço, que não foi feita nesta rodada.
15. **Ausência de monitoração de execução e de política automática de retenção de dados.** Continuam sendo lacunas de operação, e a segunda segue sendo a única limitação arquitetural não declarada em comentário no próprio código.

**Ameaças à validade.**

*Validade de construção.* Os requisitos foram levantados a partir do próprio código, o que introduz circularidade: um requisito derivado da implementação tende a ser atendido por ela. A mitigação adotada foi restringir o registro a requisitos localizáveis em artefato concreto e explicitar o procedimento, mas o risco não é eliminado. A leitura correta da Tabela 1 é "os requisitos observáveis no sistema são rastreáveis", e não "os requisitos previamente especificados foram cumpridos".

*Validade interna.* Os comandos e seus resultados foram registrados, a versão medida está fixada em *commit*, e todas as contagens desta rodada passaram a ser produzidas por um roteiro versionado que imprime, ao lado de cada número, o comando que o gerou — o que remove a categoria de erro representada por listas mantidas à mão. Permanece uma fragilidade, e ela cresceu de importância: **as suítes de banco e de ponta a ponta medem uma reconstrução local do ambiente gerenciado**, cuja fidelidade é boa mas não integral. Duas ocorrências desta rodada mostram os dois sentidos em que isso morde. A divergência da função de identidade, relatada na rodada anterior, mostrou que a reconstrução pode divergir do original sem aviso; e as 28 falhas da primeira execução de ponta a ponta mostraram o inverso — falhas causadas pelo arcabouço de teste e não pelo produto, que só puderam ser distinguidas porque cada uma foi diagnosticada até a causa. O risco correspondente é o de uma falha do produto ser atribuída ao arcabouço, e a mitigação adotada foi não aceitar nenhuma falha como "problema de ambiente" sem nomear o mecanismo.

Uma segunda fragilidade é declarada agora: **as suítes foram escritas por quem escreveu o produto**, o que vale tanto para os testes quanto para os cenários de avaliação da inteligência artificial. Um cenário pode não existir justamente onde a implementação tem um ponto cego. A mitigação parcial adotada foi a contraprova — reintroduzir o defeito e verificar que o teste reprova —, que ataca o teste que passa sem medir, mas não o teste que nunca foi escrito.

*Validade externa.* Trata-se de estudo de caso único: os resultados descrevem o Easy Trip e não são generalizáveis para outras aplicações. O que é transferível é o conjunto de decisões de projeto — controle de acesso na camada de dados, validação estrutural das sugestões do modelo, cadeia de modelos alternativos — e o procedimento de avaliação, não os números.

*Validade de conclusão.* A conclusão apoia-se em contagens e execuções, sem inferência estatística. O risco de tratar a existência de um teste como aprovação desse teste, presente nas rodadas anteriores, deixou de se aplicar à suíte de ponta a ponta, que passou a ser executada. Em seu lugar entra um risco novo e simétrico: o de tratar **execução local** como evidência sobre o ambiente publicado. A mitigação é a distinção mantida em 4.5 e no grupo C de 4.6 — as três camadas estão verificadas por execução, e nenhuma delas foi verificada contra produção. Mantém-se também a recusa de somar as três contagens num total único, pela mesma razão de sempre: elas medem coisas diferentes e o mesmo comportamento aparece em mais de uma.

---

## 5 Conclusão

Este trabalho desenvolveu e avaliou o Easy Trip, um planejador inteligente de viagens implementado como aplicação móvel em React Native/Expo com backend Supabase, cujo propósito é reunir em uma única solução aquilo que hoje se fragmenta entre aplicativos de mensagem, planilhas, caixas de e-mail e blocos de notas durante o planejamento de uma viagem.

Do ponto de vista funcional, o sistema integra quinze módulos: autenticação e perfil, gestão de viagem, roteiro, lista de preparação, finanças, carteira com conversão de moedas, reservas, diário, documentos, colaboração, avisos e lembretes, trabalho fora de rede, assistente de inteligência artificial, conteúdo editorial e administração. A gestão de viagem passou a incluir capa personalizada e informações contextuais do destino; o controle financeiro ganhou meta de gasto diário com acompanhamento de consumo e excesso; os avisos deixaram de depender da viagem selecionada e passaram a cobrir todas as viagens acessíveis, identificando a origem de cada um. A colaboração é sustentada por três papéis e por um modelo de visibilidade item a item, no qual o conteúdo do grupo e o conteúdo pessoal convivem na mesma viagem sob regras distintas, e passou a contar com **transferência de propriedade** — que resolve, além da lacuna funcional, um risco estrutural descrito adiante. Acrescentaram-se ainda uma **fila durável de escrita fora de rede** e o suporte a **notificações do sistema operacional**.

Um resultado desta rodada merece destaque por sua natureza. A investigação da transferência de propriedade expôs um defeito que nenhuma política de acesso poderia impedir: a chave estrangeira que liga a viagem ao seu proprietário remove em cascata, de modo que a exclusão da conta do dono de uma viagem compartilhada apagaria a viagem inteira — com as despesas, o diário e o roteiro **dos demais participantes**. A cascata acontece abaixo da camada de autorização, e por isso uma pessoa exercendo o próprio direito de exclusão destruiria dado de terceiros, sem aviso e sem recuperação. A resposta adotada não foi escolher um novo proprietário automaticamente, o que daria a estranhos a gerência de um grupo do qual não pediram para cuidar, mas **recusar a exclusão** e informar o caminho: transferir a viagem, ou encerrar a colaboração. A propriedade é gravada em duas origens de autorização, e a transferência move ambas na mesma transação — verificação que a suíte correspondente prende por contraprova.

A inteligência artificial participa como apoio ao planejamento, e não como decisor: recebe os dados estruturados da viagem como contexto — com exclusão das entradas de diário e do conteúdo privado de terceiros —, devolve texto e ações separadamente, e nenhuma ação se torna registro sem passar por três validações e pela confirmação explícita do usuário, com a gravação ocorrendo na sessão dessa mesma pessoa e sob as mesmas políticas que a interface obedece. Uma cadeia de cinco modelos alternativos sustenta o recurso quando o modelo preferido está indisponível. O controle de acesso é aplicado pelo banco de dados, por políticas de segurança em nível de linha, de modo que a garantia não dependa da interface.

Respondendo à questão de pesquisa: os recursos previstos estão integrados na aplicação, e a evidência que sustenta essa afirmação tem alcance desigual, o que é declarado explicitamente. Dos 74 requisitos funcionais identificados, todos são rastreáveis até código e estrutura de dados, e 63 operam sobre o esquema publicado; os onze restantes têm causa isolada em publicação, não em implementação. Dos 70 requisitos não funcionais, 59 apresentam evidência forte, seis estão implementados e aguardam publicação, e as cinco lacunas concentram-se em atributos que dependem de operação contínua.

**As três camadas estão agora verificadas por execução**, o que não era verdade nas rodadas anteriores. A camada de aplicação: 124 conjuntos, 1.686 casos sem falhas, verificação de tipos e análise estática sem erros, ambiente aprovado em dezoito verificações. A camada de banco: as dezesseis *migrations* aplicam em instalação limpa e sobre base legada, e as políticas de acesso foram exercitadas contra o motor em 265 asserções sem falhas. A camada de API: 403 asserções de ponta a ponta contra uma pilha Supabase completa, em onze arquivos, sem falhas e sem verificações ignoradas — número que substitui a contagem estática de blocos escritos que as rodadas anteriores apresentavam, com a ressalva de que nunca era um resultado de aprovação.

As três contagens não são somadas, e a recusa é deliberada: elas medem coisas diferentes, e um total único seria um número que nenhuma execução sustenta. **Toda essa evidência vem de ambientes locais e descartáveis**; o ambiente publicado não foi verificado sob essas suítes, e a diferença entre os dois são quatro *migrations* e duas funções aguardando autorização para publicação.

Os objetivos específicos foram cumpridos: os requisitos foram identificados e organizados por módulo (objetivo 1, seções 3.2 e 4.1); a arquitetura e a camada de persistência foram projetadas e implementadas (objetivo 2, seções 3.3 e 3.4); os recursos de planejamento, organização, controle financeiro, reservas e colaboração foram desenvolvidos (objetivo 3, seção 3.2); a inteligência artificial foi integrada como apoio ao planejamento (objetivo 4, seção 3.5); os mecanismos de segurança, privacidade e controle de acesso foram implementados (objetivo 5, seção 3.6); e a implementação foi avaliada tecnicamente por testes, análise estática, verificação de tipos e rastreabilidade (objetivo 6, seção 4).

Nem tudo foi validado, e a delimitação importa tanto quanto os resultados. **Não houve avaliação com usuários**: nenhuma afirmação sobre facilidade de uso, satisfação ou redução do tempo de planejamento é feita aqui. Foi elaborado um protocolo completo, com tarefas, instrumento de usabilidade, consentimento e plano de análise, mas **nenhum participante foi recrutado e nenhuma sessão foi conduzida** — ter um protocolo não é ter um resultado. **Não houve teste de intrusão independente**: a avaliação de segurança orientada pelo MASVS foi conduzida pela própria equipe, e o trabalho não se declara conforme ao padrão, porque conformidade formal exige verificação por terceiro. **A qualidade dos roteiros propostos pelo modelo não foi medida**: avaliou-se o mecanismo que impede uma sugestão de virar registro sem validação, com dezoito cenários sintéticos, e a camada que exercitaria o modelo real não foi executada por indisponibilidade de credencial. **A entrega de notificação não foi verificada em aparelho físico.** E quatro *migrations* e duas Edge Functions permanecem implementadas, validadas localmente e não publicadas.

Uma cautela sobre o que **não** se conclui do trabalho de fila fora de rede: ela cobre conteúdo de viagem, e não todas as operações. Exclusão de conta, transferência de propriedade, alteração de papel, convites e envio de arquivos continuam exigindo conexão, cada um por um motivo registrado. Não é correto dizer que o aplicativo funciona integralmente sem rede.

Como trabalhos futuros, três frentes decorrem diretamente das limitações que restaram, e a mudança em relação à rodada anterior é informativa: das quatro frentes então apontadas, duas foram executadas — a transferência de propriedade com a correção do risco de remoção em cascata, e o ambiente dedicado que permitiu executar a suíte de ponta a ponta, junto da integração contínua e da medição de desempenho.

A primeira frente restante é **publicar**: aplicar as quatro *migrations* pendentes, publicar a exclusão de conta com a guarda de propriedade e a correção de segurança, publicar o envio de notificação e criar o trabalho de agendamento do resumo diário. Nada nela é de implementação; é uma decisão de operação, e o fluxo de publicação sob aprovação já está versionado para conduzi-la.

A segunda é **conduzir a avaliação com usuários** conforme o protocolo elaborado, com aprovação ética quando aplicável, e — na mesma etapa — aplicar a rubrica de avaliação humana das sugestões da inteligência artificial e executar a camada de avaliação do modelo real. As três respondem perguntas que este trabalho deliberadamente não respondeu, e nenhuma delas depende de escrever mais código.

A terceira é **submeter o sistema a avaliação de segurança independente** e completar a medição de desempenho em aparelho instrumentado. São as duas afirmações que este trabalho não pode fazer sobre si mesmo, por razões que não se resolvem com mais esforço do próprio autor.

---

## Referências

BASS, L.; CLEMENTS, P.; KAZMAN, R. **Software architecture in practice**. 4. ed. Boston: Addison-Wesley Professional, 2021. 464 p. (SEI Series in Software Engineering). ISBN 978-0-13-688609-9.

HEVNER, A. R.; MARCH, S. T.; PARK, J.; RAM, S. Design science in information systems research. **MIS Quarterly**, v. 28, n. 1, p. 75-105, 2004. DOI: 10.2307/25148625.

INTERNATIONAL ORGANIZATION FOR STANDARDIZATION; INTERNATIONAL ELECTROTECHNICAL COMMISSION. **ISO/IEC 25010:2023**: systems and software engineering — systems and software quality requirements and evaluation (SQuaRE) — product quality model. 2. ed. Genebra: ISO, 2023.

JI, Z.; LEE, N.; FRIESKE, R.; YU, T.; SU, D.; XU, Y.; ISHII, E.; BANG, Y. J.; MADOTTO, A.; FUNG, P. Survey of hallucination in natural language generation. **ACM Computing Surveys**, v. 55, n. 12, art. 248, p. 1-38, 2023. DOI: 10.1145/3571730.

KARLOVIĆ, R.; ROVIS, M.; SMAJIĆ, A.; SEVER, L.; LORENCIN, I. Context-aware tourism recommendations using retrieval-augmented large language models and semantic re-ranking. **Electronics**, v. 14, n. 22, art. 4448, 2025. DOI: 10.3390/electronics14224448.

LEWIS, P.; PEREZ, E.; PIKTUS, A.; PETRONI, F.; KARPUKHIN, V.; GOYAL, N.; KÜTTLER, H.; LEWIS, M.; YIH, W.; ROCKTÄSCHEL, T.; RIEDEL, S.; KIELA, D. Retrieval-augmented generation for knowledge-intensive NLP tasks. **Advances in Neural Information Processing Systems**, v. 33, p. 9459-9474, 2020.

NIKAM, A.; VERMA, I. K.; RANADE, P. An interactive mobile application to enhance travel planning using a user-centric approach: a UX design case study. **International Journal of Interactive Mobile Technologies**, v. 19, n. 17, p. 115-128, 2025. DOI: 10.3991/ijim.v19i17.51279.

OPEN WEB APPLICATION SECURITY PROJECT. **OWASP mobile application security verification standard (MASVS)**: version 2.1.0. [S. l.]: OWASP Foundation, 2024. Disponível em: https://mas.owasp.org/MASVS/. Acesso em: 28 ago. 2026.

PEFFERS, K.; TUUNANEN, T.; ROTHENBERGER, M. A.; CHATTERJEE, S. A design science research methodology for information systems research. **Journal of Management Information Systems**, v. 24, n. 3, p. 45-77, 2007. DOI: 10.2753/MIS0742-1222240302.

PEREZ, F.; RIBEIRO, I. **Ignore previous prompt**: attack techniques for language models. 2022. DOI: 10.48550/arXiv.2211.09527. Disponível em: https://arxiv.org/abs/2211.09527. Acesso em: 28 ago. 2026.

XIE, J.; ZHANG, K.; CHEN, J.; ZHU, T.; LOU, R.; TIAN, Y.; XIAO, Y.; SU, Y. TravelPlanner: a benchmark for real-world planning with language agents. *In*: INTERNATIONAL CONFERENCE ON MACHINE LEARNING, 41., 2024, Viena. **Proceedings** [...]. [S. l.]: PMLR, 2024. DOI: 10.48550/arXiv.2402.01622.
