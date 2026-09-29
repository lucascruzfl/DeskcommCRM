import { beforeAll, describe, expect, it } from "vitest";
import { buildManagedAreaPolicy } from "@/lib/managed-clients/policy";
import {
  GOV_ADMIN,
  GOV_AGENT_A,
  GOV_MANAGER,
  GOV_ORG,
  countAs,
  lastLine,
  seedGov,
  sql,
  writeCountAs,
} from "./gov-helpers";

const GATES = [
  ["companies", "/app/companies"],
  ["people", "/app/people"],
  ["company_people", "/app/people"],
  ["import_batches", "/app/imports"],
  ["import_rows", "/app/imports"],
  ["crm_proposals", "/app/proposals"],
  ["crm_proposal_items", "/app/proposals"],
  ["proposal_templates", "/app/settings/tenant/proposals/modelos"],
] as const;

beforeAll(() => {
  seedGov();
  const areas = JSON.stringify(buildManagedAreaPolicy("managed/aesthetic-clinic").areas);
  sql(`
    insert into public.companies(organization_id, legal_name)
      values ('${GOV_ORG}', 'Empresa de teste');
    insert into public.managed_client_policies
      (organization_id, business_type, management_mode, preset_id, preset_version, areas, applied_by)
      values ('${GOV_ORG}', 'aesthetic_clinic', 'managed', 'managed/aesthetic-clinic', '1.0.0', '${areas}'::jsonb, '${GOV_ADMIN}');
  `);
});

describe("áreas opcionais do upstream não abrem no cliente managed", () => {
  it("instala policy restritiva em todas as oito tabelas", () => {
    for (const [table, area] of GATES) {
      expect(lastLine(sql(`select count(*) from pg_policies where schemaname='public'
        and tablename='${table}' and policyname='managed_area_gate'
        and permissive='RESTRICTIVE' and cmd='ALL'
        and qual like '%${area}%' and with_check like '%${area}%';`))).toBe("1");
    }
  });

  it("nega PostgREST direto mesmo ao admin do tenant gerenciado", () => {
    for (const user of [GOV_AGENT_A, GOV_MANAGER, GOV_ADMIN]) {
      expect(countAs(user, `select count(*) from public.companies where organization_id='${GOV_ORG}';`)).toBe(0);
      expect(writeCountAs(user, `insert into public.companies(organization_id, legal_name)
        values ('${GOV_ORG}', 'Indevida')`)).toBe(0);
    }
  });

  it("mantém as tabelas de Honorários ausentes até instalar o módulo e as cerca depois", () => {
    expect(lastLine(sql("select to_regclass('public.honorarios_contratos') is null;"))).toBe("t");
    sql("select public.fn_honorarios_provisionar();");
    for (const table of ["honorarios_contratos", "honorarios_parcelas"]) {
      expect(lastLine(sql(`select count(*) from pg_policies where tablename='${table}'
        and policyname='managed_area_gate' and permissive='RESTRICTIVE';`))).toBe("1");
    }
    sql(`insert into public.honorarios_contratos(organization_id, modelo, valor_fixo_cents)
      values ('${GOV_ORG}', 'fixo', 10000);`);
    expect(countAs(GOV_ADMIN, `select count(*) from public.honorarios_contratos where organization_id='${GOV_ORG}';`)).toBe(0);
  });
});
