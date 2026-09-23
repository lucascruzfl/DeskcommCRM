import { z } from "zod";

import { audit } from "@/lib/audit";
import { ApiError } from "@/lib/api/types";
import { setSkillPointer } from "@/lib/agent-engine/agent/skills";
import { getSkillsPool } from "@/lib/ai/skills/db";
import type { McpToolDefinition } from "@/lib/mcp/types";

const name = z.string().min(1).max(120);
const listShape = { name };
const restoreShape = { name, version_id: z.string().uuid() };

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

export const SKILL_VERSION_MCP_TOOLS = [crmListAiSkillVersions, crmRestoreAiSkillVersion] as const;
