import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function job(file: string, name: string): string {
  const source = readFileSync(`.github/workflows/${file}`, "utf8");
  const start = source.indexOf(`\n  ${name}:\n`);
  if (start < 0) throw Error(`job ${name} ausente`);
  const tail = source.slice(start + 1);
  const end = tail.slice(1).search(/\n  [a-zA-Z0-9_-]+:\n/);
  return end < 0 ? tail : tail.slice(0, end + 1);
}

function script(file: string, name: string): string {
  const lines = job(file, name).split("\n");
  const start = lines.findIndex((line) => /^\s+run: \|$/.test(line));
  if (start < 0) throw Error(`run do ${name} ausente`);
  const indent = lines[start + 1]!.match(/^\s*/)?.[0].length ?? 0;
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() && (line.match(/^\s*/)?.[0].length ?? 0) < indent) break;
    body.push(line.slice(indent));
  }
  return body.join("\n");
}

// Sem parser YAML: recorte por indentação, com controle positivo no próprio teste.
function runVerify(partes: string, docs = "nao"): boolean {
  const lines = script("ci.yml", "verify");
  try {
    execFileSync("bash", ["-c", lines], {
      env: { ...process.env, DOCS_SAFE: docs, PARTES: partes, GITHUB_STEP_SUMMARY: "/dev/null" },
      stdio: "ignore",
    });
    return true;
  } catch { return false; }
}

describe("required checks do fast path", () => {
  it("verify roda completo mesmo com docs-safe e reprova filho pulado", () => {
    const part = job("ci.yml", "verify-parte");
    const aggregate = job("ci.yml", "verify");
    expect(part).not.toMatch(/^    if:/m);
    expect(part).not.toContain("needs: [docs-safe]");
    expect(part).toContain("pnpm typecheck");
    expect(part).toContain("pnpm lint");
    expect(part).toContain("pnpm cercas");
    expect(part).toContain("--shard=");
    expect(aggregate).toContain("needs: [verify-parte]");
    expect(aggregate).not.toContain("docs_safe");
    expect(runVerify("skipped", "sim")).toBe(false);
    expect(runVerify("failure", "sim")).toBe(false);
    expect(runVerify("success", "sim")).toBe(true);
    expect(runVerify("success", "nao")).toBe(true);
    // Uma alteração documental inválida ainda encontra as três guardas.
    expect(part).toContain("pnpm test:unit --project produto --shard=");
    for (const guard of ["evidencia-citada", "fragmentos-de-release", "documentacao-aponta-para-o-que-existe"]) {
      expect(readFileSync(`tests/unit/${guard}.test.ts`, "utf8").length).toBeGreaterThan(0);
    }
  });

  it("docs-safe evita somente as partes pesadas dos outros quatro domínios", () => {
    expect(job("ci.yml", "invariants-majors")).toContain("needs.docs-safe.outputs.docs_safe != 'sim'");
    expect(job("ci.yml", "invariants")).toContain('"$DOCS_SAFE" = "sim"');
    expect(job("e2e.yml", "e2e-parte")).toContain("needs.e2e-alcance.outputs.docs_safe != 'sim'");
    expect(job("e2e.yml", "e2e")).toContain('"$DOCS_SAFE" = "sim"');
    expect(job("publish-image.yml", "imagem-do-app-sobe")).toContain("needs.a-tag-veio-da-main.outputs.imagem == 'sim'");
    expect(job("publish-image.yml", "imagens-ok")).toContain('"$DOCS_SAFE" = "sim"');
    expect(job("perf.yml", "build-and-size")).toContain("if: steps.docs.outputs.docs_safe != 'sim'");
  });

  it("os quatro workflows invocam o mesmo detector; build-and-size fica presente", () => {
    for (const file of ["ci.yml", "e2e.yml", "publish-image.yml"]) {
      const source = readFileSync(`.github/workflows/${file}`, "utf8");
      expect(source).toContain("node scripts/ci-docs-safe-delta.mjs");
      expect(source).toMatch(/ref: \$\{\{[^\n]*github\.event\.pull_request\.base\.sha/);
      expect(source).toContain("detector ausente na base confiável");
    }
    const perf = job("perf.yml", "build-and-size");
    expect(perf).toContain('git show "${BASE_SHA}:scripts/ci-docs-safe-delta.mjs"');
    expect(perf).toContain('node "$RUNNER_TEMP/ci-docs-safe-delta.mjs"');
    expect(perf).toContain("run: pnpm build");
    expect(perf).toContain("if: steps.docs.outputs.docs_safe != 'sim'");
    expect(perf).not.toMatch(/^    if:/m);
  });
});
