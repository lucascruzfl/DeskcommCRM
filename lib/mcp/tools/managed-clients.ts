import { MANAGED_CLIENT_PRESETS, managedPresetForBusinessType, managedPresetAreas } from "@/lib/managed-clients/presets";
import { managedClientPreflightSchema } from "@/lib/managed-clients/preflight";
import { managedOnboardingSchema, managedOnboardingService } from "@/lib/managed-clients/onboarding";
import { ispPackageService } from "@/lib/managed-clients/isp-package";
import { ispAiInputSchema, ispAiService } from "@/lib/managed-clients/isp-ai";
import { z } from "zod";
import type { McpToolDefinition } from "../types";
import type { McpContext } from "../types";

function onboardingActor(ctx: McpContext) {
  return {
    userId: ctx.actor?.type === "api_token" ? ctx.provisionedByUserId ?? null : null,
    sourceOrganizationId: ctx.organizationId,
    apiTokenId: ctx.apiTokenId,
    requestId: ctx.requestId,
  };
}

const createSchema = managedOnboardingSchema.extend({ confirm: z.boolean().default(false) });
const ispSchema = z.object({ confirm: z.boolean().default(false) }).strict();

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
    description: "Mostra o plano e os bloqueios para um cliente gerenciado, sem criar organização, vínculo ou convite. can_execute informa elegibilidade, não executa.",
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
    handler: async (input, ctx) => {
      const parsed = managedClientPreflightSchema.parse(input);
      const current = await managedOnboardingService.preflight({
        organization_name: parsed.name, preset: managedPresetForBusinessType(parsed.business_type).id,
        client_email: parsed.client_email, slug: parsed.slug,
      }, onboardingActor(ctx));
      const overridesConflict = parsed.overrides.length ? ["overrides_not_supported_for_execution"] : [];
      return {
        ...current,
        request_id: ctx.requestId,
        business_type: parsed.business_type,
        management_mode: parsed.management_mode,
        overrides: parsed.overrides,
        conflicts: [...current.conflicts, ...overridesConflict],
        can_execute: current.can_execute && overridesConflict.length === 0,
      };
    },
  },
  {
    name: "crm_create_managed_client",
    description: "Conferir ou criar um cliente gerenciado. Sem confirm=true devolve apenas preflight. Exige platform_admin full atual e capability:managed_client_onboarding.",
    inputSchema: createSchema.shape,
    category: "write",
    requiresRole: "manager",
    requiresScope: "mcp:write",
    domain: "settings",
    capabilities: ["managed_client_onboarding"],
    redigirParaAuditoria: (args) => ({
      preset: args.preset,
      confirm: args.confirm === true,
      idempotency_key_present: typeof args.idempotency_key === "string",
    }),
    auditResource: (_args, result) => ({
      type: "organization",
      id: result && typeof result === "object" && "organization_id" in result
        ? String(result.organization_id) : null,
    }),
    handler: async (input, ctx) => {
      const parsed = createSchema.parse(input);
      const { confirm, ...request } = parsed;
      return managedOnboardingService.execute(request, onboardingActor(ctx), confirm);
    },
  },
  {
    name: "crm_configure_managed_internet_provider",
    description: "Planeja ou aplica o pacote operacional 7B no provedor de internet gerenciado vinculado ao token MCP. Sem confirm=true mostra conflitos e pendências. Exige platform_admin full, vínculo admin atual no cliente e capability:managed_client_onboarding.",
    inputSchema: ispSchema.shape,
    category: "write",
    requiresRole: "manager",
    requiresScope: "mcp:write",
    domain: "settings",
    capabilities: ["managed_client_onboarding"],
    redigirParaAuditoria: (args) => ({ confirm: args.confirm === true }),
    auditResource: (_args, result) => ({ type: "organization",
      id: result && typeof result === "object" && "organization_id" in result
        ? String(result.organization_id) : null }),
    handler: async (input, ctx) => {
      const parsed = ispSchema.parse(input);
      return ispPackageService.execute(ctx.organizationId, onboardingActor(ctx), parsed.confirm);
    },
  },
  {
    name: "crm_configure_managed_internet_provider_ai",
    description: "Confere ou prepara em draft cinco agentes ISP, Intent Router inativo e follow-ups internos com prazos explícitos. Nunca publica, ativa ou envia mensagem.",
    inputSchema: ispAiInputSchema.shape,
    category: "write",
    requiresRole: "manager",
    requiresScope: "mcp:write",
    domain: "settings",
    capabilities: ["managed_client_onboarding"],
    redigirParaAuditoria: (args) => ({ confirm: args.confirm === true,
      ai_config_present: Boolean(args.ai), followup_keys: Object.keys(args.followups ?? {}) }),
    auditResource: (_args, result) => ({ type: "organization",
      id: result && typeof result === "object" && "organization_id" in result
        ? String(result.organization_id) : null }),
    handler: async (input, ctx) => {
      if (ctx.actor.type === "ai_agent") throw new Error("managed_isp_ai_requires_person");
      return ispAiService.execute(ctx.organizationId, onboardingActor(ctx), input);
    },
  },
];
