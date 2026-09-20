import { z } from "zod";

import { audit } from "@/lib/audit";
import { ApiError } from "@/lib/api/types";
import { evaluateConditions, type RuleCondition } from "@/lib/automation/conditions";
import {
  configDoGatilhoDeData,
  GATILHO_DE_DATA_DO_FUNIL,
} from "@/lib/automation/gatilho-de-data-do-funil";
import { decideRouting } from "@/lib/routing/decide";
import { loadChannelRoutingSettings } from "@/lib/routing/channel-policies";
import { loadEligibleAttendants } from "@/lib/routing/eligibles";
import {
  atendimentoConfigPatchSchema,
  mesclarSettingsDeAtendimento,
  routingConfigSchema,
  channelRoutingPatchSchema,
} from "@/lib/schemas/routing";
import {
  actionSchema,
  createAutomationRuleSchema,
  ENTIDADE_ESPERADA_POR_GATILHO,
  TRIGGER_EVENTS,
  updateAutomationRuleSchema,
} from "@/lib/schemas/webhooks";
import { encryptRuleActionSecrets } from "@/lib/webhooks/secrets";
import { autoriaDaMudanca } from "@/lib/operacao/autoria";
import type { McpContext, McpToolDefinition } from "@/lib/mcp/types";

const RULE_COLUMNS =
  "id, name, is_active, trigger_event, trigger_config, conditions, actions, last_run_at, run_count, last_change_actor_kind, last_change_at, created_at, updated_at";
const DEFAULT_ROUTING = routingConfigSchema.parse({});
function ator(ctx: McpContext) {
  return ctx.actor.type === "user" ? ctx.actor.id : null;
}
function semSegredos<T>(value: T): T {
  if (Array.isArray(value)) return value.map(semSegredos) as T;
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (/^(secret|secret_enc|token|api_key|authorization|ciphertext)$/i.test(k)) continue;
    out[k] = semSegredos(v);
  }
  return out as T;
}

async function regra(ctx: McpContext, id: string) {
  const { data, error } = await ctx.supabase
    .from("automation_rules")
    .select(RULE_COLUMNS)
    .eq("organization_id", ctx.organizationId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
  if (!data)
    throw new ApiError(
      404,
      "not_found",
      undefined,
      ctx.requestId,
      "Regra de automação não encontrada.",
    );
  return data;
}

export const crmDiscoverAutomationTriggers: McpToolDefinition = {
  name: "crm_discover_automation_triggers",
  description:
    "Descobre o catálogo real de gatilhos aceitos pelo motor, a entidade esperada e o schema adicional do gatilho de data. Use antes de criar ou editar uma regra; não invente nomes.",
  inputSchema: {},
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  domain: "automations",
  handler: async () => ({
    triggers: TRIGGER_EVENTS.map((name) => ({
      name,
      entity_kind: ENTIDADE_ESPERADA_POR_GATILHO[name],
      trigger_config:
        name === GATILHO_DE_DATA_DO_FUNIL
          ? { required: ["pipeline_id", "campo", "dias"], dias: { min: -3650, max: 3650 } }
          : { required: [] },
    })),
  }),
};

const ACTION_SCHEMAS = [
  { name: "create_or_move_lead", required: ["pipeline_id", "stage_id"], effect: "crm_write" },
  {
    name: "send_whatsapp_message",
    required: ["channel_session_id", "template"],
    effect: "external_message",
  },
  { name: "add_tag", required: ["tags"], effect: "crm_write" },
  { name: "assign_owner", required: ["user_id"], effect: "crm_write" },
  {
    name: "send_ai_message",
    required: ["agent_id", "channel_session_id", "instruction"],
    effect: "external_message",
  },
  { name: "call_webhook", required: ["url"], optional: ["secret"], effect: "external_webhook" },
  { name: "start_message_flow", required: ["flow_pointer_id"], effect: "external_message_flow" },
] as const;
export const crmDiscoverAutomationActions: McpToolDefinition = {
  name: "crm_discover_automation_actions",
  description:
    "Descobre as ações reais, campos obrigatórios e classe de efeito do motor. É catálogo e não simulação: não envia mensagem, move lead nem chama webhook.",
  inputSchema: {},
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  domain: "automations",
  handler: async () => ({ actions: ACTION_SCHEMAS }),
};

const getRuleShape = { automation_id: z.string().uuid() };
export const crmGetAutomationRule: McpToolDefinition<typeof getRuleShape> = {
  name: "crm_get_automation_rule",
  description:
    "Consulta uma regra completa para administração, removendo secrets e ciphertext das ações. Não ativa, executa ou testa a regra.",
  inputSchema: getRuleShape,
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  domain: "automations",
  handler: async (i, ctx) => ({ regra: semSegredos(await regra(ctx, i.automation_id)) }),
};

type Issue = { code: string; path: string; message: string };
async function preflight(
  ctx: McpContext,
  raw: unknown,
): Promise<{
  valid: boolean;
  errors: Issue[];
  parsed?: z.infer<typeof createAutomationRuleSchema>;
}> {
  const parsed = createAutomationRuleSchema.safeParse(raw);
  const errors: Issue[] = [];
  if (!parsed.success)
    return {
      valid: false,
      errors: parsed.error.issues.map((i) => ({
        code: "schema_invalid",
        path: i.path.join("."),
        message: i.message,
      })),
    };
  const rule = parsed.data;
  if (rule.trigger_event === GATILHO_DE_DATA_DO_FUNIL) {
    const cfg = configDoGatilhoDeData(rule.trigger_config);
    if (cfg) {
      const { data: pipeline } = await ctx.supabase
        .from("crm_pipelines")
        .select("id, settings")
        .eq("organization_id", ctx.organizationId)
        .eq("id", cfg.pipeline_id)
        .maybeSingle();
      if (!pipeline)
        errors.push({
          code: "pipeline_not_found",
          path: "trigger_config.pipeline_id",
          message: "Funil não existe nesta organização.",
        });
      else {
        const fields =
          (pipeline.settings as { fields?: Array<{ key?: string; type?: string }> } | null)
            ?.fields ?? [];
        const field = fields.find((f) => f.key === cfg.campo);
        if (!field)
          errors.push({
            code: "field_not_found",
            path: "trigger_config.campo",
            message: "Campo não existe no funil.",
          });
        else if (field.type !== "date")
          errors.push({
            code: "field_not_date",
            path: "trigger_config.campo",
            message: "O campo do gatilho precisa ser do tipo data.",
          });
      }
    }
  }
  for (let n = 0; n < rule.actions.length; n += 1) {
    const action = rule.actions[n]!;
    const path = `actions.${n}.config`;
    if (action.type === "create_or_move_lead") {
      const [p, s] = await Promise.all([
        ctx.supabase
          .from("crm_pipelines")
          .select("id")
          .eq("organization_id", ctx.organizationId)
          .eq("id", action.config.pipeline_id)
          .maybeSingle(),
        ctx.supabase
          .from("crm_stages")
          .select("id, pipeline_id, is_archived")
          .eq("organization_id", ctx.organizationId)
          .eq("id", action.config.stage_id)
          .maybeSingle(),
      ]);
      if (!p.data)
        errors.push({
          code: "pipeline_not_found",
          path: `${path}.pipeline_id`,
          message: "Funil inválido ou de outra organização.",
        });
      if (!s.data || s.data.pipeline_id !== action.config.pipeline_id || s.data.is_archived)
        errors.push({
          code: "stage_invalid",
          path: `${path}.stage_id`,
          message: "Etapa inválida, arquivada ou de outro funil.",
        });
    }
    if (action.type === "assign_owner") {
      const { data } = await ctx.supabase
        .from("user_organizations")
        .select("user_id")
        .eq("organization_id", ctx.organizationId)
        .eq("user_id", action.config.user_id)
        .is("revoked_at", null)
        .maybeSingle();
      if (!data)
        errors.push({
          code: "member_not_found",
          path: `${path}.user_id`,
          message: "Membro não pertence à organização.",
        });
    }
    if (action.type === "send_whatsapp_message" || action.type === "send_ai_message") {
      const { data } = await ctx.supabase
        .from("channel_sessions")
        .select("id, archived_at")
        .eq("organization_id", ctx.organizationId)
        .eq("id", action.config.channel_session_id)
        .maybeSingle();
      if (!data || data.archived_at)
        errors.push({
          code: "channel_invalid",
          path: `${path}.channel_session_id`,
          message: "Canal não existe ou está arquivado.",
        });
    }
    if (action.type === "send_ai_message") {
      const { data } = await ctx.supabase
        .from("ai_agents")
        .select("id, is_active, published_version_id, archived_at")
        .eq("organization_id", ctx.organizationId)
        .eq("id", action.config.agent_id)
        .maybeSingle();
      if (!data || !data.is_active || !data.published_version_id || data.archived_at)
        errors.push({
          code: "agent_invalid",
          path: `${path}.agent_id`,
          message: "Agente precisa existir, estar publicado e ativo.",
        });
    }
    if (action.type === "start_message_flow") {
      const { data } = await ctx.supabase
        .from("followup_flow_pointers")
        .select("id, status, active_version_id")
        .eq("organization_id", ctx.organizationId)
        .eq("id", action.config.flow_pointer_id)
        .maybeSingle();
      if (!data || data.status !== "active" || !data.active_version_id)
        errors.push({
          code: "flow_invalid",
          path: `${path}.flow_pointer_id`,
          message: "Fluxo precisa existir e estar publicado/ativo.",
        });
    }
  }
  return { valid: errors.length === 0, errors, parsed: rule };
}

const preflightShape = createAutomationRuleSchema.shape;
export const crmPreflightAutomationRule: McpToolDefinition<typeof preflightShape> = {
  name: "crm_preflight_automation_rule",
  description:
    "Valida gatilho, condições, ações e referências tenant-scoped antes de salvar ou ativar. Não grava regra, não envia mensagem, não move lead e não chama webhook.",
  inputSchema: preflightShape,
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  domain: "automations",
  handler: async (i, ctx) => {
    const r = await preflight(ctx, i);
    return {
      valid: r.valid,
      errors: r.errors,
      required_capabilities: (r.parsed?.actions ?? []).some((a) =>
        ["send_whatsapp_message", "send_ai_message", "start_message_flow"].includes(a.type),
      )
        ? ["automation_activation", "send_messages"]
        : ["automation_activation"],
    };
  },
};

export const crmCreateAutomationRule: McpToolDefinition<typeof preflightShape> = {
  name: "crm_create_automation_rule",
  description:
    "Cria uma regra INATIVA após preflight completo. Configurar a regra não executa ações; ativação é separada e exige capability específica.",
  inputSchema: preflightShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "automations",
  auditResource: (_i, r) => ({
    type: "automation_rule",
    id: (r as { regra?: { id?: string } })?.regra?.id,
  }),
  handler: async (input, ctx) => {
    const check = await preflight(ctx, input);
    if (!check.valid || !check.parsed) return { created: false, errors: check.errors };
    const actions = await encryptRuleActionSecrets(ctx.supabase, check.parsed.actions);
    if (!actions)
      throw new ApiError(
        422,
        "encryption_unavailable",
        undefined,
        ctx.requestId,
        "Cifra de secrets indisponível.",
      );
    const { data, error } = await ctx.supabase
      .from("automation_rules")
      .insert({
        organization_id: ctx.organizationId,
        created_by_user_id: ator(ctx),
        name: check.parsed.name,
        trigger_event: check.parsed.trigger_event,
        trigger_config: check.parsed.trigger_config ?? {},
        conditions: check.parsed.conditions,
        actions,
        is_active: false,
        ...autoriaDaMudanca(ctx.actor),
      })
      .select(RULE_COLUMNS)
      .single();
    if (error) throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
    await audit({
      action: "automation.rule_created",
      actorUserId: ator(ctx),
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "automation_rule",
      resourceId: data.id,
      requestId: ctx.requestId,
      metadata: { trigger_event: input.trigger_event, via: "mcp" },
    });
    return { created: true, regra: semSegredos(data) };
  },
};

const updateRuleShape = { automation_id: z.string().uuid(), ...updateAutomationRuleSchema.shape };
export const crmUpdateAutomationRule: McpToolDefinition<typeof updateRuleShape> = {
  name: "crm_update_automation_rule",
  description:
    "Edita uma regra sem ativá-la. Para mudar uma regra ativa, desative antes; depois rode preflight e use a operação separada de ativação.",
  inputSchema: updateRuleShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "automations",
  auditResource: (i) => ({ type: "automation_rule", id: i.automation_id }),
  handler: async (input, ctx) => {
    const current = await regra(ctx, input.automation_id);
    if (current.is_active)
      throw new ApiError(
        409,
        "automation_active",
        undefined,
        ctx.requestId,
        "Desative a regra antes de editar.",
      );
    const { automation_id, is_active: _ignored, ...partial } = input;
    if (!Object.keys(partial).length)
      throw new ApiError(
        422,
        "validation_failed",
        undefined,
        ctx.requestId,
        "Informe o que alterar.",
      );
    const candidate = {
      name: partial.name ?? current.name,
      trigger_event: partial.trigger_event ?? current.trigger_event,
      trigger_config: partial.trigger_config ?? current.trigger_config,
      conditions: partial.conditions ?? current.conditions,
      actions: partial.actions ?? current.actions,
    };
    const check = await preflight(ctx, candidate);
    if (!check.valid || !check.parsed) return { updated: false, errors: check.errors };
    const patch: Record<string, unknown> = {
      ...partial,
      updated_at: new Date().toISOString(),
      ...autoriaDaMudanca(ctx.actor),
    };
    if (partial.actions) {
      const actions = await encryptRuleActionSecrets(ctx.supabase, partial.actions);
      if (!actions)
        throw new ApiError(
          422,
          "encryption_unavailable",
          undefined,
          ctx.requestId,
          "Cifra indisponível.",
        );
      patch.actions = actions;
    }
    const { data, error } = await ctx.supabase
      .from("automation_rules")
      .update(patch)
      .eq("organization_id", ctx.organizationId)
      .eq("id", automation_id)
      .select(RULE_COLUMNS)
      .single();
    if (error) throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
    await audit({
      action: "automation.rule_updated",
      actorUserId: ator(ctx),
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "automation_rule",
      resourceId: automation_id,
      requestId: ctx.requestId,
      metadata: { fields_changed: Object.keys(partial), via: "mcp" },
    });
    return { updated: true, regra: semSegredos(data) };
  },
};

const duplicateShape = { automation_id: z.string().uuid(), name: z.string().min(1).max(120) };
export const crmDuplicateAutomationRule: McpToolDefinition<typeof duplicateShape> = {
  name: "crm_duplicate_automation_rule",
  description:
    "Duplica uma regra como rascunho INATIVO, preservando condições e ações cifradas sem revelar secrets. A cópia precisa de preflight e ativação próprios.",
  inputSchema: duplicateShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "automations",
  auditResource: (_i, r) => ({
    type: "automation_rule",
    id: (r as { regra?: { id?: string } })?.regra?.id,
  }),
  handler: async (input, ctx) => {
    const src = await regra(ctx, input.automation_id);
    const { data, error } = await ctx.supabase
      .from("automation_rules")
      .insert({
        organization_id: ctx.organizationId,
        created_by_user_id: ator(ctx),
        name: input.name,
        trigger_event: src.trigger_event,
        trigger_config: src.trigger_config,
        conditions: src.conditions,
        actions: src.actions,
        is_active: false,
        ...autoriaDaMudanca(ctx.actor),
      })
      .select(RULE_COLUMNS)
      .single();
    if (error) throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
    await audit({
      action: "automation.rule_created",
      actorUserId: ator(ctx),
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "automation_rule",
      resourceId: data.id,
      requestId: ctx.requestId,
      metadata: { source_id: input.automation_id, duplicated: true, via: "mcp" },
    });
    return { regra: semSegredos(data) };
  },
};

export const crmDeleteAutomationRule: McpToolDefinition<typeof getRuleShape> = {
  name: "crm_delete_automation_rule",
  description:
    "Exclui somente uma regra INATIVA, preservando os logs de execução conforme as FKs do produto. Exige capability destrutiva e nunca executa as ações da regra.",
  inputSchema: getRuleShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "automations",
  capabilities: ["destructive_operations"],
  auditResource: (i) => ({ type: "automation_rule", id: i.automation_id }),
  handler: async (input, ctx) => {
    const current = await regra(ctx, input.automation_id);
    if (current.is_active)
      throw new ApiError(
        409,
        "automation_active",
        undefined,
        ctx.requestId,
        "Desative a regra antes de excluir.",
      );
    const { error } = await ctx.supabase
      .from("automation_rules")
      .delete()
      .eq("organization_id", ctx.organizationId)
      .eq("id", input.automation_id);
    if (error) throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
    await audit({
      action: "automation.rule_deleted",
      actorUserId: ator(ctx),
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "automation_rule",
      resourceId: input.automation_id,
      requestId: ctx.requestId,
      metadata: { via: "mcp" },
    });
    return { deleted: true, automation_id: input.automation_id };
  },
};

const simulateShape = {
  automation_id: z.string().uuid().optional(),
  conditions: z
    .array(
      z.object({
        field: z.string().min(1).max(200),
        op: z.enum(["eq", "neq", "contains"]),
        value: z.string().max(500),
      }),
    )
    .max(10)
    .optional(),
  actions: z.array(actionSchema).min(1).max(10).optional(),
  context: z.record(z.string(), z.unknown()),
};
export const crmSimulateAutomationRule: McpToolDefinition<typeof simulateShape> = {
  name: "crm_simulate_automation_rule",
  description:
    "Simula condições e devolve as ações propostas, sanitizadas, sem enviar mensagem, mover lead, aplicar tag, criar compromisso ou chamar webhook. Nunca executa o motor.",
  inputSchema: simulateShape,
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  domain: "automations",
  handler: async (input, ctx) => {
    let conditions = input.conditions ?? [];
    let actions = input.actions ?? [];
    if (input.automation_id) {
      const r = await regra(ctx, input.automation_id);
      conditions = r.conditions as RuleCondition[];
      actions = r.actions as typeof actions;
    }
    if (!actions.length)
      throw new ApiError(
        422,
        "validation_failed",
        undefined,
        ctx.requestId,
        "Informe automation_id ou actions.",
      );
    const matched = evaluateConditions(conditions as RuleCondition[], input.context);
    return {
      simulated: true,
      matched,
      proposed_actions: matched
        ? semSegredos(actions).map((a) => ({ type: a.type, config: a.config }))
        : [],
      side_effects_executed: false,
    };
  },
};

const getRunShape = { run_id: z.string().uuid() };
export const crmGetAutomationRun: McpToolDefinition<typeof getRunShape> = {
  name: "crm_get_automation_run",
  description:
    "Consulta status, erro, gatilho e resultados sanitizados de uma execução. Nunca retorna secrets nem reprocessa o run.",
  inputSchema: getRunShape,
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  domain: "automations",
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase
      .from("automation_rule_runs")
      .select(
        "id, rule_id, event_id, status, actions_result, error, created_at, automation_rules(name, trigger_event)",
      )
      .eq("organization_id", ctx.organizationId)
      .eq("id", input.run_id)
      .maybeSingle();
    if (error) throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
    if (!data)
      throw new ApiError(404, "not_found", undefined, ctx.requestId, "Execução não encontrada.");
    return { execucao: semSegredos(data) };
  },
};

export const crmGetRoutingConfig: McpToolDefinition = {
  name: "crm_get_routing_config",
  description:
    "Consulta a política real de roteamento global e por canal, incluindo modo manual/round_robin, retry, fallback implícito e responsáveis permitidos. Não altera distribuição.",
  inputSchema: {},
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  domain: "routing",
  handler: async (_i, ctx) => {
    const { data, error } = await ctx.supabase
      .from("organizations")
      .select("settings")
      .eq("id", ctx.organizationId)
      .maybeSingle();
    if (error) throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
    const settings = (data?.settings as Record<string, unknown> | null) ?? {};
    return {
      global: routingConfigSchema.catch(DEFAULT_ROUTING).parse(settings.routing ?? {}),
      visibility_mode: settings.visibility_mode ?? "own_and_unassigned",
      por_canal: await loadChannelRoutingSettings(ctx.supabase, ctx.organizationId),
    };
  },
};

const updateRoutingShape = {
  mode: z.enum(["manual", "round_robin"]).optional(),
  max_retries: z.number().int().min(0).max(20).optional(),
  backoff_seconds: z.number().int().min(1).max(3600).optional(),
  handoff_return_after_minutes: z.number().int().min(5).max(1440).nullable().optional(),
  visibility_mode: z.enum(["all", "own_and_unassigned", "own"]).optional(),
};
export const crmUpdateRoutingConfig: McpToolDefinition<typeof updateRoutingShape> = {
  name: "crm_update_routing_config",
  description:
    "Atualiza a política global oficial de roteamento. round_robin usa a ordem/carga do engine; manual não atribui automaticamente. Não inventa first-match/all-match nem filas inexistentes.",
  inputSchema: updateRoutingShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "routing",
  auditResource: (_i, _r) => ({ type: "organization" }),
  handler: async (input, ctx) => {
    if (!Object.keys(input).length)
      throw new ApiError(
        422,
        "validation_failed",
        undefined,
        ctx.requestId,
        "Informe o que alterar.",
      );
    const currentResult = await ctx.supabase
      .from("organizations")
      .select("settings")
      .eq("id", ctx.organizationId)
      .maybeSingle();
    if (currentResult.error)
      throw new ApiError(
        500,
        "internal_error",
        undefined,
        ctx.requestId,
        currentResult.error.message,
      );
    const current = (currentResult.data?.settings as Record<string, unknown> | null) ?? {};
    const base = routingConfigSchema.catch(DEFAULT_ROUTING).parse(current.routing ?? {});
    const parsed = atendimentoConfigPatchSchema.parse({ ...base, ...input });
    const next = mesclarSettingsDeAtendimento(current, parsed);
    const { error } = await ctx.supabase
      .from("organizations")
      .update({ settings: next.settings })
      .eq("id", ctx.organizationId);
    if (error) throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
    await audit({
      action: "routing.config_changed",
      actorUserId: ator(ctx),
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "organization",
      resourceId: ctx.organizationId,
      requestId: ctx.requestId,
      metadata: { fields_changed: Object.keys(input), via: "mcp" },
    });
    return {
      ...next.routing,
      visibility_mode: next.settings.visibility_mode ?? "own_and_unassigned",
    };
  },
};

export const crmListRoutingDestinations: McpToolDefinition = {
  name: "crm_list_routing_destinations",
  description:
    "Descobre destinos válidos no modelo real: canais, membros elegíveis/configuráveis e agentes de IA publicados. Pipelines e stages são descobertos pelas tools de funil; não há queue_id.",
  inputSchema: {},
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  domain: "routing",
  handler: async (_i, ctx) => {
    const channel = await loadChannelRoutingSettings(ctx.supabase, ctx.organizationId);
    const { data: agents, error } = await ctx.supabase
      .from("ai_agents")
      .select("id, name, is_active, published_version_id, priority")
      .eq("organization_id", ctx.organizationId)
      .is("archived_at", null)
      .order("priority");
    if (error) throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
    return {
      channels: channel.channels,
      members: channel.members,
      ai_agents: (agents ?? []).filter((a) => a.is_active && a.published_version_id),
      queues: [],
      note: "Esta versão usa fila derivada; queue_id não existe.",
    };
  },
};

const channelRoutingShape = channelRoutingPatchSchema.shape;
export const crmUpdateChannelRouting: McpToolDefinition<typeof channelRoutingShape> = {
  name: "crm_update_channel_routing",
  description:
    "Define responsáveis permitidos de um canal ou restaura o fallback legado. IDs são validados no tenant; lista vazia é bloqueio explícito, reset=true remove a política por canal.",
  inputSchema: channelRoutingShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "routing",
  auditResource: (i) => ({ type: "channel_session", id: i.channel_session_id }),
  handler: async (input, ctx) => {
    const parsed = channelRoutingPatchSchema.parse(input);
    const { data, error } = await ctx.supabase.rpc("fn_set_channel_routing", {
      p_org: ctx.organizationId,
      p_channel: parsed.channel_session_id,
      p_users: parsed.user_ids,
      p_reset: parsed.reset,
    });
    if (error) {
      if (error.code === "P0002")
        throw new ApiError(404, "not_found", undefined, ctx.requestId, "Canal não encontrado.");
      if (error.code === "22023")
        throw new ApiError(
          422,
          "validation_failed",
          undefined,
          ctx.requestId,
          "Há responsável inválido ou de outra organização.",
        );
      if (error.code === "42501")
        throw new ApiError(
          403,
          "forbidden",
          undefined,
          ctx.requestId,
          "Esta sessão não pode alterar os responsáveis.",
        );
      throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
    }
    await audit({
      action: "routing.config_changed",
      actorUserId: ator(ctx),
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "channel_session",
      resourceId: parsed.channel_session_id,
      requestId: ctx.requestId,
      metadata: { user_ids: parsed.user_ids, reset: parsed.reset, via: "mcp" },
    });
    return { configuracao: data };
  },
};

const simulateRoutingShape = {
  channel_session_id: z.string().uuid(),
  already_assigned: z.boolean().default(false),
  attempts: z.number().int().min(0).max(100).default(0),
  now: z.string().datetime({ offset: true }).optional(),
};
export const crmSimulateRouting: McpToolDefinition<typeof simulateRoutingShape> = {
  name: "crm_simulate_routing",
  description:
    "Simula a decisão oficial de routing para um canal e instante controlado. Retorna assign/skip/requeue, destino e motivo sem alterar conversa, lead, fila ou histórico de atribuição.",
  inputSchema: simulateRoutingShape,
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  domain: "routing",
  handler: async (input, ctx) => {
    const now = input.now ? new Date(input.now) : new Date();
    const [orgResult, channelResult] = await Promise.all([
      ctx.supabase
        .from("organizations")
        .select("settings")
        .eq("id", ctx.organizationId)
        .maybeSingle(),
      ctx.supabase
        .from("channel_sessions")
        .select("id")
        .eq("organization_id", ctx.organizationId)
        .eq("id", input.channel_session_id)
        .is("archived_at", null)
        .maybeSingle(),
    ]);
    if (orgResult.error)
      throw new ApiError(500, "internal_error", undefined, ctx.requestId, orgResult.error.message);
    if (channelResult.error)
      throw new ApiError(
        500,
        "internal_error",
        undefined,
        ctx.requestId,
        channelResult.error.message,
      );
    if (!channelResult.data)
      throw new ApiError(404, "not_found", undefined, ctx.requestId, "Canal não encontrado.");
    const config = routingConfigSchema
      .catch(DEFAULT_ROUTING)
      .parse((orgResult.data?.settings as Record<string, unknown> | null)?.routing ?? {});
    const eligibles = await loadEligibleAttendants(ctx.supabase, ctx.organizationId, now, {
      kind: "conversation_channel",
      channelSessionId: input.channel_session_id,
    });
    const decision = decideRouting({
      mode: config.mode,
      alreadyAssigned: input.already_assigned,
      eligibles,
      config,
      attempts: input.attempts,
      now,
    });
    return {
      simulated: true,
      matched_rule: config.mode,
      destination: decision.kind === "assign" ? { kind: "member", user_id: decision.userId } : null,
      reason:
        decision.kind === "skip"
          ? decision.reason
          : decision.kind === "requeue"
            ? "no_eligible_attendant"
            : "round_robin_first_eligible",
      decision,
      candidates: eligibles.map((e) => ({
        user_id: e.userId,
        current_load: e.currentLoad,
        last_assigned_at:
          e.lastAssignedAt === null ? null : new Date(e.lastAssignedAt).toISOString(),
      })),
      side_effects_executed: false,
    };
  },
};

export const AUTOMATION_ROUTING_MCP_TOOLS = [
  crmDiscoverAutomationTriggers,
  crmDiscoverAutomationActions,
  crmGetAutomationRule,
  crmPreflightAutomationRule,
  crmCreateAutomationRule,
  crmUpdateAutomationRule,
  crmDuplicateAutomationRule,
  crmDeleteAutomationRule,
  crmSimulateAutomationRule,
  crmGetAutomationRun,
  crmGetRoutingConfig,
  crmUpdateRoutingConfig,
  crmListRoutingDestinations,
  crmUpdateChannelRouting,
  crmSimulateRouting,
] as const;
