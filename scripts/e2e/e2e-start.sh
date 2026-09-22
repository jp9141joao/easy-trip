#!/usr/bin/env bash
# Sobe a pilha local dedicada aos testes de ponta a ponta. Ver `e2e-env.sh`.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/e2e-env.sh"
e2e_assert_local
e2e_assert_docker_local

# A ORDEM AQUI NÃO É ARBITRÁRIA.
#
# `e2e_materialize` apaga e recria o diretório de trabalho. Se a pilha estiver
# de pé nesse momento, os contêineres continuam montando o inode ANTIGO — o
# diretório apagado — e passam a enxergar uma pasta vazia. O sintoma é o edge
# runtime respondendo 503 com "failed to determine entrypoint" para toda
# função, e ele não se parece nem um pouco com a causa.
echo "→ derrubando qualquer pilha de teste anterior"
"$E2E_ROOT/scripts/e2e/e2e-stop.sh"

echo "→ montando o diretório de trabalho da pilha de teste"
e2e_materialize

echo "→ subindo a pilha '$E2E_PROJECT' (API $E2E_API_PORT, DB $E2E_DB_PORT)"
# Os 11 roteiros usam DB, Auth, Kong, PostgREST, Storage e Edge Runtime.
# Logflare/Vector só coletam logs; os demais excluídos também não são usados.
# Mantemos os health checks do CLI para TODOS os serviços que de fato sobem.
supa start --exclude logflare,vector,realtime,studio,postgres-meta,mailpit,imgproxy,supavisor

# As migrations do repositório são aplicadas pelo `start`, porque
# `[db.migrations] enabled = true`. Confirmamos que a última chegou: subir com
# o schema antigo faria os testes falharem por um motivo que não é deles.
LAST="$(basename "$(ls "$E2E_ROOT"/supabase/migrations/*.sql | sort | tail -1)" | cut -c1-4)"
echo "→ conferindo que a migration $LAST está aplicada"
docker exec "supabase_db_${E2E_PROJECT}" psql -U postgres -d postgres -tAc \
  "select count(*) from supabase_migrations.schema_migrations where version like '${LAST}%'" \
  | grep -q '^1$' || { echo "✗ migration $LAST não aplicada"; exit 1; }

e2e_export_keys || { echo "✗ não foi possível ler as chaves da pilha"; exit 1; }
# Além dos health checks do CLI, confira as rotas usadas pelos testes. OPTIONS
# carrega as Functions sem criar dados nem chamar provedores externos.
node --input-type=module <<'JS'
const api = process.env.SUPABASE_API_URL;
const headers = {
  apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
};
for (const [path, method] of [
  ['/auth/v1/health', 'GET'],
  ['/rest/v1/', 'GET'],
  ['/storage/v1/bucket', 'GET'],
  ...['delete-account', 'trip-suggestions', 'trip-daily-briefing'].map(name => [`/functions/v1/${name}`, 'OPTIONS']),
]) {
  const response = await fetch(`${api}${path}`, { method, headers });
  await response.body?.cancel();
  if (!response.ok) throw new Error(`Serviço indisponível: ${path} → ${response.status}`);
  console.log(`  pronto: ${path}`);
}
JS
echo "✓ pilha de teste pronta em $E2E_API_URL"
