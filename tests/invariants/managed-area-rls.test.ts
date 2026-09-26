import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { buildManagedAreaPolicy } from "@/lib/managed-clients/policy";
import { countAs, lastLine, sql, writeCountAs } from "./gov-helpers";

const org = randomUUID(),
  otherOrg = randomUUID();
const agent = randomUUID(),
  manager = randomUUID(),
  operator = randomUUID(),
  outsider = randomUUID();
const session = randomUUID(),
  aiAgent = randomUUID(),
  version = randomUUID();
const areas = JSON.stringify(buildManagedAreaPolicy("managed/aesthetic-clinic").areas);
const gateMigration = readFileSync(
  "supabase/migrations/20260925120001_0426_areas_administrativas_no_postgrest.sql",
  "utf8",
);
const administrativeGates = [
  ...gateMigration.matchAll(/\('([a-z_]+)', '(\/app\/[a-z/-]+)'\)/g),
].map(([, table, area]) => ({ table, area }));

beforeAll(() => {
  sql(`
    insert into auth.users(id, email) values
      ('${agent}', 'managed-agent@invariant.test'),
      ('${manager}', 'managed-manager@invariant.test'),
      ('${operator}', 'managed-operator@invariant.test'),
      ('${outsider}', 'managed-outsider@invariant.test');
    insert into public.organizations(id, slug, legal_name, display_name) values
      ('${org}', '${org}', 'Clínica de teste', 'Clínica de teste'),
      ('${otherOrg}', '${otherOrg}', 'Outra clínica', 'Outra clínica');
    insert into public.user_organizations(organization_id, user_id, role, accepted_at) values
      ('${org}', '${agent}', 'agent', now()),
      ('${org}', '${manager}', 'admin', now()),
      ('${org}', '${operator}', 'manager', now()),
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
    insert into public.llm_calls(organization_id, provider, model, purpose) values
      ('${org}', 'test', 'test-model', 'agent_turn'),
      ('${otherOrg}', 'test', 'test-model', 'agent_turn');
  `);
});

describe("RLS da política gerenciada", () => {
  it("inventaria tabelas tenant com SELECT e sem RLS", () => {
    const unprotected = sql(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
        and exists (select 1 from pg_attribute a where a.attrelid = c.oid
          and a.attname = 'organization_id' and a.attnum > 0 and not a.attisdropped)
        and has_table_privilege('authenticated', c.oid, 'SELECT') order by c.relname;
    `);
    expect(unprotected).toBe("");
  });

  it("aplica 0426 sobre esquema anterior com dados e reaplica sem mudar o preset", () => {
    const before = lastLine(
      sql(
        `select areas::text from public.managed_client_policies where organization_id = '${org}';`,
      ),
    );
    sql(
      administrativeGates
        .map(({ table }) => `drop policy if exists managed_area_gate on public.${table};`)
        .join("\n"),
    );
    expect(
      Number(
        lastLine(sql(`select count(*) from pg_policies where policyname = 'managed_area_gate';`)),
      ),
    ).toBe(9);
    sql(`set client_min_messages = warning;\n${gateMigration}`);
    sql(`set client_min_messages = warning;\n${gateMigration}`);
    const after = lastLine(
      sql(
        `select areas::text from public.managed_client_policies where organization_id = '${org}';`,
      ),
    );
    expect(after).toBe(before);
  });

  it("instala o gate restritivo correto em todas as tabelas administrativas inventariadas", () => {
    expect(administrativeGates.length).toBeGreaterThan(40);
    const values = administrativeGates
      .map(({ table, area }) => `('${table}', '${area}')`)
      .join(",");
    const count = Number(
      lastLine(
        sql(`
      select count(*) from (values ${values}) as expected(table_name, area_href)
      join pg_class c on c.oid = to_regclass('public.' || expected.table_name)
        and c.relrowsecurity
      join pg_policies p on p.schemaname = 'public'
        and p.tablename = expected.table_name
        and p.policyname = 'managed_area_gate'
        and p.permissive = 'RESTRICTIVE'
        and p.cmd = 'ALL'
        and p.qual like '%' || expected.area_href || '%'
        and p.with_check like '%' || expected.area_href || '%';
    `),
      ),
    );
    expect(count).toBe(administrativeGates.length);
  });

  it("nega leitura e escrita de automações ao cliente e preserva o gestor", () => {
    const ruleId = randomUUID();
    expect(
      writeCountAs(
        manager,
        `insert into public.automation_rules(id, organization_id, name, trigger_event)
      values ('${ruleId}', '${org}', 'Regra privada', 'lead.created')`,
      ),
    ).toBe(1);
    expect(
      countAs(
        agent,
        `select count(*) from public.automation_rules where organization_id = '${org}';`,
      ),
    ).toBe(0);
    expect(
      countAs(
        manager,
        `select count(*) from public.automation_rules where organization_id = '${org}';`,
      ),
    ).toBe(1);
    expect(
      countAs(
        outsider,
        `select count(*) from public.automation_rules where organization_id = '${org}';`,
      ),
    ).toBe(0);
    expect(
      writeCountAs(
        agent,
        `update public.automation_rules set name = 'Alterada pelo cliente' where id = '${ruleId}'`,
      ),
    ).toBe(0);
  });

  it("fecha PostgREST de llm_calls por área e tenant, inclusive grants de escrita", () => {
    expect(
      countAs(
        agent,
        `select count(*) where public.fn_managed_area_allowed('${org}', '/app/ai/runs');`,
      ),
    ).toBe(0);
    expect(countAs(agent, `select count(*) from public.llm_calls;`)).toBe(0);
    expect(countAs(manager, `select count(*) from public.llm_calls;`)).toBe(1);
    expect(countAs(outsider, `select count(*) from public.llm_calls;`)).toBe(1);
    expect(
      lastLine(sql(`select has_table_privilege('authenticated', 'public.llm_calls', 'INSERT');`)),
    ).toBe("f");
    expect(lastLine(sql(`select has_table_privilege('anon', 'public.llm_calls', 'SELECT');`))).toBe(
      "f",
    );
    expect(
      lastLine(
        sql(
          `select permissive from pg_policies where tablename = 'llm_calls' and policyname = 'managed_llm_calls_read';`,
        ),
      ),
    ).toBe("RESTRICTIVE");
    sql(
      `update public.managed_client_policies set areas = jsonb_set(areas, array['/app/ai/runs'], '"client"'::jsonb) where organization_id = '${org}';`,
    );
    expect(countAs(agent, `select count(*) from public.llm_calls;`)).toBe(0);
    sql(
      `update public.managed_client_policies set areas = jsonb_set(areas, array['/app/ai/runs'], '"agency"'::jsonb) where organization_id = '${org}';`,
    );
  });

  it.each(["ai_agents", "ai_agent_versions"])("nega SELECT PostgREST em %s ao cliente", (table) => {
    expect(
      countAs(agent, `select count(*) from public.${table} where organization_id = '${org}';`),
    ).toBe(0);
    expect(
      countAs(manager, `select count(*) from public.${table} where organization_id = '${org}';`),
    ).toBe(1);
    expect(
      countAs(outsider, `select count(*) from public.${table} where organization_id = '${org}';`),
    ).toBe(0);
  });

  it("nega alteração do próprio preset ao cliente", () => {
    const privileges = sql(
      `select has_table_privilege('authenticated', 'public.managed_client_policies', 'UPDATE');`,
    );
    expect(lastLine(privileges)).toBe("f");
    expect(
      countAs(
        agent,
        `select count(*) from public.managed_client_policies where organization_id = '${org}';`,
      ),
    ).toBe(0);
    expect(
      countAs(
        manager,
        `select count(*) from public.managed_client_policies where organization_id = '${org}';`,
      ),
    ).toBe(1);
    expect(
      countAs(
        agent,
        `select count(*) from public.managed_client_policies where organization_id = '${otherOrg}';`,
      ),
    ).toBe(0);
  });

  it("permite ler etapas operacionais, mas nega sua administração ao manager da clínica", () => {
    const stageCount = countAs(
      operator,
      `select count(*) from public.crm_stages where organization_id = '${org}';`,
    );
    expect(stageCount).toBe(0);
    expect(
      writeCountAs(
        operator,
        `update public.crm_stages set name = 'Alterada pela clínica' where organization_id = '${org}'`,
      ),
    ).toBe(0);
    expect(
      writeCountAs(
        manager,
        `update public.crm_stages set name = name where organization_id = '${org}'`,
      ),
    ).toBeGreaterThan(0);
    expect(
      countAs(agent, `select count(*) from public.crm_stages where organization_id = '${org}';`),
    ).toBe(0);
    expect(
      countAs(
        agent,
        `select count(*) from public.operational_crm_stages where organization_id = '${org}';`,
      ),
    ).toBeGreaterThan(0);
    expect(
      countAs(outsider, `select count(*) from public.crm_stages where organization_id = '${org}';`),
    ).toBe(0);
  });

  it("fecha as três tabelas base e mantém as projeções operacionais isoladas", () => {
    for (const [base, projection] of [
      ["organizations", "operational_organizations"],
      ["channel_sessions", "operational_channel_sessions"],
      ["crm_stages", "operational_crm_stages"],
      ["crm_pipelines", "operational_crm_pipelines"],
    ]) {
      const baseOrg = base === "organizations" ? "id" : "organization_id";
      const viewOrg = projection === "operational_organizations" ? "id" : "organization_id";
      expect(
        countAs(agent, `select count(*) from public.${base} where ${baseOrg} = '${org}';`),
      ).toBe(0);
      expect(
        countAs(manager, `select count(*) from public.${base} where ${baseOrg} = '${org}';`),
      ).toBeGreaterThan(0);
      expect(
        countAs(agent, `select count(*) from public.${projection} where ${viewOrg} = '${org}';`),
      ).toBeGreaterThan(0);
      expect(
        countAs(
          agent,
          `select count(*) from public.${projection} where ${viewOrg} = '${otherOrg}';`,
        ),
      ).toBe(0);
      expect(
        countAs(outsider, `select count(*) from public.${projection} where ${viewOrg} = '${org}';`),
      ).toBe(0);
    }
    const columns = sql(`select table_name || '.' || column_name from information_schema.columns
      where table_schema = 'public' and table_name in
        ('operational_organizations', 'operational_channel_sessions', 'operational_crm_stages', 'operational_crm_pipelines')
      order by table_name, column_name;`);
    for (const secret of [
      "onboarding_state",
      "created_by",
      "metadata",
      "webhook_secret_encrypted",
      "waha_session_name",
      "agent_stage_hint",
      "last_change_actor_kind",
    ]) {
      expect(columns).not.toContain(`.${secret}`);
    }
  });

  it("agent move lead para etapa ganha e o trigger mantém o fechamento", () => {
    const pipeline = lastLine(
      sql(
        `select id from public.crm_pipelines where organization_id = '${org}' and is_default limit 1;`,
      ),
    );
    const initial = lastLine(
      sql(
        `select id from public.crm_stages where pipeline_id = '${pipeline}' and not is_won and not is_lost order by position limit 1;`,
      ),
    );
    const won = lastLine(
      sql(
        `select id from public.crm_stages where pipeline_id = '${pipeline}' and is_won order by position limit 1;`,
      ),
    );
    const lead = randomUUID();
    sql(`insert into public.crm_leads(id, organization_id, pipeline_id, stage_id, title, owner_user_id)
      values ('${lead}', '${org}', '${pipeline}', '${initial}', 'Lead de teste', '${agent}');`);
    expect(
      writeCountAs(
        agent,
        `update public.crm_leads set stage_id = '${won}' where id = '${lead}' and organization_id = '${org}'`,
      ),
    ).toBe(1);
    expect(
      countAs(
        agent,
        `select count(*) from public.crm_leads where id = '${lead}' and status = 'won' and closed_at is not null;`,
      ),
    ).toBe(1);
    expect(
      countAs(
        agent,
        `select jsonb_array_length(public.fn_attendant_metrics('${org}', now() - interval '1 day', now() + interval '1 day', null)->'funnel');`,
      ),
    ).toBeGreaterThan(0);
  });

  it("nega autoelevação do membership e leitura de tokens administrativos via PostgREST", () => {
    expect(
      writeCountAs(
        agent,
        `update public.user_organizations set role = 'admin'
      where organization_id = '${org}' and user_id = '${agent}'`,
      ),
    ).toBe(0);
    expect(
      lastLine(
        sql(`select role from public.user_organizations
      where organization_id = '${org}' and user_id = '${agent}';`),
      ),
    ).toBe("agent");
    expect(
      countAs(agent, `select count(*) from public.api_tokens where organization_id = '${org}';`),
    ).toBe(0);
  });

  it("permite só a projeção operacional do seletor, sem prompt/configuração", () => {
    expect(
      countAs(
        agent,
        `select count(*) from public.ai_agent_assignable_directory where organization_id = '${org}';`,
      ),
    ).toBe(1);
    expect(
      countAs(
        manager,
        `select count(*) from public.ai_agent_assignable_directory where organization_id = '${org}';`,
      ),
    ).toBe(1);
    expect(
      countAs(
        outsider,
        `select count(*) from public.ai_agent_assignable_directory where organization_id = '${org}';`,
      ),
    ).toBe(0);
    const columns = sql(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'ai_agent_assignable_directory' order by column_name;`,
    );
    expect(columns).not.toContain("system_prompt");
    expect(columns).not.toContain("credential_id");
    expect(
      lastLine(
        sql(
          `select version_number from public.ai_agent_assignable_directory where agent_id = '${aiAgent}';`,
        ),
      ),
    ).toBe("1");
  });
});
