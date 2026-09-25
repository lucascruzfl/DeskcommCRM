import type { Role } from "@/lib/auth/types";
import { NAV_CATALOG, type NavDestinationId } from "@/lib/navigation/catalogo";
import { MANAGED_CLIENT_PRESETS, type ManagedAreaClass, type ManagedPresetId } from "./presets";

export interface ManagedAreaPolicy {
  business_type: string;
  management_mode: "managed";
  preset_id: ManagedPresetId;
  preset_version: string;
  /** Full snapshot: a migration and the app resolve the same tenant policy. */
  areas: Record<NavDestinationId, ManagedAreaClass>;
  overrides: Partial<Record<NavDestinationId, ManagedAreaClass>>;
}

const AREA_IDS = new Set<string>(NAV_CATALOG.map((area) => area.href));
const CLASSES = new Set<ManagedAreaClass>(["client", "agency", "shared", "not_applicable"]);

export function buildManagedAreaPolicy(
  presetId: ManagedPresetId,
  overrides: ReadonlyArray<{ href: NavDestinationId; classification: ManagedAreaClass }> = [],
): ManagedAreaPolicy {
  const preset = MANAGED_CLIENT_PRESETS[presetId];
  if (!preset) throw new Error("managed_preset_not_found");
  const unique = new Set<string>();
  const overrideMap: Partial<Record<NavDestinationId, ManagedAreaClass>> = {};
  for (const override of overrides) {
    if (!AREA_IDS.has(override.href) || !CLASSES.has(override.classification) || unique.has(override.href)) {
      throw new Error("invalid_managed_area_override");
    }
    unique.add(override.href);
    overrideMap[override.href] = override.classification;
  }
  return {
    business_type: preset.business_type,
    management_mode: preset.management_mode,
    preset_id: preset.id,
    preset_version: preset.version,
    areas: { ...preset.areas, ...overrideMap },
    overrides: overrideMap,
  };
}

/** Legacy tenants have no policy and keep their existing authorization. */
export function canAccessManagedArea(
  policy: ManagedAreaPolicy | null | undefined,
  role: Role | null,
  href: NavDestinationId,
): boolean {
  if (!policy) return true;
  // The persisted snapshot is the authority. Version identifies the policy
  // applied at onboarding; a later code release must not silently revoke it.
  if (!role || policy.management_mode !== "managed") return false;
  const classification = policy.areas[href];
  if (!CLASSES.has(classification)) return false;
  if (classification === "not_applicable") return false;
  if (classification === "agency") return role === "admin";
  return true;
}

/** Longest path wins, so /app/ai/cases/avisos cannot inherit /app/ai/cases. */
export function managedAreaForPath(pathname: string): NavDestinationId | null {
  // Detail URLs from older modules live outside the navigation href prefix.
  // They still belong to the same canonical destination permission.
  if (pathname === "/app/pipelines" || pathname.startsWith("/app/pipelines/")) return "/app/kanban";
  if (pathname === "/app/leads" || pathname.startsWith("/app/leads/")) return "/app/kanban";
  if (pathname === "/app/settings/canal-oficial" || pathname === "/app/settings/templates") return "/app/connections";
  return (NAV_CATALOG.map((area) => area.href)
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0] ?? null) as NavDestinationId | null;
}

/** Existing route/action resource identifiers are routed to the canonical href. */
const RESOURCE_AREAS: Readonly<Record<string, NavDestinationId>> = {
  agenda: "/app/agenda",
  agent_cases: "/app/ai/cases",
  agent_inbox_items: "/app/inbox",
  attendant_availability: "/app/team",
  calendar_connections: "/app/agenda",
  calendar_event_types: "/app/settings/tenant/agenda",
  catalog_products: "/app/products",
  contact: "/app/contacts",
  contacts: "/app/contacts",
  conversation_media: "/app/inbox",
  conversation_notes: "/app/inbox",
  conversations: "/app/inbox",
  crm_leads: "/app/kanban",
  crm_pipelines: "/app/kanban",
  crm_stages: "/app/settings/tenant/pipelines",
  crm_tasks: "/app/tasks",
  demandas: "/app/radar",
  financeiro: "/app/settings/tenant/financeiro",
  interface: "/app/settings/profile",
  lead_captures: "/app/webhooks",
  leads_at_risk: "/app/radar",
  lgpd_requests: "/app/lgpd/requests",
  message_templates: "/app/templates",
  messages: "/app/inbox",
  metrics: "/app/metrics",
  passagens_de_atendimento: "/app/inbox",
  pipeline_stages: "/app/settings/tenant/pipelines",
  pipelines: "/app/kanban",
  push_subscriptions: "/app/settings/notifications",
  reports: "/app/metrics",
  settings_tags: "/app/settings/tags",
  system_instalacao: "/app/settings/tenant",
  system_instalacao_provar: "/app/ai/credentials",
  system_relogio_tick: "/app/settings/tenant",
  team: "/app/team",
  voice_calls: "/app/calls",
  ai_operator_metrics: "/app/ai/agents",
  ai_agents: "/app/ai/agents",
  ai_agents_assignable: "/app/kanban",
  ai_agents_operational_status: "/app/inbox",
  ai_guardrail_layers: "/app/ai/agents",
  ai_routers: "/app/ai/routers",
  ai_credentials: "/app/ai/credentials",
  ai_providers: "/app/ai/providers",
  ai_knowledge: "/app/ai/knowledge/sources",
  org_memory: "/app/ai/memory",
  ai_skills: "/app/ai/skills",
  ai_runs: "/app/ai/runs",
  ai_usage: "/app/ai/usage",
  ai_budget: "/app/ai/usage",
  ai_evolution: "/app/ai/evolution",
  ai_style_adjustments: "/app/ai/evolution",
  flywheel_proposals: "/app/ai/proposals",
  followup_flows: "/app/ai/followups",
  followup_enrollments: "/app/ai/followups",
  followup_queue: "/app/ai/followups",
  followup_promises: "/app/ai/followups",
  automation_rules: "/app/ai/followups",
  campaign_settings: "/app/campaigns",
  campaign_suppressions: "/app/campaigns",
  campaign_templates: "/app/campaigns",
  campaigns: "/app/campaigns",
  webhook_sources: "/app/webhooks",
  ads_insights: "/app/ads/meta",
  ad_platform_connections: "/app/settings/meta-ads",
  config_aviso_de_caso: "/app/ai/cases/avisos",
  api_tokens: "/app/settings/api-tokens",
  audit: "/app/audit",
  prospecting: "/app/prospecting",
  extension_installations: "/app/extensions",
  extension_operations: "/app/extensions",
  organization_extensions: "/app/extensions",
  external_db_connections: "/app/integracao-dados",
  voip_trunk_settings: "/app/settings/voip-trunk",
  channel_sessions: "/app/connections",
  channels_graph_partner: "/app/connections",
  channels_official: "/app/connections",
  channels_official_webhook: "/app/connections",
  channels_partner: "/app/connections",
  channels_templates: "/app/connections",
  channel_templates: "/app/connections",
  channel_templates_read: "/app/inbox",
  channels_graph_partner_templates_read: "/app/inbox",
  channels_graph_partner_templates: "/app/connections",
  social_connections: "/app/connections",
  phone_numbers: "/app/connections",
  org_voice_calls: "/app/connections",
  pipeline_agent_mapping: "/app/ai/agents",
  settings_routing: "/app/settings/atendimento",
  channel_knobs: "/app/connections",
};

export function managedAreaForResource(resource: string | undefined): NavDestinationId | null {
  return resource ? RESOURCE_AREAS[resource] ?? null : null;
}
