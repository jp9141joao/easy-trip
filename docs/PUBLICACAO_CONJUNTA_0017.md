# 0017 e a Function `trip-suggestions` publicam JUNTAS

Registro de dependência de publicação. **Nada foi publicado nesta rodada** — nem
`supabase db push`, nem `supabase functions deploy`.

## O acoplamento

A migration `0017_suggestion_generation_lease.sql` trocou a assinatura de
`claim_trip_suggestion_refresh` (passou a devolver `attempt` e `retry_after`) e
criou `settle_trip_suggestion_refresh`. A Function `trip-suggestions` só existe
na forma atual porque essas duas funções existem: ela reserva a tentativa antes
do Gemini e a encerra depois, com o veredito de `policy.ts`.

Publicar um lado sem o outro produz defeito, e os dois defeitos são diferentes:

| estado | o que acontece |
|---|---|
| **Banco com 0017, Function antiga** | A Function antiga chama o claim esperando só `claimed`/`refreshed_at` e nunca chama `settle`. A tentativa fica registrada em `suggestions_attempt_key` e só é liberada pela lease — a viagem trava por 5 minutos a cada tentativa e a marca d'água de 6h nunca é gravada. |
| **Function nova, banco sem 0017** | `settle_trip_suggestion_refresh` não existe e o claim tem outra assinatura. A geração falha na primeira chamada, para toda viagem. |

## A ordem correta

1. `supabase db push` (aplica 0017);
2. `supabase functions deploy trip-suggestions`.

Nesta ordem a janela de exposição é a do primeiro quadro da tabela — degradação
de 5 minutos por tentativa, sem perda de dado — em vez de falha total. A ordem
inversa derruba a geração para todo mundo enquanto durar.

## Antes de publicar

- [ ] `./scripts/sql-test.sh` verde no banco local (inclui `suggestion_refresh_window.test.sql`);
- [ ] `npx tsc -p supabase/functions/tsconfig.json`;
- [ ] confirmar que `GEMINI_API_KEY` continua configurada no projeto remoto.
