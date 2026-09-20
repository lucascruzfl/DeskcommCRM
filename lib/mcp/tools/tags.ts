import { z } from "zod";

import { ApiError } from "@/lib/api/types";
import { audit } from "@/lib/audit";
import { corDeEtiquetaSchema, tagSchema } from "@/lib/schemas/tags";
import type { McpContext, McpToolDefinition } from "../types";

function ator(ctx: McpContext) {
  return ctx.actor.type === "user"
    ? { actorUserId: ctx.actor.id, actorApiTokenId: null, metadata: { actor_type: "user" } }
    : { actorUserId: null, actorApiTokenId: ctx.apiTokenId, metadata: { actor_type: ctx.actor.type, actor_id: ctx.actor.id, via: "mcp" } };
}

const listShape = { query: z.string().min(1).max(60).optional(), limit: z.number().int().min(1).max(200).default(100) };
export const crmListTagVocabulary: McpToolDefinition<typeof listShape> = {
  name: "crm_list_tag_vocabulary",
  description: "Lista o vocabulário real de tags com cor e contagens separadas de uso em contatos, leads, conversas e automações. Use antes de criar variações ou alterar um nome.",
  inputSchema: listShape, category: "read", requiresRole: "agent", requiresScope: "mcp:read", domain: "contacts",
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase.rpc("fn_vocabulario_de_tags", { p_org: ctx.organizationId });
    if (error) throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
    const q = input.query?.trim().toLocaleLowerCase("pt-BR");
    const tags = ((data ?? []) as Array<Record<string, unknown>>).filter((row) => !q || String(row.tag).toLocaleLowerCase("pt-BR").includes(q)).slice(0, input.limit);
    return { tags, total_returned: tags.length };
  },
};

const updateShape = { tag: tagSchema, new_name: tagSchema.optional(), color: corDeEtiquetaSchema.nullable().optional() };
export const crmUpdateTag: McpToolDefinition<typeof updateShape> = {
  name: "crm_update_tag",
  description: "Renomeia uma tag em todos os contatos, leads, conversas e regras, ou define/remove sua cor. Para juntar duas tags ou excluir use crm_merge_or_delete_tag.",
  inputSchema: updateShape, category: "write", requiresRole: "manager", requiresScope: "mcp:write", domain: "contacts",
  auditResource: (input) => ({ type: "tag", id: input.tag }),
  handler: async (input, ctx) => {
    if ((input.new_name === undefined) === (input.color === undefined)) throw new ApiError(422, "validation_failed", undefined, ctx.requestId, "Informe exatamente new_name ou color.");
    const action = input.new_name !== undefined ? "renomear" : "definir_cor";
    const { data, error } = await ctx.supabase.rpc("fn_vocabulario_de_tags_operar", {
      p_org: ctx.organizationId, p_acao: action, p_tag: input.tag,
      p_destino: input.new_name ?? null, p_cor: input.color ?? null,
    });
    if (error) throw new ApiError(error.code === "22023" ? 422 : 500, error.code === "22023" ? "validation_failed" : "internal_error", undefined, ctx.requestId, error.message);
    const a = ator(ctx);
    await audit({ action: "tag_vocabulary.changed", organizationId: ctx.organizationId, actorUserId: a.actorUserId, actorApiTokenId: a.actorApiTokenId,
      resourceType: "tag", resourceId: input.tag, requestId: ctx.requestId, metadata: { ...a.metadata, action, destination: input.new_name ?? null, color: input.color ?? null } });
    return data;
  },
};

const destructiveShape = { action: z.enum(["merge", "delete"]), tag: tagSchema, destination: tagSchema.optional() };
export const crmMergeOrDeleteTag: McpToolDefinition<typeof destructiveShape> = {
  name: "crm_merge_or_delete_tag",
  description: "Junta uma tag em outra ou a remove de contatos, leads e conversas usando a operação transacional oficial. Exige capability destructive_operations.",
  inputSchema: destructiveShape, category: "write", requiresRole: "manager", requiresScope: "mcp:write", domain: "contacts",
  capabilities: ["destructive_operations"], auditResource: (input) => ({ type: "tag", id: input.tag }),
  handler: async (input, ctx) => {
    if (input.action === "merge" && !input.destination) throw new ApiError(422, "validation_failed", undefined, ctx.requestId, "destination é obrigatório para merge.");
    const action = input.action === "merge" ? "juntar" : "excluir";
    const { data, error } = await ctx.supabase.rpc("fn_vocabulario_de_tags_operar", {
      p_org: ctx.organizationId, p_acao: action, p_tag: input.tag, p_destino: input.destination ?? null, p_cor: null,
    });
    if (error) throw new ApiError(error.code === "22023" ? 422 : 500, error.code === "22023" ? "validation_failed" : "internal_error", undefined, ctx.requestId, error.message);
    const a = ator(ctx);
    await audit({ action: "tag_vocabulary.changed", organizationId: ctx.organizationId, actorUserId: a.actorUserId, actorApiTokenId: a.actorApiTokenId,
      resourceType: "tag", resourceId: input.tag, requestId: ctx.requestId, metadata: { ...a.metadata, action, destination: input.destination ?? null } });
    return data;
  },
};

export const CRM_TAG_TOOLS = [crmListTagVocabulary, crmUpdateTag, crmMergeOrDeleteTag] as const;
