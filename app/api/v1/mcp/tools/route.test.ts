import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/server", () => ({
  loadAuthUser: vi.fn(),
  resolveActiveOrg: vi.fn(),
}));

import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { MCP_PUBLIC_TOOL_NAMES } from "@/lib/mcp/public-profile";
import { GET } from "./route";

describe("catálogo MCP público", () => {
  beforeEach(() => {
    vi.mocked(loadAuthUser).mockResolvedValue({ id: "user-1" } as never);
    vi.mocked(resolveActiveOrg).mockResolvedValue({
      orgId: "11111111-1111-4111-8111-111111111111",
      role: "admin",
      name: "Org",
    } as never);
  });

  it("serve somente o perfil público com contrato gerável", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/v1/mcp/tools?profile=public"),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: {
        profile: string;
        tools: Array<Record<string, unknown>>;
      };
    };

    expect(body.data.profile).toBe("public");
    expect(body.data.tools.map((tool) => tool.name).sort()).toEqual(
      [...MCP_PUBLIC_TOOL_NAMES].sort(),
    );
    for (const tool of body.data.tools) {
      expect(tool).toEqual(
        expect.objectContaining({
          name: expect.any(String),
          description: expect.any(String),
          input_schema: expect.any(Object),
          access: expect.stringMatching(/^(read|write|critical)$/),
          required_scopes: expect.any(Array),
        }),
      );
      expect(tool.required_capability === null || typeof tool.required_capability === "string").toBe(
        true,
      );
    }
  });

  it("mantém o catálogo interno completo como padrão", async () => {
    const response = await GET(new NextRequest("http://localhost/api/v1/mcp/tools"));
    const body = (await response.json()) as { data: { profile: string; tools: unknown[] } };
    expect(body.data.profile).toBe("internal");
    expect(body.data.tools.length).toBeGreaterThan(MCP_PUBLIC_TOOL_NAMES.length);
  });

  it("expõe schemas e política das quatro tools de administração de pipeline", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/v1/mcp/tools?profile=public"),
    );
    const body = (await response.json()) as {
      data: { tools: Array<{
        name: string;
        access: string;
        required_scopes: string[];
        required_capability: string | null;
        input_schema: { properties?: Record<string, unknown> };
      }> };
    };
    for (const name of [
      "crm_create_pipeline",
      "crm_update_pipeline",
      "crm_manage_pipeline_stages",
      "crm_manage_pipeline_fields",
    ]) {
      const tool = body.data.tools.find((candidate) => candidate.name === name);
      expect(tool, name).toBeDefined();
      expect(tool?.required_scopes).toEqual(["mcp:write", "pipelines:write"]);
      expect(tool?.required_capability).toBeNull();
      expect(tool?.input_schema.properties).not.toHaveProperty("organization_id");
    }
    expect(body.data.tools.find((tool) => tool.name === "crm_manage_pipeline_stages")?.access)
      .toBe("critical");
  });
});
