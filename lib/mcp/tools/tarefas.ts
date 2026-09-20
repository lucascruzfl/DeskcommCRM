import { z } from "zod";

import type { McpContext, McpToolDefinition } from "../types";
import { PRIORIDADES_DA_TAREFA, SITUACOES_DA_TAREFA } from "@/lib/tarefas/tipos";
import { atualizarTarefa, criarTarefa, excluirTarefa, listarTarefas, obterTarefa } from "@/lib/tarefas/operations";

function ctx(input: McpContext) {
  return { supabase: input.supabase, organizationId: input.organizationId, actor: input.actor, requestId: input.requestId, apiTokenId: input.apiTokenId };
}

const listShape = {
  status: z.enum(SITUACOES_DA_TAREFA).optional(),
  priority: z.enum(PRIORIDADES_DA_TAREFA).optional(),
  lead_id: z.string().uuid().optional(),
  contact_id: z.string().uuid().optional(),
  assigned_to: z.string().uuid().optional(),
  due_from: z.string().datetime({ offset: true }).optional(),
  due_to: z.string().datetime({ offset: true }).optional(),
  open_only: z.boolean().default(false),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).max(10_000).default(0),
};

export const crmListTasks: McpToolDefinition<typeof listShape> = {
  name: "crm_list_tasks",
  description: "Lista tarefas comerciais reais com filtros de situação, prioridade, negócio, contato, responsável e prazo. A resposta é paginada e não mistura compromissos da Agenda.",
  inputSchema: listShape, category: "read", requiresRole: "agent", requiresScope: "mcp:read", domain: "leads",
  handler: (input, context) => listarTarefas(ctx(context), input),
};

const getShape = { task_id: z.string().uuid() };
export const crmGetTask: McpToolDefinition<typeof getShape> = {
  name: "crm_get_task", description: "Consulta uma tarefa comercial pelo UUID, sem misturar compromissos da Agenda.",
  inputSchema: getShape, category: "read", requiresRole: "agent", requiresScope: "mcp:read", domain: "leads",
  handler: async (input, context) => ({ task: await obterTarefa(ctx(context), input.task_id) }),
};

const writeFields = {
  title: z.string().trim().min(1).max(255),
  description: z.string().max(5000).nullable().optional(),
  due_date: z.string().datetime({ offset: true }).nullable().optional(),
  priority: z.enum(PRIORIDADES_DA_TAREFA).default("medium"),
  status: z.enum(SITUACOES_DA_TAREFA).default("pending"),
  lead_id: z.string().uuid().nullable().optional(),
  contact_id: z.string().uuid().nullable().optional(),
  assigned_to: z.string().uuid().nullable().optional(),
};
export const crmCreateTask: McpToolDefinition<typeof writeFields> = {
  name: "crm_create_task", description: "Cria uma tarefa comercial e, quando vinculada a um negócio, registra task_created na timeline oficial. Referências e responsável precisam pertencer ao tenant do token.",
  inputSchema: writeFields, category: "write", requiresRole: "agent", requiresScope: "mcp:write", domain: "leads",
  auditResource: (_input, result) => ({ type: "crm_tasks", id: (result as { task?: { id?: string } } | undefined)?.task?.id }),
  handler: async (input, context) => ({ task: await criarTarefa(ctx(context), input) }),
};

const updateShape = {
  task_id: z.string().uuid(), title: z.string().trim().min(1).max(255).optional(),
  description: z.string().max(5000).nullable().optional(), due_date: z.string().datetime({ offset: true }).nullable().optional(),
  priority: z.enum(PRIORIDADES_DA_TAREFA).optional(), status: z.enum(SITUACOES_DA_TAREFA).optional(),
  lead_id: z.string().uuid().nullable().optional(), contact_id: z.string().uuid().nullable().optional(), assigned_to: z.string().uuid().nullable().optional(),
};
export const crmUpdateTask: McpToolDefinition<typeof updateShape> = {
  name: "crm_update_task", description: "Atualiza, conclui, reabre ou cancela uma tarefa comercial. A primeira transição para done registra task_completed na timeline do negócio; use status pending/in_progress para reabrir.",
  inputSchema: updateShape, category: "write", requiresRole: "agent", requiresScope: "mcp:write", domain: "leads",
  auditResource: (input) => ({ type: "crm_tasks", id: input.task_id }),
  handler: async (input, context) => { const { task_id, ...patch } = input; return { task: await atualizarTarefa(ctx(context), task_id, patch) }; },
};

export const crmDeleteTask: McpToolDefinition<typeof getShape> = {
  name: "crm_delete_task", description: "Exclui definitivamente uma tarefa comercial existente. Exige capability destructive_operations; para desistir sem apagar histórico, prefira crm_update_task com status cancelled.",
  inputSchema: getShape, category: "write", requiresRole: "manager", requiresScope: "mcp:write", domain: "leads",
  capabilities: ["destructive_operations"], auditResource: (input) => ({ type: "crm_tasks", id: input.task_id }),
  handler: (input, context) => excluirTarefa(ctx(context), input.task_id),
};

export const CRM_TASK_TOOLS = [crmListTasks, crmGetTask, crmCreateTask, crmUpdateTask, crmDeleteTask] as const;
