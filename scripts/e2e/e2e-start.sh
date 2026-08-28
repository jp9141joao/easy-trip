#!/usr/bin/env bash
# Sobe a pilha local dedicada aos testes de ponta a ponta. Ver `e2e-env.sh`.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/e2e-env.sh"

# A ORDEM AQUI NÃO É ARBITRÁRIA.
#
# `e2e_materialize` apaga e recria o diretório de trabalho. Se a pilha estiver
# de pé nesse momento, os contêineres continuam montando o inode ANTIGO — o
# diretório apagado — e passam a enxergar uma pasta vazia. O sintoma é o edge
# runtime respondendo 503 com "failed to determine entrypoint" para toda
# função, e ele não se parece nem um pouco com a causa.
echo "→ derrubando qualquer pilha de teste anterior"
"$E2E_ROOT/scripts/e2e/e2e-stop.sh" >/dev/null 2>&1 || true

echo "→ montando o diretório de trabalho da pilha de teste"
e2e_materialize

echo "→ subindo a pilha '$E2E_PROJECT' (API $E2E_API_PORT, DB $E2E_DB_PORT)"
supa start

# As migrations do repositório são aplicadas pelo `start`, porque
# `[db.migrations] enabled = true`. Confirmamos que a última chegou: subir com
# o schema antigo faria os testes falharem por um motivo que não é deles.
LAST="$(basename "$(ls "$E2E_ROOT"/supabase/migrations/*.sql | sort | tail -1)" | cut -c1-4)"
echo "→ conferindo que a migration $LAST está aplicada"
docker exec "supabase_db_${E2E_PROJECT}" psql -U postgres -d postgres -tAc \
  "select count(*) from supabase_migrations.schema_migrations where version like '${LAST}%'" \
  | grep -q '^1$' || { echo "✗ migration $LAST não aplicada"; exit 1; }

e2e_export_keys || { echo "✗ não foi possível ler as chaves da pilha"; exit 1; }
echo "✓ pilha de teste pronta em $E2E_API_URL"
