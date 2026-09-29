import { describe, expect, it, vi } from "vitest";
import { MANAGED_CLIENT_PRESETS } from "@/lib/managed-clients/presets";
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

describe.each(Object.values(MANAGED_CLIENT_PRESETS))("transporte MCP $id", (preset) => {
  const requestFor = (method: string, params: object = {}) =>
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
  function managedAuth() {
    mocks.auth.mockResolvedValue({
      organizationId: "clinic",
      role: "agent",
      actor: { type: "api_token", id: "token", role: "agent" },
      apiTokenId: "token",
      scopes: ["mcp:read", "mcp:write"],
      managedPolicy: buildManagedAreaPolicy(preset.id),
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
    const response = await POST(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "crm_list_orders", arguments: {} },
        }),
      }) as never,
    );
    const body = await response.text();
    expect(body).toContain("crm_list_orders");
    expect(body).toMatch(/not found|Unknown tool|not_allowed/i);
  });

  it("mostra criação só para platform_admin full e recusa chamada direta dos demais", async () => {
    for (const [role, platformAdminFull] of [
      ["admin", false],
      ["manager", false],
      ["agent", false],
      ["manager", true],
    ] as const) {
      mocks.auth.mockResolvedValue({
        organizationId: "agency",
        role,
        actor: { type: "api_token", id: "token", role },
        apiTokenId: "token",
        provisionedByUserId: "actor",
        scopes: ["mcp:read", "mcp:write", "capability:managed_client_onboarding"],
        platformAdminFull,
        managedPolicy: null,
      });
      const listed = await POST(requestFor("tools/list") as never);
      const body = await listed.text();
      expect(body.includes("crm_create_managed_client")).toBe(platformAdminFull);
      expect(body.includes("crm_configure_managed_internet_provider")).toBe(platformAdminFull);
      if (!platformAdminFull) {
        const called = await POST(
          requestFor("tools/call", {
            name: "crm_create_managed_client",
            arguments: {},
          }) as never,
        );
        expect(await called.text()).toMatch(/not found|Unknown tool|not_allowed/i);
      }
    }
  });
});
