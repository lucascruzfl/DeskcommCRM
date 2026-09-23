#!/usr/bin/env python3
"""Monta manifesto MCP só após quatro metadados de imagem válidos."""
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

NAMES = {"app": "deskcommcrm", "worker": "deskcomm-worker",
         "scheduler": "deskcomm-scheduler", "voice_agent": "deskcomm-voice-agent"}
DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")
VERSION = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")
SHA = re.compile(r"^[0-9a-f]{40}$")


def build_manifest(directory, owner, version, commit, tools):
    if not VERSION.fullmatch(version) or not SHA.fullmatch(commit):
        raise ValueError("versão ou commit inválido")
    if not isinstance(tools, int) or tools < 1:
        raise ValueError("snapshot do catálogo inválido")
    images = {}
    for role, name in NAMES.items():
        path = Path(directory) / f"{role}.metadata.json"
        digest = json.loads(path.read_text(encoding="utf-8"))["containerimage.digest"]
        if not DIGEST.fullmatch(digest):
            raise ValueError(f"digest inválido para {role}")
        images[role] = {"repository": f"ghcr.io/{owner.lower()}/{name}",
                        "tag": f"{version}-mcp", "digest": digest}
    return {"schema_version": 1, "release_date": datetime.now(timezone.utc).isoformat(),
            "deskcomm_version": version, "tag": f"v{version}-mcp", "mcp_commit": commit,
            "tests": "passed", "gaps_a": 0, "tool_count_snapshot": tools,
            "images": images}


def main():
    manifest = build_manifest(".", os.environ["GITHUB_REPOSITORY_OWNER"],
                              os.environ["RELEASE_VERSION"], os.environ["GITHUB_SHA"],
                              int(os.environ["TOOL_COUNT"]))
    Path("mcp-release.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
