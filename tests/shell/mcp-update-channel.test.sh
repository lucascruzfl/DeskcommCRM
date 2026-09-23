#!/usr/bin/env bash
# Prova o intervalo perigoso: upstream 1.43 saiu, mas o release MCP ainda não.
set -euo pipefail
unset $(git rev-parse --local-env-vars)
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export GIT_AUTHOR_NAME=Teste GIT_AUTHOR_EMAIL=teste@example.invalid
export GIT_COMMITTER_NAME=Teste GIT_COMMITTER_EMAIL=teste@example.invalid

git init -q "$WORK/source"
git -C "$WORK/source" -c user.name=Teste -c user.email=teste@example.invalid \
  commit -q --allow-empty -m base
git -C "$WORK/source" tag v1.42.0-mcp
git -C "$WORK/source" -c user.name=Teste -c user.email=teste@example.invalid \
  commit -q --allow-empty -m proxima
git -C "$WORK/source" tag v1.43.0-mcp
git clone -q "$WORK/source" "$WORK/consumer"
mkdir -p "$WORK/bin" "$WORK/releases/v1.42.0-mcp" "$WORK/releases/v1.43.0-mcp"
cat > "$WORK/bin/docker" <<'SH'
#!/usr/bin/env bash
test "$1" = buildx && test "$2" = imagetools && test "$3" = inspect
SH
chmod +x "$WORK/bin/docker"
export PATH="$WORK/bin:$PATH"
source "$ROOT/hostgator-setup-kit/mcp-channel.sh"
DESKCOMM_IMAGE_REPOSITORY=ghcr.io/lucascruzfl/deskcommcrm
MCP_GIT_URL="$WORK/source"
MCP_RELEASE_URL="file://$WORK/releases"

manifest() {
  local ver="$1" sha="$2"
  python3 - "$WORK/releases/v${ver}-mcp/mcp-release.json" "$ver" "$sha" <<'PY'
import json, sys
path, version, sha = sys.argv[1:]
names = {"app": "deskcommcrm", "worker": "deskcomm-worker", "scheduler": "deskcomm-scheduler", "voice_agent": "deskcomm-voice-agent"}
images = {role: {"repository": "ghcr.io/lucascruzfl/" + name,
                 "tag": version + "-mcp", "digest": "sha256:" + "a" * 64}
          for role, name in names.items()}
with open(path, "w", encoding="utf-8") as stream:
    json.dump({"schema_version": 1, "deskcomm_version": version,
               "tag": "v" + version + "-mcp", "mcp_commit": sha,
               "tests": "passed", "gaps_a": 0,
               "tool_count_snapshot": 202, "images": images}, stream)
PY
}

cd "$WORK/consumer"
manifest 1.42.0 "$(git -C "$WORK/source" rev-parse v1.42.0-mcp)"
test "$(mcp_channel_latest)" = v1.42.0-mcp
# Nem --to manual, nem o botão podem aceitar o 1.43 sem asset.
if mcp_channel_fetch v1.43.0-mcp 2>/dev/null; then exit 1; fi

manifest 1.43.0 "$(git -C "$WORK/source" rev-parse v1.43.0-mcp)"
python3 - "$WORK/releases/v1.43.0-mcp/mcp-release.json" <<'PY'
import json, sys
path = sys.argv[1]
with open(path, encoding="utf-8") as stream: data = json.load(stream)
data["tests"] = "failed"
with open(path, "w", encoding="utf-8") as stream: json.dump(data, stream)
PY
test "$(mcp_channel_latest)" = v1.42.0-mcp
manifest 1.43.0 "$(git -C "$WORK/source" rev-parse v1.43.0-mcp)"
test "$(mcp_channel_latest)" = v1.43.0-mcp
mcp_channel_fetch v1.43.0-mcp
mcp_channel_load_images v1.43.0-mcp "$(git rev-parse v1.43.0-mcp)"
test "$MCP_APP_PIN" = "ghcr.io/lucascruzfl/deskcommcrm@sha256:$(printf 'a%.0s' {1..64})"
source "$ROOT/hostgator-setup-kit/_common.sh"
git checkout -q v1.43.0-mcp
DESKCOMM_UPDATE_CHANNEL=official
mcp_checkout_sem_canal
DESKCOMM_UPDATE_CHANNEL=custom-mcp
if mcp_checkout_sem_canal; then exit 1; fi
echo '✓ 1.43 bloqueada sem manifesto, liberada somente após testes e digests'
