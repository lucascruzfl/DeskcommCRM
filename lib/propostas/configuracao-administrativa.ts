import type { SupabaseClient } from "@supabase/supabase-js";
import type { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import { ApiError } from "@/lib/api/types";
import { audit } from "@/lib/audit";
import { proposalAuditActor } from "./administracao-audit";

export const proposalsSettingsSchema = z.object({
  enabled: z.boolean(),
  default_valid_days: z.number().int().positive().max(365),
  default_conditions: z.string().max(4000).nullable(),
  followup_dias: z.number().int().positive().max(365).optional(),
  avisar_no_whatsapp: z.boolean().optional(),
});
// Exclui ativação, WhatsApp e automação: apenas padrões comerciais internos.
export const proposalDefaultsSchema = proposalsSettingsSchema
  .pick({ default_valid_days: true, default_conditions: true })
  .strict();

export async function getProposalSettingsHandler(db: SupabaseClient, ctx: HandlerCtx) {
  const { data } = await db
    .from("organizations")
    .select("settings")
    .eq("id", ctx.organization_id)
    .single();
  const proposals = (data?.settings as Record<string, unknown> | null)?.proposals as Record<
    string,
    unknown
  > | null;
  return {
    followup_dias: 3,
    avisar_no_whatsapp: true,
    ...(proposals ?? { enabled: false, default_valid_days: 15, default_conditions: null }),
  };
}

/** A borda HTTP passa o schema completo; MCP passa somente defaults validados. */
export async function updateProposalSettingsHandler(
  db: ReturnType<typeof createAdminClient>,
  ctx: HandlerCtx,
  input: z.infer<typeof proposalsSettingsSchema> | z.infer<typeof proposalDefaultsSchema>,
) {
  const { data: atual, error: readError } = await db
    .from("organizations")
    .select("settings")
    .eq("id", ctx.organization_id)
    .single();
  if (readError || !atual)
    throw new ApiError(
      500,
      "internal_error",
      undefined,
      ctx.requestId,
      "Falha ao consultar configuração.",
    );
  const settingsAtual = (atual?.settings as Record<string, unknown> | null) ?? {};
  const proposalsAtual = (settingsAtual.proposals as Record<string, unknown> | null) ?? {};
  const { error } = await db
    .from("organizations")
    .update({ settings: { ...settingsAtual, proposals: { ...proposalsAtual, ...input } } })
    .eq("id", ctx.organization_id);
  if (error)
    throw new ApiError(500, "internal_error", undefined, ctx.requestId, "Falha ao salvar.");
  void audit({
    action: "proposals.config_changed",
    ...proposalAuditActor(ctx),
    organizationId: ctx.organization_id,
    resourceType: "organization",
    resourceId: ctx.organization_id,
    requestId: ctx.requestId,
    metadata: { fields_changed: Object.keys(input).sort() },
  });
  return input;
}
