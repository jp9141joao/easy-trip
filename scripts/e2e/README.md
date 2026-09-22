# E2E local oficial

Na raiz do repositório, com as dependências do `package-lock.json` instaladas
(`npm ci`), Docker local via socket Unix, Bash, Node.js e Python 3 disponíveis:

```bash
bash scripts/e2e/e2e-run.sh
```

O runner usa o CLI Supabase instalado no repositório (2.117.0 no lockfile
atual). Não há runner alternativo nem Docker Compose de testes: os containers
são gerenciados pelo CLI. Downloads das imagens e das dependências Deno das
Functions exigem rede na primeira execução.

A pilha tem `project_id = "easy-trip-e2e"`, API em
`http://127.0.0.1:54421`, banco na porta 54422 e diretório gerado `.e2e/`.
Esse diretório recebe as migrations e Functions atuais, a configuração local
com portas próprias e a semente mínima já usada pelos testes. Não recebe o
vínculo remoto (`supabase/.temp`) nem o `.env` do aplicativo. O ambiente das
Functions recebe somente o segredo público de cron de teste. Variáveis
`SUPABASE_*` do terminal são removidas ao chamar o CLI; as chaves dos testes
vêm exclusivamente do `status` dessa pilha, cuja URL deve coincidir com a API
local dedicada. Nenhum comando acessa ou aplica migrations ao Supabase remoto.

## Serviços e prontidão

Os 11 arquivos `supabase/tests/*_e2e.mjs` exercitam Auth, REST/RPC, Storage e
três Functions HTTP (`delete-account`, `trip-suggestions`,
`trip-daily-briefing`). A pilha mantém PostgreSQL, GoTrue, Kong, PostgREST,
Storage API e Edge Runtime.

O `e2e-start.sh` exclui explicitamente:

- `logflare,vector`: coleta e consulta de logs; nenhum roteiro consulta esses
  serviços. Sua falha de saúde neste ambiente bloqueava o runner antes de
  qualquer teste. Os logs dos próprios roteiros continuam no relatório.
- `realtime`: os roteiros atuais não abrem canais ou subscriptions.
- `studio,postgres-meta`: interface administrativa e sua API auxiliar.
- `mailpit`: não há teste de entrega de email; os cadastros locais já usam
  `enable_confirmations = false`.
- `imgproxy`: não há transformação de imagens; upload, assinatura e download
  continuam usando o Storage real.
- `supavisor`: os testes não usam pool de conexões.

Analytics, Studio, Realtime, SMTP local e pooler também são desabilitados
somente na configuração gerada. O `supabase/config.toml` original é preservado.
O mecanismo de exclusão e os health checks são os do
[CLI oficial](https://supabase.com/docs/reference/cli/supabase-start).
Não se usa `--ignore-health-check` nem se amplia o timeout de inicialização.
Após o CLI aguardar os serviços, o runner verifica a última migration e as
rotas de Auth, REST e Storage, além de carregar as três Functions via OPTIONS,
sem alterar dados ou chamar provedores externos. Falhas abortam a execução
antes dos testes.

## Resultado e limpeza

Sem argumentos, todos os arquivos `*_e2e.mjs` são executados; nenhum teste ou
assertion é modificado pelo runner. O relatório detalhado fica em
`.e2e-report.txt`. Uma suíte sem asserções, uma falha, um erro de ambiente ou
uma seleção vazia não pode resultar em sucesso.

Ao terminar (inclusive em falha, SIGINT ou SIGTERM), o runner chama
`stop --project-id easy-trip-e2e --no-backup`, remove eventuais recursos Docker
residuais com o nome exato dessa pilha e apaga `.e2e/`. Erros de limpeza
produzem exit code diferente de zero. Não use execuções simultâneas: as portas
e o projeto são fixos. SIGKILL ou queda do Docker não permitem executar traps;
a próxima execução limpa a pilha anterior antes de criar outra.

Os modos de diagnóstico existentes continuam disponíveis: um nome de suíte
como argumento ou `E2E_KEEP=1` para conservar a pilha. Eles não correspondem à
validação completa e descartável acima. Para remover uma pilha conservada:

```bash
bash scripts/e2e/e2e-stop.sh
```

## Falha de rede do Docker antes dos testes

`LegacyDbSetupError` na etapa `Initialising schema` também pode indicar falha
de comunicação entre os containers, mesmo com o PostgreSQL saudável. Neste
Codespace foi observado Docker usando iptables-nft junto de uma política
`FORWARD DROP` antiga em iptables-legacy. O nome do banco resolvia, mas a
conexão TCP do job de inicialização do Storage expirava; os contadores da
política legacy confirmaram o descarte. Isso é independente de Logflare/Vector.
Não resolva esse caso ignorando health checks ou aumentando timeouts: a rede
Docker precisa permitir comunicação entre os serviços da pilha dedicada.
