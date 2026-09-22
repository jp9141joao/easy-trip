#!/usr/bin/env bash
# Derruba a pilha de teste e apaga os volumes dela.
#
# `--no-backup` é o que torna o banco descartável de verdade: sem ele o CLI
# guarda um dump e a próxima subida restaura o estado da execução anterior —
# testes veriam contas criadas na rodada passada.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/e2e-env.sh"
e2e_assert_docker_local

if [ -d "$E2E_WORKDIR" ]; then
  echo "→ derrubando a pilha '$E2E_PROJECT' e apagando os volumes"
  if ! supa stop --project-id "$E2E_PROJECT" --no-backup; then
    echo "→ stop do CLI falhou; removendo os recursos dedicados via Docker" >&2
  fi
fi

# Resíduo de uma execução interrompida antes de o workdir existir.
# A label também alcança jobs de inicialização com nomes aleatórios.
docker ps -aq --filter "label=com.supabase.cli.project=$E2E_PROJECT" | xargs -r docker rm -fv
docker ps -aq --filter "name=^/supabase_.*_${E2E_PROJECT}$" | xargs -r docker rm -fv
docker volume ls -q --filter "name=^supabase_.*_${E2E_PROJECT}$" | xargs -r docker volume rm
docker network ls -q --filter "name=^supabase_network_${E2E_PROJECT}$" | xargs -r docker network rm

e2e_remove_workdir
echo "✓ pilha de teste removida"
