import { describe, expect, it } from "vitest";

import { AI_MCP_TOOLS } from "@/lib/mcp/tools/ia";

const byName = new Map(AI_MCP_TOOLS.map((tool) => [tool.name, tool]));

describe("registry MCP de IA", () => {
  it("cobre descoberta, administração, publicação e runs", () => {
    for (const name of [
      "crm_list_ai_providers",
      "crm_list_ai_models",
      "crm_list_ai_credentials",
      "crm_validate_agent_ai_configuration",
      "crm_create_ai_agent",
      "crm_update_ai_agent_version",
      "crm_preflight_ai_agent_version",
      "crm_publish_ai_agent_version",
      "crm_test_ai_agent_version",
      "crm_activate_ai_agent",
      "crm_list_ai_agent_runs",
    ]) expect(byName.has(name), name).toBe(true);
  });

  it("não aceita organization_id em nenhuma entrada pública", () => {
    for (const tool of AI_MCP_TOOLS) {
      expect(Object.keys(tool.inputSchema), tool.name).not.toContain("organization_id");
    }
  });

  it("separa scopes de catálogo de IA dos scopes de administração de agentes", () => {
    expect(byName.get("crm_list_ai_models")?.domain).toBe("ai");
    expect(byName.get("crm_list_ai_agents")?.domain).toBe("agents");
    expect(byName.get("crm_publish_ai_agent_version")?.domain).toBe("agents");
  });

  it("publicação e ativação têm capabilities distintas", () => {
    expect(byName.get("crm_publish_ai_agent_version")?.capabilities).toEqual(["agent_publication"]);
    expect(byName.get("crm_activate_ai_agent")?.capabilities).toEqual(["agent_activation"]);
  });

  it("credenciais só expõem metadados e nunca aceitam secret", () => {
    for (const name of ["crm_list_ai_credentials", "crm_get_ai_credential"]) {
      const text = JSON.stringify(byName.get(name)?.inputSchema);
      expect(text).not.toMatch(/api_key|secret|ciphertext|token/i);
    }
  });
});
