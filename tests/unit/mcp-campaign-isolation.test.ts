import { describe, expect, it } from "vitest";

import type { McpToolError } from "@/lib/mcp/errors";
import { getToolByName } from "@/lib/mcp/tools";
import type { McpContext } from "@/lib/mcp/types";

const orgA = "00000000-0000-4000-8000-000000000001";
const orgB = "00000000-0000-4000-8000-000000000002";
const campaignA = "00000000-0000-4000-8000-000000000003";
const campaignB = "00000000-0000-4000-8000-000000000004";

function context() {
  const queries: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
  const rows = [
    { id: campaignA, organization_id: orgA, name: "Própria", status: "draft", created_at: "2026-09-01" },
    { id: campaignB, organization_id: orgB, name: "SECRETA", status: "draft", created_at: "2026-09-02" },
  ];
  const supabase = {
    from(table: string) {
      const query = { table, filters: [] as Array<[string, unknown]> };
      queries.push(query);
      const builder = {
        select() { return builder; },
        eq(column: string, value: unknown) { query.filters.push([column, value]); return builder; },
        order() { return builder; },
        limit() {
          const matches = rows.filter((row) => query.filters.every(([column, value]) => row[column as keyof typeof row] === value));
          return Promise.resolve({ data: matches, error: null });
        },
        maybeSingle() {
          const matches = rows.filter((row) => query.filters.every(([column, value]) => row[column as keyof typeof row] === value));
          return Promise.resolve({ data: matches[0] ?? null, error: null });
        },
      };
      return builder;
    },
  };
  const ctx = {
    organizationId: orgA, role: "manager", actor: { type: "api_token", id: campaignA, role: "manager" },
    apiTokenId: campaignA, requestId: "campaign-isolation", supabase,
  } as unknown as McpContext;
  return { ctx, queries };
}

describe("campanhas MCP com service role", () => {
  it("lista apenas campanhas da organização, mesmo quando o client ignora RLS", async () => {
    const { ctx, queries } = context();
    const tool = getToolByName("crm_list_campaigns")!;
    const result = await tool.handler({ limit: 30 }, ctx) as { campaigns: Array<{ id: string }> };
    expect(result.campaigns.map((campaign) => campaign.id)).toEqual([campaignA]);
    expect(queries[0]?.filters).toContainEqual(["organization_id", orgA]);
  });

  it("nega leitura e confirmação de lançamento de uma campanha de outro tenant", async () => {
    for (const name of ["crm_get_campaign", "crm_prepare_campaign_launch"]) {
      const { ctx, queries } = context();
      const tool = getToolByName(name)!;
      await expect(tool.handler({ campaign_id: campaignB }, ctx)).rejects.toMatchObject({ code: "not_found" } satisfies Partial<McpToolError>);
      expect(queries[0]?.filters).toContainEqual(["organization_id", orgA]);
      expect(queries.every((query) => query.table === "campaigns")).toBe(true);
    }
  });
});
