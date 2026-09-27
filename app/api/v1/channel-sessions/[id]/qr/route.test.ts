import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireRole: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: async () => null }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: mocks.requireRole }));

import { GET } from "./route";

describe("QR de Conexões", () => {
  it("nega o cliente antes de consultar o canal", async () => {
    mocks.requireRole.mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 403 }),
    });
    const response = await GET(new Request("http://localhost/api/v1/channel-sessions/id/qr"), {
      params: Promise.resolve({ id: "id" }),
    });
    expect(response.status).toBe(403);
    expect(mocks.requireRole).toHaveBeenCalledWith("admin", { resource: "channel_sessions" });
  });
});
