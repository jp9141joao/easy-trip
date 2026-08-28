#!/usr/bin/env bash
# =============================================================================
# Suítes SQL contra um PostgreSQL descartável.
#
# Sobe um contêiner `postgres:17` só para esta execução, aplica as migrations
# do repositório num banco novo por suíte, roda as asserções e apaga tudo no
# final. Não fala com o projeto remoto e não toca o stack local do autor.
#
#   ./scripts/sql-test.sh              # todas as suítes
#   ./scripts/sql-test.sh fresh        # só a instalação limpa 0001–00NN
#   ./scripts/sql-test.sh upgrade      # só o caminho de atualização
#
# Saída: uma linha por suíte com o número de asserções (`OK` emitidos) e o
# código de saída do psql. Qualquer asserção que falhe aborta a suíte.
# =============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${SQL_TEST_IMAGE:-public.ecr.aws/supabase/postgres:17.6.1.155}"
CONTAINER="${SQL_TEST_CONTAINER:-easytrip_sql_test_$$}"
ONLY="${1:-all}"
CRON_DB="cron_schedule_check"
FAILED=0

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "→ subindo PostgreSQL descartável ($IMAGE)"
# `cron.database_name` é parâmetro de postmaster: precisa estar definido na
# subida, e não pode ser trocado por sessão. É o que permite instalar `pg_cron`
# num banco descartável em vez de no `postgres` da imagem — que não serve, por
# não ter as tabelas do storage-api que as migrations 0002/0007 tocam.
# O CMD padrão da imagem é `postgres -D /etc/postgresql`, e argumentos passados
# ao `docker run` o SUBSTITUEM por inteiro — passar só `-c cron.database_name=…`
# derrubaria o `-D`, e com ele o postgresql.conf que carrega
# `shared_preload_libraries`. O sintoma seria "pg_cron can only be loaded via
# shared_preload_libraries" numa imagem que o carrega. Por isso o CMD é repetido
# na íntegra.
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=postgres "$IMAGE" \
  postgres -D /etc/postgresql -c "cron.database_name=$CRON_DB" >/dev/null
# A imagem do Supabase reinicia o servidor durante a inicialização: um
# `pg_isready` isolado passa cedo demais e a conexão seguinte cai. Exigimos
# três respostas consecutivas antes de considerar o banco pronto.
ok=0
for _ in $(seq 1 120); do
  if docker exec "$CONTAINER" psql -U postgres -d postgres -tAc 'select 1' >/dev/null 2>&1; then
    ok=$((ok + 1)); [ $ok -ge 3 ] && break
  else
    ok=0
  fi
  sleep 1
done
[ $ok -ge 3 ] || { echo "✗ banco não subiu"; exit 1; }
echo "  $(docker exec "$CONTAINER" psql -U postgres -tAc 'select version()' | cut -c1-40)"

# `supabase_admin` é o superusuário da imagem. As migrations rodam com ele
# porque `create extension pg_cron` exige superusuário — no Supabase hospedado
# quem aplica migration tem esse privilégio, e usar `postgres` aqui mediria uma
# restrição do contêiner de teste, não do produto.
psql_db() { docker exec -i "$CONTAINER" psql -U supabase_admin -d "$1" -X -v ON_ERROR_STOP=1 "${@:2}"; }

make_db() {  # make_db <nome> <primeira-migration> <última-migration>
  docker exec -i "$CONTAINER" psql -U supabase_admin -d postgres -X -q \
    -c "drop database if exists $1;" -c "create database $1;" >/dev/null
  psql_db "$1" -q < "$ROOT/supabase/tests/_local_bootstrap.sql" >/dev/null || return 1
  for m in "$ROOT"/supabase/migrations/*.sql; do
    n="$(basename "$m" | cut -c1-4)"
    [ "$n" \< "$2" ] && continue
    [ "$n" \> "$3" ] && continue
    psql_db "$1" -q < "$m" >/dev/null || { echo "  ✗ migration $(basename "$m")"; return 1; }
  done
}

LAST="$(basename "$(ls "$ROOT"/supabase/migrations/*.sql | sort | tail -1)" | cut -c1-4)"

run_suite() {  # run_suite <rótulo> <banco> <arquivo-de-teste>
  local out rc n
  out="$(psql_db "$2" < "$3" 2>&1)"; rc=$?
  n="$(printf '%s' "$out" | grep -c 'OK  ')"
  if [ $rc -eq 0 ]; then
    printf '  %-34s → %3d asserções, 0 falhas, exit %d\n' "$1" "$n" "$rc"
  else
    printf '  %-34s → %3d asserções, FALHOU, exit %d\n' "$1" "$n" "$rc"
    printf '%s\n' "$out" | grep -iE 'FALHOU|ERROR|erro' | head -5
    FAILED=1
  fi
}

if [ "$ONLY" = all ] || [ "$ONLY" = fresh ]; then
  echo "→ instalação limpa: 0001–$LAST"
  make_db fresh_install 0001 "$LAST" && echo "  todas as migrations aplicam" || FAILED=1
fi

if [ "$ONLY" = all ] || [ "$ONLY" = upgrade ]; then
  echo "→ atualização: 0001–0007 + dados legados + 0008–$LAST"
  docker exec -i "$CONTAINER" psql -U supabase_admin -d postgres -X -q \
    -c "drop database if exists legacy_upgrade;" -c "create database legacy_upgrade;" >/dev/null
  psql_db legacy_upgrade -q < "$ROOT/supabase/tests/_local_bootstrap.sql" >/dev/null
  for m in "$ROOT"/supabase/migrations/000[1-7]_*.sql; do psql_db legacy_upgrade -q < "$m" >/dev/null || FAILED=1; done
  psql_db legacy_upgrade -q < "$ROOT/supabase/tests/legacy_upgrade_seed.sql" >/dev/null || FAILED=1
  for m in "$ROOT"/supabase/migrations/*.sql; do
    n="$(basename "$m" | cut -c1-4)"; [ "$n" \< 0008 ] && continue
    psql_db legacy_upgrade -q < "$m" >/dev/null || { echo "  ✗ $(basename "$m")"; FAILED=1; }
  done
  run_suite "legacy_upgrade.test.sql" legacy_upgrade "$ROOT/supabase/tests/legacy_upgrade.test.sql"
fi

if [ "$ONLY" = all ]; then
  echo "→ suítes de RLS (banco novo por suíte, 0001–$LAST)"
  for t in rls_articles rls_content rls_collaboration ownership_transfer; do
    make_db "t_$t" 0001 "$LAST" || { FAILED=1; continue; }
    run_suite "$t.test.sql" "t_$t" "$ROOT/supabase/tests/$t.test.sql"
  done

  # `pg_cron` só se instala no banco que `cron.database_name` aponta, e esse
  # nome é fixado na subida do contêiner (é um parâmetro de postmaster, não de
  # sessão). Por isso o banco desta suíte tem nome combinado com o `docker run`
  # lá em cima, e não segue o padrão `t_<suíte>` das demais.
  echo "→ agendamento (banco '$CRON_DB', exigência do pg_cron)"
  make_db "$CRON_DB" 0001 "$LAST" || FAILED=1
  run_suite "briefing_schedule.test.sql" "$CRON_DB" "$ROOT/supabase/tests/briefing_schedule.test.sql"
fi

[ $FAILED -eq 0 ] && echo "✓ SQL: tudo passou" || echo "✗ SQL: houve falha"
exit $FAILED
