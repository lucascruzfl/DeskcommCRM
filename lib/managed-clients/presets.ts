import { NAV_CATALOG, type NavDestinationId } from "@/lib/navigation/catalogo";

export type ManagedAreaClass = "client" | "agency" | "shared" | "not_applicable";

/**
 * Intenção de produto, não uma concessão de acesso. O catálogo de navegação é
 * a fonte das áreas; Record<NavDestinationId, ...> obriga revisar o preset
 * sempre que uma área nova for adicionada ao CRM.
 */
const aestheticClinicAreas = {
  "/app/prospecting": "not_applicable",
  "/app/inbox": "client",
  "/app/radar": "client",
  "/app/agenda": "client",
  "/app/templates": "client",
  "/app/kanban": "client",
  "/app/campaigns": "agency",
  "/app/contacts": "client",
  "/app/tasks": "client",
  "/app/calls": "shared",
  "/app/products": "shared",
  "/app/settings/tenant/agenda": "shared",
  "/app/comandas": "client",
  "/app/settings/tenant/financeiro": "shared",
  "/app/settings/tenant/pipelines": "agency",
  "/app/ai/agents": "agency",
  "/app/ai/followups": "agency",
  "/app/ai/routers": "agency",
  "/app/ai/credentials": "agency",
  "/app/ai/providers": "agency",
  "/app/ai/knowledge/sources": "agency",
  "/app/ai/memory": "agency",
  "/app/ai/skills": "agency",
  "/app/ai/cases": "shared",
  "/app/ai/inbox": "shared",
  "/app/ai/cases/avisos": "agency",
  "/app/ai/proposals": "agency",
  "/app/ai/runs": "agency",
  "/app/ai/usage": "agency",
  "/app/connections": "agency",
  "/app/integrations/nuvemshop": "not_applicable",
  "/app/webhooks": "agency",
  "/app/faturamento": "client",
  "/app/metrics": "client",
  "/app/ads/meta": "agency",
  "/app/activities": "client",
  "/app/ai/evolution": "agency",
  "/app/audit": "agency",
  "/app/settings/profile": "client",
  "/app/settings/security": "client",
  "/app/settings/notifications": "client",
  "/app/team": "shared",
  "/app/settings/atendimento": "agency",
  "/app/settings/tags": "agency",
  "/app/settings/tenant": "agency",
  "/app/settings/conversoes": "agency",
  "/app/settings/meta-ads": "agency",
  "/app/settings/marca": "agency",
  "/app/settings/billing": "agency",
  "/app/lgpd/requests": "shared",
  "/app/settings/api-tokens": "agency",
  "/app/settings/voip-trunk": "agency",
  "/app/extensions": "agency",
  "/app/integracao-dados": "agency",
} as const satisfies Record<NavDestinationId, ManagedAreaClass>;

export const MANAGED_CLIENT_PRESETS = {
  "managed/aesthetic-clinic": {
    id: "managed/aesthetic-clinic",
    version: "1.0.0",
    business_type: "aesthetic_clinic",
    management_mode: "managed",
    label: "Clínica de estética — gerenciada",
    proposed_client_role: "agent",
    agency_manager_role: "admin",
    /** A aplicação do perfil fica bloqueada até todas as superfícies usarem a política. */
    executable: false,
    areas: aestheticClinicAreas,
  },
} as const;

export type ManagedPresetId = keyof typeof MANAGED_CLIENT_PRESETS;

export function managedPresetAreas(id: ManagedPresetId) {
  const preset = MANAGED_CLIENT_PRESETS[id];
  return NAV_CATALOG.map((area) => ({
    href: area.href,
    label: area.label,
    function: area.description,
    group: area.group,
    existing_min_role: "minRole" in area ? area.minRole : "viewer",
    classification: preset.areas[area.href],
  }));
}
