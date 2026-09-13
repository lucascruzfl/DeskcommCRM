/**
 * Contrato de autorizacao do MCP publico.
 *
 * Tokens legados e o runtime interno nao carregam `mcp:public` e continuam
 * usando o catalogo completo. Um token publico falha fechado: so enxerga uma
 * tool desta lista quando carrega a allowlist, o scope amplo, o scope de
 * dominio e, nas duas saidas irreversiveis, a capability explicita.
 */
import type { McpToolDefinition } from "./types";

export const MCP_PUBLIC_PROFILE_SCOPE = "mcp:public";
export const MCP_TOOL_SCOPE_PREFIX = "tool:";

export const MCP_PUBLIC_CAPABILITIES = ["send_messages", "human_handoff"] as const;
export type McpPublicCapability = (typeof MCP_PUBLIC_CAPABILITIES)[number];
export type McpPublicRisk = "read" | "write" | "critical";

export interface McpPublicToolPolicy {
  name: string;
  risk: McpPublicRisk;
  required_scopes: readonly string[];
  required_capability: McpPublicCapability | null;
}

function politica(
  name: string,
  risk: McpPublicRisk,
  domainScope: string,
  requiredCapability: McpPublicCapability | null = null,
): McpPublicToolPolicy {
  return {
    name,
    risk,
    required_scopes: [risk === "read" ? "mcp:read" : "mcp:write", domainScope],
    required_capability: requiredCapability,
  };
}

export const MCP_PUBLIC_TOOL_POLICIES: readonly McpPublicToolPolicy[] = [
  politica("crm_search_contacts", "read", "contacts:read"),
  politica("crm_get_contact", "read", "contacts:read"),
  politica("crm_list_conversations", "read", "conversations:read"),
  politica("crm_get_conversation", "read", "conversations:read"),
  politica("crm_get_conversation_history", "read", "conversations:read"),
  politica("crm_get_queue_status", "read", "conversations:read"),
  politica("crm_list_pipelines", "read", "pipelines:read"),
  politica("crm_create_pipeline", "write", "pipelines:write"),
  politica("crm_update_pipeline", "write", "pipelines:write"),
  politica("crm_manage_pipeline_stages", "critical", "pipelines:write"),
  politica("crm_manage_pipeline_fields", "write", "pipelines:write"),
  politica("crm_list_leads", "read", "leads:read"),
  politica("crm_get_lead", "read", "leads:read"),
  politica("crm_create_lead", "write", "leads:write"),
  politica("crm_update_lead", "write", "leads:write"),
  politica("crm_move_lead_stage", "write", "leads:write"),
  politica("crm_manage_tags", "write", "tags:write"),
  politica("crm_assign_conversation", "write", "conversations:write"),
  politica("crm_request_human_handoff", "critical", "handoff:write", "human_handoff"),
  politica("crm_send_whatsapp_message", "critical", "messages:send", "send_messages"),
] as const;

export const MCP_PUBLIC_TOOL_NAMES = MCP_PUBLIC_TOOL_POLICIES.map((p) => p.name);

const POLITICA_POR_TOOL = new Map(MCP_PUBLIC_TOOL_POLICIES.map((p) => [p.name, p]));

export function capabilityScope(capability: McpPublicCapability): string {
  return `capability:${capability}`;
}

export function toolAllowlistScope(toolName: string): string {
  return `${MCP_TOOL_SCOPE_PREFIX}${toolName}`;
}

/** Normaliza o que a rota de criacao persiste em `api_tokens.scopes`. */
export function buildTokenScopes(input: {
  scopes: readonly string[];
  allowedTools?: readonly string[];
  capabilities?: readonly McpPublicCapability[];
}): string[] {
  const scopes = new Set(input.scopes);
  if (input.allowedTools) {
    scopes.add(MCP_PUBLIC_PROFILE_SCOPE);
    // Token do perfil público representa um cliente MCP, não uma linha de
    // auth.users. Isto também impede auditorias de domínio de tentarem gravar o
    // id do token na FK actor_user_id.
    scopes.add("actor:ai_agent");
    for (const toolName of input.allowedTools) {
      const policy = publicToolPolicy(toolName);
      if (!policy) throw new Error(`tool_not_public:${toolName}`);
      scopes.add(toolAllowlistScope(toolName));
      for (const required of policy.required_scopes) scopes.add(required);
    }
  }
  for (const capability of input.capabilities ?? []) scopes.add(capabilityScope(capability));
  return [...scopes].sort();
}

export function isPublicMcpToken(scopes: readonly string[]): boolean {
  return scopes.includes(MCP_PUBLIC_PROFILE_SCOPE);
}

export function publicToolPolicy(toolName: string): McpPublicToolPolicy | undefined {
  return POLITICA_POR_TOOL.get(toolName);
}

export type PublicToolAuthorization =
  | { ok: true; policy: McpPublicToolPolicy | null }
  | { ok: false; reason: "not_public" | "not_allowed" | "scope_missing" | "capability_missing"; missing?: string };

export function authorizeMcpTool(
  scopes: readonly string[],
  toolName: string,
): PublicToolAuthorization {
  // Compatibilidade: tokens existentes e o runtime in-process continuam com
  // o comportamento anterior. A restricao publica e sempre opt-in explicito.
  if (!isPublicMcpToken(scopes)) return { ok: true, policy: null };

  const policy = publicToolPolicy(toolName);
  if (!policy) return { ok: false, reason: "not_public" };
  if (!scopes.includes(toolAllowlistScope(toolName))) {
    return { ok: false, reason: "not_allowed" };
  }
  for (const required of policy.required_scopes) {
    if (!scopes.includes(required)) {
      return { ok: false, reason: "scope_missing", missing: required };
    }
  }
  if (policy.required_capability) {
    const required = capabilityScope(policy.required_capability);
    if (!scopes.includes(required)) {
      return { ok: false, reason: "capability_missing", missing: required };
    }
  }
  return { ok: true, policy };
}

/** O que entra em tools/list para este token. */
export function toolsAuthorizedForToken(
  tools: ReadonlyArray<McpToolDefinition>,
  scopes: readonly string[],
): ReadonlyArray<McpToolDefinition> {
  return tools.filter((tool) => authorizeMcpTool(scopes, tool.name).ok);
}
