import { createHash } from "node:crypto";
import { z } from "zod";
import { NAV_CATALOG, type NavDestinationId } from "@/lib/navigation/catalogo";
import { MANAGED_CLIENT_PRESETS, managedPresetAreas } from "./presets";

const hrefs = NAV_CATALOG.map((area) => area.href) as [NavDestinationId, ...NavDestinationId[]];

export const managedClientPreflightSchema = z.object({
  business_type: z.literal("aesthetic_clinic"),
  management_mode: z.literal("managed"),
  name: z.string().trim().min(2).max(120),
  slug: z.string().min(2).max(40).regex(/^[a-z0-9-]+$/),
  client_email: z.string().trim().email().transform((email) => email.toLowerCase()),
  overrides: z.array(z.object({
    href: z.enum(hrefs),
    classification: z.enum(["client", "agency", "shared", "not_applicable"]),
  }).strict()).max(hrefs.length).default([]),
}).strict();

export type ManagedClientPreflightInput = z.input<typeof managedClientPreflightSchema>;

/** Planejamento puro: sem leitura cross-tenant nem mutação. */
export function preflightManagedClient(input: ManagedClientPreflightInput, opts: {
  proposed_manager_id: string | null;
  request_id?: string;
}) {
  const parsed = managedClientPreflightSchema.parse(input);
  const preset = MANAGED_CLIENT_PRESETS["managed/aesthetic-clinic"];
  const duplicated = parsed.overrides.map((o) => o.href)
    .filter((href, index, all) => all.indexOf(href) !== index);
  const overrides = [...parsed.overrides].sort((a, b) => a.href.localeCompare(b.href));
  const plan = {
    name: parsed.name,
    slug: parsed.slug,
    client_email: parsed.client_email,
    proposed_manager_id: opts.proposed_manager_id,
    preset_id: preset.id,
    preset_version: preset.version,
    overrides,
  };
  const plan_id = createHash("sha256").update(JSON.stringify(plan)).digest("hex");
  const changes = new Map(overrides.map((o) => [o.href, o.classification]));
  const areas = managedPresetAreas(preset.id).map((area) => ({
    ...area,
    classification: changes.get(area.href) ?? area.classification,
  }));
  const conflicts = [
    ...(duplicated.length ? ["duplicate_override"] : []),
    ...(overrides.length ? ["overrides_not_enforced"] : []),
    "slug_uniqueness_not_checked",
    "agency_manager_membership_not_verified",
    "managed_backend_authorization_incomplete",
    "technical_rls_read_exposure",
    "managed_creation_not_available",
  ];

  return {
    plan_id,
    request_id: opts.request_id ?? null,
    name: parsed.name,
    slug: parsed.slug,
    business_type: preset.business_type,
    management_mode: preset.management_mode,
    preset: { id: preset.id, version: preset.version, label: preset.label },
    client: { email: parsed.client_email, proposed_role: preset.proposed_client_role },
    agency_manager: {
      proposed_user_id: opts.proposed_manager_id,
      source: "token_provisioner_unverified",
      role: preset.agency_manager_role,
    },
    client_areas: areas.filter((area) => area.classification === "client"),
    agency_areas: areas.filter((area) => area.classification === "agency"),
    shared_areas: areas.filter((area) => area.classification === "shared"),
    not_applicable_areas: areas.filter((area) => area.classification === "not_applicable"),
    overrides,
    human_actions: ["Aceitar o convite", "Confirmar o e-mail se a conta ainda não estiver verificada"],
    conflicts,
    can_execute: false as const,
    recommended_action: "Fechar autorização por área em página, API, server action, MCP e RLS antes de criar clientes gerenciados.",
  };
}
