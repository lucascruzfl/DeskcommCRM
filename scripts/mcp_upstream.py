#!/usr/bin/env python3
"""Detecta releases oficiais e prepara uma integração MCP isolada.

Nunca resolve conflitos nem declara gaps A iguais a zero. O relatório é evidência
para a auditoria humana; a publicação tem seus próprios gates.
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

UPSTREAM = "melgarafael/DeskcommCRM"
VERSION = re.compile(r"^v(\d+)\.(\d+)\.(\d+)$")
MCP_VERSION = re.compile(r"^v(\d+)\.(\d+)\.(\d+)-mcp$")
AREAS = {
    "MCP": ("lib/mcp/", "app/api/mcp/"),
    "Banco e migrations": ("supabase/",),
    "Autorização": ("lib/auth/", "lib/api/", "proxy.ts"),
    "Serviços e workers": ("lib/", "workers/", "app/api/", "app/actions/"),
    "Interface": ("app/app/", "components/", "hooks/"),
    "Updater e imagens": ("hostgator-setup-kit/", "Dockerfile", "docker-compose", ".github/workflows/"),
}


def run(*args, check=True):
    return subprocess.run(args, text=True, capture_output=True, check=check)


def version(tag, pattern):
    match = pattern.fullmatch(tag)
    return tuple(map(int, match.groups())) if match else None


def latest_ready(releases):
    return max((version(r["tag_name"], MCP_VERSION)
                for r in releases
                if version(r["tag_name"], MCP_VERSION)
                and any(a["name"] == "mcp-release.json" for a in r.get("assets", []))),
               default=None)


def decision(upstream, ready):
    target = version(upstream, VERSION)
    if target is None:
        raise ValueError(f"tag oficial inválida: {upstream}")
    return "integrate" if ready is None or target > ready else "noop"


def gh_json(path):
    return json.loads(run("gh", "api", path).stdout)


def summary(message):
    print(message)
    if os.getenv("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as stream:
            stream.write(message + "\n")


def report(version_text, base, upstream_sha, changed, conflicts):
    lines = [f"# Delta MCP para v{version_text}", "",
             f"- Linha MCP anterior: `{base}`", f"- Tag oficial: `v{version_text}` (`{upstream_sha}`)",
             f"- Arquivos alterados pelo upstream desde v1.42.0: {len(changed)}",
             f"- Conflitos Git: {len(conflicts)}", ""]
    if conflicts:
        lines += ["## Conflitos — intervenção obrigatória", ""] + [f"- `{p}`" for p in conflicts] + [""]
    for area, prefixes in AREAS.items():
        items = [p for p in changed if any(p.startswith(prefix) for prefix in prefixes)]
        lines += [f"## {area} ({len(items)})", ""] + [f"- `{p}`" for p in items] + [""]
    migrations = [p for p in changed if p.startswith("supabase/migrations/") and p.endswith(".sql")]
    lines += ["## Migrations oficiais novas", ""] + [f"- `{p}`" for p in migrations] + [""]
    lines += ["## Classificação A/B/C", "", "PENDENTE: revisão humana das novas operações e contratos. Gaps A não declarados como zero.",
              "", "## Gates", "", "PENDENTE: integração, sentinelas, banco, updater e imagens.", ""]
    Path("mcp-delta-report.md").write_text("\n".join(lines), encoding="utf-8")


def main():
    repo = os.getenv("GITHUB_REPOSITORY", "lucascruzfl/DeskcommCRM")
    release = gh_json(f"repos/{UPSTREAM}/releases/latest")
    tag = release["tag_name"]
    releases = gh_json(f"repos/{repo}/releases?per_page=100")
    ready = latest_ready(releases)
    if decision(tag, ready) == "noop":
        summary(f"Nenhuma nova versão: upstream {tag}; última MCP pronta {ready}.")
        return 0
    v = tag[1:]
    branch = f"mcp/integrate/{v}"
    summary(f"Nova versão upstream detectada: {tag}. MCP anterior: {ready}.")
    # A tag, e não a main, define o conteúdo. Sem force e sem sobrescrever
    # uma tentativa anterior: ela pode conter resolução humana em andamento.
    if run("git", "ls-remote", "--exit-code", "origin", f"refs/heads/{branch}", check=False).returncode == 0:
        summary(f"Integração {branch} já existe; aguardando PR e auditoria.")
        return 0
    run("git", "fetch", "--no-tags", f"https://github.com/{UPSTREAM}.git", f"refs/tags/{tag}:refs/tags/upstream-{v}")
    upstream_sha = run("git", "rev-parse", f"upstream-{v}^{{commit}}").stdout.strip()
    base = run("git", "rev-parse", "HEAD").stdout.strip()
    previous_tag = "v" + ".".join(map(str, ready)) if ready else "v1.42.0"
    run("git", "fetch", "--no-tags", f"https://github.com/{UPSTREAM}.git", f"refs/tags/{previous_tag}:refs/tags/upstream-previous")
    changed = run("git", "diff", "--name-only", "upstream-previous", f"upstream-{v}").stdout.splitlines()
    run("git", "checkout", "-b", branch)
    merge = run("git", "merge", "--no-commit", "--no-ff", f"upstream-{v}", check=False)
    conflicts = run("git", "diff", "--name-only", "--diff-filter=U").stdout.splitlines()
    report(v, base, upstream_sha, changed, conflicts)
    if merge.returncode or conflicts:
        title = f"MCP v{v}: integração bloqueada por conflito"
        body = Path("mcp-delta-report.md").read_text(encoding="utf-8")
        issues = run("gh", "issue", "list", "-R", repo, "--state", "open", "--search", title,
                     "--json", "title").stdout
        if not any(i["title"] == title for i in json.loads(issues)):
            run("gh", "issue", "create", "-R", repo, "--title", title, "--body", body)
        summary(f"Nova versão upstream detectada, mas MCP não foi publicado. Conflitos: {', '.join(conflicts)}.")
        return 2
    run("git", "config", "user.name", "github-actions[bot]")
    run("git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com")
    run("git", "commit", "-m", f"chore(mcp): integrar tag oficial {tag}")
    run("git", "push", "origin", f"HEAD:refs/heads/{branch}")
    body = (f"Integração automática de `{tag}` sobre `mcp/stable`.\n\n"
            "**Publicação bloqueada** até auditoria A/B/C, gaps A = 0, gates completos e merge revisado.\n\n"
            "O relatório detalhado está no artefato do workflow.\n")
    run("gh", "pr", "create", "-R", repo, "--base", "mcp/stable", "--head", branch,
        "--title", f"MCP: integrar {tag}", "--body", body)
    summary(f"PR {branch} aberto. Nova versão upstream detectada, mas MCP não foi publicado: auditoria pendente.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (subprocess.CalledProcessError, ValueError, KeyError) as exc:
        summary(f"Nova versão upstream detectada, mas MCP não foi publicado. Erro: {exc}")
        sys.exit(1)
