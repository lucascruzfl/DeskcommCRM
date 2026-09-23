import { VALID_TOOL_IDS } from "./tools/catalog";
import type { McpCapability, McpToolDomain } from "./types";

export const MCP_DOMAINS = [
  "agents",
  "ai",
  "audit",
  "appointments",
  "automations",
  "campaigns",
  "channels",
  "contacts",
  "conversations",
  "followups",
  "knowledge",
  "leads",
  "messages",
  "pipelines",
  "products",
  "privacy",
  "routing",
  "operations",
  "settings",
  "team",
  "templates",
  "webhooks",
] as const satisfies ReadonlyArray<McpToolDomain>;

export const MCP_CAPABILITIES = [
  "agent_activation",
  "agent_publication",
  "automation_activation",
  "destructive_operations",
  "human_handoff",
  "send_messages",
] as const satisfies ReadonlyArray<McpCapability>;

export const MCP_OPERATION_PRESET = [
  "role:manager",
  "mcp:read",
  "mcp:write",
  ...MCP_DOMAINS.flatMap((domain) => [`${domain}:read`, `${domain}:write`]),
  ...VALID_TOOL_IDS.map((name) => `tool:${name}`),
  ...MCP_CAPABILITIES.map((capability) => `capability:${capability}`),
] as const;

export function isKnownApiTokenScope(scope: string): boolean {
  if (["mcp:read", "mcp:write", "role:manager", "audit:read"].includes(scope)) return true;
  if (MCP_DOMAINS.some((domain) => scope === `${domain}:read` || scope === `${domain}:write`))
    return true;
  if (MCP_CAPABILITIES.some((capability) => scope === `capability:${capability}`)) return true;
  return VALID_TOOL_IDS.some((name) => scope === `tool:${name}`);
}
