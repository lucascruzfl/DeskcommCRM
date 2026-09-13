import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  row: null as null | {
    id: string;
    organization_id: string;
    scopes: string[];
    revoked_at: string | null;
    expires_at: string | null;
  },
  error: null as null | { message: string },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const chain = {
        select: () => chain,
        update: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve({ data: state.row, error: state.error }),
        then: (resolve: (value: { error: null }) => unknown) =>
          Promise.resolve({ error: null }).then(resolve),
      };
      return chain;
    },
  }),
}));

import { McpAuthError, validateBearerToken } from "./auth";

const TOKEN = "dsk_12345678_um-segredo-que-nao-sera-logado";

describe("autenticação do MCP", () => {
  beforeEach(() => {
    state.error = null;
    state.row = {
      id: "11111111-1111-4111-8111-111111111111",
      organization_id: "22222222-2222-4222-8222-222222222222",
      scopes: ["mcp:read", "role:manager"],
      revoked_at: null,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    };
  });

  it("aceita token válido e resolve a organização somente da linha autenticada", async () => {
    const auth = await validateBearerToken(`Bearer ${TOKEN}`);
    expect(auth.organizationId).toBe(state.row!.organization_id);
    expect(auth.role).toBe("manager");
  });

  it("recusa token expirado", async () => {
    state.row!.expires_at = new Date(Date.now() - 60_000).toISOString();
    await expect(validateBearerToken(`Bearer ${TOKEN}`)).rejects.toMatchObject({
      httpStatus: 401,
      message: "Token expired.",
    } satisfies Partial<McpAuthError>);
  });

  it("recusa token revogado", async () => {
    state.row!.revoked_at = new Date().toISOString();
    await expect(validateBearerToken(`Bearer ${TOKEN}`)).rejects.toMatchObject({
      httpStatus: 401,
      message: "Token revoked.",
    } satisfies Partial<McpAuthError>);
  });
});
