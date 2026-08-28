#!/usr/bin/env bash
# =============================================================================
# Executa as suítes de ponta a ponta contra a pilha dedicada.
#
#   ./scripts/e2e/e2e-run.sh                 # sobe, roda tudo, derruba
#   ./scripts/e2e/e2e-run.sh auth_e2e        # só uma suíte
#   E2E_KEEP=1 ./scripts/e2e/e2e-run.sh      # deixa a pilha de pé para depurar
#
# Cada `.mjs` conta as próprias asserções e sai com 0 ou 1. Este script soma o
# que eles relatam e separa EXECUTADO de NÃO EXECUTADO — um arquivo que nem
# chegou a rodar não pode entrar na conta como aprovado.
# =============================================================================
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/e2e-env.sh"

ONLY="${1:-}"
REPORT="${E2E_REPORT:-$E2E_ROOT/.e2e-report.txt}"
: > "$REPORT"

cleanup() {
  if [ "${E2E_KEEP:-0}" != "1" ]; then
    "$E2E_ROOT/scripts/e2e/e2e-stop.sh" >/dev/null 2>&1 || true
  else
    echo "→ E2E_KEEP=1: a pilha continua de pé em $E2E_API_URL"
  fi
}
trap cleanup EXIT

"$E2E_ROOT/scripts/e2e/e2e-start.sh"
e2e_export_keys || { echo "✗ chaves indisponíveis"; exit 1; }
e2e_assert_local

echo
echo "=== suítes de ponta a ponta ==="
FAILED=0
declare -a EXECUTADAS=() NAO_EXECUTADAS=()

for f in "$E2E_ROOT"/supabase/tests/*_e2e.mjs; do
  name="$(basename "$f" .mjs)"
  [ -n "$ONLY" ] && [ "$name" != "$ONLY" ] && continue

  start=$(date +%s)
  out="$(node "$f" 2>&1)"; rc=$?
  elapsed=$(( $(date +%s) - start ))

  ok=$(printf '%s' "$out" | grep -cE '^\s*OK  ')
  bad=$(printf '%s' "$out" | grep -cE '^\s*FALHOU')

  {
    echo "===== $name (exit $rc, ${elapsed}s) ====="
    printf '%s\n' "$out"
    echo
  } >> "$REPORT"

  # Exit 2 é o guarda de ambiente dos próprios arquivos: falta de chave ou alvo
  # não-local. Isso NÃO é uma falha de teste, é uma suíte que não rodou — e
  # somá-la como aprovada ou reprovada seria inventar um resultado.
  if [ $rc -eq 2 ]; then
    printf '  %-24s → NÃO EXECUTADA (ambiente)\n' "$name"
    NAO_EXECUTADAS+=("$name")
    FAILED=1
  elif [ $rc -eq 0 ]; then
    printf '  %-24s → %3d ok, %3d falhas, %2ds\n' "$name" "$ok" "$bad" "$elapsed"
    EXECUTADAS+=("$name:$ok:$bad")
  else
    printf '  %-24s → %3d ok, %3d falhas, exit %d, %2ds\n' "$name" "$ok" "$bad" "$rc" "$elapsed"
    EXECUTADAS+=("$name:$ok:$bad")
    FAILED=1
  fi
done

echo
TOTAL_OK=0; TOTAL_BAD=0
for e in "${EXECUTADAS[@]:-}"; do
  [ -z "$e" ] && continue
  TOTAL_OK=$(( TOTAL_OK + $(echo "$e" | cut -d: -f2) ))
  TOTAL_BAD=$(( TOTAL_BAD + $(echo "$e" | cut -d: -f3) ))
done

echo "arquivos executados : ${#EXECUTADAS[@]}"
echo "arquivos não executados: ${#NAO_EXECUTADAS[@]} ${NAO_EXECUTADAS[*]:-}"
echo "asserções aprovadas : $TOTAL_OK"
echo "asserções falhadas  : $TOTAL_BAD"
echo "relatório completo  : $REPORT"
[ $FAILED -eq 0 ] && echo "✓ E2E: tudo passou" || echo "✗ E2E: houve falha"
exit $FAILED
