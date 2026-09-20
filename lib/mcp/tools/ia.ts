import { z } from "zod";

import {
  agentMcpCreateSchema,
  agentMcpPatchSchema,
  versionCreateSchema,
  versionPatchSchema,
} from "@/lib/ai/agents/validation";
import {
  MCP_AGENT_COLUMNS,
  MCP_VERSION_COLUMNS,
  createAiAgent,
  createAiAgentVersion,
  duplicateAgentWithVersion,
  getAiCredential,
  getAiModel,
  getAiProvider,
  listAiCredentials,
  listAiModels,
  listAiProviders,
  publishAiAgentVersion,
  testAiAgentVersion,
  setAiAgentState,
  updateAiAgent,
  updateAiAgentVersion,
  validateAiConfiguration,
  validateVersionForMcp,
} from "@/lib/ai/mcp-service";
import { McpToolError } from "@/lib/mcp/errors";
import type { McpToolDefinition } from "@/lib/mcp/types";

const uuid = z.string().uuid();
const agentId = { agent_id: uuid };
const versionId = { agent_id: uuid, version_id: uuid };

function read<T extends z.ZodRawShape>(definition: Omit<McpToolDefinition<T>, "category" | "requiresRole" | "requiresScope">): McpToolDefinition<T> {
  return { ...definition, category: "read", requiresRole: "manager", requiresScope: "mcp:read", domain: definition.domain ?? "ai" };
}
function write<T extends z.ZodRawShape>(definition: Omit<McpToolDefinition<T>, "category" | "requiresRole" | "requiresScope">): McpToolDefinition<T> {
  return { ...definition, category: "write", requiresRole: "manager", requiresScope: "mcp:write", domain: definition.domain ?? "agents" };
}

const listProviders = read({
  name: "crm_list_ai_providers", description: "Lista os provedores de IA suportados, disponibilidade, configuração necessária e capacidade de catálogo.", inputSchema: {},
  handler: async (_input, ctx) => ({ providers: await listAiProviders(ctx.supabase, ctx.organizationId) }),
});
const getProvider = read({
  name: "crm_get_ai_provider", description: "Consulta um provedor de IA suportado e informa disponibilidade e configuração não sensível.", inputSchema: { provider: z.string().min(1) },
  handler: async (input, ctx) => getAiProvider(ctx.supabase, ctx.organizationId, input.provider),
});
const listModels = read({
  name: "crm_list_ai_models", description: "Descobre modelos reais do catálogo com provider, estado, preços e suporte a ferramentas e visão.",
  inputSchema: { provider: z.string().optional(), include_deprecated: z.boolean().default(false), supports_tools: z.boolean().optional(), supports_vision: z.boolean().optional() },
  handler: async (input, ctx) => ({ models: await listAiModels(ctx.supabase, input) }),
});
const getModel = read({
  name: "crm_get_ai_model", description: "Consulta um modelo exato do catálogo, inclusive estado de depreciação e capacidades declaradas.", inputSchema: { provider: z.string().min(1), model: z.string().min(1) },
  handler: async (input, ctx) => getAiModel(ctx.supabase, input.provider, input.model),
});
const listCredentials = read({
  name: "crm_list_ai_credentials", description: "Lista somente metadados seguros das credenciais de IA disponíveis para esta organização.", inputSchema: { provider: z.string().optional() },
  handler: async (input, ctx) => ({ credentials: await listAiCredentials(ctx.supabase, ctx.organizationId, input.provider) }),
});
const getCredential = read({
  name: "crm_get_ai_credential", description: "Consulta metadados seguros de uma credencial sem revelar chave, token, segredo ou conteúdo cifrado.", inputSchema: { credential_id: uuid },
  handler: async (input, ctx) => getAiCredential(ctx.supabase, ctx.organizationId, input.credential_id),
});
const validateConfiguration = read({
  name: "crm_validate_agent_ai_configuration", description: "Valida provider, modelo, credencial e capacidades antes de criar ou publicar uma versão de agente.",
  inputSchema: { provider: z.string().min(1), model: z.string().min(1), credential_id: uuid.nullable(), requires_tools: z.boolean().default(true), requires_vision: z.boolean().default(false) },
  handler: async (input, ctx) => validateAiConfiguration(ctx.supabase, ctx.organizationId, input),
});

const listAgents = read({
  domain: "agents",
  name: "crm_list_ai_agents", description: "Lista agentes de IA da organização com estado, publicação, pausa e arquivamento, sem conteúdo secreto.", inputSchema: { include_archived: z.boolean().default(false) },
  handler: async (input, ctx) => {
    let query = ctx.supabase.from("ai_agents").select(MCP_AGENT_COLUMNS).eq("organization_id", ctx.organizationId).eq("kind", "mcp_agent").order("created_at", { ascending: false });
    if (!input.include_archived) query = query.is("archived_at", null);
    const { data, error } = await query; if (error) throw new Error(error.message); return { agents: data ?? [] };
  },
});
const getAgent = read({
  domain: "agents",
  name: "crm_get_ai_agent", description: "Consulta um agente de IA da organização e o estado da versão publicada correspondente.", inputSchema: agentId,
  handler: async (input, ctx) => { const { data, error } = await ctx.supabase.from("ai_agents").select(MCP_AGENT_COLUMNS).eq("organization_id", ctx.organizationId).eq("id", input.agent_id).eq("kind", "mcp_agent").maybeSingle(); if (error) throw new Error(error.message); if (!data) throw new McpToolError("not_found", "agent_not_found"); return data; },
});
const createAgent = write({
  name: "crm_create_ai_agent", description: "Cria um agente de IA com a primeira versão em rascunho depois de validar todas as referências.", inputSchema: agentMcpCreateSchema.shape,
  handler: async (input, ctx) => createAiAgent(ctx.supabase, ctx.organizationId, ctx.provisionedByUserId ?? ctx.actor.id, input),
  auditResource: (_input, result) => ({ type: "ai_agent", id: (result as { agent?: { id?: string } })?.agent?.id }),
});
const updateAgent = write({
  name: "crm_update_ai_agent", description: "Atualiza nome, descrição ou prioridade de um agente de IA sem alterar uma versão publicada.", inputSchema: { ...agentId, patch: agentMcpPatchSchema },
  handler: async (input, ctx) => updateAiAgent(ctx.supabase, ctx.organizationId, input.agent_id, input.patch),
  auditResource: (input) => ({ type: "ai_agent", id: input.agent_id }),
});
const duplicateAgent = write({
  name: "crm_duplicate_ai_agent", description: "Duplica um agente e sua versão de origem em um novo rascunho que nasce fora do ar.", inputSchema: agentId,
  handler: async (input, ctx) => { const result = await duplicateAgentWithVersion(ctx.supabase, { orgId: ctx.organizationId, agentId: input.agent_id, actorUserId: ctx.provisionedByUserId ?? ctx.actor.id, requireVersion: true }); if (!result.ok) throw new McpToolError(result.error === "not_found" ? "not_found" : "conflict", result.error); return result; },
  auditResource: (_input, result) => ({ type: "ai_agent", id: (result as { agent?: { id?: string } })?.agent?.id }),
});
const pauseAgent = write({
  name: "crm_pause_ai_agent", description: "Pausa um agente publicado sem apagar sua versão ou histórico, permitindo retomada posterior.", inputSchema: agentId,
  handler: async (input, ctx) => setAiAgentState(ctx.supabase, ctx.organizationId, input.agent_id, "paused"), auditResource: (input) => ({ type: "ai_agent", id: input.agent_id }),
});
const activateAgent = write({
  name: "crm_activate_ai_agent", description: "Ativa um agente que já possui versão publicada e volta a permitir novos atendimentos automáticos.", inputSchema: agentId, capabilities: ["agent_activation"],
  handler: async (input, ctx) => setAiAgentState(ctx.supabase, ctx.organizationId, input.agent_id, "active"), auditResource: (input) => ({ type: "ai_agent", id: input.agent_id }),
});
const archiveAgent = write({
  name: "crm_archive_ai_agent", description: "Arquiva um agente, remove sua publicação ativa e preserva versões e histórico para auditoria.", inputSchema: agentId, capabilities: ["destructive_operations"],
  handler: async (input, ctx) => setAiAgentState(ctx.supabase, ctx.organizationId, input.agent_id, "archived"), auditResource: (input) => ({ type: "ai_agent", id: input.agent_id }),
});

const listVersions = read({
  domain: "agents",
  name: "crm_list_ai_agent_versions", description: "Lista versões de um agente com estado, configuração de runtime, modelo e capabilities selecionadas.", inputSchema: agentId,
  handler: async (input, ctx) => { const { data, error } = await ctx.supabase.from("ai_agent_versions").select(MCP_VERSION_COLUMNS).eq("organization_id", ctx.organizationId).eq("agent_id", input.agent_id).order("version_number", { ascending: false }); if (error) throw new Error(error.message); return { versions: data ?? [] }; },
});
const getVersion = read({
  domain: "agents",
  name: "crm_get_ai_agent_version", description: "Consulta uma versão específica do agente com prompt, modelo, ferramentas e configuração de execução.", inputSchema: versionId,
  handler: async (input, ctx) => { const { data, error } = await ctx.supabase.from("ai_agent_versions").select(MCP_VERSION_COLUMNS).eq("organization_id", ctx.organizationId).eq("agent_id", input.agent_id).eq("id", input.version_id).maybeSingle(); if (error) throw new Error(error.message); if (!data) throw new McpToolError("not_found", "version_not_found"); return data; },
});
const getPublishedVersion = read({
  domain: "agents",
  name: "crm_get_published_ai_agent_version", description: "Consulta a versão atualmente publicada de um agente sem exigir que o cliente adivinhe seu identificador.", inputSchema: agentId,
  handler: async (input, ctx) => { const { data: agent } = await ctx.supabase.from("ai_agents").select("published_version_id").eq("organization_id", ctx.organizationId).eq("id", input.agent_id).maybeSingle(); if (!agent) throw new McpToolError("not_found", "agent_not_found"); if (!agent.published_version_id) return { published: false, version: null }; const { data } = await ctx.supabase.from("ai_agent_versions").select(MCP_VERSION_COLUMNS).eq("organization_id", ctx.organizationId).eq("agent_id", input.agent_id).eq("id", agent.published_version_id).single(); return { published: true, version: data }; },
});
const createVersion = write({
  name: "crm_create_ai_agent_version", description: "Cria uma nova versão em rascunho depois de validar modelo, credencial, funis e materiais.", inputSchema: { ...agentId, version: versionCreateSchema },
  handler: async (input, ctx) => createAiAgentVersion(ctx.supabase, ctx.organizationId, ctx.provisionedByUserId ?? ctx.actor.id, input.agent_id, input.version), auditResource: (_input, result) => ({ type: "ai_agent_version", id: (result as { id?: string })?.id }),
});
const updateVersion = write({
  name: "crm_update_ai_agent_version", description: "Edita somente uma versão em rascunho e revalida referências antes de persistir a configuração.", inputSchema: { ...versionId, patch: versionPatchSchema },
  handler: async (input, ctx) => updateAiAgentVersion(ctx.supabase, ctx.organizationId, input.agent_id, input.version_id, input.patch), auditResource: (input) => ({ type: "ai_agent_version", id: input.version_id }),
});
const preflightVersion = read({
  domain: "agents",
  name: "crm_preflight_ai_agent_version", description: "Executa a validação completa de uma versão existente antes da publicação sem modificar o agente.", inputSchema: versionId,
  handler: async (input, ctx) => { const { data } = await ctx.supabase.from("ai_agent_versions").select(MCP_VERSION_COLUMNS).eq("organization_id", ctx.organizationId).eq("agent_id", input.agent_id).eq("id", input.version_id).maybeSingle(); if (!data) throw new McpToolError("not_found", "version_not_found"); await validateVersionForMcp(ctx.supabase, ctx.organizationId, data); return { valid: true, agent_id: input.agent_id, version_id: input.version_id }; },
});
const publishVersion = write({
  name: "crm_publish_ai_agent_version", description: "Publica atomicamente uma versão validada sem confundir publicação com ativação do agente.", inputSchema: versionId, capabilities: ["agent_publication"],
  handler: async (input, ctx) => publishAiAgentVersion(ctx.supabase, ctx.organizationId, input.agent_id, input.version_id), auditResource: (input) => ({ type: "ai_agent_version", id: input.version_id }),
});
const testVersion = write({
  name: "crm_test_ai_agent_version", description: "Executa uma prévia controlada da versão sem enviar mensagens nem produzir efeitos externos no canal.",
  inputSchema: { ...versionId, sample_message: z.string().trim().min(1).max(4000), sample_contact: z.object({ name: z.string().trim().min(1).max(120).optional(), phone: z.string().trim().min(3).max(40).optional() }).optional() },
  handler: async (input, ctx) => testAiAgentVersion(ctx.supabase, ctx.organizationId, input.agent_id, input.version_id, { sample_message: input.sample_message, sample_contact: input.sample_contact }),
  auditResource: (input, result) => ({ type: "ai_agent_run", id: (result as { run_id?: string })?.run_id ?? input.version_id }),
});
const listRuns = read({
  domain: "agents",
  name: "crm_list_ai_agent_runs", description: "Lista execuções de um agente com estado, uso e erros básicos, sem expor credenciais ou segredos.", inputSchema: { ...agentId, limit: z.number().int().min(1).max(100).default(25), status: z.string().optional() },
  handler: async (input, ctx) => { let query = ctx.supabase.from("llm_calls").select("id, agent_id, contact_id, purpose, status, error_code, error_message, input_tokens, output_tokens, cost_cents, latency_ms, created_at").eq("organization_id", ctx.organizationId).eq("agent_id", input.agent_id).eq("purpose", "agent_turn").order("created_at", { ascending: false }).limit(input.limit); if (input.status) query = query.eq("status", input.status === "completed" ? "ok" : input.status === "failed" ? "erro" : input.status); const { data, error } = await query; if (error) throw new Error(error.message); return { runs: data ?? [] }; },
});
const getRun = read({
  domain: "agents",
  name: "crm_get_ai_agent_run", description: "Consulta uma execução específica do agente com resultado e uso básico, mantendo dados sensíveis fora da resposta.", inputSchema: { run_id: uuid },
  handler: async (input, ctx) => { const { data, error } = await ctx.supabase.from("llm_calls").select("id, agent_id, contact_id, purpose, status, error_code, error_message, input_tokens, output_tokens, cost_cents, latency_ms, created_at").eq("organization_id", ctx.organizationId).eq("id", input.run_id).eq("purpose", "agent_turn").maybeSingle(); if (error) throw new Error(error.message); if (!data) throw new McpToolError("not_found", "run_not_found"); return data; },
});

export const AI_MCP_TOOLS = [
  listProviders, getProvider, listModels, getModel, listCredentials, getCredential,
  validateConfiguration, listAgents, getAgent, createAgent, updateAgent, duplicateAgent,
  pauseAgent, activateAgent, archiveAgent, listVersions, getVersion, getPublishedVersion,
  createVersion, updateVersion, preflightVersion, publishVersion, testVersion, listRuns, getRun,
] as unknown as ReadonlyArray<McpToolDefinition>;
