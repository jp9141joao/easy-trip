# Execução das suítes de ponta a ponta — Easy Trip

Data da execução: 28 de agosto de 2026
Commit do produto: `d108a15`
Ambiente: pilha Supabase local dedicada (`easy-trip-e2e`), descartável

---

## 1. O que mudou em relação ao estado anterior

Até esta rodada os arquivos `supabase/tests/*_e2e.mjs` existiam no repositório e
**nunca haviam sido executados**. A documentação registrava "292 blocos não
executados". Esta rodada os executou.

O impedimento não era o código dos testes. Era um detalhe de infraestrutura, e
vale registrá-lo porque custou tempo e não se parece com a causa:

> **A pilha de teste era remontada por baixo dos contêineres em execução.**
> O script apagava e recriava o diretório de trabalho enquanto o *stack* estava
> de pé. Os contêineres continuavam montando o *inode* antigo — o diretório já
> apagado — e passavam a enxergar uma pasta vazia. O sintoma era o
> `edge_runtime` respondendo **503** com `failed to determine entrypoint` a toda
> chamada de função, o que se parece com um problema de compilação de Deno e não
> com um *bind mount* órfão.

A correção está em `scripts/e2e/e2e-start.sh`: derrubar qualquer pilha anterior
**antes** de materializar o diretório.

## 2. Como a execução é isolada

Os testes criam contas, sobem arquivos e apagam linhas. Três camadas os mantêm
longe de qualquer coisa que importe:

| Camada | Mecanismo |
|---|---|
| Pilha própria | `project_id = easy-trip-e2e`, portas 54420–54429, volumes próprios. Convive com o *stack* de desenvolvimento do autor sem tocá-lo. |
| Guarda em cada arquivo | Cada `.mjs` recusa alvo que não seja `127.0.0.1`/`localhost` e sai com código 2 (§53). |
| Guarda no executor | `e2e_assert_local` repete a checagem antes de invocar qualquer suíte, para um erro de variável de ambiente não apontar todas elas ao mesmo lugar errado. |

O banco é descartável de verdade: `e2e-stop.sh` usa `supabase stop --no-backup`,
sem o qual o CLI guarda um *dump* e a subida seguinte restauraria as contas da
execução anterior.

A semente é a mínima (`scripts/e2e/seed.e2e.sql`): duas linhas de conteúdo
editorial que os testes não criam por si e de que as tabelas de vínculo
(`consultations`, `article_likes`) precisam para ter alvo. A `supabase/seed.sql`
do repositório **não** é usada — ela popula o catálogo inteiro e faria a subida
ser dominada por dado que nenhuma asserção lê.

### Reprodução

```
./scripts/e2e/e2e-run.sh                 # sobe, roda tudo, derruba
./scripts/e2e/e2e-run.sh auth_e2e        # uma suíte
E2E_KEEP=1 ./scripts/e2e/e2e-run.sh      # deixa a pilha de pé para depurar
```

## 3. Resultado

**10 arquivos, 10 executados, 0 não executados. 378 asserções, 378 aprovadas, 0 falhas, 0 ignoradas.**

| Arquivo | Asserções | Falhas | Tempo |
|---|---:|---:|---:|
| `auth_e2e.mjs` | 33 | 0 | 2 s |
| `content_admin_e2e.mjs` | 62 | 0 | 3 s |
| `delete_account_e2e.mjs` | 18 | 0 | 2 s |
| `functions_http_e2e.mjs` | 17 | 0 | 3 s |
| `lifecycle_e2e.mjs` | 41 | 0 | 2 s |
| `offer_window_e2e.mjs` | 10 | 0 | 1 s |
| `ownership_transfer_e2e.mjs` | 30 | 0 | 1 s |
| `profile_avatar_e2e.mjs` | 34 | 0 | 1 s |
| `rls_matrix_e2e.mjs` | 74 | 0 | 1 s |
| `storage_e2e.mjs` | 59 | 0 | 1 s |
| **Total** | **378** | **0** | **~17 s** |

### Sobre o número 378 e o número 292

Não são a mesma medida, e a diferença não é um ganho.

- **293** é a contagem ESTÁTICA de chamadas `check(...)` nos nove arquivos que
  já existiam. É o que se conta lendo o código. (A documentação anterior
  registrava 292; a recontagem desta rodada dá 293.)
- **348** é quanto esses mesmos nove arquivos EXECUTAM, porque várias chamadas
  estão dentro de laços — `rls_matrix_e2e` percorre uma lista de tabelas e
  emite uma asserção por tabela.
- **30** vêm de `ownership_transfer_e2e.mjs`, criado nesta rodada.
- **378 = 348 + 30.**

O valor que descreve a execução é 378. O valor 293 descreve o texto-fonte.
Somá-los, ou apresentar um como o outro, seria erro.

## 4. Falhas encontradas e o que foi feito

A primeira execução real terminou com **28 falhas em 4 arquivos**. Nenhuma era
defeito do produto; todas eram do arcabouço de teste, e todas foram corrigidas.

| Falhas | Causa | Correção |
|---:|---|---|
| 22 | `edge_runtime` servindo 503 (*bind mount* órfão, seção 1) | Ordem de `e2e-stop` antes de `e2e_materialize` |
| 4 | `rls_matrix_e2e` depende de uma linha de `advisors` e um artigo publicado; a semente mínima não os tinha | Duas linhas em `seed.e2e.sql` |
| 2 | `trip-daily-briefing` respondia 503 "misconfigured" porque `TRIP_DAILY_BRIEFING_CRON_SECRET` não estava instalado na pilha de teste — as asserções mediam a ausência de configuração, não a regra de autorização | Segredo de teste fixo instalado em `functions/.env` da pilha descartável |

A terceira delas também destravou uma asserção que estava sendo **pulada**
(`16: cron autorizado`), e que agora executa.

## 5. O que estes testes cobrem

- **Autenticação**: cadastro, entrada, sessão, recuperação, expiração.
- **RLS por HTTP**: a matriz `rls_matrix_e2e` exercita cada tabela com dois
  usuários e mede o que o PostgREST devolve — não o que a policy diz.
- **Storage**: envio, leitura, URL assinada, isolamento por prefixo, ciclo de
  vida do arquivo junto com a linha que o referencia.
- **Edge Functions**: autorização de `trip-suggestions` e `trip-daily-briefing`,
  incluindo papel forjado no *payload*, método não permitido e o segredo do
  cron.
- **Conteúdo editorial e administração**: publicação, rascunho, janela de oferta.
- **Ciclo de vida da conta**: exclusão, expurgo de arquivos, cascata.
- **Propriedade de viagem** (novo): a sequência completa do §50 — recusa da
  exclusão, transferência, exclusão permitida, e a prova de que a viagem do
  outro membro sobrevive.

## 6. O que estes testes NÃO cobrem

Registrado para que o número 378 não seja lido como mais do que é:

- **Nenhuma tela.** São testes de backend por HTTP. A interface é coberta pelo
  Jest (`@testing-library/react-native`), que não é o mesmo tipo de evidência.
- **Nenhum aparelho.** Não há Android, iOS nem navegador envolvido.
- **Nenhum provedor externo real.** Gemini e Open-Meteo não são chamados; as
  asserções sobre eles medem o comportamento quando a chave está ausente.
- **Nenhum ambiente publicado.** Tudo roda em `127.0.0.1`. O que passa aqui
  passa contra o schema do repositório, não contra o projeto remoto.
- **Concorrência real.** As asserções de idempotência exercitam o índice único,
  mas em execução sequencial.
