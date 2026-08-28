#!/usr/bin/env bash
# =============================================================================
# Recontagem de tudo, do zero.
#
# Os números do TCC precisam vir de uma medição, e não de uma lista mantida à
# mão que envelhece a cada migration. Este script conta o que existe AGORA:
# o código pelo sistema de arquivos, o schema por um banco descartável com
# 0001–N aplicadas.
#
#   ./scripts/count-artifacts.sh
# =============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${SQL_TEST_IMAGE:-public.ecr.aws/supabase/postgres:17.6.1.155}"
CONTAINER="easytrip_count_$$"
CRON_DB="count_check"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "# Contagem de artefatos — Easy Trip"
echo
echo "Gerado em $(date -u +%Y-%m-%dT%H:%M:%SZ) · commit \`$(git -C "$ROOT" rev-parse --short HEAD)\`"
echo

echo "## Código"
echo
echo "| artefato | contagem | como foi contado |"
echo "|---|---:|---|"

conta() { printf '| %s | %s | `%s` |\n' "$1" "$2" "$3"; }

# Rotas do Expo Router: cada arquivo em src/app que não é layout nem grupo.
ROTAS=$(find "$ROOT/src/app" -name '*.tsx' ! -name '_layout.tsx' ! -name '+*.tsx' | wc -l)
conta "Rotas (telas)" "$ROTAS" "find src/app -name '*.tsx' ! -name '_layout.tsx' ! -name '+*.tsx'"

LAYOUTS=$(find "$ROOT/src/app" -name '_layout.tsx' | wc -l)
conta "Layouts" "$LAYOUTS" "find src/app -name '_layout.tsx'"

DOMINIO=$(ls "$ROOT/src/domain"/*.ts 2>/dev/null | wc -l)
conta "Módulos de domínio" "$DOMINIO" "ls src/domain/*.ts"

HOOKS=$(ls "$ROOT/src/hooks"/*.ts "$ROOT/src/hooks"/*.tsx 2>/dev/null | wc -l)
conta "Hooks" "$HOOKS" "ls src/hooks/*.ts*"

SERVICOS=$(ls "$ROOT/src/services"/*.ts 2>/dev/null | wc -l)
conta "Serviços" "$SERVICOS" "ls src/services/*.ts"

# Contratos de repositório: as interfaces *Repository em types.ts.
CONTRATOS=$(grep -c "^export interface .*Repository" "$ROOT/src/repositories/types.ts")
conta "Contratos de repositório" "$CONTRATOS" "grep -c '^export interface .*Repository' src/repositories/types.ts"

COMPONENTES=$(find "$ROOT/src/components" -name '*.tsx' | wc -l)
conta "Componentes" "$COMPONENTES" "find src/components -name '*.tsx'"

PROVIDERS=$(ls "$ROOT/src/providers"/*.tsx 2>/dev/null | wc -l)
conta "Providers" "$PROVIDERS" "ls src/providers/*.tsx"

LIB=$(ls "$ROOT/src/lib"/*.ts 2>/dev/null | wc -l)
conta "Módulos de infraestrutura (lib)" "$LIB" "ls src/lib/*.ts"

MIGRATIONS=$(ls "$ROOT/supabase/migrations"/*.sql | wc -l)
conta "Migrations" "$MIGRATIONS" "ls supabase/migrations/*.sql"

FUNCOES=$(find "$ROOT/supabase/functions" -mindepth 1 -maxdepth 1 -type d ! -name '_shared' | wc -l)
conta "Edge Functions" "$FUNCOES" "find supabase/functions -maxdepth 1 -type d ! -name _shared"

SUITES=$(find "$ROOT/tests" -name '*.test.ts' -o -name '*.test.tsx' | wc -l)
conta "Conjuntos de teste (Jest)" "$SUITES" "find tests -name '*.test.ts*'"

SQLSUITES=$(ls "$ROOT/supabase/tests"/*.test.sql | wc -l)
conta "Suítes SQL" "$SQLSUITES" "ls supabase/tests/*.test.sql"

E2EFILES=$(ls "$ROOT/supabase/tests"/*_e2e.mjs | wc -l)
conta "Arquivos de ponta a ponta" "$E2EFILES" "ls supabase/tests/*_e2e.mjs"

LOC=$(find "$ROOT/src" -name '*.ts' -o -name '*.tsx' | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}')
conta "Linhas em src/" "$LOC" "wc -l em src/**/*.ts*"

LOCTESTS=$(find "$ROOT/tests" -name '*.ts' -o -name '*.tsx' | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}')
conta "Linhas em tests/" "$LOCTESTS" "wc -l em tests/**/*.ts*"

LOCSQL=$(cat "$ROOT/supabase/migrations"/*.sql | wc -l)
conta "Linhas de migration" "$LOCSQL" "wc -l em supabase/migrations/*.sql"

echo
echo "## Schema (banco descartável, 0001–$(basename "$(ls "$ROOT"/supabase/migrations/*.sql | sort | tail -1)" | cut -c1-4))"
echo

docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=postgres "$IMAGE" \
  postgres -D /etc/postgresql -c "cron.database_name=$CRON_DB" >/dev/null
ok=0
for _ in $(seq 1 120); do
  if docker exec "$CONTAINER" psql -U supabase_admin -d postgres -tAc 'select 1' >/dev/null 2>&1; then
    ok=$((ok + 1)); [ $ok -ge 3 ] && break
  else ok=0; fi
  sleep 1
done
[ $ok -ge 3 ] || { echo "banco não subiu"; exit 1; }

psql() { docker exec -i "$CONTAINER" psql -U supabase_admin -d "$CRON_DB" -X -tAq "$@"; }

docker exec -i "$CONTAINER" psql -U supabase_admin -d postgres -X -q \
  -c "create database $CRON_DB;" >/dev/null
psql -v ON_ERROR_STOP=1 < "$ROOT/supabase/tests/_local_bootstrap.sql" >/dev/null
for m in "$ROOT"/supabase/migrations/*.sql; do
  psql -v ON_ERROR_STOP=1 < "$m" >/dev/null || { echo "falhou: $(basename "$m")"; exit 1; }
done

echo "| objeto | contagem |"
echo "|---|---:|"

q() { printf '| %s | %s |\n' "$1" "$(psql -c "$2" | tr -d '[:space:]')"; }

# `public` apenas: `auth` e `storage` são do Supabase, não deste projeto.
q "Tabelas em \`public\`" \
  "select count(*) from pg_tables where schemaname='public'"
q "Colunas em \`public\`" \
  "select count(*) from information_schema.columns where table_schema='public'"
q "Funções em \`public\`" \
  "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'"
q "Funções \`security definer\`" \
  "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef"
q "Triggers (não internos)" \
  "select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal"
q "Índices em \`public\`" \
  "select count(*) from pg_indexes where schemaname='public'"
q "Constraints em \`public\`" \
  "select count(*) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public'"
q "  · CHECK" \
  "select count(*) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public' and c.contype='c'"
q "  · FOREIGN KEY" \
  "select count(*) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public' and c.contype='f'"
q "  · UNIQUE" \
  "select count(*) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public' and c.contype='u'"
q "Policies em \`public\`" \
  "select count(*) from pg_policies where schemaname='public'"
q "Policies em \`storage.objects\`" \
  "select count(*) from pg_policies where schemaname='storage' and tablename='objects'"
q "**Policies, total**" \
  "select count(*) from pg_policies where schemaname in ('public','storage')"
q "Tabelas com RLS ligada" \
  "select count(*) from pg_tables where schemaname='public' and rowsecurity"
q "Tabelas SEM RLS (deve ser 0)" \
  "select count(*) from pg_tables where schemaname='public' and not rowsecurity"
q "Buckets de Storage" \
  "select count(*) from storage.buckets"
q "  · privados" \
  "select count(*) from storage.buckets where not public"
q "  · públicos" \
  "select count(*) from storage.buckets where public"
q "Tabelas com privilégio para \`anon\` (deve ser 0)" \
  "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and has_table_privilege('anon', c.oid, 'select')"

echo
echo "### Buckets"
echo
echo "| bucket | público | limite | tipos |"
echo "|---|---|---:|---|"
psql -c "select '| ' || id || ' | ' || case when public then 'sim' else 'não' end || ' | ' || coalesce(file_size_limit::text,'—') || ' | ' || coalesce(array_to_string(allowed_mime_types,', '),'—') || ' |' from storage.buckets order by id"
