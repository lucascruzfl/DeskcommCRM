import type { SupabaseClient } from "@supabase/supabase-js";

import { mcpAgentDraftRecords } from "@/lib/ai/agents/create-draft";
import { duplicateAgentWithVersion } from "@/lib/ai/agents/duplicate";
import { mensagemDoEscopo, validarEscopoDaVersao } from "@/lib/ai/agents/escopo";
import { publishAgentVersion } from "@/lib/ai/agents/publish";
import {
  agentMcpCreateSchema,
  agentMcpPatchSchema,
  testRunSchema,
  versionCreateSchema,
  versionPatchSchema,
} from "@/lib/ai/agents/validation";
import { PROVEDORES, PROVEDOR_POR_ID } from "@/lib/ai/pontos/provedores";
import { chaveDePlataforma } from "@/lib/ai/platform-credential";
import { McpToolError } from "@/lib/mcp/errors";

export const MCP_AGENT_COLUMNS =
  "id, name, description, kind, priority, is_active, published_version_id, paused_at, archived_at, created_at, updated_at";
export const MCP_VERSION_COLUMNS =
  "id, agent_id, version_number, system_prompt, provider, model, credential_id, tool_ids, trigger_config, channel_session_id, max_steps, token_budget, cost_budget_cents, history_message_window, history_token_window, handoff_keywords, handoff_tool_enabled, cases_enabled, split_messages, split_max_chars, followup, operator_enabled, operator_model, operator_tool_ids, status, published_at, superseded_at, created_at, pipeline_ids, knowledge_source_ids, provisioning_origin";
const MODEL_COLUMNS =
  "id, provider, model_id, display_name, description, context_window, supports_tools, supports_vision, is_default_for_provider, deprecated_at, released_at, input_price_per_million_cents, output_price_per_million_cents";
const CREDENTIAL_COLUMNS =
  "id, provider, label, api_key_last4, validated_at, validation_error, models_available, is_active, created_at, updated_at";

type Db = SupabaseClient;

export async function listAiProviders(db: Db, orgId: string) {
  const [{ data: credentials }, { data: models }] = await Promise.all([
    db.from("ai_provider_credentials_safe").select("provider,is_active,validated_at").eq("organization_id", orgId),
    db.from("ai_models").select("provider,deprecated_at"),
  ]);
  return PROVEDORES.map((provider) => ({
    ...provider,
    platform_configured: Boolean(chaveDePlataforma(provider.id)),
    active_credentials: (credentials ?? []).filter((c) => c.provider === provider.id && c.is_active).length,
    active_models: (models ?? []).filter((m) => m.provider === provider.id && !m.deprecated_at).length,
    available:
      Boolean(chaveDePlataforma(provider.id)) ||
      (credentials ?? []).some((c) => c.provider === provider.id && c.is_active && c.validated_at),
  }));
}

export async function getAiProvider(db: Db, orgId: string, providerId: string) {
  if (!PROVEDOR_POR_ID.has(providerId)) throw new McpToolError("not_found", "provider_not_found");
  return (await listAiProviders(db, orgId)).find((provider) => provider.id === providerId)!;
}

export async function listAiModels(
  db: Db,
  input: { provider?: string; include_deprecated?: boolean; supports_tools?: boolean; supports_vision?: boolean },
) {
  if (input.provider && !PROVEDOR_POR_ID.has(input.provider)) {
    throw new McpToolError("not_found", "provider_not_found");
  }
  let query = db.from("ai_models").select(MODEL_COLUMNS).order("provider").order("display_name");
  if (input.provider) query = query.eq("provider", input.provider);
  if (!input.include_deprecated) query = query.is("deprecated_at", null);
  if (input.supports_tools !== undefined) query = query.eq("supports_tools", input.supports_tools);
  if (input.supports_vision !== undefined) query = query.eq("supports_vision", input.supports_vision);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getAiModel(db: Db, provider: string, modelId: string) {
  if (!PROVEDOR_POR_ID.has(provider)) throw new McpToolError("not_found", "provider_not_found");
  const { data, error } = await db.from("ai_models").select(MODEL_COLUMNS)
    .eq("provider", provider).eq("model_id", modelId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new McpToolError("model_not_found", "model_not_found");
  return data;
}

export async function listAiCredentials(db: Db, orgId: string, provider?: string) {
  let query = db.from("ai_provider_credentials_safe").select(CREDENTIAL_COLUMNS)
    .eq("organization_id", orgId).order("created_at", { ascending: false });
  if (provider) query = query.eq("provider", provider);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getAiCredential(db: Db, orgId: string, credentialId: string) {
  const { data, error } = await db.from("ai_provider_credentials_safe").select(CREDENTIAL_COLUMNS)
    .eq("organization_id", orgId).eq("id", credentialId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new McpToolError("credential_not_found", "credential_not_found");
  return data;
}

export async function validateAiConfiguration(db: Db, orgId: string, input: {
  provider: string;
  model: string;
  credential_id: string | null;
  requires_tools?: boolean;
  requires_vision?: boolean;
}) {
  if (!PROVEDOR_POR_ID.has(input.provider)) {
    throw new McpToolError("not_found", "provider_not_found");
  }
  const model = await getAiModel(db, input.provider, input.model);
  if (model.deprecated_at) throw new McpToolError("model_deprecated", "model_deprecated");
  if (input.requires_tools && !model.supports_tools) {
    throw new McpToolError("model_incompatible", "model_does_not_support_tools");
  }
  if (input.requires_vision && !model.supports_vision) {
    throw new McpToolError("model_incompatible", "model_does_not_support_vision");
  }

  let credential: Record<string, unknown> | null = null;
  if (input.credential_id) {
    credential = await getAiCredential(db, orgId, input.credential_id) as Record<string, unknown>;
    if (credential.provider !== input.provider) {
      throw new McpToolError("model_incompatible", "credential_provider_mismatch");
    }
    if (!credential.is_active || !credential.validated_at) {
      throw new McpToolError("provider_unavailable", "credential_inactive_or_unvalidated");
    }
    const available = Array.isArray(credential.models_available)
      ? credential.models_available as string[]
      : [];
    if (available.length > 0 && !available.includes(input.model)) {
      throw new McpToolError("model_incompatible", "credential_does_not_list_model");
    }
  } else if (!chaveDePlataforma(input.provider)) {
    throw new McpToolError("credential_not_found", "platform_credential_not_configured");
  }

  return {
    valid: true,
    provider: input.provider,
    model: input.model,
    credential_id: input.credential_id,
    credential_source: input.credential_id ? "organization" : "installation",
    capabilities: { tools: model.supports_tools, vision: model.supports_vision },
  };
}

export async function validateVersionForMcp(db: Db, orgId: string, raw: unknown) {
  const version = versionCreateSchema.parse(raw);
  await validateAiConfiguration(db, orgId, {
    provider: version.provider,
    model: version.model,
    credential_id: version.credential_id,
    requires_tools: version.tool_ids.length > 0 || version.operator_tool_ids.length > 0,
  });
  const scope = await validarEscopoDaVersao(db, orgId, version);
  if (!scope.ok) throw new McpToolError("validation_error", mensagemDoEscopo(scope));
  return version;
}

export async function createAiAgent(db: Db, orgId: string, userId: string, raw: unknown) {
  const input = agentMcpCreateSchema.parse(raw);
  await validateVersionForMcp(db, orgId, input.version);
  const records = mcpAgentDraftRecords({ orgId, userId }, input);
  const { data: agent, error: agentError } = await db.from("ai_agents").insert(records.agent)
    .select(MCP_AGENT_COLUMNS).single();
  if (agentError || !agent) throw new Error(agentError?.message ?? "agent_insert_failed");
  const { data: version, error: versionError } = await db.from("ai_agent_versions")
    .insert(records.version).select(MCP_VERSION_COLUMNS).single();
  if (versionError || !version) {
    await db.from("ai_agents").update({ archived_at: new Date().toISOString() })
      .eq("organization_id", orgId).eq("id", records.agent.id);
    throw new Error(versionError?.message ?? "version_insert_failed");
  }
  return { agent, version };
}

export async function updateAiAgent(db: Db, orgId: string, agentId: string, raw: unknown) {
  const patch = agentMcpPatchSchema.parse(raw);
  const { data, error } = await db.from("ai_agents").update(patch).eq("organization_id", orgId)
    .eq("id", agentId).is("archived_at", null).select(MCP_AGENT_COLUMNS).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new McpToolError("not_found", "agent_not_found");
  return data;
}

export async function setAiAgentState(db: Db, orgId: string, agentId: string, state: "active" | "paused" | "archived") {
  const { data: agent } = await db.from("ai_agents").select("id,published_version_id,archived_at")
    .eq("organization_id", orgId).eq("id", agentId).maybeSingle();
  if (!agent) throw new McpToolError("not_found", "agent_not_found");
  if (agent.archived_at) throw new McpToolError("conflict", "agent_archived");
  if (state === "active" && !agent.published_version_id) {
    throw new McpToolError("conflict", "agent_has_no_published_version");
  }
  const now = new Date().toISOString();
  const patch = state === "active"
    ? { paused_at: null, is_active: true, updated_at: now }
    : state === "paused"
      ? { paused_at: now, updated_at: now }
      : { archived_at: now, published_version_id: null, is_active: false, updated_at: now };
  const { data, error } = await db.from("ai_agents").update(patch).eq("organization_id", orgId)
    .eq("id", agentId).select(MCP_AGENT_COLUMNS).single();
  if (error) throw new Error(error.message);
  return data;
}

export async function createAiAgentVersion(db: Db, orgId: string, userId: string, agentId: string, raw: unknown) {
  const version = await validateVersionForMcp(db, orgId, raw);
  const { data: agent } = await db.from("ai_agents").select("id,kind,archived_at")
    .eq("organization_id", orgId).eq("id", agentId).maybeSingle();
  if (!agent || agent.archived_at || agent.kind !== "mcp_agent") throw new McpToolError("not_found", "agent_not_found");
  const { data: latest } = await db.from("ai_agent_versions").select("version_number")
    .eq("organization_id", orgId).eq("agent_id", agentId).order("version_number", { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await db.from("ai_agent_versions").insert({
    ...version, organization_id: orgId, agent_id: agentId,
    version_number: Number(latest?.version_number ?? 0) + 1, status: "draft", created_by: userId,
  }).select(MCP_VERSION_COLUMNS).single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateAiAgentVersion(db: Db, orgId: string, agentId: string, versionId: string, raw: unknown) {
  const patch = versionPatchSchema.parse(raw);
  const { data: current } = await db.from("ai_agent_versions").select(MCP_VERSION_COLUMNS)
    .eq("organization_id", orgId).eq("agent_id", agentId).eq("id", versionId).maybeSingle();
  if (!current) throw new McpToolError("not_found", "version_not_found");
  if (current.status !== "draft") throw new McpToolError("conflict", "version_immutable");
  const mergedInput = Object.fromEntries(
    Object.keys(versionCreateSchema.shape).map((key) => [
      key,
      key in patch
        ? (patch as Record<string, unknown>)[key]
        : (current as Record<string, unknown>)[key],
    ]),
  );
  const merged = versionCreateSchema.parse(mergedInput);
  await validateVersionForMcp(db, orgId, merged);
  const { data, error } = await db.from("ai_agent_versions").update(patch)
    .eq("organization_id", orgId).eq("agent_id", agentId).eq("id", versionId)
    .select(MCP_VERSION_COLUMNS).single();
  if (error) throw new Error(error.message);
  return data;
}

export async function publishAiAgentVersion(db: Db, orgId: string, agentId: string, versionId: string) {
  const { data: version } = await db.from("ai_agent_versions").select(MCP_VERSION_COLUMNS)
    .eq("organization_id", orgId).eq("agent_id", agentId).eq("id", versionId).maybeSingle();
  if (!version) throw new McpToolError("not_found", "version_not_found");
  await validateVersionForMcp(db, orgId, version);
  const result = await publishAgentVersion(db, { orgId, agentId, versionId });
  if (!result.ok) {
    const code = result.code === "credential_missing" ? "credential_not_found" : "validation_error";
    throw new McpToolError(code, result.message);
  }
  return result;
}

/** Prévia controlada: cria somente um run dry-run e nunca despacha mensagem/canal. */
export async function testAiAgentVersion(
  db: Db,
  orgId: string,
  agentId: string,
  versionId: string,
  raw: unknown,
) {
  const input = testRunSchema.parse(raw);
  const { data: version, error: versionError } = await db.from("ai_agent_versions")
    .select("id,channel_session_id")
    .eq("organization_id", orgId).eq("agent_id", agentId).eq("id", versionId).maybeSingle();
  if (versionError) throw new Error(versionError.message);
  if (!version) throw new McpToolError("not_found", "version_not_found");

  const startedAt = new Date();
  const { data: run, error: runError } = await db.from("ai_agent_runs").insert({
    organization_id: orgId,
    agent_id: agentId,
    agent_version_id: versionId,
    channel_session_id: version.channel_session_id,
    status: "running",
    is_dry_run: true,
    started_at: startedAt.toISOString(),
  }).select("id").single();
  if (runError || !run) throw new Error(runError?.message ?? "test_run_insert_failed");

  try {
    // Imports tardios evitam carregar o runtime inteiro (que também conhece o
    // registry MCP) quando o servidor está apenas enumerando tools.
    const [{ testAgentVersion }, { requestTurnDeps }, { getRequestPool }] = await Promise.all([
      import("@/lib/agent-engine/agent/sandbox"),
      import("@/lib/agent-engine/agent/request-deps"),
      import("@/lib/agent-engine/db/request-pool"),
    ]);
    const result = await testAgentVersion(getRequestPool(), requestTurnDeps(), {
      organizationId: orgId,
      agentId,
      versionId,
      runId: run.id,
      sampleMessage: input.sample_message,
      sampleContact: input.sample_contact,
      channelId: version.channel_session_id,
    });
    const completedAt = new Date().toISOString();
    await db.from("ai_agent_runs").update({
      status: "completed",
      completed_at: completedAt,
      latency_ms: Date.now() - startedAt.getTime(),
      tool_calls: JSON.parse(JSON.stringify(result.proposals)),
    }).eq("organization_id", orgId).eq("id", run.id);
    return {
      run_id: run.id,
      status: result.candidates.length ? "ok" : "blocked",
      latency_ms: Date.now() - startedAt.getTime(),
      final_text: result.candidates.map((candidate) => candidate.body).join("\n\n"),
      tool_calls: result.proposals,
      stub: process.env.INTERNAL_AGENT_RUN_STUB === "true",
    };
  } catch {
    await db.from("ai_agent_runs").update({
      status: "failed",
      completed_at: new Date().toISOString(),
      latency_ms: Date.now() - startedAt.getTime(),
      error_code: "preview_failed",
    }).eq("organization_id", orgId).eq("id", run.id);
    throw new McpToolError("provider_unavailable", "agent_preview_failed", { run_id: run.id });
  }
}

export { duplicateAgentWithVersion };
