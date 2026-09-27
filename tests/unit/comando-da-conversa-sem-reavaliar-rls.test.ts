/**
 * A 0404 NO PAPEL — a tripla inteira de `comando_da_conversa` fica medida aqui.
 *
 * A issue #1571 trocou o custo da Inbox por duas decisões que não aparecem em
 * nenhum outro teste e que envelhecem em silêncio se sumirem:
 *
 *  1. SECURITY DEFINER (a contagem das abas pagava a policy de `contacts` duas
 *     vezes por conversa — 823–846 ms → 75–94 ms medido na issue);
 *  2. parâmetro SEM NOME (com nome, a PostgREST expõe a coluna calculada em
 *     `/rpc` — e sob `definer`, uma linha fabricada de `conversations` leria
 *     `force_human`/`is_blocked` de outro tenant);
 *  3. o `baseline.sql` usa a forma final desde a primeira definição e a repete
 *     no apêndice sem DROP, preservando a view managed no `update.sh`;
 *  4. `ct.organization_id = $1.organization_id` nas duas subconsultas (a policy de
 *     UPDATE de `conversations` não confere `contact_id` e a FK não passa pela
 *     RLS — sem o predicado, sob o definer, uma conversa apontada para contato de
 *     outra empresa leria os dois bits dele).
 *
 * Este arquivo é a régua estática das quatro, mais a linha do MANIFEST — o
 * `pre-commit` confere a tripla no momento do commit, mas sem isto um rebase ou
 * um "arrumar o baseline" futuro derruba a decisão com o gate verde.
 *
 * O que ele NÃO faz: afirmar comportamento de banco (isso é invariante, e o
 * job `invariants` do CI roda com Postgres de verdade — `pnpm test:db` exige
 * Docker, que esta VPS não tem).
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();
const DIR_MIGRACOES = path.join(RAIZ, "supabase", "migrations");
/** Sufixo estável da migration — o NNNN pode ser renumerado, o resto não. */
const SUFIXO = "_comando_da_conversa_sem_reavaliar_rls.sql";

const arquivoDaMigration = (): string | undefined =>
  fs.readdirSync(DIR_MIGRACOES).find((f) => f.endsWith(SUFIXO));

const ler = (caminho: string): string => fs.readFileSync(caminho, "utf8");

describe("a 0404 — comando_da_conversa sem reavaliar a RLS (issue #1571)", () => {
  it("a tripla está na árvore: migration, apêndice no baseline e linha no MANIFEST", () => {
    const nome = arquivoDaMigration();
    expect(
      nome,
      `migration ausente: supabase/migrations/*${SUFIXO} — sem ela o update de clone não aplica a correção`,
    ).toBeDefined();

    const manifest = ler(path.join(DIR_MIGRACOES, "MANIFEST.md"));
    const celulaDoManifest = nome!.replace(/^\d{14}_/, "").replace(/\.sql$/, "");
    expect(
      manifest.includes(celulaDoManifest),
      "MANIFEST.md sem a linha da migration — a tripla da regra de migrations está incompleta",
    ).toBe(true);

    const baseline = ler(path.join(RAIZ, "supabase", "baseline.sql"));
    expect(
      baseline.includes(
        "create or replace function public.comando_da_conversa(public.conversations)",
      ),
      "baseline.sql sem a forma final da 0404",
    ).toBe(true);
  });

  it("na migration, a função nasce SECURITY DEFINER com parâmetro SEM NOME", () => {
    const sql = ler(path.join(DIR_MIGRACOES, arquivoDaMigration()!));

    expect(
      sql.includes("create function public.comando_da_conversa(public.conversations)"),
      "parâmetro namedado na criação: a PostgREST exporia a função em /rpc, e sob security definer uma linha fabricada leria force_human/is_blocked de outro tenant",
    ).toBe(true);
    expect(
      /comando_da_conversa\(\s*c\s+public\.conversations\s*\)/.test(sql),
      "a criação voltou a nomear o parâmetro (`c public.conversations`)",
    ).toBe(false);
    expect(
      sql.includes("security definer"),
      "sem security definer a contagem das abas volta a pagar a RLS de contacts 2x por conversa",
    ).toBe(true);
    expect(
      sql.includes("$1.status"),
      "o corpo deixou de referenciar o parâmetro por posição ($1)",
    ).toBe(true);
    expect(
      /\bc\.status\b/.test(sql),
      "o corpo referencia `c.` — sobra do parâmetro nomeado removido",
    ).toBe(false);
  });

  it("a migration refaz as DUAS origens de EXECUTE e recarrega o schema do PostgREST", () => {
    const sql = ler(path.join(DIR_MIGRACOES, arquivoDaMigration()!));
    expect(
      sql,
      "revoke das duas origens ausente — o DROP levou a ACL e nasce exposta a public/anon",
    ).toMatch(
      /revoke execute on function public\.comando_da_conversa\(public\.conversations\) from public, anon;/,
    );
    expect(
      sql,
      "grant a authenticated/service_role ausente — a Inbox ficaria sem executar a função",
    ).toMatch(
      /grant\s+execute on function public\.comando_da_conversa\(public\.conversations\) to authenticated, service_role;/,
    );
    expect(
      sql,
      "notify pgrst ausente: a forma do schema mudou (o /rpc some) e o PostgREST seguiria servindo o velho até reinício manual",
    ).toContain("notify pgrst, 'reload schema';");
    expect(
      sql,
      "drop antes do create: sem ele o Postgres recusa o replace (mudança de nome de parâmetro) ou vira overload",
    ).toMatch(
      /drop function if exists public\.comando_da_conversa\(public\.conversations\);[\s\S]*create function public\.comando_da_conversa/,
    );
  });

  it("no baseline, ambas as definições preservam a forma segura e o OID da view managed", () => {
    const baseline = ler(path.join(RAIZ, "supabase", "baseline.sql"));
    const assinatura =
      "create or replace function public.comando_da_conversa(public.conversations)";
    const primeira = baseline.indexOf(assinatura);
    const segunda = baseline.lastIndexOf(assinatura);
    expect(primeira).toBeGreaterThanOrEqual(0);
    expect(segunda).toBeGreaterThan(primeira);
    expect(baseline).not.toContain(
      "drop function if exists public.comando_da_conversa(public.conversations);",
    );
    const formaInicial = baseline.slice(primeira, baseline.indexOf("$comando$;", primeira));
    const apendice = baseline.slice(segunda);
    expect(formaInicial).toContain("security definer");
    expect(formaInicial).toContain("$1.status");
    expect(formaInicial).toContain("ct.organization_id = $1.organization_id");
    expect(apendice).toContain("security definer");
    expect(segunda).toBeLessThan(
      baseline.indexOf("create or replace view public.operational_conversations"),
    );
    expect(apendice).toContain("notify pgrst, 'reload schema';");
  });

  it("as duas subconsultas em contacts exigem a empresa da conversa, na migration e no apêndice", () => {
    const PREDICADO = "where ct.id = $1.contact_id and ct.organization_id = $1.organization_id)";
    const conta = (texto: string): number => texto.split(PREDICADO).length - 1;

    const sql = ler(path.join(DIR_MIGRACOES, arquivoDaMigration()!));
    const baseline = ler(path.join(RAIZ, "supabase", "baseline.sql"));
    const apendice = baseline.slice(
      baseline.lastIndexOf(
        "create or replace function public.comando_da_conversa(public.conversations)",
      ),
    );

    const motivo =
      "subconsulta em contacts sem `ct.organization_id = $1.organization_id`: sob o definer, uma conversa apontada para contato de outra empresa leria force_human/is_blocked dele";
    expect(conta(sql), `migration — ${motivo}`).toBe(2);
    expect(conta(apendice), `apêndice do baseline — ${motivo}`).toBe(2);
  });
});
