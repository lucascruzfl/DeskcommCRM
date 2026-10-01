/**
 * O `invariants` (check OBRIGATÓRIO) passou a aceitar que a matriz rode com UMA
 * major só — e isso só vale em `pull_request` que não alcança o piso
 * (`invariants-alcance` → `piso=nao`, scripts/pr-mexe-no-piso-do-postgres.sh).
 *
 * Fora de pull_request o piso é obrigatório: a `main` mede as duas majors, e é
 * por isso que toda mudança de schema continua provada no piso — no PR dela e de
 * novo na árvore integrada.
 *
 * Como nos irmãos (imagens-ok, e2e), o script do agregador é EXECUTADO contra a
 * matriz inteira de desfechos, e o conjunto do que passa tem de ser exatamente o
 * declarado. `skipped` da matriz nunca passa: sem major nenhuma, nada foi medido.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// Sem parser YAML nas dependências: recorte do primeiro `run: |` do job `invariants`.
function scriptDoAgregador(): string {
  const linhas = readFileSync(".github/workflows/ci.yml", "utf-8").split("\n");
  const job = linhas.findIndex((l) => l === "  invariants:");
  const run = linhas.findIndex((l, i) => i > job && /^\s+run: \|$/.test(l));
  const indent = (linhas[run + 1] ?? "").match(/^\s*/)![0].length;
  const corpo: string[] = [];
  for (const l of linhas.slice(run + 1)) {
    if (l.trim() && l.match(/^\s*/)![0].length < indent) break;
    corpo.push(l.slice(indent));
  }
  return corpo.join("\n");
}

const SCRIPT = scriptDoAgregador();
const DESFECHOS = "success failure skipped cancelled";

function combinacoesAceitas(): string[] {
  const programa = `
for EVENTO in pull_request push; do
 for PISO in sim nao ""; do
  for PORTAO in ${DESFECHOS}; do
   for MAJORS in ${DESFECHOS}; do
    export EVENTO PISO PORTAO MAJORS
    ( eval "$SCRIPT_DO_JOB" ) >/dev/null 2>&1
    rc=$?
    [ $rc -eq 0 ] && echo "$EVENTO \${PISO:-vazio} $PORTAO $MAJORS"
   done
  done
 done
done
true`;
  return execFileSync("bash", ["-c", programa], {
    env: { ...process.env, SCRIPT_DO_JOB: SCRIPT, DETECTOR: "success", DOCS_SAFE: "nao" },
    encoding: "utf-8",
  })
    .split("\n")
    .filter(Boolean);
}

describe("invariants só aceita a matriz reduzida onde ela foi declarada", () => {
  it("fast path comprovado passa; detector inválido ou major pulada sem prova reprova", () => {
    const run = (detector: string, docs: string, majors: string, evento = "pull_request") => {
      try {
        execFileSync("bash", ["-c", SCRIPT], { env: { ...process.env, EVENTO: evento, DETECTOR: detector, DOCS_SAFE: docs, PORTAO: "success", PISO: "sim", MAJORS: majors, GITHUB_STEP_SUMMARY: "/dev/null" }, stdio: "ignore" });
        return true;
      } catch { return false; }
    };
    expect(run("success", "sim", "skipped")).toBe(true);
    expect(run("failure", "sim", "skipped")).toBe(false);
    expect(run("success", "nao", "skipped")).toBe(false);
    expect(run("success", "nao", "success")).toBe(true);
    expect(run("success", "sim", "skipped", "push")).toBe(false);
  });
  it("controle positivo: o recorte pegou o script que lê os três resultados", () => {
    for (const v of ["$PORTAO", "$PISO", "$MAJORS", "$EVENTO"]) expect(SCRIPT).toContain(v);
  });

  it("da matriz inteira de desfechos (96), passa exatamente o que foi declarado", { timeout: 60_000 }, () => {
    expect(combinacoesAceitas().sort()).toEqual(
      [
        // PR: a matriz tem de passar, com piso ou sem ele.
        "pull_request sim success success",
        "pull_request nao success success",
        // Saída vazia com o portão `success` não acontece (ele sempre escreve
        // a saída); se acontecer, em PR só passa com a matriz MEDIDA.
        "pull_request vazio success success",
        // Fora de PR, o piso é obrigatório: `nao` e vazio não passam.
        "push sim success success",
      ].sort(),
    );
  });
});
