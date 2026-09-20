import { z } from "zod";

import { ApiError } from "@/lib/api/types";
import { getContactHandler, patchContactHandler } from "@/app/api/v1/contacts/_handler";
import { getLeadHandler, updateLeadHandler } from "@/app/api/v1/leads/_handler";
import { validarValoresDeCampos } from "@/lib/leads/custom-field-values";
import type { McpToolDefinition } from "../types";

const shape = {
  target_kind: z.enum(["contact", "lead"]),
  target_id: z.string().uuid(),
  pipeline_id: z.string().uuid().optional().describe("Obrigatório para contato; no lead o funil é resolvido pelo próprio recurso."),
  values: z.record(z.string(), z.unknown()).default({}),
  clear_keys: z.array(z.string().min(1).max(40)).max(50).default([]),
};

export const crmSetCustomFieldValues: McpToolDefinition<typeof shape> = {
  name: "crm_set_custom_field_values",
  description:
    "Define ou limpa valores de campos personalizados em contato ou lead, validando a definição real do funil (texto, número, booleano, data, select, multiselect, email, telefone e URL). Para contatos informe pipeline_id.",
  inputSchema: shape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  domain: "leads",
  auditResource: (input) => ({ type: input.target_kind, id: input.target_id }),
  handler: async (input, ctx) => {
    if (Object.keys(input.values).length === 0 && input.clear_keys.length === 0) {
      throw new ApiError(422, "validation_failed", undefined, ctx.requestId, "Informe values ou clear_keys.");
    }
    let pipelineId = input.pipeline_id;
    let current: Record<string, unknown> = {};
    if (input.target_kind === "lead") {
      const lead = await getLeadHandler(ctx.supabase, { organization_id: ctx.organizationId, actor: ctx.actor, requestId: ctx.requestId }, input.target_id);
      pipelineId = String(lead.pipeline_id);
      current = (lead.custom_fields as Record<string, unknown> | null) ?? {};
    } else {
      if (!pipelineId) throw new ApiError(422, "validation_failed", undefined, ctx.requestId, "pipeline_id é obrigatório para contato.");
      const contact = await getContactHandler(ctx.supabase, { organization_id: ctx.organizationId, actor: ctx.actor, requestId: ctx.requestId }, { contactId: input.target_id, decryptPurpose: null });
      current = contact.custom_fields ?? {};
    }
    const { data: pipeline, error } = await ctx.supabase.from("crm_pipelines").select("settings")
      .eq("organization_id", ctx.organizationId).eq("id", pipelineId!).maybeSingle();
    if (error) throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
    if (!pipeline) throw new ApiError(404, "not_found", undefined, ctx.requestId, "Funil não encontrado.");
    let patch: Record<string, unknown>;
    try { patch = validarValoresDeCampos(pipeline.settings as Record<string, unknown> | null, input.values, input.clear_keys); }
    catch (error_) { throw new ApiError(422, "validation_failed", undefined, ctx.requestId, error_ instanceof Error ? error_.message : "Valor inválido."); }
    if (input.target_kind === "lead") {
      const lead = await updateLeadHandler(ctx.supabase, { organization_id: ctx.organizationId, actor: ctx.actor, requestId: ctx.requestId }, input.target_id, { custom_fields: patch });
      return { target_kind: "lead", target_id: input.target_id, custom_fields: lead.custom_fields };
    }
    const next = { ...current, ...patch };
    const contact = await patchContactHandler(ctx.supabase, { organization_id: ctx.organizationId, actor: ctx.actor, requestId: ctx.requestId }, input.target_id, { custom_fields: next });
    return { target_kind: "contact", target_id: input.target_id, custom_fields: contact.custom_fields };
  },
};
