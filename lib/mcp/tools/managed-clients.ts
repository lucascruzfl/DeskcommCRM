import { MANAGED_CLIENT_PRESETS, managedPresetAreas } from "@/lib/managed-clients/presets";
import { managedClientPreflightSchema, preflightManagedClient } from "@/lib/managed-clients/preflight";
import type { McpToolDefinition } from "../types";

export const MANAGED_CLIENT_TOOLS: ReadonlyArray<McpToolDefinition> = [
  {
    name: "crm_list_managed_client_presets",
    description: "Lista presets estruturados de clientes gerenciados e informa se a criação está liberada. Não altera dados.",
    inputSchema: {},
    category: "read",
    requiresRole: "agent",
    requiresScope: "mcp:read",
    domain: "settings",
    handler: async () => Object.values(MANAGED_CLIENT_PRESETS).map((preset) => ({
      id: preset.id,
      version: preset.version,
      business_type: preset.business_type,
      management_mode: preset.management_mode,
      label: preset.label,
      executable: preset.executable,
      areas: managedPresetAreas(preset.id),
    })),
  },
  {
    name: "crm_preflight_managed_client",
    description: "Mostra o plano e os bloqueios para uma clínica de estética gerenciada, sem criar organização, vínculo ou convite. Enquanto a autorização granular não estiver fechada, can_execute é sempre false.",
    inputSchema: managedClientPreflightSchema.shape,
    category: "read",
    requiresRole: "agent",
    requiresScope: "mcp:read",
    domain: "settings",
    redigirParaAuditoria: (args) => ({
      business_type: args.business_type,
      management_mode: args.management_mode,
      override_count: Array.isArray(args.overrides) ? args.overrides.length : 0,
    }),
    handler: async (input, ctx) => preflightManagedClient(managedClientPreflightSchema.parse(input), {
      proposed_manager_id: ctx.provisionedByUserId ?? null,
      request_id: ctx.requestId,
    }),
  },
];
