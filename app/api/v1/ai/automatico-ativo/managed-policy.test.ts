import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  role: vi.fn(),
  admin: vi.fn(),
  from: vi.fn(),
}));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: mocks.role }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));

import { GET } from "./route";

describe("status operacional do automático", () => {
  it("nega antes da leitura quando Inbox não é permitido", async () => {
    mocks.role.mockReset();
    mocks.admin.mockReset();
    mocks.role.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });

    const response = await GET(new Request("http://localhost/api/v1/ai/automatico-ativo") as never);
    expect(response.status).toBe(403);
    expect(mocks.role).toHaveBeenCalledWith("agent", expect.objectContaining({ resource: "ai_agents_operational_status" }));
    expect(mocks.admin).not.toHaveBeenCalled();
  });

  it("retorna apenas o estado da organização autorizada", async () => {
    mocks.role.mockReset();
    mocks.admin.mockReset();
    mocks.from.mockReset();
    mocks.role.mockResolvedValue({ ok: true, org: { orgId: "clinic" } });
    const query: Record<string, unknown> = {};
    query.select = vi.fn(() => query);
    query.eq = vi.fn(() => query);
    query.is = vi.fn(async () => ({ data: [], error: null }));
    mocks.from.mockReturnValue(query);
    mocks.admin.mockReturnValue({ from: mocks.from });

    const response = await GET(new Request("http://localhost/api/v1/ai/automatico-ativo") as never);
    expect(response.status).toBe(200);
    expect(mocks.from).toHaveBeenCalledWith("ai_agents");
    expect(query.eq).toHaveBeenCalledWith("organization_id", "clinic");
    const body = await response.json();
    expect(body.data).toEqual({ ativo: false });
  });
});
