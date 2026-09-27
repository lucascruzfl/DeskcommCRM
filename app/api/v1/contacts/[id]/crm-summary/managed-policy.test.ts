import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  gate: vi.fn(),
  admin: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "client" } }, error: null }) },
    from: mocks.from,
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/managed-clients/server", () => ({ managedAreaAllowedForActor: mocks.gate }));
vi.mock("@/lib/users/nome-do-atendente", () => ({ nomesDosAtendentes: async () => new Map() }));

import { GET } from "./route";

describe("resumo operacional em tenant gerenciado", () => {
  it("preserva o painel sem consultar pedidos ou enriquecimento de áreas não aplicáveis", async () => {
    mocks.from.mockReset();
    mocks.gate.mockReset();
    mocks.admin.mockReset();
    mocks.gate.mockResolvedValue(false);
    mocks.from.mockImplementation((table: string) => {
      const result = table === "contacts"
        ? { data: { organization_id: "clinic", is_anonymized: false }, error: null }
        : { data: [], error: null };
      const query: Record<string, unknown> = {};
      for (const method of ["select", "eq", "is", "not", "order", "limit"]) {
        query[method] = () => query;
      }
      query.maybeSingle = async () => result;
      query.then = (resolve: (value: typeof result) => unknown) => resolve(result);
      return query;
    });

    const response = await GET(new Request("http://localhost/api/v1/contacts/contact/crm-summary") as never, {
      params: Promise.resolve({ id: "contact" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.from.mock.calls.map(([table]) => table)).not.toContain("orders");
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.gate).toHaveBeenCalledWith("clinic", "client", "/app/prospecting");
    expect(mocks.gate).toHaveBeenCalledWith("clinic", "client", "/app/integrations/nuvemshop");
    const body = await response.json();
    expect(body.data.orders).toEqual([]);
    expect(body.data.enrichment).toBeNull();
  });
});
