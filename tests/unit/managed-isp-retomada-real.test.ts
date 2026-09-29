import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: async () => ({ error: null }) }),
}));

import { retomarLeadHandler } from "@/app/api/v1/leads/_handler";
import { ApiError } from "@/lib/api/types";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const PIPE = "33333333-3333-4333-8333-333333333333";
const OPEN = "44444444-4444-4444-8444-444444444444";
const LOST = "55555555-5555-4555-8555-555555555555";
const ORIGIN = "66666666-6666-4666-8666-666666666666";
const RESUMED = "77777777-7777-4777-8777-777777777777";

describe("ISP Sem cobertura: retomada pelo handler canônico", () => {
  it("preserva a origem perdida, cria negócio aberto no mesmo tenant e recusa tenant B", async () => {
    const leads: Array<Record<string, unknown>> = [{ id: ORIGIN, organization_id: ORG,
      pipeline_id: PIPE, stage_id: OPEN, title: "Expansão de área", status: "open",
      lost_reason: null, tags: ["lead", "sem-cobertura"], currency: "BRL", custom_fields: {} }];
    // O operador classifica a perda; a retomada abaixo é exclusivamente o handler do produto.
    Object.assign(leads[0]!, { stage_id: LOST, status: "lost", lost_reason: "Sem cobertura" });
    const from = (table: string) => {
      const filters: Record<string, unknown> = {};
      let inserted: Record<string, unknown> | null = null;
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters[key] = value; return query; },
        order: () => query,
        limit: () => query,
        insert: (row: Record<string, unknown>) => { inserted = row; return query; },
        maybeSingle: async () => {
          if (table === "crm_leads") {
            const found = leads.find((lead) => Object.entries(filters).every(([key, value]) => lead[key] === value));
            return { data: found ?? null, error: null };
          }
          if (table === "crm_pipelines") return { data: { settings: { reabertura: "novo_negocio",
            reabertura_campos: ["tags", "custom_fields"] } }, error: null };
          if (table === "operational_organizations") return { data: { currency: "BRL" }, error: null };
          if (table === "operational_crm_stages") return { data: { id: OPEN, pipeline_id: PIPE, organization_id: ORG }, error: null };
          throw new Error(`unexpected lookup: ${table}`);
        },
        single: async () => {
          if (table !== "crm_leads" || !inserted) throw new Error("unexpected insert");
          const lead = { ...inserted, id: RESUMED };
          leads.push(lead);
          return { data: lead, error: null };
        },
        then: (resolve: (value: { data: Record<string, unknown>[]; error: null }) => unknown) => {
          if (table !== "crm_stages") throw new Error(`unexpected list: ${table}`);
          return Promise.resolve(resolve({ data: [{ id: OPEN, pipeline_id: PIPE, is_won: false,
            is_lost: false, is_archived: false }], error: null }));
        },
      };
      return query;
    };
    const db = { from } as never;
    const ctx = { organization_id: ORG, actor: { type: "user" as const, id: ORG }, requestId: "isp-resume",
      serviceOrigin: { kind: "unavailable" as const, reason: "origin_capture_failed" as const } };
    const resumed = await retomarLeadHandler(db, ctx, ORIGIN);
    expect(resumed).toMatchObject({ id: RESUMED, organization_id: ORG, status: "open",
      source: "retomada", retomado_de_lead_id: ORIGIN, stage_id: OPEN });
    expect(leads[0]).toMatchObject({ id: ORIGIN, organization_id: ORG, status: "lost",
      lost_reason: "Sem cobertura", tags: ["lead", "sem-cobertura"] });
    expect(await retomarLeadHandler(db, ctx, ORIGIN)).toMatchObject({ id: RESUMED });
    expect(leads).toHaveLength(2);
    const forbidden = await retomarLeadHandler(db, { ...ctx, organization_id: OTHER }, ORIGIN)
      .catch((error: unknown) => error);
    expect(forbidden).toBeInstanceOf(ApiError);
    expect((forbidden as ApiError).status).toBe(404);
    expect(leads).toHaveLength(2);
    expect(leads.every((lead) => lead.organization_id === ORG)).toBe(true);
  });
});
