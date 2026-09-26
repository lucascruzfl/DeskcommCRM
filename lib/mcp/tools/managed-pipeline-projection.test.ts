import { describe, expect, it } from "vitest";
import { buildManagedAreaPolicy } from "@/lib/managed-clients/policy";
import type { McpContext } from "../types";
import { crmGetPipeline, crmListPipelines } from "./pipelines";
import { crmListStages } from "./operacao";

const org = "11111111-1111-4111-8111-111111111111";
const pipelineId = "22222222-2222-4222-8222-222222222222";
const base = {
  crm_pipelines: [
    {
      id: pipelineId,
      organization_id: org,
      name: "Clínica",
      slug: "clinica",
      description: null,
      position: 1,
      is_default: true,
      is_archived: false,
      settings: { internal: "never-expose" },
      vocabulary: { admin: "never-expose" },
    },
  ],
  operational_crm_pipelines: [
    {
      id: pipelineId,
      organization_id: org,
      name: "Clínica",
      slug: "clinica",
      description: null,
      position: 1,
      is_default: true,
      is_archived: false,
      settings: { fields: [], lost_reasons: [], canonical_tags: [] },
      vocabulary: {},
    },
  ],
  operational_crm_stages: [
    {
      id: "33333333-3333-4333-8333-333333333333",
      organization_id: org,
      pipeline_id: pipelineId,
      name: "Novo",
      slug: "novo",
      description: null,
      position: 1,
      color: null,
      is_won: false,
      is_lost: false,
      is_archived: false,
      requires_human: false,
      expected_duration_hours: null,
    },
  ],
};

function context() {
  const reads: Array<{ table: string; columns: string }> = [];
  const supabase = {
    from(table: keyof typeof base) {
      const rows = base[table];
      let columns = "*";
      let filtered = [...rows] as Array<Record<string, unknown>>;
      const result = () =>
        filtered.map((row) =>
          columns === "*"
            ? row
            : Object.fromEntries(columns.split(",").map((col) => [col.trim(), row[col.trim()]])),
        );
      const query = {
        select(value: string) {
          columns = value;
          reads.push({ table, columns });
          return query;
        },
        eq(key: string, value: unknown) {
          filtered = filtered.filter((row) => row[key] === value);
          return query;
        },
        order() {
          return query;
        },
        maybeSingle: async () => ({ data: result()[0] ?? null, error: null }),
        then(resolve: (value: { data: Record<string, unknown>[]; error: null }) => unknown) {
          return Promise.resolve(resolve({ data: result(), error: null }));
        },
      };
      return query;
    },
  };
  const ctx = {
    organizationId: org,
    role: "agent",
    actor: { type: "api_token", id: "test", role: "agent" },
    apiTokenId: "test",
    requestId: "test",
    supabase,
    managedPolicy: buildManagedAreaPolicy("managed/aesthetic-clinic"),
  } as unknown as McpContext;
  return { ctx, reads };
}

describe("MCP operacional de funil com service_role", () => {
  it("get, list e etapas não retornam configuração ao cliente gerenciado", async () => {
    const { ctx, reads } = context();
    const get = await crmGetPipeline.handler({ pipeline_id: pipelineId }, ctx);
    const list = await crmListPipelines.handler({ include_archived: false }, ctx);
    const stages = await crmListStages.handler({ pipeline_id: pipelineId }, ctx);
    expect(JSON.stringify([get, list, stages])).not.toMatch(
      /internal|never-expose|vocabulary|last_change_actor_kind/,
    );
    expect(reads.some((read) => read.table === "crm_stages")).toBe(false);
    expect(reads.some((read) => read.table === "crm_pipelines")).toBe(false);
    expect(reads.filter((read) => read.table === "operational_crm_stages")).toHaveLength(2);
    expect((stages as { etapas: unknown[] }).etapas).toHaveLength(1);
  });
});
