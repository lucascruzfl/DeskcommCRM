import { describe, expect, it } from "vitest";

import { allTools } from "./tools";
import {
  authorizeMcpTool,
  buildTokenScopes,
  capabilityScope,
  MCP_PUBLIC_PROFILE_SCOPE,
  MCP_PUBLIC_TOOL_NAMES,
  publicToolPolicy,
  toolAllowlistScope,
  toolsAuthorizedForToken,
} from "./public-profile";

const PUBLICAS = [
  "crm_search_contacts",
  "crm_get_contact",
  "crm_list_conversations",
  "crm_get_conversation",
  "crm_get_conversation_history",
  "crm_get_queue_status",
  "crm_list_pipelines",
  "crm_create_pipeline",
  "crm_update_pipeline",
  "crm_manage_pipeline_stages",
  "crm_manage_pipeline_fields",
  "crm_list_leads",
  "crm_get_lead",
  "crm_create_lead",
  "crm_update_lead",
  "crm_move_lead_stage",
  "crm_manage_tags",
  "crm_assign_conversation",
  "crm_request_human_handoff",
  "crm_send_whatsapp_message",
] as const;

function scopesPara(name: string, capability?: "send_messages" | "human_handoff"): string[] {
  const policy = publicToolPolicy(name);
  if (!policy) throw new Error(`politica ausente: ${name}`);
  return [
    MCP_PUBLIC_PROFILE_SCOPE,
    toolAllowlistScope(name),
    ...policy.required_scopes,
    ...(capability ? [capabilityScope(capability)] : []),
  ];
}

describe("perfil MCP público", () => {
  it("publica exatamente as tools aprovadas", () => {
    expect([...MCP_PUBLIC_TOOL_NAMES].sort()).toEqual([...PUBLICAS].sort());
    expect(new Set(MCP_PUBLIC_TOOL_NAMES).size).toBe(PUBLICAS.length);
  });

  it("token legado preserva as 60 tools internas", () => {
    expect(toolsAuthorizedForToken(allTools, ["mcp:read", "mcp:write"])).toHaveLength(
      allTools.length,
    );
  });

  it("token público vê somente a allowlist que também está autorizada", () => {
    const scopes = scopesPara("crm_get_contact");
    expect(toolsAuthorizedForToken(allTools, scopes).map((tool) => tool.name)).toEqual([
      "crm_get_contact",
    ]);
    expect(authorizeMcpTool(scopes, "crm_list_leads")).toMatchObject({
      ok: false,
      reason: "not_allowed",
    });
  });

  it("criação do token deriva allowlist e scopes mínimos sem liberar capability", () => {
    const scopes = buildTokenScopes({
      scopes: [],
      allowedTools: ["crm_get_contact", "crm_send_whatsapp_message"],
    });
    expect(scopes).toEqual(
      expect.arrayContaining([
        MCP_PUBLIC_PROFILE_SCOPE,
        "actor:ai_agent",
        toolAllowlistScope("crm_get_contact"),
        toolAllowlistScope("crm_send_whatsapp_message"),
        "mcp:read",
        "contacts:read",
        "mcp:write",
        "messages:send",
      ]),
    );
    expect(scopes).not.toContain(capabilityScope("send_messages"));
  });

  it("scope amplo sem scope de domínio é insuficiente", () => {
    expect(
      authorizeMcpTool(
        [MCP_PUBLIC_PROFILE_SCOPE, toolAllowlistScope("crm_get_contact"), "mcp:read"],
        "crm_get_contact",
      ),
    ).toMatchObject({ ok: false, reason: "scope_missing", missing: "contacts:read" });
  });

  it.each([
    ["crm_send_whatsapp_message", "send_messages"],
    ["crm_request_human_handoff", "human_handoff"],
  ] as const)("%s exige a capability crítica %s", (tool, capability) => {
    expect(authorizeMcpTool(scopesPara(tool), tool)).toMatchObject({
      ok: false,
      reason: "capability_missing",
      missing: capabilityScope(capability),
    });
    expect(authorizeMcpTool(scopesPara(tool, capability), tool).ok).toBe(true);
  });

  it("nenhuma tool pública aceita organization_id no input", () => {
    for (const name of PUBLICAS) {
      const tool = allTools.find((candidate) => candidate.name === name);
      expect(tool, name).toBeDefined();
      expect(Object.prototype.hasOwnProperty.call(tool!.inputSchema, "organization_id"), name).toBe(
        false,
      );
    }
  });

  it("administração de pipelines exige allowlist e domínio pipelines:write", () => {
    for (const name of [
      "crm_create_pipeline",
      "crm_update_pipeline",
      "crm_manage_pipeline_stages",
      "crm_manage_pipeline_fields",
    ]) {
      const policy = publicToolPolicy(name);
      expect(policy?.required_scopes).toEqual(["mcp:write", "pipelines:write"]);
      expect(authorizeMcpTool(scopesPara(name), name).ok).toBe(true);
      expect(policy?.required_capability).toBeNull();
    }
  });
});
