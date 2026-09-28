#!/usr/bin/env bash
# Examina só arquivos versionados: artefatos locais, inclusive .env, ficam fora.
# O binário roda localmente, sem validação online de credenciais.
set -euo pipefail

cd "$(dirname "$0")/.."

versao=1.8.1
case "$(uname -m)" in
  x86_64) arquitetura=x64; sha256=efa407244e1ea8e35f582b8a42becdeac08bdead04f68eb752adda722d583c2a ;;
  aarch64) arquitetura=arm64; sha256=bbb578b12a2f65d7082ab436abf37724232bc71d8a078e3c41336574420f1b48 ;;
  *) echo "Arquitetura sem binário fixado para o scanner." >&2; exit 1 ;;
esac
arquivo="betterleaks_${versao}_linux_${arquitetura}.tar.gz"
temporario="$(mktemp -d)"
trap 'rm -rf "$temporario"' EXIT

curl --fail --silent --show-error --location --retry 3 \
  "https://github.com/betterleaks/betterleaks/releases/download/v${versao}/${arquivo}" \
  --output "$temporario/$arquivo"
printf '%s  %s\n' "$sha256" "$temporario/$arquivo" | sha256sum --check --status
tar -xzf "$temporario/$arquivo" -C "$temporario" betterleaks

# Controle positivo: uma regressão do detector não pode produzir verde vazio.
python3 - "$temporario/canario.txt" <<'PY'
from pathlib import Path
import secrets
import string
import sys

alfabeto = string.ascii_letters + string.digits
Path(sys.argv[1]).write_text(
    "GITHUB_TOKEN=ghp_" + "".join(secrets.choice(alfabeto) for _ in range(36)) + "\n"
)
PY
if "$temporario/betterleaks" dir "$temporario/canario.txt" --confidence high \
  --redact --no-banner --no-color --report-format json \
  --report-path "$temporario/canario.json" > /dev/null 2>&1; then
  echo "O scanner não detectou o controle positivo." >&2
  exit 1
fi
python3 - "$temporario/canario.json" <<'PY'
from pathlib import Path
import json
import sys

relatorio = Path(sys.argv[1])
if not relatorio.exists() or not json.loads(relatorio.read_text()):
    raise SystemExit("O scanner falhou sem detectar o controle positivo.")
PY

mkdir "$temporario/tree"
git archive HEAD | tar -x -C "$temporario/tree"
(
  cd "$temporario/tree"
  "$temporario/betterleaks" dir . --confidence high --redact --no-banner --no-color
)
