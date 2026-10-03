// @vitest-environment node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const script = fs.readFileSync("scripts/conferir-isolamento-do-kit.sh", "utf8");

function executar(falhaUpstream = false) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "deskcomm-kit-fork-"));
  try {
    for (const pasta of ["scripts", "hostgator-setup-kit", "bin"]) {
      fs.mkdirSync(path.join(raiz, pasta));
    }
    fs.writeFileSync(path.join(raiz, "scripts/conferir-isolamento-do-kit.sh"), script);
    fs.writeFileSync(
      path.join(raiz, "hostgator-setup-kit/update.sh"),
      `# E AS REGRAS DE ISOLAMENTO SÃO CONFERIDAS
  esperadas="$(awk 'BEGIN { print "tenant_isolation_contacts_all|contacts" }')"
  faltando="$(pg_container imagem psql url -Atc 'select policies')"
`,
    );
    fs.writeFileSync(
      path.join(raiz, "bin/git"),
      `#!/usr/bin/env bash
set -euo pipefail
shift 2 # -C <raiz>
case "$1" in
  rev-parse)
    if [ "$2" = --is-shallow-repository ]; then echo true
    elif [[ "$*" == *v1.57.0-mcp* ]]; then exit 0
    else test -f "$FIXTURE_ROOT/buscada"; fi ;;
  fetch)
    printf '%s\\n' "$*" >> "$FIXTURE_ROOT/fetch.log"
    [[ "$*" == *https://github.com/melgarafael/DeskcommCRM.git* ]] || exit 1
    [ "$FALHA_UPSTREAM" = 0 ] || exit 1
    touch "$FIXTURE_ROOT/buscada" ;;
  show)
    if [[ "$2" == v1.63.0:* ]]; then test -f "$FIXTURE_ROOT/buscada"; fi
    cat "$FIXTURE_ROOT/hostgator-setup-kit/update.sh" ;;
  *) exit 99 ;;
esac
`,
      { mode: 0o755 },
    );
    fs.writeFileSync(path.join(raiz, "bin/docker"), "#!/usr/bin/env bash\nexit 0\n", {
      mode: 0o755,
    });
    const resultado = spawnSync("bash", ["scripts/conferir-isolamento-do-kit.sh", "efemero", "molde"], {
      cwd: raiz,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${path.join(raiz, "bin")}:${process.env.PATH}`,
        CONFERENCIA_KIT_RELEASE: "v1.57.0-mcp",
        FIXTURE_ROOT: raiz,
        FALHA_UPSTREAM: falhaUpstream ? "1" : "0",
      },
    });
    return {
      ...resultado,
      fetches: fs.readFileSync(path.join(raiz, "fetch.log"), "utf8"),
    };
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
}

describe("conferência do kit num fork sem a tag histórica oficial", () => {
  it("mede checkout, release MCP e v1.63.0 obtida do produto oficial", () => {
    const resultado = executar();
    expect(resultado.status, resultado.stderr).toBe(0);
    expect(resultado.stdout).toContain("update.sh da última release (v1.57.0-mcp)");
    expect(resultado.stdout).toContain("update.sh da v1.63.0 (sem filtro por tabela)");
    expect(resultado.fetches).toContain("https://github.com/melgarafael/DeskcommCRM.git");
    expect(resultado.fetches).not.toContain(" origin ");
  });

  it("reprova quando a fonte oficial da tag histórica está indisponível", () => {
    const resultado = executar(true);
    expect(resultado.status).toBe(1);
    expect(resultado.stdout).not.toContain("✓ update.sh da v1.63.0");
  });
});
