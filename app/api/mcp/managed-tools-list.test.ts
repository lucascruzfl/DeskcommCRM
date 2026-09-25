import { describe, expect, it, vi } from "vitest";
import { buildManagedAreaPolicy } from "@/lib/managed-clients/policy";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
}));
vi.mock("@/lib/mcp/auth", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  validateBearerToken: mocks.auth,
}));
vi.mock("@/lib/mcp/rate-limit", () => ({ limitMcpRequest: async () => ({ allowed: true }) }));
vi.mock("@/lib/instalacao/modulos", () => ({ modulosLigados: async () => [] }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

import { POST } from "./route";

describe("tools/list pelo transporte MCP", () => {
  function managedAuth() {
    mocks.auth.mockResolvedValue({
      organizationId: "clinic", role: "agent", actor: { type: "api_token", id: "token", role: "agent" },
      apiTokenId: "token", scopes: ["mcp:read", "mcp:write"],
      managedPolicy: buildManagedAreaPolicy("managed/aesthetic-clinic"),
    });
  }

  it("omite áreas agência e não aplicáveis para token gerenciado", async () => {
    managedAuth();
    const request = new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    const response = await POST(request as never);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("crm_list_leads");
    expect(body).not.toContain("crm_list_orders");
    expect(body).not.toContain("crm_list_webhook_sources");
    expect(body).not.toContain("crm_list_ai_skill_versions");
    expect(mocks.auth).toHaveBeenCalledWith("Bearer test-token");
  });

  it("recusa invocação direta de pedidos Nuvemshop", async () => {
    managedAuth();
    const response = await POST(new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 2, method: "tools/call",
        params: { name: "crm_list_orders", arguments: {} },
      }),
    }) as never);
    const body = await response.text();
    expect(body).toContain("crm_list_orders");
    expect(body).toMatch(/not found|Unknown tool|not_allowed/i);
  });
});
