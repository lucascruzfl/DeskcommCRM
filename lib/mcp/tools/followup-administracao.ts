import { z } from "zod";

import { audit } from "@/lib/audit";
import { ApiError } from "@/lib/api/types";
import {
  createFollowupFlowSchema,
  patchFollowupFlowSchema,
  triggerConfigSchema,
} from "@/lib/followup/api-schemas";
import { carregaEtapasCitadas } from "@/lib/followup/etapas-citadas";
import { ENROLLMENT_LIST_COLUMNS } from "@/lib/followup/enroll";
import { flowGraphSchema, type FlowGraph } from "@/lib/followup/graph-schema";
import {
  adiaEnrollment,
  pausaEnrollment,
  pulaPassoDoEnrollment,
  retomaEnrollment,
} from "@/lib/followup/intervencao";
import { publishFollowupFlowVersion } from "@/lib/followup/publish";
import { rascunhoDoFluxo } from "@/lib/followup/rascunho";
import { validateFlowForPublish } from "@/lib/followup/validate-publish";
import { logger } from "@/lib/logger";
import type { McpContext, McpToolDefinition } from "@/lib/mcp/types";

const DETAIL =
  "id, name, status, active_version_id, draft_graph, handoff_policy, trigger_config, created_at, updated_at";
const STATUS = [
  "active",
  "waiting_reply",
  "paused_handoff",
  "paused_manual",
  "completed",
  "cancelled",
  "dead",
] as const;
const TRIGGERS_COM_MOTOR = [
  "manual",
  "webhook",
  "silence",
  "stage_change",
  "case_opened",
  "appointment_no_show",
] as const;

function userId(ctx: McpContext): string {
  return ctx.actor.type === "user" ? ctx.actor.id : (ctx.provisionedByUserId ?? ctx.actor.id);
}
function ator(ctx: McpContext) {
  return ctx.actor.type === "user" ? ctx.actor.id : null;
}
function depsIntervencao(ctx: McpContext) {
  return {
    supabase: ctx.supabase,
    admin: ctx.supabase,
    orgId: ctx.organizationId,
    userId: userId(ctx),
    requestId: ctx.requestId,
  };
}

async function fluxo(ctx: McpContext, id: string) {
  const { data, error } = await ctx.supabase
    .from("followup_flow_pointers")
    .select(DETAIL)
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
      "Fluxo de follow-up não encontrado.",
    );
  return data;
}

const listarFluxosShape = { status: z.enum(["draft", "active", "disabled"]).optional() };
export const crmListFollowupFlows: McpToolDefinition<typeof listarFluxosShape> = {
  name: "crm_list_followup_flows",
  description:
    "Lista configurações de follow-up versionadas, com status, gatilho, política de handoff e versão ativa. Não confunda com crm_list_followups, que lista retornos simples de um contato.",
  inputSchema: listarFluxosShape,
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  domain: "followups",
  handler: async (input, ctx) => {
    let q = ctx.supabase
      .from("followup_flow_pointers")
      .select("id, name, status, active_version_id, handoff_policy, trigger_config, updated_at")
      .eq("organization_id", ctx.organizationId)
      .order("updated_at", { ascending: false });
    if (input.status) q = q.eq("status", input.status);
    const { data, error } = await q;
    if (error) throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
    return { fluxos: data ?? [] };
  },
};

const obterFluxoShape = { flow_id: z.string().uuid() };
export const crmGetFollowupFlow: McpToolDefinition<typeof obterFluxoShape> = {
  name: "crm_get_followup_flow",
  description:
    "Consulta o rascunho, gatilho, etapas, delays, condições, ações, política de handoff e versão ativa de um fluxo. É leitura; não publica nem dispara comunicação.",
  inputSchema: obterFluxoShape,
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  domain: "followups",
  handler: async (input, ctx) => {
    const row = await fluxo(ctx, input.flow_id);
    return {
      fluxo: {
        ...row,
        draft_graph: await rascunhoDoFluxo(
          ctx.supabase,
          row as { draft_graph: unknown; active_version_id: string | null },
          ctx.organizationId,
        ),
      },
    };
  },
};

const criarFluxoShape = createFollowupFlowSchema.shape;
export const crmCreateFollowupFlow: McpToolDefinition<typeof criarFluxoShape> = {
  name: "crm_create_followup_flow",
  description:
    "Cria somente um rascunho inativo de fluxo de follow-up. Não publica, não inscreve contatos e não envia mensagem; configure o grafo e valide antes de ativar.",
  inputSchema: criarFluxoShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "followups",
  auditResource: (_i, r) => ({
    type: "followup_flow_pointer",
    id: (r as { fluxo?: { id?: string } })?.fluxo?.id,
  }),
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase
      .from("followup_flow_pointers")
      .insert({ organization_id: ctx.organizationId, name: input.name })
      .select(DETAIL)
      .single();
    if (error)
      throw new ApiError(
        error.code === "23505" ? 409 : 500,
        error.code === "23505" ? "conflict" : "internal_error",
        undefined,
        ctx.requestId,
        error.message,
      );
    await audit({
      action: "followup_flow.created",
      actorUserId: ator(ctx),
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "followup_flow_pointer",
      resourceId: data.id,
      requestId: ctx.requestId,
      metadata: { name: input.name, via: "mcp" },
    });
    return { fluxo: data };
  },
};

const atualizarFluxoShape = { flow_id: z.string().uuid(), ...patchFollowupFlowSchema.shape };
export const crmUpdateFollowupFlow: McpToolDefinition<typeof atualizarFluxoShape> = {
  name: "crm_update_followup_flow",
  description:
    "Edita nome, grafo de rascunho, gatilho ou política de handoff sem publicar. Alterar um fluxo ativo não muda a versão em execução até crm_publish_followup_flow.",
  inputSchema: atualizarFluxoShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "followups",
  auditResource: (i) => ({ type: "followup_flow_pointer", id: i.flow_id }),
  handler: async (input, ctx) => {
    const { flow_id, ...raw } = input;
    const parsed = patchFollowupFlowSchema.safeParse(raw);
    if (!parsed.success)
      throw new ApiError(
        422,
        "validation_failed",
        parsed.error.flatten(),
        ctx.requestId,
        "Configuração de follow-up inválida.",
      );
    if (!Object.keys(parsed.data).length)
      throw new ApiError(
        422,
        "validation_failed",
        undefined,
        ctx.requestId,
        "Informe o que alterar.",
      );
    await fluxo(ctx, flow_id);
    const { data, error } = await ctx.supabase
      .from("followup_flow_pointers")
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq("organization_id", ctx.organizationId)
      .eq("id", flow_id)
      .select(DETAIL)
      .single();
    if (error) throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
    await audit({
      action: "followup_flow.updated",
      actorUserId: ator(ctx),
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "followup_flow_pointer",
      resourceId: flow_id,
      requestId: ctx.requestId,
      metadata: { fields_changed: Object.keys(parsed.data), via: "mcp" },
    });
    return { fluxo: data };
  },
};

async function preflightFluxo(ctx: McpContext, id: string) {
  const row = await fluxo(ctx, id);
  const erros: Array<{ code: string; message: string; node_id?: string | null }> = [];
  const trigger = triggerConfigSchema.safeParse(row.trigger_config ?? { kind: "manual" });
  if (!trigger.success)
    erros.push({ code: "trigger_invalid", message: "Configuração do gatilho inválida." });
  else if (!(TRIGGERS_COM_MOTOR as readonly string[]).includes(trigger.data.kind))
    erros.push({
      code: "trigger_not_supported",
      message: `O gatilho ${trigger.data.kind} não possui motor ativo.`,
    });
  if (!row.draft_graph)
    erros.push({ code: "draft_missing", message: "Fluxo sem grafo de rascunho." });
  const graph = row.draft_graph ? flowGraphSchema.safeParse(row.draft_graph) : null;
  if (graph && !graph.success)
    erros.push({ code: "graph_invalid", message: "Estrutura do grafo inválida." });
  if (graph?.success) {
    const refs = await carregaEtapasCitadas(ctx.supabase, ctx.organizationId, graph.data.nodes);
    if (!refs.ok)
      throw new ApiError(500, "internal_error", undefined, ctx.requestId, refs.mensagem);
    const valid = validateFlowForPublish(graph.data, { etapas: refs.etapas });
    if (!valid.ok) erros.push(...valid.errors);
  }
  if (trigger?.success && trigger.data.kind === "stage_change") {
    const stageId = trigger.data.params.stage_id;
    const { data } = await ctx.supabase
      .from("crm_stages")
      .select("id, is_archived")
      .eq("organization_id", ctx.organizationId)
      .eq("id", stageId)
      .maybeSingle();
    if (!data)
      erros.push({
        code: "trigger_stage_not_found",
        message: "Etapa do gatilho não existe nesta organização.",
      });
    else if (data.is_archived)
      erros.push({ code: "trigger_stage_archived", message: "Etapa do gatilho está arquivada." });
  }
  return {
    valid: erros.length === 0,
    errors: erros,
    graph: graph?.success ? graph.data : null,
    row,
  };
}

const validarFluxoShape = { flow_id: z.string().uuid() };
export const crmPreflightFollowupFlow: McpToolDefinition<typeof validarFluxoShape> = {
  name: "crm_preflight_followup_flow",
  description:
    "Valida rascunho, gatilho, referências de etapas e caminhos do fluxo sem publicar, inscrever contato ou executar ação externa. Retorna erros acionáveis.",
  inputSchema: validarFluxoShape,
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  domain: "followups",
  handler: async (i, ctx) => {
    const r = await preflightFluxo(ctx, i.flow_id);
    return { valid: r.valid, errors: r.errors };
  },
};

export const crmPublishFollowupFlow: McpToolDefinition<typeof validarFluxoShape> = {
  name: "crm_publish_followup_flow",
  description:
    "Publica atomicamente um rascunho de follow-up que passou no preflight. A publicação ativa o fluxo para novos gatilhos, mas não envia mensagem imediatamente nem cria inscrição por si só.",
  inputSchema: validarFluxoShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "followups",
  capabilities: ["automation_activation"],
  auditResource: (i) => ({ type: "followup_flow_pointer", id: i.flow_id }),
  handler: async (input, ctx) => {
    const check = await preflightFluxo(ctx, input.flow_id);
    if (!check.valid || !check.graph) return { published: false, errors: check.errors };
    const result = await publishFollowupFlowVersion(ctx.supabase, {
      orgId: ctx.organizationId,
      pointerId: input.flow_id,
      graph: check.graph as FlowGraph,
      createdBy: userId(ctx),
    });
    if (!result.ok)
      throw new ApiError(
        result.code === "pointer_not_found" ? 404 : 500,
        result.code === "pointer_not_found" ? "not_found" : "internal_error",
        undefined,
        ctx.requestId,
        result.message,
      );
    await audit({
      action: "followup_flow.published",
      actorUserId: ator(ctx),
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "followup_flow_pointer",
      resourceId: input.flow_id,
      requestId: ctx.requestId,
      metadata: { version_id: result.version_id, via: "mcp" },
    });
    return { published: true, flow_id: input.flow_id, version_id: result.version_id };
  },
};

const estadoFluxoShape = { flow_id: z.string().uuid(), active: z.boolean() };
export const crmSetFollowupFlowActive: McpToolDefinition<typeof estadoFluxoShape> = {
  name: "crm_set_followup_flow_active",
  description:
    "Desativa um fluxo publicado ou reativa sua versão já publicada. Reativar exige capability de ativação; não dispara mensagem imediata e inscrições existentes preservam seu estado.",
  inputSchema: estadoFluxoShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "followups",
  capabilities: ["automation_activation"],
  auditResource: (i) => ({ type: "followup_flow_pointer", id: i.flow_id }),
  handler: async (input, ctx) => {
    const before = await fluxo(ctx, input.flow_id);
    if (input.active && !before.active_version_id)
      throw new ApiError(
        422,
        "validation_failed",
        undefined,
        ctx.requestId,
        "Publique uma versão antes de ativar.",
      );
    const status = input.active ? "active" : "disabled";
    const { data, error } = await ctx.supabase
      .from("followup_flow_pointers")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("organization_id", ctx.organizationId)
      .eq("id", input.flow_id)
      .select("id, status, active_version_id, updated_at")
      .single();
    if (error) throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
    await audit({
      action: input.active ? "followup_flow.updated" : "followup_flow.disabled",
      actorUserId: ator(ctx),
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "followup_flow_pointer",
      resourceId: input.flow_id,
      requestId: ctx.requestId,
      metadata: { status, via: "mcp" },
    });
    return { fluxo: data };
  },
};

export const crmDeleteFollowupFlow: McpToolDefinition<typeof validarFluxoShape> = {
  name: "crm_delete_followup_flow",
  description:
    "Exclui definitivamente um fluxo e sua linhagem pelo mesmo encadeamento oficial: para o relógio, remove inscrições, versões e o ponteiro. Exige capability destrutiva e não envia mensagem.",
  inputSchema: validarFluxoShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "followups",
  capabilities: ["destructive_operations"],
  auditResource: (input) => ({ type: "followup_flow_pointer", id: input.flow_id }),
  handler: async (input, ctx) => {
    await fluxo(ctx, input.flow_id);
    const enrollments = await ctx.supabase
      .from("followup_enrollments")
      .delete()
      .eq("pointer_id", input.flow_id)
      .eq("organization_id", ctx.organizationId);
    if (enrollments.error)
      throw new ApiError(
        500,
        "internal_error",
        undefined,
        ctx.requestId,
        enrollments.error.message,
      );
    const unpin = await ctx.supabase
      .from("followup_flow_pointers")
      .update({ active_version_id: null, updated_at: new Date().toISOString() })
      .eq("id", input.flow_id)
      .eq("organization_id", ctx.organizationId);
    if (unpin.error)
      throw new ApiError(500, "internal_error", undefined, ctx.requestId, unpin.error.message);
    const versions = await ctx.supabase
      .from("followup_flow_versions")
      .delete()
      .eq("pointer_id", input.flow_id)
      .eq("organization_id", ctx.organizationId);
    if (versions.error)
      throw new ApiError(500, "internal_error", undefined, ctx.requestId, versions.error.message);
    const pointer = await ctx.supabase
      .from("followup_flow_pointers")
      .delete()
      .eq("id", input.flow_id)
      .eq("organization_id", ctx.organizationId);
    if (pointer.error)
      throw new ApiError(500, "internal_error", undefined, ctx.requestId, pointer.error.message);
    await audit({
      action: "followup_flow.deleted",
      actorUserId: ator(ctx),
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "followup_flow_pointer",
      resourceId: input.flow_id,
      requestId: ctx.requestId,
      metadata: { via: "mcp" },
    });
    return { deleted: true, flow_id: input.flow_id };
  },
};

const listarInscricoesShape = {
  flow_id: z.string().uuid().optional(),
  contact_id: z.string().uuid().optional(),
  status: z.enum(STATUS).optional(),
  limit: z.number().int().min(1).max(200).default(50),
};
export const crmListFollowupEnrollments: McpToolDefinition<typeof listarInscricoesShape> = {
  name: "crm_list_followup_enrollments",
  description:
    "Lista o estado real dos acompanhamentos por fluxo, contato ou status, incluindo próximo horário, passo atual, resultado e erro. Não executa nem envia nada.",
  inputSchema: listarInscricoesShape,
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  domain: "followups",
  handler: async (input, ctx) => {
    let q = ctx.supabase
      .from("followup_enrollments")
      .select(ENROLLMENT_LIST_COLUMNS)
      .eq("organization_id", ctx.organizationId)
      .order("updated_at", { ascending: false })
      .limit(input.limit);
    if (input.flow_id) q = q.eq("pointer_id", input.flow_id);
    if (input.contact_id) q = q.eq("contact_id", input.contact_id);
    if (input.status) q = q.eq("status", input.status);
    const { data, error } = await q;
    if (error) throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
    return { inscricoes: data ?? [] };
  },
};

const obterInscricaoShape = { enrollment_id: z.string().uuid() };
export const crmGetFollowupEnrollment: McpToolDefinition<typeof obterInscricaoShape> = {
  name: "crm_get_followup_enrollment",
  description:
    "Consulta uma inscrição de follow-up e seu histórico de eventos, próximo passo, erro e resultado. O id é sempre validado dentro da organização do token.",
  inputSchema: obterInscricaoShape,
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  domain: "followups",
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase
      .from("followup_enrollments")
      .select(
        "id, status, contact_id, pointer_id, version_id, current_node_id, next_eval_at, claimed_until, started_at, completed_at, updated_at, outcome, cancel_reason, last_error, attempts, max_attempts, steps_taken",
      )
      .eq("organization_id", ctx.organizationId)
      .eq("id", input.enrollment_id)
      .maybeSingle();
    if (error) throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
    if (!data)
      throw new ApiError(404, "not_found", undefined, ctx.requestId, "Inscrição não encontrada.");
    const ev = await ctx.supabase
      .from("followup_enrollment_events")
      .select("id, node_id, event_type, payload, created_at")
      .eq("organization_id", ctx.organizationId)
      .eq("enrollment_id", input.enrollment_id)
      .order("created_at")
      .limit(500);
    if (ev.error)
      throw new ApiError(500, "internal_error", undefined, ctx.requestId, ev.error.message);
    return {
      inscricao: data,
      eventos: ev.data ?? [],
      eventos_truncados: (ev.data?.length ?? 0) === 500,
    };
  },
};

const controlarInscricaoShape = {
  enrollment_id: z.string().uuid(),
  action: z.enum(["pause", "resume", "snooze", "skip", "cancel"]),
  next_eval_at: z.string().datetime({ offset: true }).optional(),
  edge_id: z.string().min(1).max(200).optional(),
  reason: z.string().min(1).max(200).optional(),
};
export const crmControlFollowupEnrollment: McpToolDefinition<typeof controlarInscricaoShape> = {
  name: "crm_control_followup_enrollment",
  description:
    "Pausa, retoma, adia, pula um passo ou cancela uma inscrição existente pelo mecanismo oficial. Configurar/editar fluxo não envia agora; esta operação também não força mensagem imediata e respeita o relógio/claim do worker.",
  inputSchema: controlarInscricaoShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  domain: "followups",
  auditResource: (i) => ({ type: "followup_enrollment", id: i.enrollment_id }),
  handler: async (input, ctx) => {
    let result: unknown;
    if (input.action === "pause")
      result = await pausaEnrollment(depsIntervencao(ctx), input.enrollment_id);
    else if (input.action === "resume")
      result = await retomaEnrollment(depsIntervencao(ctx), input.enrollment_id);
    else if (input.action === "snooze") {
      if (!input.next_eval_at)
        throw new ApiError(
          422,
          "validation_failed",
          undefined,
          ctx.requestId,
          "next_eval_at é obrigatório para snooze.",
        );
      result = await adiaEnrollment(depsIntervencao(ctx), input.enrollment_id, input.next_eval_at);
    } else if (input.action === "skip")
      result = await pulaPassoDoEnrollment(
        depsIntervencao(ctx),
        input.enrollment_id,
        input.edge_id ?? null,
      );
    else {
      const { data: existing, error } = await ctx.supabase
        .from("followup_enrollments")
        .select("id, status, current_node_id")
        .eq("organization_id", ctx.organizationId)
        .eq("id", input.enrollment_id)
        .maybeSingle();
      if (error) throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
      if (!existing)
        throw new ApiError(404, "not_found", undefined, ctx.requestId, "Inscrição não encontrada.");
      if (!["active", "waiting_reply", "paused_handoff", "paused_manual"].includes(existing.status))
        return { changed: false, reason: "already_terminal", status: existing.status };
      const now = new Date().toISOString();
      const upd = await ctx.supabase
        .from("followup_enrollments")
        .update({
          status: "cancelled",
          cancel_reason: input.reason ?? "manual",
          next_eval_at: null,
          outcome: null,
          completed_at: now,
          updated_at: now,
        })
        .eq("organization_id", ctx.organizationId)
        .eq("id", input.enrollment_id)
        .eq("status", existing.status)
        .select("id, status, cancel_reason, updated_at")
        .maybeSingle();
      if (upd.error)
        throw new ApiError(500, "internal_error", undefined, ctx.requestId, upd.error.message);
      if (!upd.data) return { changed: false, reason: "concurrent_change" };
      const evento = await ctx.supabase.from("followup_enrollment_events").insert({
        organization_id: ctx.organizationId,
        enrollment_id: input.enrollment_id,
        node_id: existing.current_node_id,
        event_type: "cancelled_manual",
        payload: { actor_user_id: userId(ctx), reason: input.reason ?? "manual" },
      });
      if (evento.error)
        logger.error("[mcp.followup.cancel] event insert failed", {
          error: evento.error.message,
          requestId: ctx.requestId,
          enrollmentId: input.enrollment_id,
        });
      result = { ok: true, status_novo: "cancelled", enrollment: existing };
    }
    const r = result as {
      ok?: boolean;
      codigo?: string;
      mensagem?: string;
      status_novo?: string;
      next_eval_at?: string | null;
    };
    if (r.ok === false) return { changed: false, reason: r.codigo, message: r.mensagem };
    const auditAction = {
      pause: "followup_enrollment.paused",
      resume: "followup_enrollment.resumed",
      snooze: "followup_enrollment.snoozed",
      skip: "followup_enrollment.step_skipped",
      cancel: "followup_enrollment.cancelled",
    } as const;
    await audit({
      action: auditAction[input.action],
      actorUserId: ator(ctx),
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "followup_enrollment",
      resourceId: input.enrollment_id,
      requestId: ctx.requestId,
      metadata: {
        via: "mcp",
        edge_id: input.edge_id ?? null,
        next_eval_at: input.next_eval_at ?? null,
      },
    });
    return {
      changed: true,
      enrollment_id: input.enrollment_id,
      status: r.status_novo ?? "cancelled",
      next_eval_at: r.next_eval_at ?? null,
    };
  },
};

export const FOLLOWUP_ADMIN_MCP_TOOLS = [
  crmListFollowupFlows,
  crmGetFollowupFlow,
  crmCreateFollowupFlow,
  crmUpdateFollowupFlow,
  crmPreflightFollowupFlow,
  crmPublishFollowupFlow,
  crmSetFollowupFlowActive,
  crmDeleteFollowupFlow,
  crmListFollowupEnrollments,
  crmGetFollowupEnrollment,
  crmControlFollowupEnrollment,
] as const;
