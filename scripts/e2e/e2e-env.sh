# =============================================================================
# Definições comuns dos scripts de ponta a ponta. Não executa nada sozinho.
#
# A PILHA DE TESTE É OUTRA, E ISSO É O PONTO
#
# Os testes desta pasta criam contas, sobem arquivos e apagam linhas. Rodá-los
# contra o stack local de desenvolvimento destruiria o banco em que o autor
# trabalha; rodá-los contra o remoto está proibido pelo guarda que cada arquivo
# `.mjs` carrega (`§53`) e pela política do projeto.
#
# Então a pilha é DEDICADA: um `project_id` próprio, portas próprias, volumes
# próprios. Os contêineres se chamam `supabase_*_easy-trip-e2e`, ao lado dos
# `supabase_*_easy-trip` sem tocá-los. Derrubar a pilha de teste apaga os
# volumes dela e nada mais.
#
# O diretório de trabalho é gerado, e não versionado: ele é uma cópia do
# `supabase/` do repositório com o `project_id` e as portas trocados. Copiar em
# vez de editar o original é o que garante que rodar os testes não deixa
# resíduo em `supabase/config.toml`.
# =============================================================================

E2E_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
E2E_PROJECT="easy-trip-e2e"
E2E_WORKDIR="${E2E_WORKDIR:-$E2E_ROOT/.e2e}"

# Deslocamento de porta: o stack padrão ocupa 54320–54329.
E2E_API_PORT=54421
E2E_DB_PORT=54422
E2E_SHADOW_PORT=54420
E2E_STUDIO_PORT=54423
E2E_SMTP_PORT=54424
E2E_POOLER_PORT=54429
E2E_ANALYTICS_PORT=54427

E2E_API_URL="http://127.0.0.1:${E2E_API_PORT}"

supa() { npx --no-install supabase --workdir "$E2E_WORKDIR" "$@"; }

# Monta o diretório de trabalho da pilha de teste a partir do repositório.
e2e_materialize() {
  # O CLI grava segredos em `.temp/` como root (via contêiner), e um `rm -rf`
  # daqui esbarra em "permission denied" na segunda execução. Quem apaga é um
  # contêiner descartável, que roda como root e alcança o que criamos.
  if [ -d "$E2E_WORKDIR" ]; then
    rm -rf "$E2E_WORKDIR" 2>/dev/null || \
      docker run --rm -v "$E2E_ROOT:/host" alpine rm -rf "/host/$(basename "$E2E_WORKDIR")" >/dev/null 2>&1
  fi
  mkdir -p "$E2E_WORKDIR/supabase"
  cp -r "$E2E_ROOT/supabase/migrations" "$E2E_WORKDIR/supabase/migrations"
  cp -r "$E2E_ROOT/supabase/functions"  "$E2E_WORKDIR/supabase/functions"
  cp "$E2E_ROOT/supabase/config.toml"   "$E2E_WORKDIR/supabase/config.toml"

  # Semente MÍNIMA e exclusiva de teste. A `seed.sql` do repositório popula o
  # catálogo editorial inteiro; nada disso é necessário aqui, e carregá-la
  # tornaria o tempo de subida dominado por dado que nenhum teste lê.
  cp "$E2E_ROOT/scripts/e2e/seed.e2e.sql" "$E2E_WORKDIR/supabase/seed.e2e.sql"

  # SEGREDO DO CRON NA PILHA DE TESTE
  #
  # `functions_http_e2e` mede a autorização de `trip-daily-briefing`, que exige
  # service role E um segredo dedicado. Sem o segredo instalado, a função
  # responde 503 "misconfigured" a TODA chamada privilegiada — comportamento
  # correto dela, mas que faz as asserções de 403 medirem a ausência de
  # configuração em vez da regra de autorização.
  #
  # O valor é fixo e público de propósito: é um segredo DE TESTE, para uma
  # pilha descartável que só escuta em 127.0.0.1. O segredo real de produção
  # nunca passa por aqui, e não há caminho por onde este alcance o remoto.
  cat > "$E2E_WORKDIR/supabase/functions/.env" <<'ENV'
TRIP_DAILY_BRIEFING_CRON_SECRET=e2e-cron-secret-nao-usar-em-producao
ENV

  python3 - "$E2E_WORKDIR/supabase/config.toml" <<PY
import re, sys
p = sys.argv[1]
s = open(p).read()
s = s.replace('project_id = "easy-trip"', 'project_id = "$E2E_PROJECT"')
for old, new in [
    ("54321", "$E2E_API_PORT"), ("54322", "$E2E_DB_PORT"),
    ("54320", "$E2E_SHADOW_PORT"), ("54323", "$E2E_STUDIO_PORT"),
    ("54324", "$E2E_SMTP_PORT"), ("54329", "$E2E_POOLER_PORT"),
    ("54327", "$E2E_ANALYTICS_PORT"),
]:
    s = re.sub(r'(?<![0-9])%s(?![0-9])' % old, new, s)
# A semente do repositório é trocada pela mínima de teste.
s = re.sub(r'^sql_paths = .*$', 'sql_paths = ["./seed.e2e.sql"]', s, flags=re.M)
open(p, "w").write(s)
PY
}

# Exporta as chaves da pilha de teste para o ambiente.
e2e_export_keys() {
  local status
  status="$(supa status -o env 2>/dev/null)" || return 1
  eval "$status"
  export SUPABASE_API_URL="$E2E_API_URL"
  export SUPABASE_ANON_KEY="${ANON_KEY:-}"
  export SUPABASE_SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY:-}"
  # O mesmo segredo que a pilha instalou na função, para o teste poder exercitar
  # o caminho autorizado além dos caminhos recusados.
  export TRIP_DAILY_BRIEFING_CRON_SECRET="e2e-cron-secret-nao-usar-em-producao"
  [ -n "$SUPABASE_ANON_KEY" ] && [ -n "$SUPABASE_SERVICE_ROLE_KEY" ]
}

# Rede de segurança. Cada `.mjs` já recusa alvo não-local, mas um erro de
# variável de ambiente aqui apontaria TODOS eles para o mesmo lugar errado.
e2e_assert_local() {
  case "$E2E_API_URL" in
    http://127.0.0.1:*|http://localhost:*) ;;
    *) echo "✗ recusado: $E2E_API_URL não é local"; exit 2 ;;
  esac
}
