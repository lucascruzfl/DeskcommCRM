import { describe, expect, it } from "vitest";

import type { McpAuthResult } from "@/lib/mcp/auth";
import { MCP_REGISTRY, MCP_TOOL_COUNT, mcpPublicProfile, toolsForAuth } from "@/lib/mcp/registry";
import { MCP_OPERATION_PRESET } from "@/lib/mcp/scopes";

function auth(scopes: string[], role: McpAuthResult["role"] = "manager"): McpAuthResult {
  return {
    organizationId: "00000000-0000-4000-8000-000000000001",
    role,
    actor: { type: "api_token", id: "00000000-0000-4000-8000-000000000002", role },
    apiTokenId: "00000000-0000-4000-8000-000000000002",
    scopes,
  };
}

describe("registry público MCP", () => {
  it("deriva o total e o tools/list da mesma fonte", () => {
    expect(MCP_TOOL_COUNT).toBe(MCP_REGISTRY.length);
    expect(new Set(MCP_REGISTRY.map((tool) => tool.name)).size).toBe(MCP_TOOL_COUNT);
    expect(MCP_TOOL_COUNT).toBeGreaterThan(63);
  });

  it("nenhuma tool registrada aceita organization_id como entrada pública", () => {
    for (const tool of MCP_REGISTRY) {
      expect(Object.keys(tool.inputSchema), tool.name).not.toContain("organization_id");
    }
  });

  it("preset manager alcança o perfil completo sem role admin", () => {
    const profile = mcpPublicProfile(auth([...MCP_OPERATION_PRESET]));
    expect(profile).toHaveLength(MCP_TOOL_COUNT);
    expect(profile.some((tool) => tool.name === "crm_publish_ai_agent_version")).toBe(true);
    expect(profile.every((tool) => tool.requiresRole !== "admin")).toBe(true);
  });

  it("scope e allowlist reduzem tools/list antes de registrar handlers", () => {
    const tools = toolsForAuth(auth([
      "mcp:read",
      "ai:read",
      "tool:crm_list_ai_models",
    ]));
    expect(tools.map((tool) => tool.name)).toEqual(["crm_list_ai_models"]);
  });

  it("papel abaixo de manager não enxerga administração de agentes", () => {
    const profile = mcpPublicProfile(auth(["mcp:read", "agents:read"], "ai_operator"));
    expect(profile.some((tool) => tool.domain === "agents")).toBe(false);
  });
});
