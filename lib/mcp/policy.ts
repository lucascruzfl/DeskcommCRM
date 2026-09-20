import type { McpAuthResult } from "./auth";
import { McpAuthError } from "./auth";
import type { McpCapability, McpToolDefinition, McpToolDomain } from "./types";

const DOMAIN_PREFIXES: ReadonlyArray<[RegExp, McpToolDomain]> = [
  [/appointment|event_type|free_slot/, "appointments"],
  [/automation/, "automations"],
  [/knowledge|org_memory|improvement/, "knowledge"],
  [/followup|at_risk|reactivation|close_demand/, "followups"],
  [/conversation|queue|human_case|case_note|attendance|handoff/, "conversations"],
  [/whatsapp|message/, "messages"],
  [/contact/, "contacts"],
  [/lead/, "leads"],
  [/pipeline|stage/, "pipelines"],
  [/product|order/, "products"],
  [/webhook/, "webhooks"],
  [/template/, "templates"],
  [/team|attendant/, "team"],
  [/routing/, "routing"],
];

export function domainOf(tool: McpToolDefinition): McpToolDomain {
  if (tool.domain) return tool.domain;
  return DOMAIN_PREFIXES.find(([pattern]) => pattern.test(tool.name))?.[1] ?? "ai";
}

export function capabilitiesOf(tool: McpToolDefinition): ReadonlyArray<McpCapability> {
  if (tool.capabilities) return tool.capabilities;
  if (["crm_send_whatsapp_message", "crm_start_conversation_and_send"].includes(tool.name)) {
    return ["send_messages"];
  }
  if (tool.name === "crm_request_human_handoff") return ["human_handoff"];
  if (tool.name === "crm_set_automation_rule_active") return ["automation_activation"];
  if (["crm_archive_stage", "crm_close_human_case"].includes(tool.name)) {
    return ["destructive_operations"];
  }
  return [];
}

export function capabilityScopes(tool: McpToolDefinition): ReadonlyArray<string> {
  return capabilitiesOf(tool).map((capability) => `capability:${capability}`);
}

export function domainScope(tool: McpToolDefinition): string {
  return `${domainOf(tool)}:${tool.category === "read" ? "read" : "write"}`;
}

export function authorizeTool(auth: McpAuthResult, tool: McpToolDefinition): void {
  if (!auth.scopes.includes(tool.requiresScope)) {
    throw new McpAuthError(-32002, 403, `scope_missing:${tool.requiresScope}`);
  }

  const granular = auth.scopes.some(
    (scope) => /^[a-z_]+:(read|write)$/.test(scope) && !scope.startsWith("mcp:") && !scope.startsWith("audit:"),
  );
  const requiredDomainScope = domainScope(tool);
  if (granular && !auth.scopes.includes(requiredDomainScope)) {
    throw new McpAuthError(-32002, 403, `scope_missing:${requiredDomainScope}`);
  }

  const allowlisted = auth.scopes.filter((scope) => scope.startsWith("tool:"));
  if (allowlisted.length > 0 && !auth.scopes.includes(`tool:${tool.name}`)) {
    throw new McpAuthError(-32002, 403, `not_allowed:${tool.name}`);
  }

  for (const scope of capabilityScopes(tool)) {
    if (!auth.scopes.includes(scope)) {
      throw new McpAuthError(-32002, 403, `capability_missing:${scope.slice("capability:".length)}`);
    }
  }
}

export function isToolVisible(auth: McpAuthResult, tool: McpToolDefinition): boolean {
  if (tool.publicProfile === false) return false;
  try {
    authorizeTool(auth, tool);
    return true;
  } catch {
    return false;
  }
}
