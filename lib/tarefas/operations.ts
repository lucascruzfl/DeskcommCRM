import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Actor } from "@/lib/api/handlers/types";
import { ApiError } from "@/lib/api/types";
import { audit } from "@/lib/audit";
import { registraAtividadeDaTarefa } from "@/lib/tarefas/atividade";
import { PRIORIDADES_DA_TAREFA, SITUACOES_DA_TAREFA, type Tarefa } from "@/lib/tarefas/tipos";

const COLUNAS = "id, organization_id, title, description, due_date, priority, status, lead_id, contact_id, assigned_to, created_by, created_at, updated_at";

export const taskCreateSchema = z.object({
  title: z.string().trim().min(1).max(255),
  description: z.string().max(5000).nullable().optional(),
  due_date: z.string().datetime({ offset: true }).nullable().optional(),
  priority: z.enum(PRIORIDADES_DA_TAREFA).default("medium"),
  status: z.enum(SITUACOES_DA_TAREFA).default("pending"),
  lead_id: z.string().uuid().nullable().optional(),
  contact_id: z.string().uuid().nullable().optional(),
  assigned_to: z.string().uuid().nullable().optional(),
});

export const taskUpdateSchema = taskCreateSchema.partial().refine((v) => Object.keys(v).length > 0, { message: "Nada para alterar." });

export interface TaskContext { supabase: SupabaseClient; organizationId: string; actor: Actor; requestId: string; apiTokenId?: string }

function auditActor(ctx: TaskContext) {
  return ctx.actor.type === "user"
    ? { user: ctx.actor.id, token: null, metadata: { actor_type: "user" } }
    : { user: null, token: ctx.apiTokenId ?? (ctx.actor.type === "api_token" ? ctx.actor.id : null), metadata: { actor_type: ctx.actor.type, actor_id: ctx.actor.id, via: "mcp" } };
}

async function validarReferencias(ctx: TaskContext, input: { lead_id?: string | null; contact_id?: string | null; assigned_to?: string | null }) {
  if (input.lead_id) {
    const { data } = await ctx.supabase.from("crm_leads").select("id").eq("organization_id", ctx.organizationId).eq("id", input.lead_id).maybeSingle();
    if (!data) throw new ApiError(422, "validation_failed", undefined, ctx.requestId, "Negócio não encontrado nesta organização.");
  }
  if (input.contact_id) {
    const { data } = await ctx.supabase.from("contacts").select("id").eq("organization_id", ctx.organizationId).eq("id", input.contact_id).maybeSingle();
    if (!data) throw new ApiError(422, "validation_failed", undefined, ctx.requestId, "Contato não encontrado nesta organização.");
  }
  if (input.assigned_to) {
    const { data } = await ctx.supabase.from("user_organizations").select("user_id")
      .eq("organization_id", ctx.organizationId).eq("user_id", input.assigned_to).is("revoked_at", null).maybeSingle();
    if (!data) throw new ApiError(422, "validation_failed", undefined, ctx.requestId, "Responsável não encontrado nesta organização.");
  }
}

export async function listarTarefas(ctx: TaskContext, filters: {
  status?: string; priority?: string; lead_id?: string; contact_id?: string; assigned_to?: string;
  due_from?: string; due_to?: string; open_only?: boolean; limit: number; offset: number;
}) {
  let query = ctx.supabase.from("crm_tasks").select(COLUNAS, { count: "exact" })
    .eq("organization_id", ctx.organizationId).order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false }).range(filters.offset, filters.offset + filters.limit - 1);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.priority) query = query.eq("priority", filters.priority);
  if (filters.lead_id) query = query.eq("lead_id", filters.lead_id);
  if (filters.contact_id) query = query.eq("contact_id", filters.contact_id);
  if (filters.assigned_to) query = query.eq("assigned_to", filters.assigned_to);
  if (filters.due_from) query = query.gte("due_date", filters.due_from);
  if (filters.due_to) query = query.lte("due_date", filters.due_to);
  if (filters.open_only) query = query.in("status", ["pending", "in_progress"]);
  const { data, error, count } = await query;
  if (error) throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
  return { tasks: (data ?? []) as unknown as Tarefa[], total: count ?? 0, offset: filters.offset, has_more: filters.offset + filters.limit < (count ?? 0) };
}

export async function obterTarefa(ctx: TaskContext, taskId: string): Promise<Tarefa> {
  const { data, error } = await ctx.supabase.from("crm_tasks").select(COLUNAS)
    .eq("organization_id", ctx.organizationId).eq("id", taskId).maybeSingle();
  if (error) throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
  if (!data) throw new ApiError(404, "not_found", undefined, ctx.requestId, "Tarefa não encontrada.");
  return data as unknown as Tarefa;
}

export async function criarTarefa(ctx: TaskContext, raw: z.input<typeof taskCreateSchema>) {
  const input = taskCreateSchema.parse(raw);
  await validarReferencias(ctx, input);
  const { data, error } = await ctx.supabase.from("crm_tasks").insert({ ...input, organization_id: ctx.organizationId, created_by: ctx.actor.type === "user" ? ctx.actor.id : null }).select(COLUNAS).single();
  if (error || !data) throw new ApiError(500, "internal_error", undefined, ctx.requestId, error?.message);
  const task = data as unknown as Tarefa;
  const a = auditActor(ctx);
  await audit({ action: "crm_task.created", organizationId: ctx.organizationId, actorUserId: a.user, actorApiTokenId: a.token,
    resourceType: "crm_tasks", resourceId: task.id, requestId: ctx.requestId, metadata: { ...a.metadata, due_date: task.due_date, priority: task.priority } });
  await registraAtividadeDaTarefa(ctx.supabase, { organizationId: ctx.organizationId, tarefa: task, tipo: "task_created", actor: ctx.actor });
  return task;
}

export async function atualizarTarefa(ctx: TaskContext, taskId: string, raw: z.input<typeof taskUpdateSchema>) {
  const input = taskUpdateSchema.parse(raw);
  await validarReferencias(ctx, input);
  const before = await obterTarefa(ctx, taskId);
  const { data, error } = await ctx.supabase.from("crm_tasks").update(input)
    .eq("organization_id", ctx.organizationId).eq("id", taskId).select(COLUNAS).maybeSingle();
  if (error) throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
  if (!data) throw new ApiError(404, "not_found", undefined, ctx.requestId, "Tarefa não encontrada.");
  const task = data as unknown as Tarefa;
  const a = auditActor(ctx);
  await audit({ action: "crm_task.updated", organizationId: ctx.organizationId, actorUserId: a.user, actorApiTokenId: a.token,
    resourceType: "crm_tasks", resourceId: task.id, requestId: ctx.requestId, metadata: { ...a.metadata, fields: Object.keys(input) } });
  if (task.status === "done" && before.status !== "done") await registraAtividadeDaTarefa(ctx.supabase, { organizationId: ctx.organizationId, tarefa: task, tipo: "task_completed", actor: ctx.actor });
  return task;
}

export async function excluirTarefa(ctx: TaskContext, taskId: string) {
  await obterTarefa(ctx, taskId);
  const { data, error } = await ctx.supabase.from("crm_tasks").delete().eq("organization_id", ctx.organizationId).eq("id", taskId).select("id");
  if (error) throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
  if (!data?.length) throw new ApiError(404, "not_found", undefined, ctx.requestId, "Tarefa não encontrada.");
  const a = auditActor(ctx);
  await audit({ action: "crm_task.deleted", organizationId: ctx.organizationId, actorUserId: a.user, actorApiTokenId: a.token,
    resourceType: "crm_tasks", resourceId: taskId, requestId: ctx.requestId, metadata: a.metadata });
  return { task_id: taskId, deleted: true };
}
