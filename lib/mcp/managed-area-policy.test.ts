import { describe, expect, it } from "vitest";
import { buildManagedAreaPolicy } from "@/lib/managed-clients/policy";
import type { McpAuthResult } from "./auth";
import { authorizeTool, isToolVisible } from "./policy";
import type { McpToolDefinition } from "./types";
import { mcpPublicProfile } from "./registry";

const managedPolicy = buildManagedAreaPolicy("managed/aesthetic-clinic");
const auth: McpAuthResult = {
  organizationId: "tenant-a", role: "agent", actor: { type: "api_token", id: "token-a", role: "agent" },
  apiTokenId: "token-a", scopes: ["mcp:read", "mcp:write"], managedPolicy,
};
function tool(domain: McpToolDefinition["domain"]): McpToolDefinition {
  return {
    name: `crm_test_${domain}`, description: "test", inputSchema: {}, category: "read",
    requiresRole: "agent", requiresScope: "mcp:read", domain, handler: async () => ({}),
  };
}

describe("tools/list de token gerenciado", () => {
  it("o registry real preserva operação e omite administração do cliente", () => {
    const names = new Set(mcpPublicProfile(auth).map(entry => entry.name));
    for (const name of ["crm_list_leads", "crm_list_tasks", "crm_list_pipelines", "crm_list_at_risk_leads", "crm_assign_conversation", "crm_list_messaging_channels"]) {
      expect(names.has(name), name).toBe(true);
    }
    for (const name of ["crm_search_knowledge", "crm_get_org_memory", "crm_list_webhook_sources", "crm_list_automation_rules", "crm_list_followups"]) {
      expect(names.has(name), name).toBe(false);
    }
  });

  it.each(["agents", "campaigns", "followups", "knowledge", "routing", "webhooks", "audit", "settings"] as const)(
    "omite o domínio administrativo %s para o cliente", domain => {
      expect(isToolVisible(auth, tool(domain))).toBe(false);
      expect(() => authorizeTool(auth, tool(domain))).toThrow("managed_area_denied");
    },
  );

  it.each(["appointments", "contacts", "conversations", "messages", "templates"] as const)(
    "preserva a tool operacional %s", domain => {
      expect(isToolVisible(auth, tool(domain))).toBe(true);
    },
  );

  it("override de campanha alcança a mesma decisão MCP", () => {
    const changed = { ...auth, managedPolicy: buildManagedAreaPolicy("managed/aesthetic-clinic", [
      { href: "/app/campaigns", classification: "client" },
    ]) };
    expect(isToolVisible(changed, tool("campaigns"))).toBe(true);
  });
});
