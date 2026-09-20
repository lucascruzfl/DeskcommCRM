import { ROLE_RANK } from "@/lib/auth/types";
import type { McpAuthResult } from "./auth";
import { allTools } from "./tools";
import { TOOL_CATALOG } from "./tools/catalog";
import { juntarCatalogoComHandlers } from "./tools/catalogo-servido";
import { capabilitiesOf, domainOf, isToolVisible } from "./policy";

export const MCP_REGISTRY = allTools;
export const MCP_TOOL_COUNT = MCP_REGISTRY.length;

export function mcpPublicProfile(auth: McpAuthResult) {
  const presentation = new Map(
    juntarCatalogoComHandlers(MCP_REGISTRY, TOOL_CATALOG).map((entry) => [entry.id, entry]),
  );
  return MCP_REGISTRY.filter(
    (tool) => ROLE_RANK[auth.role] >= ROLE_RANK[tool.requiresRole] && isToolVisible(auth, tool),
  ).map((tool) => ({
    ...presentation.get(tool.name),
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    domain: domainOf(tool),
    capabilities: capabilitiesOf(tool),
    requiresRole: tool.requiresRole,
    requiresScope: tool.requiresScope,
  }));
}

export function toolsForAuth(auth: McpAuthResult) {
  const names = new Set(mcpPublicProfile(auth).map((tool) => tool.name));
  return MCP_REGISTRY.filter((tool) => names.has(tool.name));
}
