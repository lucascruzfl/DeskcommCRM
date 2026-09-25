import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { buildManagedAreaPolicy } from "@/lib/managed-clients/policy";
import { countAs, lastLine, sql } from "./gov-helpers";

const org = randomUUID(), otherOrg = randomUUID();
const agent = randomUUID(), manager = randomUUID(), outsider = randomUUID();
const session = randomUUID(), aiAgent = randomUUID(), version = randomUUID();
const areas = JSON.stringify(buildManagedAreaPolicy("managed/aesthetic-clinic").areas);

beforeAll(() => {
  sql(`
    insert into auth.users(id, email) values
      ('${agent}', 'managed-agent@invariant.test'),
      ('${manager}', 'managed-manager@invariant.test'),
      ('${outsider}', 'managed-outsider@invariant.test');
    insert into public.organizations(id, slug, legal_name, display_name) values
      ('${org}', '${org}', 'Clínica de teste', 'Clínica de teste'),
      ('${otherOrg}', '${otherOrg}', 'Outra clínica', 'Outra clínica');
    insert into public.user_organizations(organization_id, user_id, role, accepted_at) values
      ('${org}', '${agent}', 'agent', now()),
      ('${org}', '${manager}', 'admin', now()),
      ('${otherOrg}', '${outsider}', 'agent', now());
    insert into public.managed_client_policies(organization_id, business_type, management_mode, preset_id, preset_version, areas, applied_by)
      values ('${org}', 'aesthetic_clinic', 'managed', 'managed/aesthetic-clinic', '1.0.0', '${areas}'::jsonb, '${manager}');
    insert into public.channel_sessions(id, organization_id, waha_session_name, webhook_secret_encrypted)
      values ('${session}', '${org}', '${session}', '\\x00'::bytea);
    insert into public.ai_agents(id, organization_id, name, system_prompt)
      values ('${aiAgent}', '${org}', 'Agente privado', 'segredo de teste');
    insert into public.ai_agent_versions(id, organization_id, agent_id, version_number, system_prompt, provider, model, channel_session_id)
      values ('${version}', '${org}', '${aiAgent}', 1, 'segredo de teste', 'anthropic', 'teste', '${session}');
    update public.ai_agents set published_version_id = '${version}' where id = '${aiAgent}';
  `);
});

describe("RLS da política gerenciada", () => {
  it.each(["ai_agents", "ai_agent_versions"])("nega SELECT PostgREST em %s ao cliente", table => {
    expect(countAs(agent, `select count(*) from public.${table} where organization_id = '${org}';`)).toBe(0);
    expect(countAs(manager, `select count(*) from public.${table} where organization_id = '${org}';`)).toBe(1);
    expect(countAs(outsider, `select count(*) from public.${table} where organization_id = '${org}';`)).toBe(0);
  });

  it("nega alteração do próprio preset ao cliente", () => {
    const privileges = sql(`select has_table_privilege('authenticated', 'public.managed_client_policies', 'UPDATE');`);
    expect(lastLine(privileges)).toBe("f");
    expect(countAs(agent, `select count(*) from public.managed_client_policies where organization_id = '${otherOrg}';`)).toBe(0);
  });

  it("permite só a projeção operacional do seletor, sem prompt/configuração", () => {
    expect(countAs(agent, `select count(*) from public.ai_agent_assignable_directory where organization_id = '${org}';`)).toBe(1);
    const columns = sql(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'ai_agent_assignable_directory' order by column_name;`);
    expect(columns).not.toContain("system_prompt");
    expect(columns).not.toContain("credential_id");
    expect(lastLine(sql(`select version_number from public.ai_agent_assignable_directory where agent_id = '${aiAgent}';`))).toBe("1");
  });
});
