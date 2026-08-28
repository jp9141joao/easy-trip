#!/usr/bin/env bash
# Derruba a pilha de teste e apaga os volumes dela.
#
# `--no-backup` é o que torna o banco descartável de verdade: sem ele o CLI
# guarda um dump e a próxima subida restaura o estado da execução anterior —
# testes veriam contas criadas na rodada passada.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/e2e-env.sh"

if [ -d "$E2E_WORKDIR" ]; then
  echo "→ derrubando a pilha '$E2E_PROJECT' e apagando os volumes"
  supa stop --no-backup >/dev/null 2>&1 || true
fi

# Resíduo de uma execução interrompida antes de o workdir existir.
docker ps -aq --filter "name=supabase_.*_${E2E_PROJECT}" | xargs -r docker rm -f >/dev/null 2>&1 || true
docker volume ls -q --filter "name=supabase_.*_${E2E_PROJECT}" | xargs -r docker volume rm -f >/dev/null 2>&1 || true

rm -rf "$E2E_WORKDIR"
echo "✓ pilha de teste removida"
