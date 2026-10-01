#!/usr/bin/env node
// Um único detector para os quatro workflows. Qualquer dúvida conserva o CI completo.
import { execFileSync } from "node:child_process";
import { readFileSync, appendFileSync } from "node:fs";

// Medido em 2026-10-01: GET /repos/{owner}/{repo}/branches/mcp/stable/protection no fork.
// required_status_checks.checks = verify, invariants, imagens-ok, e2e (app_id 15368).
// O GITHUB_TOKEN não tem administration:read; a fonte versionada é deliberada.
// build-and-size entra como exigência adicional para provar o build anterior.
// verify é confiança no parent; a suíte verify do HEAD atual sempre roda completa.
export const PARENT_TRUSTED_CHECKS = Object.freeze({
  "verify": 15368,
  "invariants": 15368,
  "e2e": 15368,
  "imagens-ok": 15368,
  "build-and-size": 15368,
});
const SHA = /^[0-9a-f]{40}$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const EXTENSOES_INERTES = /\.(?:md|txt|png|jpe?g|gif|webp|pdf)$/i;

export function caminhoSeguro(path) {
  if (typeof path !== "string" || !path || path.includes("\\") || path.includes("\0") ||
      path.startsWith("/") || /[\x00-\x1f\x7f]/.test(path) ||
      path.split("/").some((p) => !p || p === "." || p === "..")) return false;
  if (/\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts|sh|bash|sql|json|ya?ml|toml|xml|svg|html|css)$/i.test(path)) return false;
  if (/(?:^|\/)(?:AGENTS|CLAUDE|CODEX|GEMINI|SKILL|copilot-instructions)\.md$/i.test(path)) return false;
  if (path === "docs/mcp/RELEASE-AUDIT.json") return false;
  if (/^(?:docs|tasks|evidence)\//.test(path)) return EXTENSOES_INERTES.test(path);
  if (/^\.changes\//.test(path)) return /\.md$/i.test(path);
  if (/^\.github\/ISSUE_TEMPLATE\//.test(path)) return /\.md$/i.test(path);
  if (/^\.github\/[^/]+\.md$/i.test(path)) return true;
  return /^[A-Za-z0-9][^/]*\.md$/i.test(path);
}

export function eventoValido(event, attempt, repo) {
  if (event?.action !== "synchronize" || !event.pull_request) return "evento não é synchronize";
  if (String(attempt) !== "1") return "rerun ou reentrada";
  if (event.pull_request.base?.ref !== "mcp/stable") return "base fora da linha mcp/stable";
  if (event.repository?.full_name !== repo || !REPO.test(repo)) return "repositório não verificável";
  const previous = event.before;
  const current = event.pull_request.head?.sha;
  if (!SHA.test(previous ?? "") || !SHA.test(current ?? "") || previous === current ||
      event.after !== current) return "SHA anterior não verificável";
  if (!Number.isSafeInteger(event.pull_request.number) || event.pull_request.number < 1) return "PR não verificável";
  return null;
}

export function checksVersionados() {
  return { names: Object.keys(PARENT_TRUSTED_CHECKS).sort(), apps: new Map(Object.entries(PARENT_TRUSTED_CHECKS)) };
}

export function checksVerdes(runs, required, previous) {
  if (!Array.isArray(runs) || !required || !SHA.test(previous)) return "resposta de checks ambígua";
  for (const name of required.names) {
    const matches = runs.filter((r) => r.name === name &&
      (!required.apps.has(name) || r.app?.id === required.apps.get(name)));
    if (!matches.length) return `parent check ausente: ${name}`;
    if (new Set(matches.map((r) => r.id)).size !== matches.length ||
        matches.some((r) => r.head_sha !== previous || !Number.isSafeInteger(r.id) ||
          !Number.isFinite(Date.parse(r.started_at))))
      return `parent check ambíguo: ${name}`;
    // Regra deliberadamente estrita: todo run deste context e SHA deve ser verde.
    // Assim nem a ordem de início nem a de conclusão pode esconder um vermelho.
    if (matches.some((r) => r.status !== "completed" || r.conclusion !== "success" ||
        !Number.isFinite(Date.parse(r.completed_at)) || Date.parse(r.completed_at) < Date.parse(r.started_at)))
      return `parent check sem sucesso: ${name}`;
  }
  return null;
}

export function deltaSeguro(changes) {
  if (!Array.isArray(changes) || changes.length === 0 || changes.length > 1000) return "delta vazio ou grande demais";
  for (const c of changes) {
    if (!/^[AMDRC]$/.test(c.status) || !c.paths?.length ||
        c.paths.some((p) => !caminhoSeguro(p)) ||
        c.modes.some((mode) => mode !== "100644" && mode !== "000000"))
      return "arquivo fora da allowlist ou modo inseguro";
  }
  return null;
}

function command(bin, args) {
  return execFileSync(bin, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 12 * 1024 * 1024 }).trim();
}

function api(path) { return JSON.parse(command("gh", ["api", path])); }

export function parseDiff(raw, modeFor) {
  const parts = raw.split("\0").filter(Boolean);
  const out = [];
  for (let i = 0; i < parts.length;) {
    const status = parts[i++];
    if (!/^[AMDRC](?:\d{1,3})?$/.test(status)) throw new Error("diff ambíguo");
    const n = /^[RC]/.test(status) ? 2 : 1;
    const paths = parts.slice(i, i + n); i += n;
    if (paths.length !== n) throw new Error("diff incompleto");
    out.push({ status: status[0], paths, modes: paths.flatMap((p) => [modeFor(p, "old"), modeFor(p, "new")]) });
  }
  return out;
}

function gitChanges(previous, current) {
  command("git", ["fetch", "--no-tags", "--filter=blob:none", "origin", previous, current]);
  if (command("git", ["rev-parse", `${previous}^{commit}`]) !== previous ||
      command("git", ["rev-parse", `${current}^{commit}`]) !== current) throw new Error("SHA não verificável");
  command("git", ["merge-base", "--is-ancestor", previous, current]);
  const raw = execFileSync("git", ["diff", "--name-status", "-z", "--find-renames", previous, current],
    { encoding: "utf8", maxBuffer: 12 * 1024 * 1024 });
  return parseDiff(raw, (path, side) => {
    const sha = side === "old" ? previous : current;
    const lines = command("git", ["ls-tree", "-z", sha, "--", path]).split("\0").filter(Boolean);
    if (!lines.length) return "000000";
    if (lines.length !== 1) throw new Error("caminho ambíguo");
    const mode = lines[0].match(/^(\d{6}) (?:blob|tree|commit) [0-9a-f]{40}\t([\s\S]*)$/);
    if (!mode || mode[2] !== path) throw new Error("modo ou caminho ambíguo");
    return mode[1];
  });
}

function summary(result) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  const short = (s) => typeof s === "string" && SHA.test(s) ? s.slice(0, 9) : "—";
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, result.safe
    ? `## Fast path documental\n\n- previous_head: \`${short(result.previous)}\`\n- current_head: \`${short(result.current)}\`\n- delta_count: ${result.count}\n- fast_path: docs-safe\n- parent checks verificados: ${result.checks.join(", ")}\n`
    : `FAST_PATH_DOCS_SAFE=nao — motivo: ${result.reason}\n`);
}

export function decide(event, attempt, repo, deps) {
  const invalid = eventoValido(event, attempt, repo);
  if (invalid) return { safe: false, reason: invalid };
  const previous = event.before, current = event.pull_request.head.sha;
  try {
    if (deps.prHead(event.pull_request.number) !== current) return { safe: false, reason: "HEAD atual da PR mudou" };
    const required = checksVersionados();
    const checkReason = checksVerdes(deps.checkRuns(previous), required, previous);
    if (checkReason) return { safe: false, reason: checkReason };
    const changes = deps.changes(previous, current);
    const deltaReason = deltaSeguro(changes);
    if (deltaReason) return { safe: false, reason: deltaReason };
    return { safe: true, previous, current, count: changes.length, checks: required.names };
  } catch {
    return { safe: false, reason: "SHA anterior ou API não verificável" };
  }
}

export function coletarCheckRuns(getPage) {
  const all = [];
  const ids = new Set();
  let total = null;
  for (let page = 1; page <= 10; page++) {
    const result = getPage(page);
    if (!Number.isSafeInteger(result.total_count) || result.total_count >= 1000 || !Array.isArray(result.check_runs) ||
        (total !== null && total !== result.total_count)) throw new Error("paginação ambígua");
    total = result.total_count;
    for (const run of result.check_runs) {
      if (!Number.isSafeInteger(run?.id) || ids.has(run.id)) throw new Error("check-run duplicado ou inválido");
      ids.add(run.id);
    }
    all.push(...result.check_runs);
    if (all.length === total) return all;
    if (result.check_runs.length !== 100 || all.length > total) throw new Error("lista incompleta");
  }
  throw new Error("lista truncada");
}

function checkRuns(repo, sha) {
  return coletarCheckRuns((page) =>
    api(`repos/${repo}/commits/${sha}/check-runs?filter=all&per_page=100&page=${page}`));
}

if (process.argv[1]?.endsWith("ci-docs-safe-delta.mjs")) {
  let result;
  try {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
    result = process.env.GITHUB_EVENT_NAME !== "pull_request"
      ? { safe: false, reason: "evento não é pull_request" }
      : decide(event, process.env.GITHUB_RUN_ATTEMPT, process.env.GITHUB_REPOSITORY, {
          prHead: (number) => api(`repos/${process.env.GITHUB_REPOSITORY}/pulls/${number}`).head.sha,
          checkRuns: (sha) => checkRuns(process.env.GITHUB_REPOSITORY, sha),
          changes: gitChanges,
        });
  } catch { result = { safe: false, reason: "evento ou API não verificável" }; }
  summary(result);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `docs_safe=${result.safe ? "sim" : "nao"}\n`);
  console.info(`FAST_PATH_DOCS_SAFE=${result.safe ? "sim" : "nao"}${result.safe ? "" : ` — motivo: ${result.reason}`}`);
}
