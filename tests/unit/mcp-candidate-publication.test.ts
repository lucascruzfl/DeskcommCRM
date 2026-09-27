import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const source = readFileSync(".github/workflows/publish-mcp-release.yml", "utf8");
const start = source.indexOf("      - name: Exigir gates verdes do commit candidato");
const block = source.slice(start).split("      - name: Verificar auditoria")[0]!;
const gateRun = block.split("run: |\n")[1]!.replace(/^ {10}/gm, "");
const checks = ["verify", "build-and-size", "invariants", "e2e", "imagens-ok"];

function execute(checkRuns: unknown[]) {
  const dir = mkdtempSync(join(tmpdir(), "mcp-candidate-"));
  try {
    const fixture = join(dir, "fixture.json");
    writeFileSync(fixture, JSON.stringify({ check_runs: checkRuns }));
    writeFileSync(join(dir, "gh"), '#!/bin/sh\ncat "$MCP_TEST_FIXTURE"\n', { mode: 0o755 });
    return spawnSync("bash", ["-c", gateRun], {
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        RUNNER_TEMP: dir,
        MCP_TEST_FIXTURE: fixture,
        GITHUB_REPOSITORY: "fixture/repo",
        GITHUB_SHA: "fixture-sha",
      },
      encoding: "utf8",
    }).status;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("publicação do candidato MCP", () => {
  it("só habilita dispatch explícito do fork e branch de integração", () => {
    expect(source.includes("default: false")).toBe(true);
    expect(source).toContain("inputs.release_candidate");
    expect(source).toContain("refs/heads/feat/mcp-update-");
    expect(source).toContain("lucascruzfl/DeskcommCRM");
  });
  it("aceita somente os cinco checks verdes do commit", () => {
    expect(
      execute(
        checks.map((name) => ({ name, conclusion: "success", started_at: "2026-09-26T00:00:00Z" })),
      ),
    ).toBe(0);
  });
  it.each(["failure", "cancelled", "skipped", null])(
    "E2E %s bloqueia antes de qualquer publicação",
    (conclusion) => {
      expect(
        execute(
          checks.map((name) => ({ name, conclusion: name === "e2e" ? conclusion : "success" })),
        ),
      ).not.toBe(0);
    },
  );
  it("check ausente bloqueia", () => {
    expect(
      execute(
        checks
          .filter((name) => name !== "imagens-ok")
          .map((name) => ({ name, conclusion: "success" })),
      ),
    ).not.toBe(0);
  });
  it("uma tentativa nova vermelha não herda verde antigo", () => {
    expect(
      execute([
        ...checks.map((name) => ({
          name,
          conclusion: "success",
          started_at: "2026-09-25T00:00:00Z",
        })),
        { name: "verify", conclusion: "failure", started_at: "2026-09-26T00:00:00Z" },
      ]),
    ).not.toBe(0);
  });
});
