import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ guard: vi.fn(), client: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: mocks.guard }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));

import { GET } from "./route";

describe("catálogo de modelos na área administrativa", () => {
  it("recusa agent gerenciado antes de consultar o banco", async () => {
    mocks.guard.mockResolvedValueOnce({ ok: false, response: new Response(null, { status: 403 }) });
    mocks.client.mockClear();
    const response = await GET(
      new Request("http://localhost/api/v1/ai/providers/openai/models") as never,
      {
        params: Promise.resolve({ provider: "openai" }),
      },
    );
    expect(response.status).toBe(403);
    expect(mocks.guard).toHaveBeenCalledWith(
      "manager",
      expect.objectContaining({ resource: "ai_providers" }),
    );
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it("mantém a leitura para quem a policy autoriza", async () => {
    mocks.guard.mockResolvedValueOnce({ ok: true });
    const query = {
      select: () => query,
      eq: () => query,
      is: () => query,
      order: () => query,
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve(resolve({ data: [{ model_id: "modelo" }], error: null })),
    };
    mocks.client.mockResolvedValueOnce({ from: () => query });
    const response = await GET(
      new Request("http://localhost/api/v1/ai/providers/openai/models") as never,
      {
        params: Promise.resolve({ provider: "openai" }),
      },
    );
    expect(response.status).toBe(200);
    expect((await response.json()).data.models).toEqual([{ model_id: "modelo" }]);
  });
});
