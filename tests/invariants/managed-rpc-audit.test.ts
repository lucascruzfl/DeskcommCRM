import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { sql } from "./gov-helpers";

interface ReviewedFunction {
  signature: string;
  name: string;
  security_definer: boolean;
  authenticated_execute: boolean;
  anonymous_execute: boolean;
  body_sha256: string;
  status: "SAFE" | "FIXED" | "ADMIN-ONLY" | "NOT-REACHABLE-BY-CLIENT";
  reason: string;
}
const reviewed = JSON.parse(
  readFileSync("docs/security/managed-client-rpc-audit.json", "utf8"),
) as {
  functions: ReviewedFunction[];
};
const signature = (value: string) => value.replace(/\b(?:public|extensions)\./g, "");

it("catálogo executável coincide com as RPCs revisadas; alteração exige nova auditoria", () => {
  const rows = JSON.parse(
    sql(`
    set search_path=public,extensions;
    select coalesce(json_agg(json_build_object(
      'signature',p.oid::regprocedure::text,'name',p.proname,
      'security_definer',p.prosecdef,
      'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
      'anonymous_execute',has_function_privilege('anon',p.oid,'EXECUTE'),
      'body',p.prosrc
    ) order by p.proname,p.oid::regprocedure::text),'[]'::json)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and not exists (
      select 1 from pg_depend d where d.objid=p.oid and d.deptype='e'
    );
  `)
      .split("\n")
      .filter((line) => line.startsWith("["))
      .join("\n"),
  ) as Array<{
    signature: string;
    name: string;
    security_definer: boolean;
    authenticated_execute: boolean;
    anonymous_execute: boolean;
    body: string;
  }>;
  const bySignature = new Map(reviewed.functions.map((row) => [signature(row.signature), row]));
  expect(rows.map((row) => signature(row.signature)).sort()).toEqual(
    [...bySignature.keys()].sort(),
  );
  for (const row of rows) {
    const audit = bySignature.get(signature(row.signature))!;
    expect(audit.status).toMatch(/^(SAFE|FIXED|ADMIN-ONLY|NOT-REACHABLE-BY-CLIENT)$/);
    expect(audit.reason.length).toBeGreaterThan(30);
    expect(
      {
        name: row.name,
        security_definer: row.security_definer,
        authenticated_execute: row.authenticated_execute,
        anonymous_execute: row.anonymous_execute,
        body_sha256: createHash("sha256").update(row.body).digest("hex"),
      },
      row.signature,
    ).toEqual({
      name: audit.name,
      security_definer: audit.security_definer,
      authenticated_execute: audit.authenticated_execute,
      anonymous_execute: audit.anonymous_execute,
      body_sha256: audit.body_sha256,
    });
  }
});
