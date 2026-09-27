#!/usr/bin/env bash
# Só fixtures temporários: Git real, Docker/curl/crontab dublês. Nunca usa o host.
set -euo pipefail
unset $(git rev-parse --local-env-vars)
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export GIT_AUTHOR_NAME=Teste GIT_AUTHOR_EMAIL=teste@example.invalid
export GIT_COMMITTER_NAME=Teste GIT_COMMITTER_EMAIL=teste@example.invalid
export REAL_GIT="$(command -v git)" REAL_CURL="$(command -v curl)"
export TEST_SOURCE="$WORK/source" TEST_RELEASES="$WORK/releases"
export TEST_PAYLOAD="$WORK/heartbeat.json" TEST_DOCKER_LOG="$WORK/docker.log"
export TEST_BACKUP="$WORK/backup" TEST_CRONTAB="$WORK/crontab"
mkdir -p "$WORK/bin" "$TEST_SOURCE/hostgator-setup-kit" "$TEST_RELEASES"
cp -R "$ROOT/hostgator-setup-kit/." "$TEST_SOURCE/hostgator-setup-kit/"
printf 'services:\n  app:\n    image: fixture\n' > "$TEST_SOURCE/docker-compose.prod.yml"
printf '## [1.53.0-mcp]\n\nNova versão.\n\n## [1.47.0-mcp]\n\nInstalada.\n' > "$TEST_SOURCE/CHANGELOG.md"
cat > "$TEST_SOURCE/hostgator-setup-kit/backup.sh" <<'BACKUP'
#!/usr/bin/env bash
# Para ANTES de qualquer banco/checkout/container, depois de atravessar a guarda.
touch "$TEST_BACKUP"
exit 1
BACKUP
cat > "$WORK/bin/git" <<'STUB'
#!/usr/bin/env bash
args=()
for arg in "$@"; do
  [ "$arg" != 'https://github.com/fixture/runtime.git' ] || arg="$TEST_SOURCE"
  args+=("$arg")
done
exec "$REAL_GIT" "${args[@]}"
STUB
cat > "$WORK/bin/curl" <<'STUB'
#!/usr/bin/env bash
args=()
payload=''
while [ $# -gt 0 ]; do
  case "$1" in
    -d) shift; payload="$1" ;;
    https://github.com/fixture/runtime/releases/download/*)
      args+=("file://$TEST_RELEASES/${1#https://github.com/fixture/runtime/releases/download/}") ;;
    *) args+=("$1") ;;
  esac
  shift
done
if [ -n "$payload" ]; then
  printf '%s' "$payload" > "$TEST_PAYLOAD"
  printf '{"data":{"update_requested":false}}\n200'
  exit 0
fi
exec "$REAL_CURL" "${args[@]}"
STUB
cat > "$WORK/bin/docker" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$TEST_DOCKER_LOG"
case "$*" in
  'ps -a '*) exit 0 ;;
  'compose '* )
    case "$*" in
      *'ps --status running -q app') printf 'fixture-app-id\n' ;;
      *) exit 1 ;;
    esac ;;
  'container inspect fixture-app-id --format '* )
    case "$*" in
      *'.Config.Env'*) [ -z "${TEST_APP_VERSION:-}" ] || printf 'APP_VERSION=%s\n' "$TEST_APP_VERSION" ;;
      *'.Config.Labels'*) printf '%s\n' "${TEST_CONTAINER_LABEL:-}" ;;
      *'{{.Image}}'*) printf 'sha256:fixture-running-image\n' ;;
      *) exit 1 ;;
    esac ;;
  'image inspect sha256:fixture-running-image --format '* ) printf '%s\n' "${TEST_IMAGE_LABEL:-}" ;;
  'buildx imagetools inspect '* )
    if [ -n "${TEST_MISSING_DIGEST_ROLE:-}" ] && [[ "$*" = *"/$TEST_MISSING_DIGEST_ROLE@"* ]]; then exit 1; fi ;;
  *) exit 1 ;;
esac
STUB
cat > "$WORK/bin/crontab" <<'STUB'
#!/usr/bin/env bash
[ "$1" != -l ] || { [ ! -f "$TEST_CRONTAB" ] || cat "$TEST_CRONTAB"; exit 0; }
[ "$1" != - ] || { cat > "$TEST_CRONTAB"; exit 0; }
exit 1
STUB
chmod +x "$WORK/bin/"*
export PATH="$WORK/bin:$PATH"
"$REAL_GIT" init -q "$TEST_SOURCE"
"$REAL_GIT" -C "$TEST_SOURCE" add .
"$REAL_GIT" -C "$TEST_SOURCE" commit -qm base
"$REAL_GIT" -C "$TEST_SOURCE" tag v1.47.0-mcp
"$REAL_GIT" -C "$TEST_SOURCE" commit -qm release --allow-empty
"$REAL_GIT" -C "$TEST_SOURCE" tag v1.53.0-mcp
"$REAL_GIT" -C "$TEST_SOURCE" commit -qm 'checkout à frente' --allow-empty
"$REAL_GIT" clone -q "$TEST_SOURCE" "$WORK/consumer"
cd "$WORK/consumer"
cat > .env <<'ENV'
INTERNAL_CRON_SECRET=fixture-secret
NEXT_PUBLIC_APP_URL=http://fixture.invalid
DESKCOMM_UPDATE_CHANNEL=custom-mcp
DESKCOMM_UPDATE_REPOSITORY=fixture/runtime
DESKCOMM_IMAGE_REPOSITORY=ghcr.io/fixture/deskcommcrm
APP_VERSION=99.0.0-mcp
WORKER_IMAGE=fixture:fixed
SCHEDULER_IMAGE=fixture:fixed
ENV
# Impede rotação de segredo/crontab pelo heartbeat de fixture.
source hostgator-setup-kit/_common.sh
touch "$MARCA_SEGREDO_DO_CRON_NOME"
manifest() {
  local tag="$1" sha
  sha="$(git rev-parse "$tag")"
  mkdir -p "$TEST_RELEASES/$tag"
  python3 - "$TEST_RELEASES/$tag/mcp-release.json" "$tag" "$sha" <<'PY'
import json, sys
path, tag, sha = sys.argv[1:]
version = tag.removeprefix('v').removesuffix('-mcp')
names = dict(app='deskcommcrm', worker='deskcomm-worker', scheduler='deskcomm-scheduler', voice_agent='deskcomm-voice-agent')
images = {role: dict(repository='ghcr.io/fixture/'+name, tag=version+'-mcp', digest='sha256:'+'a'*64) for role, name in names.items()}
with open(path, 'w') as f:
    json.dump(dict(schema_version=1, deskcomm_version=version, tag=tag, mcp_commit=sha, tests='passed', gaps_a=0, tool_count_snapshot=202, images=images), f)
PY
}
manifest v1.53.0-mcp
assert_heartbeat() {
  local current="$1" latest="$2" off="$3" failed="${4:-false}"
  python3 - "$TEST_PAYLOAD" "$current" "$latest" "$off" "$failed" <<'PY'
import json, sys
path, current, latest, off, failed = sys.argv[1:]
with open(path) as f: body = json.load(f)
assert body['kind'] == 'heartbeat', body
assert body['current_version'] == current, body
assert body['latest_version'] == latest, body
assert body['off_release'] == (off == 'true'), body
assert body['compare_failed'] == (failed == 'true'), body
assert len(body['current_sha']) >= 7, body
PY
}
heartbeat() {
  : > "$TEST_DOCKER_LOG"
  bash hostgator-setup-kit/agent.sh
}
export TEST_APP_VERSION=1.47.0-mcp TEST_CONTAINER_LABEL=1.53.0-mcp TEST_IMAGE_LABEL=1.53.0-mcp
git merge-base --is-ancestor v1.53.0-mcp HEAD
heartbeat
assert_heartbeat 1.47.0-mcp v1.53.0-mcp false
printf '✓ caso 1: APP_VERSION vence labels e checkout à frente; 1.53 disponível\n'
# Prova que update.sh aceita o mesmo alvo e chega ao backup sem --force.
rm -f "$TEST_BACKUP"
if bash hostgator-setup-kit/update.sh --to v1.53.0-mcp > "$WORK/update.log" 2>&1; then exit 1; fi
test -f "$TEST_BACKUP"
! rg -q 'up |pull |stop |down ' "$TEST_DOCKER_LOG"
printf '✓ update aceita 1.47 → 1.53 mesmo com tag ancestral do checkout\n'
export TEST_APP_VERSION=1.53.0-mcp
heartbeat
assert_heartbeat 1.53.0-mcp '' false
printf '✓ caso 2: mesma versão não oferece atualização\n'
git checkout -q --detach v1.47.0-mcp
git -c advice.detachedHead=false commit -qm 'checkout divergente' --allow-empty
heartbeat
assert_heartbeat 1.53.0-mcp '' false
printf '✓ caso 3: checkout divergente não muda a versão instalada\n'
export TEST_APP_VERSION='' TEST_IMAGE_LABEL=1.47.0-mcp
heartbeat
assert_heartbeat 1.53.0-mcp '' false
export TEST_CONTAINER_LABEL='' TEST_IMAGE_LABEL=1.47.0-mcp
heartbeat
assert_heartbeat 1.47.0-mcp v1.53.0-mcp false
rg -q 'image inspect sha256:fixture-running-image' "$TEST_DOCKER_LOG"
export TEST_APP_VERSION=invalid
heartbeat
assert_heartbeat 1.47.0-mcp v1.53.0-mcp false
export TEST_APP_VERSION='' TEST_IMAGE_LABEL=''
git checkout -q v1.53.0-mcp
heartbeat
assert_heartbeat v1.53.0-mcp '' false
rg -q 'fallback Git legado' .update-agent.log
printf '✓ caso 4: APP_VERSION ausente/inválido → OCI container → imagem real → Git legado com log\n'
export TEST_APP_VERSION=1.47.0-mcp
for role in deskcommcrm deskcomm-worker deskcomm-scheduler deskcomm-voice-agent; do
  export TEST_MISSING_DIGEST_ROLE="$role"
  heartbeat
  assert_heartbeat 1.47.0-mcp '' false true
  rm -f "$TEST_BACKUP"
  if bash hostgator-setup-kit/update.sh --to v1.53.0-mcp > "$WORK/update.log" 2>&1; then exit 1; fi
  test ! -f "$TEST_BACKUP"
done
unset TEST_MISSING_DIGEST_ROLE
python3 - "$TEST_RELEASES/v1.53.0-mcp/mcp-release.json" <<'PY'
import json, sys
path = sys.argv[1]
with open(path) as f: data = json.load(f)
data['images']['voice_agent']['digest'] = 'inválido'
with open(path, 'w') as f: json.dump(data, f)
PY
heartbeat
assert_heartbeat 1.47.0-mcp '' false true
rm -f "$TEST_BACKUP"
if bash hostgator-setup-kit/update.sh --to v1.53.0-mcp > "$WORK/update.log" 2>&1; then exit 1; fi
test ! -f "$TEST_BACKUP"
printf '✓ caso 5: manifesto inválido ou qualquer um dos quatro digests ausente bloqueia anúncio e update\n'
# Mesma guarda para releases oficiais, comparação numérica, downgrade e canal.
source hostgator-setup-kit/_common.sh
is_already_installed v1.53.0 1.53.0
is_already_installed v1.47.0 1.53.0
if is_already_installed v1.53.0 1.47.0; then exit 1; else test "$?" = 1; fi
if is_already_installed v1.53.0-mcp 1.47.0; then exit 1; else test "$?" = 2; fi
if is_already_installed v1.53.0 1.47.0-rc.1; then exit 1; else test "$?" = 2; fi
if is_already_installed v1.10.0 1.9.0; then exit 1; else test "$?" = 1; fi
printf '✓ canal oficial, ordenação numérica, downgrade e comparação incerta preservados\n'
# Perda de canal continua fechada mesmo se o checkout perdeu toda história MCP.
git checkout -q --orphan fixture-official
git commit -qm 'checkout oficial' --allow-empty
DESKCOMM_UPDATE_CHANNEL=official
unset APP_VERSION
export TEST_APP_VERSION=1.47.0-mcp
mcp_checkout_sem_canal
printf '✓ imagem MCP impede fallback ao canal oficial mesmo com checkout oficial\n'
