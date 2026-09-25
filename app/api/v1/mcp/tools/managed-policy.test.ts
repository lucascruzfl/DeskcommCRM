import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  gate: vi.fn(),
  admin: vi.fn(),
  modules: vi.fn(),
}));
vi.mock("@/lib/auth/server", () => ({
  loadAuthUser: async () => ({ id: "client" }),
  resolveActiveOrg: async () => ({ orgId: "clinic" }),
}));
vi.mock("@/lib/managed-clients/server", () => ({ managedAreaAllowedForActor: mocks.gate }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/instalacao/modulos", () => ({ modulosLigados: mocks.modules }));
vi.mock("@/lib/mcp/tools", () => ({ allTools: [] }));
vi.mock("@/lib/mcp/tools/catalog", () => ({ TOOL_CATALOG: [], deModuloDesligado: () => false }));

import { GET } from "./route";

describe("catálogo MCP da tela de agentes", () => {
  it("nega o cliente gerenciado antes de servir capacidades administrativas", async () => {
    mocks.gate.mockResolvedValue(false);
    const response = await GET(new Request("http://localhost/api/v1/mcp/tools") as never);
    expect(response.status).toBe(403);
    expect(mocks.gate).toHaveBeenCalledWith("clinic", "client", "/app/ai/agents");
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.modules).not.toHaveBeenCalled();
  });
});
