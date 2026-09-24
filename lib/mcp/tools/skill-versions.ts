import { z } from "zod";

import { audit } from "@/lib/audit";
import { ApiError } from "@/lib/api/types";
import { insertSkillVersion, setSkillPointer, skillMatcherSchema, validateSkillBody } from "@/lib/agent-engine/agent/skills";
import { getSkillsPool } from "@/lib/ai/skills/db";
import type { McpToolDefinition } from "@/lib/mcp/types";

const name = z.string().min(1).max(120);
const getShape = { name };
const saveShape = {
  name,
  description: z.string().trim().min(1).max(500).regex(/^[^\r\n]*$/),
  body: z.string().min(1).max(60_000),
  matcher: skillMatcherSchema,
};
const listShape = { name };
const restoreShape = { name, version_id: z.string().uuid() };


export const crmGetAiSkill: McpToolDefinition<typeof getShape> = {
  name: "crm_get_ai_skill",
  description: "Consulta o conteúdo da skill instalada nesta organização, sua versão e se possui pacote. Requer manager porque o procedimento é configuração operacional.",
  inputSchema: getShape,
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  domain: "ai",
  publicProfile: true,
  handler: async (input, ctx) => {
    const { data: pointer, error: pointerError } = await ctx.supabase
      .from("skill_pointers")
      .select("version_id, updated_at")
      .eq("organization_id", ctx.organizationId)
      .eq("name", input.name)
      .maybeSingle();
    if (pointerError) throw new ApiError(500, "internal_error", undefined, ctx.requestId);
    if (!pointer) throw new ApiError(404, "not_found", undefined, ctx.requestId);
    const { data: version, error } = await ctx.supabase
      .from("skill_versions")
      .select("id, name, description, body, matcher, manifest")
      .eq("id", pointer.version_id)
      .eq("organization_id", ctx.organizationId)
      .eq("name", input.name)
      .maybeSingle();
    if (error) throw new ApiError(500, "internal_error", undefined, ctx.requestId);
    if (!version) throw new ApiError(404, "not_found", undefined, ctx.requestId);
    return {
      name: version.name,
      description: version.description,
      body: version.body,
      matcher: version.matcher,
      version_id: version.id,
      updated_at: pointer.updated_at,
      tem_arquivos_do_pacote: Array.isArray(version.manifest) && version.manifest.length > 0,
    };
  },
};

export const crmSaveAiSkill: McpToolDefinition<typeof saveShape> = {
  name: "crm_save_ai_skill",
  description: "Salva uma nova versão de uma skill já instalada nesta organização e a ativa. Recusa skills com arquivos de pacote, que precisam de novo upload humano. Requer capacidade de publicação.",
  inputSchema: saveShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "ai",
  capabilities: ["agent_publication"],
  publicProfile: true,
  auditResource: (_input, result) => ({ type: "skill_versions", id: (result as { version_id?: string })?.version_id }),
  redigirParaAuditoria: (args) => ({ name: args.name, description_length: String(args.description ?? "").length, body_length: String(args.body ?? "").length }),
  handler: async (input, ctx) => {
    const { data: pointer, error: pointerError } = await ctx.supabase
      .from("skill_pointers")
      .select("version_id")
      .eq("organization_id", ctx.organizationId)
      .eq("name", input.name)
      .maybeSingle();
    if (pointerError) throw new ApiError(500, "internal_error", undefined, ctx.requestId);
    if (!pointer) throw new ApiError(404, "not_found", undefined, ctx.requestId);
    const { data: current, error } = await ctx.supabase
      .from("skill_versions")
      .select("manifest")
      .eq("id", pointer.version_id)
      .eq("organization_id", ctx.organizationId)
      .eq("name", input.name)
      .maybeSingle();
    if (error) throw new ApiError(500, "internal_error", undefined, ctx.requestId);
    if (!current) throw new ApiError(404, "not_found", undefined, ctx.requestId);
    if (Array.isArray(current.manifest) && current.manifest.length > 0)
      throw new ApiError(409, "state_conflict", undefined, ctx.requestId, "Skill com arquivos de pacote exige novo upload humano.");
    try { validateSkillBody(input.body); }
    catch { throw new ApiError(422, "validation_failed", undefined, ctx.requestId); }
    let versionId: string;
    try {
      const pool = getSkillsPool();
      const version = await insertSkillVersion(pool, {
        tenantId: ctx.organizationId,
        name: input.name,
        description: input.description,
        body: input.body,
        matcher: input.matcher,
      });
      await setSkillPointer(pool, { tenantId: ctx.organizationId, name: input.name, versionId: version.id });
      versionId = version.id;
    } catch { throw new ApiError(500, "internal_error", undefined, ctx.requestId); }
    await audit({
      action: "ai.skill_saved",
      actorUserId: ctx.actor.type === "user" ? ctx.actor.id : (ctx.provisionedByUserId ?? null),
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "skill_versions",
      resourceId: versionId,
      requestId: ctx.requestId,
      metadata: { name: input.name, keywords: input.matcher.any_keywords.length, via: "mcp" },
    });
    return { name: input.name, version_id: versionId };
  },
};

export const crmListAiSkillVersions: McpToolDefinition<typeof listShape> = {
  name: "crm_list_ai_skill_versions",
  description: "Lista versões imutáveis de uma skill desta organização e indica a versão ativa, sem devolver corpo ou segredo. Use antes de restaurar.",
  inputSchema: listShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  domain: "ai",
  publicProfile: true,
  handler: async (input, ctx) => {
    const { data: pointer, error: pointerError } = await ctx.supabase
      .from("skill_pointers")
      .select("version_id")
      .eq("organization_id", ctx.organizationId)
      .eq("name", input.name)
      .maybeSingle();
    if (pointerError) throw new ApiError(500, "internal_error", undefined, ctx.requestId);
    const { data: versions, error } = await ctx.supabase
      .from("skill_versions")
      .select("id, created_at, forked_from_version_id")
      .eq("organization_id", ctx.organizationId)
      .eq("name", input.name)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new ApiError(500, "internal_error", undefined, ctx.requestId);
    return {
      versions: (versions ?? []).map((v) => ({
        id: v.id,
        created_at: v.created_at,
        forked_from_version_id: v.forked_from_version_id,
        atual: v.id === pointer?.version_id,
      })),
    };
  },
};

export const crmRestoreAiSkillVersion: McpToolDefinition<typeof restoreShape> = {
  name: "crm_restore_ai_skill_version",
  description: "Restaura uma versão existente de skill da mesma organização e nome. Muda o ponteiro ativo sem criar versão, seguindo o serviço oficial. Requer capacidade de publicação de agente.",
  inputSchema: restoreShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "ai",
  capabilities: ["agent_publication"],
  publicProfile: true,
  auditResource: (input) => ({ type: "skill_versions", id: input.version_id }),
  handler: async (input, ctx) => {
    const { data: version, error } = await ctx.supabase
      .from("skill_versions")
      .select("id")
      .eq("id", input.version_id)
      .eq("organization_id", ctx.organizationId)
      .eq("name", input.name)
      .maybeSingle();
    if (error) throw new ApiError(500, "internal_error", undefined, ctx.requestId);
    if (!version) throw new ApiError(404, "not_found", undefined, ctx.requestId);
    try {
      await setSkillPointer(getSkillsPool(), {
        tenantId: ctx.organizationId,
        name: input.name,
        versionId: input.version_id,
      });
    } catch {
      throw new ApiError(500, "internal_error", undefined, ctx.requestId);
    }
    await audit({
      action: "ai.skill_restored",
      actorUserId: ctx.actor.type === "user" ? ctx.actor.id : (ctx.provisionedByUserId ?? null),
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "skill_versions",
      resourceId: input.version_id,
      requestId: ctx.requestId,
      metadata: { name: input.name, via: "mcp" },
    });
    return { name: input.name, version_id: input.version_id };
  },
};

export const SKILL_VERSION_MCP_TOOLS = [crmGetAiSkill, crmListAiSkillVersions, crmSaveAiSkill, crmRestoreAiSkillVersion] as const;
