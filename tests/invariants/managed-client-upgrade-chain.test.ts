import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { buildManagedAreaPolicy } from "@/lib/managed-clients/policy";
import { countAs, lastLine, sql, writeCountAs } from "./gov-helpers";

const migrations = [
  "20260925100000_0410_politica_de_area_gerenciada.sql",
  "20260925110000_0411_diretorio_seguro_de_agentes_atribuiveis.sql",
  "20260925120000_0412_areas_administrativas_no_postgrest.sql",
  "20260925130000_0413_escrita_administrativa_de_funis_e_canais.sql",
] as const;

it("promove banco anterior a 0410 com dados por toda a cadeia e aceita reapply", () => {
  const org = randomUUID();
  const client = randomUUID();
  const manager = randomUUID();
  const session = randomUUID();
  const agent = randomUUID();
  const areas = JSON.stringify(buildManagedAreaPolicy("managed/aesthetic-clinic").areas);

  // O harness parte do baseline final. Nesta cópia descartável retiramos
  // exclusivamente os objetos introduzidos pela cadeia, preservando os dados
  // e todas as tabelas anteriores; CASCADE retira as policies dependentes.
  sql(`
    drop trigger if exists trg_sync_ai_agent_assignable_directory on public.ai_agents;
    drop function if exists public.fn_sync_ai_agent_assignable_directory() cascade;
    drop table if exists public.ai_agent_assignable_directory cascade;
    drop function if exists public.fn_managed_area_allowed(uuid, text) cascade;
    drop table if exists public.managed_client_policies cascade;
    insert into auth.users(id, email) values
      ('${client}', 'upgrade-client@invariant.test'),
      ('${manager}', 'upgrade-manager@invariant.test');
    insert into public.organizations(id, slug, legal_name, display_name)
      values ('${org}', '${org}', 'Clínica upgrade', 'Clínica upgrade');
    insert into public.user_organizations(organization_id, user_id, role, accepted_at) values
      ('${org}', '${client}', 'agent', now()),
      ('${org}', '${manager}', 'admin', now());
    insert into public.channel_sessions(id, organization_id, waha_session_name, webhook_secret_encrypted)
      values ('${session}', '${org}', '${session}', '\\x00'::bytea);
    insert into public.ai_agents(id, organization_id, name, system_prompt)
      values ('${agent}', '${org}', 'Agente upgrade', 'configuração privada');
  `);
  expect(lastLine(sql(`select to_regclass('public.managed_client_policies') is null;`))).toBe("t");

  const apply = (name: string) => sql(`set client_min_messages = warning;\n${readFileSync(`supabase/migrations/${name}`, "utf8")}`);
  apply(migrations[0]);
  sql(`insert into public.managed_client_policies
    (organization_id, business_type, management_mode, preset_id, preset_version, areas, applied_by)
    values ('${org}', 'aesthetic_clinic', 'managed', 'managed/aesthetic-clinic', '1.0.0', '${areas}'::jsonb, '${manager}');`);
  for (const migration of migrations.slice(1)) apply(migration);
  for (const migration of migrations) apply(migration);

  expect(countAs(client, `select count(*) from public.ai_agents where organization_id = '${org}';`)).toBe(0);
  expect(countAs(client, `select count(*) from public.ai_agent_assignable_directory where organization_id = '${org}';`)).toBe(1);
  expect(countAs(manager, `select count(*) from public.ai_agents where organization_id = '${org}';`)).toBe(1);
  expect(countAs(client, `select count(*) from public.channel_sessions where organization_id = '${org}';`)).toBe(1);
  expect(writeCountAs(client, `update public.channel_sessions set display_name = 'indevido' where id = '${session}'`)).toBe(0);
  expect(lastLine(sql(`select count(*) from pg_policies where tablename = 'llm_calls'
    and policyname like 'support_write_%';`))).toBe("0");
  expect(lastLine(sql(`select count(*) from pg_policies where policyname = 'managed_area_gate'
    and tablename in ('ad_platform_connections', 'ad_conversion_dispatches',
      'ad_insights_connections', 'ad_hierarchy_cache');`))).toBe("0");
  expect(lastLine(sql(`select count(*) from public.managed_client_policies where organization_id = '${org}';`))).toBe("1");
});
