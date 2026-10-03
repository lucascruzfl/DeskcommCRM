import type { McpAuthResult } from "./auth";
import { McpAuthError } from "./auth";
import type { McpCapability, McpToolDefinition, McpToolDomain } from "./types";
import { canAccessManagedArea } from "@/lib/managed-clients/policy";
import type { NavDestinationId } from "@/lib/navigation/catalogo";
import { MCP_CAPABILITIES, MCP_DOMAINS } from "./scopes";
import { VALID_TOOL_IDS } from "./tools/catalog";
import { TOOLS_B2B } from "./tools/catalogo/b2b";
import { TOOLS_PARITY_162 } from "./tools/catalogo/parity-162";

const PARITY_TOOL_NAMES = new Set(
  [...TOOLS_B2B, ...TOOLS_PARITY_162]
    .map((entry) => entry.name)
    .concat(["crm_get_jev_status", "crm_update_channel_pacing"]),
);

/** Preset completo emitido antes desta paridade: conserva acesso às novas tools
 * sem converter uma allowlist parcial em autorização ampla. */
function legacyFullPresetForParity(scopes: readonly string[]): boolean {
  const present = new Set(scopes);
  return (
    present.has("role:manager") &&
    present.has("mcp:read") &&
    present.has("mcp:write") &&
    MCP_DOMAINS.every(
      (domain) => present.has(`${domain}:read`) && present.has(`${domain}:write`),
    ) &&
    MCP_CAPABILITIES.every((capability) => present.has(`capability:${capability}`)) &&
    VALID_TOOL_IDS.filter((name) => !PARITY_TOOL_NAMES.has(name)).every((name) =>
      present.has(`tool:${name}`),
    )
  );
}

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
  if (
    [
      "crm_create_managed_client",
      "crm_configure_managed_internet_provider",
      "crm_configure_managed_internet_provider_ai",
    ].includes(tool.name) &&
    !auth.platformAdminFull
  ) {
    throw new McpAuthError(-32002, 403, "platform_admin_full_required");
  }
  if (auth.managedPolicy) {
    const managedPolicy = auth.managedPolicy;
    const area = managedAreaOfTool(tool);
    // A managed tenant grants only tools with an audited area, for every role.
    if (!area || !canAccessManagedArea(managedPolicy, auth.role, area)) {
      throw new McpAuthError(-32002, 403, `managed_area_denied:${tool.name}`);
    }
    // Os detalhes B2B agregam entidades de várias áreas. Uma área liberada
    // isoladamente não pode dar leitura ou escrita indireta nas demais.
    const additionalB2bAreas: Partial<Record<string, NavDestinationId[]>> = {
      crm_get_company: ["/app/people", "/app/contacts"],
      crm_get_person: ["/app/companies", "/app/contacts"],
      crm_link_company_person: ["/app/companies"],
      crm_update_company_person: ["/app/companies"],
      crm_link_contact_person: ["/app/contacts"],
      crm_get_import_batch: ["/app/companies", "/app/people", "/app/contacts"],
    };
    if (
      additionalB2bAreas[tool.name]?.some(
        (required) => !canAccessManagedArea(managedPolicy, auth.role, required),
      )
    ) {
      throw new McpAuthError(-32002, 403, `managed_area_denied:${tool.name}`);
    }
  }
  if (!auth.scopes.includes(tool.requiresScope)) {
    throw new McpAuthError(-32002, 403, `scope_missing:${tool.requiresScope}`);
  }

  const granular = auth.scopes.some(
    (scope) =>
      /^[a-z_]+:(read|write)$/.test(scope) &&
      !scope.startsWith("mcp:") &&
      !scope.startsWith("audit:"),
  );
  const requiredDomainScope = domainScope(tool);
  if (granular && !auth.scopes.includes(requiredDomainScope)) {
    throw new McpAuthError(-32002, 403, `scope_missing:${requiredDomainScope}`);
  }

  const allowlisted = auth.scopes.filter((scope) => scope.startsWith("tool:"));
  if (
    allowlisted.length > 0 &&
    !auth.scopes.includes(`tool:${tool.name}`) &&
    !(PARITY_TOOL_NAMES.has(tool.name) && legacyFullPresetForParity(auth.scopes))
  ) {
    throw new McpAuthError(-32002, 403, `not_allowed:${tool.name}`);
  }

  for (const scope of capabilityScopes(tool)) {
    if (!auth.scopes.includes(scope)) {
      throw new McpAuthError(
        -32002,
        403,
        `capability_missing:${scope.slice("capability:".length)}`,
      );
    }
  }
}

/** Routing from tool domain to the same href keys persisted for UI and RLS. */
export function managedAreaOfTool(tool: McpToolDefinition): NavDestinationId | null {
  const exactToolArea: Partial<Record<string, NavDestinationId>> = {
    // Pedidos sincronizados pertencem à integração de loja, não ao catálogo
    // de produtos compartilhado. O token MCP usa service_role e bypassa RLS.
    crm_list_orders: "/app/integrations/nuvemshop",
    crm_get_order: "/app/integrations/nuvemshop",
    crm_list_contact_orders: "/app/integrations/nuvemshop",
    crm_discover_integrations: "/app/integrations/nuvemshop",
    crm_prepare_integration_action: "/app/integrations/nuvemshop",
    crm_describe_external_data: "/app/integracao-dados",
    crm_query_external_data: "/app/integracao-dados",
    crm_get_ai_credential: "/app/ai/credentials",
    crm_list_ai_credentials: "/app/ai/credentials",
    crm_get_ai_model: "/app/ai/providers",
    crm_list_ai_models: "/app/ai/providers",
    crm_get_ai_provider: "/app/ai/providers",
    crm_list_ai_providers: "/app/ai/providers",
    crm_get_jev_status: "/app/ai/atendimento",
    crm_update_channel_pacing: "/app/connections",
    crm_get_channel_admin: "/app/connections",
    crm_get_ai_skill: "/app/ai/skills",
    crm_save_ai_skill: "/app/ai/skills",
    crm_get_ai_skill_import_instructions: "/app/ai/skills",
    crm_validate_agent_ai_configuration: "/app/ai/agents",
    crm_get_notification_sounds: "/app/settings/notifications",
    crm_reset_notification_sound: "/app/settings/notifications",
    crm_get_operational_diagnostics: "/app/settings/tenant",
    crm_list_managed_client_presets: "/app/settings/tenant",
    crm_preflight_managed_client: "/app/settings/tenant",
    crm_create_managed_client: "/app/settings/tenant",
    crm_configure_managed_internet_provider: "/app/settings/tenant",
    crm_configure_managed_internet_provider_ai: "/app/settings/tenant",
    crm_prepare_mcp_token_management: "/app/settings/api-tokens",
    crm_list_message_templates: "/app/templates",
    crm_get_message_template: "/app/templates",
    crm_render_message_template: "/app/templates",
    crm_list_ai_skill_versions: "/app/ai/skills",
    crm_restore_ai_skill_version: "/app/ai/skills",
    crm_list_pipelines: "/app/kanban",
    crm_get_pipeline: "/app/kanban",
    crm_list_stages: "/app/kanban",
    crm_list_at_risk_leads: "/app/radar",
    crm_assign_conversation: "/app/inbox",
    crm_list_messaging_channels: "/app/inbox",
    crm_get_lead_import_instructions: "/app/contacts",
    crm_list_honorarios_contratos: "/app/honorarios",
    crm_list_channel_groups: "/app/connections",
    crm_search_organization_knowledge: "/app/ai/knowledge/sources",
    crm_get_proposal_document: "/app/proposals",
    crm_update_proposal_document_field: "/app/proposals",
    crm_update_proposal_document_section: "/app/proposals",
    crm_create_proposal_revision: "/app/proposals",
    crm_discard_draft_proposal: "/app/proposals",
    crm_list_proposal_templates: "/app/settings/tenant/proposals/modelos",
    crm_get_proposal_template: "/app/settings/tenant/proposals/modelos",
    crm_create_proposal_template: "/app/settings/tenant/proposals/modelos",
    crm_customize_proposal_template: "/app/settings/tenant/proposals/modelos",
    crm_set_proposal_template_visibility: "/app/settings/tenant/proposals/modelos",
    crm_update_proposal_template: "/app/settings/tenant/proposals/modelos",
    crm_deactivate_proposal_template: "/app/settings/tenant/proposals/modelos",
    crm_get_proposal_settings: "/app/settings/tenant/proposals",
    crm_update_proposal_defaults: "/app/settings/tenant/proposals",
    crm_list_proposals: "/app/proposals",
    crm_get_proposal: "/app/proposals",
    crm_update_draft_proposal: "/app/proposals",
    crm_get_honorarios_contrato: "/app/honorarios",
    crm_list_honorarios_parcelas: "/app/honorarios",
    crm_create_honorarios_contrato: "/app/honorarios",
    crm_create_honorarios_parcela: "/app/honorarios",
    crm_get_tags_report: "/app/inbox",
    crm_preparar_proposta: "/app/proposals",
    crm_draft_proposal: "/app/proposals",
    crm_list_companies: "/app/companies",
    crm_get_company: "/app/companies",
    crm_create_company: "/app/companies",
    crm_update_company: "/app/companies",
    crm_list_people: "/app/people",
    crm_get_person: "/app/people",
    crm_create_person: "/app/people",
    crm_update_person: "/app/people",
    crm_link_company_person: "/app/people",
    crm_update_company_person: "/app/people",
    crm_link_contact_person: "/app/people",
    crm_list_import_batches: "/app/imports",
    crm_get_import_batch: "/app/imports",
  };
  const exact = exactToolArea[tool.name];
  if (exact) return exact;
  if (/^crm_(list_tasks|get_task|create_task|update_task)$/.test(tool.name)) return "/app/tasks";
  const areaByDomain: Partial<Record<McpToolDomain, NavDestinationId>> = {
    agents: "/app/ai/agents",
    appointments: "/app/agenda",
    automations: "/app/ai/followups",
    campaigns: "/app/campaigns",
    channels: "/app/connections",
    contacts: "/app/contacts",
    conversations: "/app/inbox",
    followups: "/app/ai/followups",
    knowledge: "/app/ai/knowledge/sources",
    leads: "/app/kanban",
    messages: "/app/inbox",
    pipelines: "/app/settings/tenant/pipelines",
    products: "/app/products",
    routing: "/app/ai/routers",
    team: "/app/team",
    templates: "/app/templates",
    webhooks: "/app/webhooks",
    audit: "/app/audit",
    privacy: "/app/lgpd/requests",
  };
  return areaByDomain[domainOf(tool)] ?? null;
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
