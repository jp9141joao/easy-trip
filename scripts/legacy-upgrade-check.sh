#!/usr/bin/env bash
# =============================================================================
# O cenário de upgrade do banco que está em produção hoje.
#
#   0001–0007  →  dados de quem já usa o aplicativo  →  0008–0012  →  asserções
#
# Roda num banco descartável dentro do Postgres LOCAL. Não fala com o projeto
# remoto, não faz `db push` e não altera o banco do stack local.
#
#   ./scripts/legacy-upgrade-check.sh
# =============================================================================
set -euo pipefail

CONTAINER="${SUPABASE_DB_CONTAINER:-supabase_db_easy-trip}"
DB="${LEGACY_UPGRADE_DB:-legacy_upgrade_check}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

psql_db() {
  docker exec -i "$CONTAINER" psql -U postgres -d "$DB" -X -v ON_ERROR_STOP=1 "$@"
}

echo "→ recriando o banco descartável '$DB'"
docker exec -i "$CONTAINER" psql -U postgres -d postgres -X -q \
  -c "drop database if exists $DB;" -c "create database $DB;" >/dev/null

echo "→ ambiente mínimo + migrations 0001–0007 (o que o remoto tem hoje)"
psql_db -q < "$ROOT/supabase/tests/_local_bootstrap.sql" >/dev/null
for m in "$ROOT"/supabase/migrations/000[1-7]_*.sql; do
  psql_db -q < "$m" >/dev/null
done

echo "→ dados legados, gravados sob o schema antigo"
psql_db -q < "$ROOT/supabase/tests/legacy_upgrade_seed.sql" >/dev/null

echo "→ migrations 0008–0012 (as que ainda não subiram)"
for m in "$ROOT"/supabase/migrations/0008_*.sql "$ROOT"/supabase/migrations/0009_*.sql \
         "$ROOT"/supabase/migrations/0010_*.sql "$ROOT"/supabase/migrations/0011_*.sql \
         "$ROOT"/supabase/migrations/0012_*.sql; do
  psql_db -q < "$m" >/dev/null
done

echo "→ asserções"
psql_db < "$ROOT/supabase/tests/legacy_upgrade.test.sql"
