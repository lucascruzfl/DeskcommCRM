#!/usr/bin/env bash
# Canal MCP: só oferece tags com manifesto publicado e quatro imagens pinadas.
# Este arquivo é sourceado por agent.sh e update.sh depois de carregar .env.

mcp_channel_init() {
  [ "${DESKCOMM_UPDATE_CHANNEL:-official}" = custom-mcp ] || return 0
  if [[ ! "${DESKCOMM_UPDATE_REPOSITORY:-}" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*$ ]]; then
    echo 'Canal MCP: DESKCOMM_UPDATE_REPOSITORY inválido.' >&2; return 1
  fi
  if [[ ! "${DESKCOMM_IMAGE_REPOSITORY:-}" =~ ^ghcr\.io/[A-Za-z0-9][A-Za-z0-9_.-]*/deskcommcrm$ ]]; then
    echo 'Canal MCP: DESKCOMM_IMAGE_REPOSITORY inválido.' >&2; return 1
  fi
  MCP_GIT_URL="https://github.com/${DESKCOMM_UPDATE_REPOSITORY}.git"
  MCP_RELEASE_URL="https://github.com/${DESKCOMM_UPDATE_REPOSITORY}/releases/download"
  MCP_IMAGE_NS="${DESKCOMM_IMAGE_REPOSITORY%/*}"
}

mcp_channel_tags() {
  timeout 20s git ls-remote --tags --refs "$MCP_GIT_URL" 'v*-mcp' 2>/dev/null \
    | awk '{print $2}' | sed 's|refs/tags/||' \
    | awk '/^v[0-9]+\.[0-9]+\.[0-9]+-mcp$/' | sort -Vr
}

# Os argumentos são tag e SHA exato do commit remoto. Saída: somente sucesso/falha.
# O asset é produzido por CI depois dos testes e do push das quatro imagens.
mcp_channel_ready() {
  local tag="$1" sha="$2" manifest
  manifest="$(mktemp)" || return 1
  if ! curl -fsSL --max-time 15 "$MCP_RELEASE_URL/$tag/mcp-release.json" -o "$manifest"; then
    rm -f "$manifest"; return 1
  fi
  if ! python3 "$(dirname "${BASH_SOURCE[0]}")/mcp-release-validate.py" \
      "$manifest" "$tag" "$sha" "$DESKCOMM_IMAGE_REPOSITORY"; then
    rm -f "$manifest"; return 1
  fi
  # A publicação do asset sucede o push. Confere que os quatro digests continuam
  # no registro; ausência ou indisponibilidade não oferece o botão.
  local ref
  while IFS= read -r ref; do
    if ! timeout 15s docker buildx imagetools inspect "$ref" >/dev/null 2>&1; then
      rm -f "$manifest"; return 1
    fi
  done < <(python3 - "$manifest" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as stream:
    images = json.load(stream)["images"]
for role in ("app", "worker", "scheduler", "voice_agent"):
    image = images[role]
    print(image["repository"] + "@" + image["digest"])
PY
  )
  rm -f "$manifest"
}

mcp_channel_latest() {
  local tag sha
  while IFS= read -r tag; do
    [ -n "$tag" ] || continue
    sha="$(timeout 20s git ls-remote "$MCP_GIT_URL" "refs/tags/$tag" 2>/dev/null | awk '{print $1}')"
    [ -n "$sha" ] || continue
    if mcp_channel_ready "$tag" "$sha"; then printf '%s' "$tag"; return 0; fi
  done < <(mcp_channel_tags)
  return 1
}

mcp_channel_fetch() {
  local tag="$1" sha
  [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+-mcp$ ]] || return 1
  sha="$(timeout 20s git ls-remote "$MCP_GIT_URL" "refs/tags/$tag" 2>/dev/null | awk '{print $1}')"
  [ -n "$sha" ] && mcp_channel_ready "$tag" "$sha" || return 1
  timeout 45s git fetch --no-tags --quiet "$MCP_GIT_URL" "refs/tags/$tag:refs/tags/$tag" || return 1
  [ "$(git rev-parse "${tag}^{commit}")" = "$sha" ]
}

mcp_channel_load_images() {
  local tag="$1" sha="$2" manifest
  manifest="$(mktemp)" || return 1
  if ! curl -fsSL --max-time 15 "$MCP_RELEASE_URL/$tag/mcp-release.json" -o "$manifest" \
      || ! python3 "$(dirname "${BASH_SOURCE[0]}")/mcp-release-validate.py" \
        "$manifest" "$tag" "$sha" "$DESKCOMM_IMAGE_REPOSITORY"; then
    rm -f "$manifest"; return 1
  fi
  local refs=()
  mapfile -t refs < <(python3 - "$manifest" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as stream:
    images = json.load(stream)["images"]
for role in ("app", "worker", "scheduler", "voice_agent"):
    image = images[role]
    print(image["repository"] + "@" + image["digest"])
PY
  )
  rm -f "$manifest"
  [ "${#refs[@]}" = 4 ] || return 1
  MCP_APP_PIN="${refs[0]}"
  MCP_WORKER_PIN="${refs[1]}"
  MCP_SCHEDULER_PIN="${refs[2]}"
  MCP_VOICE_PIN="${refs[3]}"
  export MCP_APP_PIN MCP_WORKER_PIN MCP_SCHEDULER_PIN MCP_VOICE_PIN
}
