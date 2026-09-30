import { z } from "zod";

import { McpToolError } from "@/lib/mcp/errors";
import type { McpToolDefinition } from "@/lib/mcp/types";

const shape = {
  router_id: z.string().uuid(),
  message: z.string().trim().min(1).max(4000),
};
const getShape = { router_id: z.string().uuid() };

export const crmGetAiRouter: McpToolDefinition<typeof getShape> = {
  name: "crm_get_ai_router",
  description: "Consulta router de IA e suas intenções no tenant do token, inclusive quando está em rascunho.",
  inputSchema: getShape,
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  domain: "routing",
  handler: async (raw, ctx) => {
    const input = z.strictObject(getShape).parse(raw);
    const { data: router, error } = await ctx.supabase.from("ai_routers")
      .select("id,name,channel_session_id,is_active,config,fallback_agent_id")
      .eq("organization_id", ctx.organizationId).eq("id", input.router_id).maybeSingle();
    if (error) throw new McpToolError("provider_unavailable", "router_read_unavailable");
    if (!router) throw new McpToolError("not_found", "router_not_found");
    const { data: members, error: memberError } = await ctx.supabase.from("ai_router_members")
      .select("id,agent_id,intent_name,intent_description,examples,flow_pointer_id,position")
      .eq("organization_id", ctx.organizationId).eq("router_id", input.router_id)
      .order("position", { ascending: true });
    if (memberError) throw new McpToolError("provider_unavailable", "router_members_read_unavailable");
    return { router, members: members ?? [] };
  },
};

/** Mesmo classificador e mesma régua do turno; router draft não precisa ser ativado. */
export const crmTestAiRouter: McpToolDefinition<typeof shape> = {
  name: "crm_test_ai_router",
  description: "Testa uma mensagem no Intent Router, inclusive draft, sem conversa ou envio ao canal. A classificação pode consumir o modelo configurado.",
  inputSchema: shape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "routing",
  redigirParaAuditoria: (args) => ({ router_id: args.router_id, message_present: true }),
  auditResource: (input) => ({ type: "ai_router", id: input.router_id }),
  handler: async (raw, ctx) => {
    const input = z.strictObject(shape).parse(raw);
    const { getSkillsPool } = await import("@/lib/ai/skills/db");
    const { loadRouterForPreview } = await import("@/lib/agent-engine/agent/router-config");
    const { classifyIntent } = await import("@/lib/agent-engine/agent/intent-classifier");
    const { destinoDoVeredito } = await import("@/lib/agent-engine/agent/resolve-turn-agent");
    const { llmEdgeConfigFromEnv } = await import("@/lib/agent-engine/edge/llm/credentials");
    const { runModelCall } = await import("@/lib/agent-engine/edge/llm/run-model-call");
    const { createLogger } = await import("@/lib/agent-engine/obs/logger");
    const { env } = await import("@/lib/env");

    const pool = getSkillsPool();
    const router = await loadRouterForPreview(pool, ctx.organizationId, input.router_id);
    if (!router) throw new McpToolError("not_found", "router_not_found");

    // Service role ignora RLS; valide todos os destinos antes de expor a prévia.
    const ids = [...new Set([router.fallbackAgentId, ...router.members.map((member) => member.agentId)].filter((id): id is string => Boolean(id)))];
    if (!router.fallbackAgentId || router.members.length === 0) {
      throw new McpToolError("conflict", "router_incomplete");
    }
    const { data: agents, error } = await ctx.supabase.from("ai_agents")
      .select("id,name").eq("organization_id", ctx.organizationId).in("id", ids);
    if (error) throw new McpToolError("provider_unavailable", "router_preview_unavailable");
    if (new Set((agents ?? []).map((agent) => agent.id)).size !== ids.length) {
      throw new McpToolError("conflict", "router_agent_not_in_tenant");
    }

    const fixture = process.env.INTERNAL_AGENT_RUN_STUB === "true";
    const llmConfig = llmEdgeConfigFromEnv(env);
    if (fixture) llmConfig.anthropicApiKey = "local-controlled-provider";
    const fixtureRegistry = fixture
      ? (await import("@/lib/agent-engine/agent/preview-fixture")).previewFixtureRegistry()
      : null;
    const verdict = await classifyIntent(pool, llmConfig, {
      tenantId: ctx.organizationId,
      leadId: null,
      jobId: null,
      router,
      signal: input.message,
    }, {
      log: createLogger(),
      ...(fixtureRegistry ? { runModelCall: (db, cfg, request, deps) =>
        runModelCall(db, cfg, request, { ...deps, registry: fixtureRegistry }) } : {}),
    });
    const chosen = destinoDoVeredito(router, undefined, null, verdict);
    const agentId = chosen.membro?.agentId ?? router.fallbackAgentId;
    return {
      router_id: router.id,
      intent_name: verdict && !verdict.falhou ? verdict.intentName : null,
      confidence: verdict && !verdict.falhou ? verdict.confidence : null,
      min_confidence: router.minConfidence,
      outcome: chosen.outcome,
      agent_id: agentId,
      agent_name: agents?.find((agent) => agent.id === agentId)?.name ?? null,
      is_dry_run: true,
    };
  },
};
