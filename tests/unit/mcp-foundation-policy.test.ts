import { describe, expect, it } from "vitest";

import type { McpAuthResult } from "@/lib/mcp/auth";
import { McpToolError, mcpErrorPayload, sanitizeMcpPayload } from "@/lib/mcp/errors";
import { authorizeTool, domainScope } from "@/lib/mcp/policy";
import { MCP_OPERATION_PRESET } from "@/lib/mcp/scopes";
import type { McpToolDefinition } from "@/lib/mcp/types";

const baseTool: McpToolDefinition = {
  name: "crm_list_contacts",
  description: "Lista contatos da organização do token.",
  inputSchema: {},
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  domain: "contacts",
  handler: async () => ({}),
};

function auth(scopes: string[], role: McpAuthResult["role"] = "manager"): McpAuthResult {
  return {
    organizationId: "00000000-0000-4000-8000-000000000001",
    role,
    actor: { type: "api_token", id: "00000000-0000-4000-8000-000000000002", role },
    apiTokenId: "00000000-0000-4000-8000-000000000002",
    scopes,
  };
}

describe("fundação de autorização MCP", () => {
  it("mantém token legado limitado pelo scope MCP", () => {
    expect(() => authorizeTool(auth(["mcp:read"]), baseTool)).not.toThrow();
    expect(() => authorizeTool(auth([]), baseTool)).toThrow(/scope_missing:mcp:read/);
  });

  it("aplica scope de domínio quando o token opta por scopes granulares", () => {
    expect(domainScope(baseTool)).toBe("contacts:read");
    expect(() => authorizeTool(auth(["mcp:read", "leads:read"]), baseTool))
      .toThrow(/scope_missing:contacts:read/);
    expect(() => authorizeTool(auth(["mcp:read", "contacts:read"]), baseTool)).not.toThrow();
  });

  it("aplica allowlist por tool quando ela foi escolhida", () => {
    expect(() => authorizeTool(auth(["mcp:read", "tool:crm_get_contact"]), baseTool))
      .toThrow(/not_allowed:crm_list_contacts/);
    expect(() => authorizeTool(auth(["mcp:read", "tool:crm_list_contacts"]), baseTool)).not.toThrow();
  });

  it("exige capability somente para o risco distinto declarado", () => {
    const publish = { ...baseTool, name: "crm_publish_ai_agent_version", domain: "agents" as const,
      category: "write" as const, requiresScope: "mcp:write" as const,
      capabilities: ["agent_publication" as const] };
    expect(() => authorizeTool(auth(["mcp:write"]), publish)).toThrow(/capability_missing:agent_publication/);
    expect(() => authorizeTool(auth(["mcp:write", "capability:agent_publication"]), publish)).not.toThrow();
  });

  it("preset operacional é manager explícito, não admin, e inclui gates", () => {
    expect(MCP_OPERATION_PRESET).toContain("role:manager");
    expect(MCP_OPERATION_PRESET).not.toContain("role:admin");
    expect(MCP_OPERATION_PRESET).toContain("mcp:read");
    expect(MCP_OPERATION_PRESET).toContain("mcp:write");
    expect(MCP_OPERATION_PRESET).toContain("agents:write");
    expect(MCP_OPERATION_PRESET).toContain("tool:crm_publish_ai_agent_version");
    expect(MCP_OPERATION_PRESET).toContain("capability:agent_publication");
  });

  it("padroniza e higieniza erros sem devolver bearer ou chave", () => {
    const payload = mcpErrorPayload(new McpToolError(
      "scope_missing",
      "scope_missing:agents:write Bearer abc sk-proj-abcdefghijklmnop client_secret=valor-confidencial",
      { nested: { refresh_token: "refresh-real", credential_value: "valor-real" } },
    ));
    expect(payload).toMatchObject({ error: { code: "scope_missing" } });
    expect(JSON.stringify(payload)).not.toContain("abcdefghijklmnop");
    expect(JSON.stringify(payload)).not.toContain("Bearer abc");
    expect(JSON.stringify(payload)).not.toContain("valor-confidencial");
    expect(JSON.stringify(payload)).not.toContain("refresh-real");
    expect(JSON.stringify(payload)).not.toContain("valor-real");
  });

  it("redige segredos de qualquer resposta sem apagar metadados seguros", () => {
    const payload = sanitizeMcpPayload({
      api_key: "key-real",
      token: "token-real",
      secret: "secret-real",
      ciphertext: "cipher-real",
      credential_value: "credential-real",
      refresh_token: "refresh-real",
      client_secret: "client-real",
      api_key_last4: "1234",
    });
    expect(payload).toEqual({
      api_key: "[redacted]",
      token: "[redacted]",
      secret: "[redacted]",
      ciphertext: "[redacted]",
      credential_value: "[redacted]",
      refresh_token: "[redacted]",
      client_secret: "[redacted]",
      api_key_last4: "1234",
    });
  });

  it("nenhuma entrada pública aceita organization_id", () => {
    expect(Object.keys(baseTool.inputSchema)).not.toContain("organization_id");
  });
});
