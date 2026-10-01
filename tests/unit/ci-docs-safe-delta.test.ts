import { describe, expect, it } from "vitest";
// O detector é JavaScript nativo: roda antes de instalar dependências no runner.
// @ts-expect-error módulo .mjs intencionalmente sem declaração TypeScript
import { PARENT_TRUSTED_CHECKS, caminhoSeguro, checksVersionados, checksVerdes, coletarCheckRuns, decide, deltaSeguro, eventoValido, parseDiff } from "../../scripts/ci-docs-safe-delta.mjs";

const PREVIOUS = "a".repeat(40);
const CURRENT = "b".repeat(40);
const REPO = ["lucascruzfl", "DeskcommCRM"].join("/");
const required = checksVersionados();
const event = () => ({
  action: "synchronize", before: PREVIOUS, after: CURRENT,
  repository: { full_name: REPO },
  pull_request: { number: 42, base: { ref: "mcp/stable" }, head: { sha: CURRENT } },
});
const green = () => required.names.map((name: string, i: number) => ({
  id: i + 1, name, head_sha: PREVIOUS, status: "completed", conclusion: "success",
  started_at: "2026-09-30T12:00:00Z", completed_at: "2026-09-30T12:01:00Z", app: { id: 15368 },
}));
const change = (path: string, status = "M", modes = ["100644", "100644"]) =>
  ({ status, paths: [path], modes });
const deps = (paths = [change("docs/README.md")], runs = green()) => ({
  prHead: () => CURRENT, checkRuns: () => runs, changes: () => paths,
});

describe("delta documental seguro", () => {
  it("a fonte versionada exige os quatro contexts medidos e o build", () => {
    expect(required.names).toEqual(["build-and-size", "e2e", "imagens-ok", "invariants", "verify"]);
    expect([...required.apps.values()]).toEqual(Array(5).fill(15368));
    expect(Object.keys(PARENT_TRUSTED_CHECKS).sort()).toEqual(required.names);
  });
  it.each([
    "docs/README.md", "evidence/x.png", ".changes/x.md", "README.md",
    "tasks/x.md", ".github/README.md", ".github/ISSUE_TEMPLATE/bug.md",
  ])("aceita %s", (p) => expect(caminhoSeguro(p)).toBe(true));

  it.each([
    "lib/x.ts", "app/x.tsx", "supabase/migrations/x.sql", ".github/workflows/ci.yml",
    "scripts/x.sh", "tests/unit/x.test.ts", "tests/e2e/x.spec.ts", "package.json",
    "pnpm-lock.yaml", ".agents/skill.md", ".claude/skill.md", "docs/falso.ts",
    "evidence/script.sh", "docs/mcp/RELEASE-AUDIT.json", "docs/a.md/../../lib/x.ts",
    "docs/foo\nbar.md", "docs/a.svg", "lib/README.md", "AGENTS.md", "CLAUDE.md",
    "CODEX.md", ".github/copilot-instructions.md", "docs/AGENTS.md", ".hidden.md",
  ])("rejeita %s", (p) => expect(caminhoSeguro(p)).toBe(false));

  it("rejeita delta vazio, lista incompleta, erro de descoberta e modos executáveis", () => {
    expect(deltaSeguro([])).toBeTruthy();
    expect(deltaSeguro(Array(1001).fill(change("docs/x.md")))).toBeTruthy();
    expect(deltaSeguro([change("docs/x.md", "M", ["100644", "120000"])] )).toBeTruthy();
    expect(deltaSeguro([change("docs/x.md", "M", ["100644", "100755"])] )).toBeTruthy();
    expect(deltaSeguro([change("docs/x.md", "A", ["000000", "160000"])] )).toBeTruthy();
    expect(() => parseDiff("R100\0docs/a.md\0", () => "100644")).toThrow();
    expect(decide(event(), 1, REPO, { ...deps(), changes: () => { throw Error("403"); } }).safe).toBe(false);
  });

  it("check-runs paginam sem truncar; API 403/404/500 ou lista ambígua reprovam", () => {
    expect(coletarCheckRuns((page: number) => page === 1
      ? { total_count: 101, check_runs: Array.from({ length: 100 }, (_, i) => ({ id: i + 1 })) }
      : { total_count: 101, check_runs: [{ id: 101 }] })).toHaveLength(101);
    expect(() => coletarCheckRuns(() => { throw Error("403"); })).toThrow();
    expect(() => coletarCheckRuns(() => ({ total_count: 101, check_runs: [{ id: 1 }] }))).toThrow();
    expect(() => coletarCheckRuns(() => ({ total_count: 1000, check_runs: [] }))).toThrow();
    expect(() => coletarCheckRuns(() => ({ total_count: 2, check_runs: [{ id: 1 }, { id: 1 }] }))).toThrow();
  });

  it("rename exige os dois caminhos; delete só o caminho antigo", () => {
    expect(deltaSeguro([{ status: "R", paths: ["docs/a.md", "lib/a.ts"], modes: ["100644", "100644"] }])).toBeTruthy();
    expect(deltaSeguro([{ status: "R", paths: ["lib/a.ts", "docs/a.md"], modes: ["100644", "100644"] }])).toBeTruthy();
    expect(deltaSeguro([change("lib/a.ts", "D")])).toBeTruthy();
    expect(deltaSeguro([change("docs/a.md", "D", ["100644", "000000"])] )).toBeNull();
  });

  it.each(["push", "tag", "workflow_dispatch", "opened"]) ("evento %s cai para full", (kind) => {
    const e = event();
    e.action = kind;
    if (kind === "opened") delete (e as { before?: string }).before;
    expect(eventoValido(e, 1, REPO)).toBeTruthy();
  });
  it("reentrada, before ausente, after diferente e base errada caem para full", () => {
    expect(eventoValido(event(), 2, REPO)).toBeTruthy();
    expect(eventoValido({ ...event(), before: undefined }, 1, REPO)).toBeTruthy();
    expect(eventoValido({ ...event(), after: PREVIOUS }, 1, REPO)).toBeTruthy();
    expect(eventoValido({ ...event(), pull_request: { ...event().pull_request, base: { ref: "main" } } }, 1, REPO)).toBeTruthy();
  });

  it.each(["missing", "pending", "skipped", "failure", "neutral", "cancelled"]) ("parent check %s impede atalho", (state) => {
    const runs = green();
    if (state === "missing") runs.pop();
    else { runs[0].status = state === "pending" ? "in_progress" : "completed"; runs[0].conclusion = state; }
    expect(checksVerdes(runs, required, PREVIOUS)).toBeTruthy();
    expect(decide(event(), 1, REPO, deps([change("docs/x.md")], runs)).safe).toBe(false);
  });

  it("SHA de outro commit, verde velho e vermelho novo não servem", () => {
    const wrong = green(); wrong[0].head_sha = CURRENT;
    expect(checksVerdes(wrong, required, PREVIOUS)).toBeTruthy();
    const newer = [...green(), { ...green()[0], id: 999, status: "completed", conclusion: "failure", started_at: "2026-09-30T13:00:00Z" }];
    expect(checksVerdes(newer, required, PREVIOUS)).toBeTruthy();
    expect(decide(event(), 1, REPO, deps([change("docs/x.md")], newer)).safe).toBe(false);
    const oldFailure = [...green(), { ...green()[0], id: 998, conclusion: "failure", started_at: "2026-09-30T11:00:00Z" }];
    expect(checksVerdes(oldFailure, required, PREVIOUS)).toBeTruthy();
    const tiedBad = [...green(), { ...green()[0], id: 997, conclusion: "skipped" }];
    expect(checksVerdes(tiedBad, required, PREVIOUS)).toBeTruthy();
    const duplicateId = [...green(), { ...green()[0] }];
    expect(checksVerdes(duplicateId, required, PREVIOUS)).toBeTruthy();
    const allGreen = [...green(), { ...green()[0], id: 996, started_at: "2026-09-30T13:00:00Z", completed_at: "2026-09-30T13:01:00Z" }];
    expect(checksVerdes(allGreen, required, PREVIOUS)).toBeNull();
    const invalid = green(); invalid[0].started_at = "invalid";
    expect(checksVerdes(invalid, required, PREVIOUS)).toBeTruthy();
  });

  it("cenários A/B: código full; docs safe; um check falho full", () => {
    expect(decide(event(), 1, REPO, deps([change("lib/qualquer.ts")])).safe).toBe(false);
    const docs = decide(event(), 1, REPO, deps([change("docs/managed-clients/internet-provider-pilot.md")]));
    expect(docs.safe).toBe(true);
    expect(docs.count).toBe(1);
    const failed = green(); failed[0].conclusion = "failure";
    expect(decide(event(), 1, REPO, deps([change("docs/managed-clients/internet-provider-pilot.md")], failed)).safe).toBe(false);
    expect(decide(event(), 1, REPO, deps([change("docs/x.md"), change("lib/x.ts")])).safe).toBe(false);
  });

  it("API indisponível, HEAD avançado ou fetch impossível impedem atalho", () => {
    expect(decide(event(), 1, REPO, { ...deps(), checkRuns: () => { throw Error("500"); } }).safe).toBe(false);
    expect(decide(event(), 1, REPO, { ...deps(), prHead: () => PREVIOUS }).safe).toBe(false);
    expect(decide(event(), 1, REPO, { ...deps(), changes: () => { throw Error("force push"); } }).safe).toBe(false);
  });
});
