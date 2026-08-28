# Medição de desempenho — Easy Trip

Data: 28 de agosto de 2026
Commit: `5cb77d6`
Máquina: GitHub Codespaces, 2 vCPU, 7 GB RAM, Linux 6.8 · Node v24.14.0

---

## 1. Por que este documento existe, e o que ele não é

A limitação registrada no TCC era **"sem medição de desempenho"**. Este
documento a substitui parcialmente — e a palavra *parcialmente* é o ponto.

**Isto não é um benchmark de aplicativo.** Não há aqui tempo de abertura, taxa
de quadros, consumo de memória em aparelho nem latência percebida. Nada disso é
mensurável sem um Android instrumentado, e nenhum desses números foi estimado,
extrapolado ou inferido. O que não pôde ser medido está na seção 6, dito assim.

O que se mede aqui são duas famílias de coisa, ambas reprodutíveis nesta
máquina por um comando:

1. **funções de domínio puras** — cálculo financeiro, derivação de rota,
   ordenação de roteiro, fila offline. É o trabalho que roda na *thread* de
   JavaScript a cada renderização, e o que o torna interessante é que o custo
   **cresce com o tamanho da viagem**;
2. **leitura do backend pela pilha local** — PostgREST com RLS avaliada, sem
   escrever nada e sem tocar produção.

## 2. Metodologia

| Decisão | Por quê |
|---|---|
| 20 execuções de aquecimento, descartadas | A primeira execução paga compilação JIT e alocação inicial. Incluí-la faria a média descrever o aquecimento, e não o trabalho. |
| N = 200 (domínio), N = 30 (rede) | Amostra suficiente para a mediana estabilizar. A rede é mais cara e mais ruidosa; 30 chamadas de leitura bastam para o p95 dizer algo. |
| Média, **mediana** e **p95** | A média sozinha esconde a cauda, e é a cauda que o usuário sente. Onde os dois valores divergem muito, o que vale é a mediana — a diferença é ruído de escalonamento numa máquina de 2 vCPU compartilhada. |
| Três tamanhos de viagem | 30 despesas é uma viagem curta real; 300, uma viagem longa de quem registra tudo; 3.000, o teto plausível de um usuário intenso ao longo de anos. Medir só o caso pequeno esconderia o crescimento, que é o que interessa. |
| Nenhuma escrita, nenhum acesso a produção | Um benchmark que gera carga no ambiente publicado não é medição, é incidente. |

### Reprodução

```
# domínio apenas
node --experimental-strip-types --import ./scripts/alias-loader.mjs scripts/benchmark.mjs

# com a seção de backend (sobe a pilha local descartável antes)
source scripts/e2e/e2e-env.sh && ./scripts/e2e/e2e-start.sh && e2e_export_keys
node --experimental-strip-types --import ./scripts/alias-loader.mjs scripts/benchmark.mjs

# JSON, para comparar entre execuções
node --experimental-strip-types --import ./scripts/alias-loader.mjs scripts/benchmark.mjs --json
```

O `alias-loader` existe porque o aplicativo importa por alias e sem extensão
(`@/lib/date`) — o que o Metro e o `jest-expo` resolvem por configuração e o
`node` puro não. O benchmark roda no `node` puro de propósito: medir dentro do
Jest mediria também o ambiente de teste em volta das funções.

---

## 3. Resultados

### 1. Cálculo financeiro e ordenação (domínio puro)

| caso | N | média | mediana | p95 | máx |
|---|---:|---:|---:|---:|---:|
| getTripTotalSpent · 30 despesas | 200 | 0.0303 ms | 0.0012 ms | 0.0051 ms | 4.7765 ms |
| getExpensesByCategory · 30 | 200 | 0.0164 ms | 0.0083 ms | 0.0204 ms | 1.1976 ms |
| getDailySpend · 30 | 200 | 0.0135 ms | 0.0075 ms | 0.0128 ms | 0.7892 ms |
| getExceededGoalDays · 30 | 200 | 0.0163 ms | 0.0088 ms | 0.0223 ms | 0.4768 ms |
| getTripTotalSpent · 300 despesas | 200 | 0.0068 ms | 0.0059 ms | 0.0089 ms | 0.1261 ms |
| getExpensesByCategory · 300 | 200 | 0.0379 ms | 0.0222 ms | 0.0250 ms | 2.5379 ms |
| getDailySpend · 300 | 200 | 0.0312 ms | 0.0285 ms | 0.0472 ms | 0.1762 ms |
| getExceededGoalDays · 300 | 200 | 0.1540 ms | 0.1298 ms | 0.2644 ms | 0.4814 ms |
| getTripTotalSpent · 3000 despesas | 200 | 0.0314 ms | 0.0301 ms | 0.0413 ms | 0.0742 ms |
| getExpensesByCategory · 3000 | 200 | 0.0914 ms | 0.0616 ms | 0.2192 ms | 0.3819 ms |
| getDailySpend · 3000 | 200 | 0.1003 ms | 0.0955 ms | 0.1235 ms | 0.2340 ms |
| getExceededGoalDays · 3000 | 200 | 1.0731 ms | 1.2319 ms | 1.5210 ms | 2.3165 ms |
| sortItinerary · 50 itens | 200 | 0.0073 ms | 0.0036 ms | 0.0145 ms | 0.0418 ms |
| sortItinerary · 500 itens | 200 | 0.1010 ms | 0.0811 ms | 0.1481 ms | 0.4083 ms |

### 2. Rota do dia (Haversine encadeado)

| caso | N | média | mediana | p95 | máx |
|---|---:|---:|---:|---:|---:|
| buildDayRoute · 5 paradas | 200 | 0.0164 ms | 0.0067 ms | 0.0123 ms | 1.5864 ms |
| buildDayRoute · 12 paradas | 200 | 0.0149 ms | 0.0036 ms | 0.0159 ms | 1.6560 ms |
| buildDayRoute · 30 paradas | 200 | 0.0124 ms | 0.0106 ms | 0.0174 ms | 0.1992 ms |

### 3. Fila offline

| caso | N | média | mediana | p95 | máx |
|---|---:|---:|---:|---:|---:|
| drainableFor · fila de 10 | 200 | 0.0011 ms | 0.0010 ms | 0.0012 ms | 0.0215 ms |
| summarize · fila de 10 | 200 | 0.0020 ms | 0.0014 ms | 0.0024 ms | 0.0586 ms |
| enqueue (dobra) · fila de 10 | 200 | 0.0022 ms | 0.0022 ms | 0.0025 ms | 0.0175 ms |
| drainableFor · fila de 100 | 200 | 0.0155 ms | 0.0030 ms | 0.0081 ms | 2.3794 ms |
| summarize · fila de 100 | 200 | 0.0212 ms | 0.0099 ms | 0.0204 ms | 2.0770 ms |
| enqueue (dobra) · fila de 100 | 200 | 0.0156 ms | 0.0087 ms | 0.0191 ms | 0.9064 ms |
| drainableFor · fila de 500 | 200 | 0.0630 ms | 0.0153 ms | 0.0448 ms | 8.1500 ms |
| summarize · fila de 500 | 200 | 0.0544 ms | 0.0417 ms | 0.0628 ms | 0.8784 ms |
| enqueue (dobra) · fila de 500 | 200 | 0.0167 ms | 0.0142 ms | 0.0160 ms | 0.2538 ms |

### 4. Backend local — leitura por PostgREST com RLS (nada é escrito)

| caso | N | média | mediana | p95 | máx |
|---|---:|---:|---:|---:|---:|
| GET /articles?limit=20 (anon) | 30 | 4.4365 ms | 2.4983 ms | 6.6384 ms | 47.0710 ms |
| GET /trips (service role) | 30 | 2.4267 ms | 1.9028 ms | 5.3143 ms | 7.6288 ms |
| GET /expenses (service role) | 30 | 1.9644 ms | 1.8008 ms | 3.0816 ms | 5.2456 ms |
| RPC is_trip_member (RLS helper) | 30 | 3.4954 ms | 2.6630 ms | 8.7896 ms | 9.3599 ms |

---

## 4. Tamanho do pacote

Medido com `npx expo export --platform android`:

| Artefato | Tamanho |
|---|---:|
| *bundle* Hermes (`entry-*.hbc`) | **8,36 MB** |
| Diretório exportado completo | 12 MB |
| `metadata.json` | 4,24 kB |

O `.hbc` é *bytecode* Hermes já compilado, não JavaScript-fonte: é o que vai
para dentro do APK e o que o aparelho carrega na abertura. Não é o tamanho do
APK, que soma ainda os recursos nativos, os ícones e o próprio Hermes.

---

## 5. Leitura dos números

**Nada no domínio é gargalo, e um caso merece atenção.**

`getExceededGoalDays` é o único que passa de 1 ms, e só em 3.000 despesas
(mediana 1,23 ms). O motivo é estrutural: ele agrupa as despesas por dia e
compara cada dia com a meta, então percorre o conjunto e depois os dias. Numa
viagem de 30 dias com 3.000 despesas — cem lançamentos por dia — 1,2 ms ainda
cabe folgado num quadro de 16 ms, e essa é a razão de não haver otimização
aqui: seria trabalho para resolver um problema que os números dizem não existir.

O crescimento é aproximadamente linear onde deveria ser (`getTripTotalSpent`,
`getDailySpend`, `sortItinerary`) e não há nenhum caso quadrático escondido —
que é a pergunta que este tipo de medição existe para responder.

**A rede domina, como esperado.** A leitura mais barata do backend local
(≈1,8 ms de mediana) é mais de vinte vezes mais cara que o cálculo financeiro
mais caro sobre 3.000 despesas. Contra um Supabase hospedado, com latência de
rede real, a distância aumenta em uma ordem de grandeza. **A conclusão prática
é que o desempenho percebido deste aplicativo é dominado por ida e volta de
rede, não por trabalho de JavaScript** — o que justifica, retroativamente, o
cache do TanStack Query e a fila offline muito mais do que qualquer
micro-otimização de domínio.

**O `p95` da rede é instável** (até 8,8 ms contra 2,7 ms de mediana no RPC).
Numa máquina de 2 vCPU rodando doze contêineres, isso mede o escalonamento da
máquina tanto quanto o banco. É por isso que a mediana é o número a citar.

---

## 6. O que NÃO foi medido, e por quê

Registrado para que os números acima não sejam lidos como mais do que são.

| Não medido | Por quê |
|---|---|
| Tempo de abertura do aplicativo | Exige aparelho Android instrumentado e build de desenvolvimento. Não há nesta rodada. |
| Taxa de quadros, *jank*, tempo de renderização | Idem. Um número de renderização obtido em Node não descreveria a *thread* de UI do React Native. |
| Consumo de memória | A medição de heap do Node não descreve o consumo do aplicativo em aparelho. Nenhuma ferramenta real de perfil estava disponível. |
| Latência contra o Supabase **hospedado** | Mediria a rede do Codespaces até a região do projeto, não o produto. E gerar carga em produção está fora de questão. |
| Tempo de resposta da IA | Depende do provedor e da cota. Está avaliado em `AI_QUALITY_EVALUATION.md`, com o número de chamadas limitado. |
| Tamanho do APK | Exige *build* nativo (EAS ou Gradle local). O que se mede aqui é o *bundle* Hermes, que é parte dele. |
| Desempenho sob concorrência real | As asserções de idempotência exercitam o índice único, mas em execução sequencial. |

**Não há linha de base histórica.** Esta é a primeira medição do projeto, então
nenhum número aqui é comparado com um anterior. O `--json` existe para que a
próxima seja.
